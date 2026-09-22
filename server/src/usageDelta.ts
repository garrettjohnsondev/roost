import { splitCodexInput } from './codexInputSplit.js';

/** Both engines report RUNNING TOTALS, not per-call figures:
 *   - Claude SDK: "each result carries the running total so far, so read the
 *     latest result rather than summing across results" (sdk.d.ts:4992)
 *   - Codex app-server: tokenUsage.total is thread-cumulative
 *  Recording either verbatim is the bug that produced agent-sync's 15-18M-token
 *  single calls and its $1,193 of fictional Codex spend. These functions are the
 *  one place the conversion happens, so it can be tested in isolation. */

export interface ClaudeDelta {
  key: string;
  model: string;
  inTok: number;
  outTok: number;
  cacheReadTok: number;
  cacheWriteTok: number;
  reasoningTok: number;
  costUsd: number;
  priced: boolean;
}

/** Diff cumulative per-model totals. A negative delta means the counter was
 *  rebased (/clear, resume, compaction) — take the fresh value, don't emit
 *  nonsense. Models whose numbers didn't move are skipped entirely. */
export function claudeDeltas(prev: Map<string, any>, modelUsage: any): ClaudeDelta[] {
  if (!modelUsage || typeof modelUsage !== 'object') return [];
  const out: ClaudeDelta[] = [];
  for (const [key, cur] of Object.entries<any>(modelUsage)) {
    if (!cur) continue;
    const was = prev.get(key);
    const d = (f: string) => {
      const n = Number(cur[f] ?? 0);
      const w = Number(was?.[f] ?? 0);
      const delta = n - w;
      return delta < 0 ? n : delta;
    };
    const inTok = d('inputTokens');
    const outTok = d('outputTokens');
    const cacheReadTok = d('cacheReadInputTokens');
    const cacheWriteTok = d('cacheCreationInputTokens');
    prev.set(key, cur);
    if (!inTok && !outTok && !cacheReadTok && !cacheWriteTok) continue;
    out.push({
      key,
      model: String(cur.canonicalModel ?? key),
      inTok,
      outTok,
      cacheReadTok,
      cacheWriteTok,
      reasoningTok: d('thinkingTokens'),
      costUsd: d('costUSD'),
      // SDK ModelUsage.costBasis: 'list' | 'managed' | 'unknown'. 'unknown' means
      // "no pricing row matched, costUSD is a GUESS at the default model's rate".
      // Absent means 'list' (older builds, right after --resume). The field was
      // previously read as `pricingBasis`, which does not exist, so every guess
      // was recorded as authoritative -- the catch-all-price-row bug again.
      priced: (cur.costBasis ?? 'list') !== 'unknown',
    });
  }
  return out;
}

export interface CodexDelta {
  inTok: number;
  outTok: number;
  cacheReadTok: number;
  cacheWriteTok: number;
  reasoningTok: number;
}

const FIELDS: Array<[keyof CodexRaw, string, string]> = [
  ['inputTokens', 'inputTokens', 'input_tokens'],
  ['cachedInputTokens', 'cachedInputTokens', 'cached_input_tokens'],
  ['cacheWriteInputTokens', 'cacheWriteInputTokens', 'cache_write_input_tokens'],
  ['outputTokens', 'outputTokens', 'output_tokens'],
  ['reasoningOutputTokens', 'reasoningOutputTokens', 'reasoning_output_tokens'],
];

export interface CodexRaw {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export function readCodexBreakdown(o: any): CodexRaw {
  const out = {} as CodexRaw;
  for (const [k, camel, snake] of FIELDS) out[k] = Number(o?.[camel] ?? o?.[snake] ?? 0);
  return out;
}

/** Returns the per-call delta plus the new baseline. `last` is the engine's own
 *  per-turn breakdown, used only as the fallback when totals go backwards. */
export function codexDelta(prev: CodexRaw | null, totalRaw: any, lastRaw: any): { delta: CodexDelta | null; next: CodexRaw } {
  const cur = readCodexBreakdown(totalRaw);
  let d: CodexRaw;
  if (!prev) {
    // No baseline yet. On a RESUMED thread `total` is the whole prior history,
    // and taking it as the first call re-creates the 15-18M-token phantom in
    // a new coat. `last` is this turn; on a fresh thread it equals `total`.
    const first = readCodexBreakdown(lastRaw);
    d = first.inputTokens || first.outputTokens || first.cachedInputTokens ? first : { ...cur };
  } else {
    d = {} as CodexRaw;
    let negative = false;
    for (const [k] of FIELDS) {
      d[k] = cur[k] - prev[k];
      if (d[k] < 0) negative = true;
    }
    if (negative) d = readCodexBreakdown(lastRaw);
  }
  if (!d.inputTokens && !d.outputTokens && !d.cachedInputTokens && !d.cacheWriteInputTokens) {
    return { delta: null, next: cur };
  }
  const { uncached, cached } = splitCodexInput(d.inputTokens, d.cachedInputTokens);
  return {
    delta: {
      inTok: uncached,
      outTok: d.outputTokens,
      cacheReadTok: cached,
      cacheWriteTok: d.cacheWriteInputTokens,
      reasoningTok: d.reasoningOutputTokens,
    },
    next: cur,
  };
}
