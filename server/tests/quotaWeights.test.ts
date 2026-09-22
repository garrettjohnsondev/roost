import { describe, expect, it } from 'vitest';
import { estimateWeights } from '../src/quotaWeights.js';

const H = (at: number, usedPercent: number) => ({ at, agent: 'codex' as const, key: 'codex:primary', usedPercent });
const C = (at: number, model: string, tokens: number) => ({ at, agent: 'codex' as const, model, inTok: tokens, outTok: 0, cacheReadTok: 0, cacheWriteTok: 0 });
const m = 60_000;

describe('window weights are measured, never derived', () => {
  it('fits percent per million tokens from single-model intervals', () => {
    // Three intervals, each moving the window by 1% on 100k tokens of Luna.
    const history = [H(0, 40), H(10 * m, 41), H(20 * m, 42), H(30 * m, 43)];
    const calls = [C(5 * m, 'luna', 100_000), C(15 * m, 'luna', 100_000), C(25 * m, 'luna', 100_000)];
    const [w] = estimateWeights(history, calls);
    expect(w.model).toBe('luna');
    expect(w.samples).toBe(3);
    expect(w.pctPerMillionTokens).toBe(10); // 3% over 300k tokens
    expect(w.confidence).toBe('low');
  });

  it('is null below three samples -- never a guess', () => {
    const [w] = estimateWeights([H(0, 40), H(10 * m, 41)], [C(5 * m, 'luna', 100_000)]);
    expect(w.pctPerMillionTokens).toBeNull();
    expect(w.confidence).toBe('none');
    expect(w.note).toMatch(/need 3/);
  });

  it('skips a reset and a mixed-model interval, and says when the window never moved', () => {
    const history = [H(0, 90), H(10 * m, 2), H(20 * m, 2), H(30 * m, 2), H(40 * m, 2), H(50 * m, 2)];
    const calls = [
      C(5 * m, 'luna', 1000),                           // inside the reset interval: skipped
      C(15 * m, 'luna', 1000), C(16 * m, 'astra', 1000), // mixed: skipped
      C(25 * m, 'luna', 1000), C(35 * m, 'luna', 1000), C(45 * m, 'luna', 1000),
    ];
    const [w] = estimateWeights(history, calls);
    expect(w.samples).toBe(3);
    expect(w.pctMoved).toBe(0);
    expect(w.pctPerMillionTokens).toBeNull();
    expect(w.note).toMatch(/below the window's 1% resolution/);
  });

  it('ignores intervals longer than the gap limit, where other machines dominate', () => {
    const history = [H(0, 40), H(10 * 3600_000, 60)];
    expect(estimateWeights(history, [C(3600_000, 'luna', 1000)])).toEqual([]);
  });
});
