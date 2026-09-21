import { describe, expect, it, beforeEach } from 'vitest';
import { claudeDeltas, codexDelta, type CodexRaw } from '../src/usageDelta.js';
import { splitCodexInput, __resetSplitWarningForTests } from '../src/codexInputSplit.js';

beforeEach(() => __resetSplitWarningForTests());

/** Codex's tokenUsage.total is thread-cumulative. This is the exact shape
 *  agent-sync read verbatim, logging single calls at 15-18M tokens. */
const codexTotal = (i: number, c: number, w: number, o: number, r = 0) => ({
  inputTokens: i,
  cachedInputTokens: c,
  cacheWriteInputTokens: w,
  outputTokens: o,
  reasoningOutputTokens: r,
});

describe('codexDelta — THE acceptance assertion', () => {
  // The gate: replay a real ascending sequence and require that the per-call
  // records sum to the engine's final cumulative total. Exactly. Not 3x it.
  it('per-call deltas sum to the final cumulative total, to the token', () => {
    const frames = [
      codexTotal(12_000, 8_000, 500, 300, 120),
      codexTotal(31_500, 24_000, 900, 850, 400),
      codexTotal(58_200, 46_000, 1_400, 1_600, 700),
      codexTotal(91_000, 74_000, 2_100, 2_450, 1_050),
    ];
    let prev: CodexRaw | null = null;
    let sumIn = 0;
    let sumCached = 0;
    let sumWrite = 0;
    let sumOut = 0;
    for (const f of frames) {
      const { delta, next } = codexDelta(prev, f, {});
      prev = next;
      if (!delta) continue;
      sumIn += delta.inTok;
      sumCached += delta.cacheReadTok;
      sumWrite += delta.cacheWriteTok;
      sumOut += delta.outTok;
    }
    const final = frames[frames.length - 1];
    // inputTokens is inclusive of cached, so uncached + cached must rebuild it
    expect(sumIn + sumCached).toBe(final.inputTokens);
    expect(sumCached).toBe(final.cachedInputTokens);
    expect(sumWrite).toBe(final.cacheWriteInputTokens);
    expect(sumOut).toBe(final.outputTokens);
  });

  it('a single frame is not multiplied by the whole thread history', () => {
    const { delta } = codexDelta(codexTotal(90_000, 70_000, 2_000, 2_400), codexTotal(91_000, 70_500, 2_100, 2_450), {});
    // The regression: reading total verbatim would report ~91k here.
    expect(delta!.inTok + delta!.cacheReadTok).toBe(1_000);
    expect(delta!.outTok).toBe(50);
  });

  it('falls back to the engine last-breakdown when totals go backwards', () => {
    const prev = { ...codexTotal(90_000, 70_000, 2_000, 2_400, 100) } as CodexRaw;
    const compacted = codexTotal(5_000, 3_000, 10, 20, 5); // rebased after compaction
    const last = codexTotal(4_000, 2_500, 8, 18, 4);
    const { delta, next } = codexDelta(prev, compacted, last);
    expect(delta!.outTok).toBe(18); // took `last`, not a negative delta
    expect(Object.values(delta!).every((v) => v >= 0)).toBe(true);
    expect(next.inputTokens).toBe(5_000); // re-baselined
  });

  it('emits nothing when the counters did not move', () => {
    const t = codexTotal(1_000, 500, 10, 20);
    expect(codexDelta({ ...t } as CodexRaw, t, {}).delta).toBeNull();
  });
});

describe('splitCodexInput', () => {
  it('treats inputTokens as inclusive of cached when it is larger', () => {
    expect(splitCodexInput(10_000, 8_000)).toEqual({ uncached: 2_000, cached: 8_000 });
  });

  it('handles the exclusive reading without going negative', () => {
    expect(splitCodexInput(2_000, 8_000)).toEqual({ uncached: 2_000, cached: 8_000 });
  });

  it('passes through when nothing is cached', () => {
    expect(splitCodexInput(5_000, 0)).toEqual({ uncached: 5_000, cached: 0 });
  });
});

describe('claudeDeltas', () => {
  const mu = (cost: number, inTok: number, outTok: number, cacheRead = 0) => ({
    'claude-sonnet-4': {
      inputTokens: inTok,
      outputTokens: outTok,
      cacheReadInputTokens: cacheRead,
      cacheCreationInputTokens: 0,
      thinkingTokens: 0,
      costUSD: cost,
      canonicalModel: 'claude-sonnet-4',
      pricingBasis: 'sdk',
    },
  });

  it('per-turn costs sum to the final cumulative costUSD', () => {
    const prev = new Map();
    const frames = [mu(0.5, 1_000, 100), mu(1.25, 3_000, 260), mu(2.0, 5_400, 410)];
    let sum = 0;
    let inSum = 0;
    for (const f of frames) for (const d of claudeDeltas(prev, f)) { sum += d.costUsd; inSum += d.inTok; }
    expect(sum).toBeCloseTo(2.0, 6); // the LAST cumulative value, not 3.75
    expect(inSum).toBe(5_400);
  });

  it('skips models whose counters did not move', () => {
    const prev = new Map();
    claudeDeltas(prev, mu(1, 100, 10));
    expect(claudeDeltas(prev, mu(1, 100, 10))).toHaveLength(0);
  });

  it('takes the fresh value when a counter resets', () => {
    const prev = new Map();
    claudeDeltas(prev, mu(5, 10_000, 900));
    const after = claudeDeltas(prev, mu(0.2, 400, 30));
    expect(after[0].inTok).toBe(400);
    expect(after[0].costUsd).toBeCloseTo(0.2, 6);
  });

  it('marks unpriced SDK usage as unpriced rather than free', () => {
    const prev = new Map();
    const out = claudeDeltas(prev, { m: { inputTokens: 10, outputTokens: 1, costUSD: 0, pricingBasis: 'unknown' } });
    expect(out[0].priced).toBe(false);
  });
});
