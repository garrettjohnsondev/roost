import { splitCodexInput } from './codexInputSplit.js';
import type { AgentKind } from './protocol.js';

/** There are THREE distinct contexts in this harness and conflating them is how
 *  a long session quietly degrades:
 *
 *   1. Pocket's transcript — the whole conversation. The only one we fully own.
 *   2. The engine's own session (Claude session_id / Codex threadId) — grows
 *      independently, compacts on its own schedule, and rots before it fills.
 *   3. Subagent contexts — fresh per dispatch, discarded. Where the savings are.
 *
 *  This module meters #2, which is the one that silently costs quality. Context
 *  rot is measurable well before overflow: every one of 18 frontier models
 *  tested degrades with input length, with real losses by ~50k in a 200k window
 *  (Chroma, "Context Rot"). So the thresholds here are deliberately tighter than
 *  the engine's own auto-compact trigger — by the time it compacts, the damage
 *  is already in the answers. */

export type ContextPressure = 'clear' | 'filling' | 'degrading' | 'critical' | 'unknown';

export interface ContextState {
  agent: AgentKind;
  /** null means we have not been told. Never rendered as 0%. */
  usedTokens: number | null;
  maxTokens: number | null;
  percent: number | null;
  pressure: ContextPressure;
  /** Set when the engine says we are past the window it measures against. */
  overLimit?: { tokensOver: number; kind: 'hard_limit' | 'compaction_window' };
  /** Largest consumers, when the engine breaks it down. */
  categories?: Array<{ name: string; tokens: number; kind?: string }>;
  observedAt: number;
  advice: ContextAdvice | null;
}

export interface ContextAdvice {
  action: 'dispatch' | 'compact' | 'handoff';
  reason: string;
}

/** Tighter than any engine's auto-compact threshold, on purpose. */
export const CONTEXT_THRESHOLDS = {
  filling: 40,
  degrading: 60,
  critical: 80,
};

export function pressureFor(percent: number | null): ContextPressure {
  if (percent == null) return 'unknown';
  if (percent >= CONTEXT_THRESHOLDS.critical) return 'critical';
  if (percent >= CONTEXT_THRESHOLDS.degrading) return 'degrading';
  if (percent >= CONTEXT_THRESHOLDS.filling) return 'filling';
  return 'clear';
}

/** Escalating, cheapest first. Dispatching a subagent keeps the main context
 *  clean without losing anything, which is why it outranks compaction; handing
 *  off to a fresh session seeded from the plan file is the last resort because
 *  it costs continuity. */
export function adviseContext(state: Omit<ContextState, 'advice'>): ContextAdvice | null {
  if (state.overLimit) {
    return {
      action: 'handoff',
      reason:
        state.overLimit.kind === 'hard_limit'
          ? `over the model's hard limit by ${state.overLimit.tokensOver.toLocaleString()} tokens — the next request will be refused`
          : `past the compaction window by ${state.overLimit.tokensOver.toLocaleString()} tokens`,
    };
  }
  switch (state.pressure) {
    case 'critical':
      return { action: 'handoff', reason: `context ${state.percent}% full — start a fresh session seeded from the plan file` };
    case 'degrading':
      return { action: 'compact', reason: `context ${state.percent}% full — quality degrades well before the window fills` };
    case 'filling':
      return { action: 'dispatch', reason: `context ${state.percent}% full — send read-heavy work to a subagent to keep this one clean` };
    default:
      return null;
  }
}

/** Claude's SDKContextUsage -> our shape. `detail:'summary'` answers from the
 *  last response plus local estimates, so this is cheap enough to poll. */
export function fromClaudeContextUsage(resp: any): Omit<ContextState, 'advice'> | null {
  const u = resp?.context_usage ?? resp;
  if (!u) return null;
  // `query.getContextUsage()` resolves SDKControlGetContextUsageResponse, which
  // is camelCase (totalTokens, rawMaxTokens, categories[].isDeferred). The
  // snake_case SDKContextUsage only ever appears as `context_usage` on the
  // synthetic assistant message a /context slash command produces. This read
  // the snake_case names on the camelCase response, returned null on every
  // real call, and the Claude context meter never emitted once.
  const total = typeof u.totalTokens === 'number' ? u.totalTokens : u.total_tokens;
  if (typeof total !== 'number') return null;
  const max = typeof u.rawMaxTokens === 'number' ? u.rawMaxTokens : u.raw_max_tokens;
  const percent = typeof u.percentage === 'number' ? Math.round(u.percentage) : null;
  const categories = Array.isArray(u.categories)
    ? u.categories
        .filter((c: any) => c && typeof c.tokens === 'number' && c.kind !== 'deferred' && c.isDeferred !== true)
        .map((c: any) => ({ name: String(c.name ?? c.category ?? 'other'), tokens: c.tokens, kind: c.kind }))
        .sort((a: any, b: any) => b.tokens - a.tokens)
        .slice(0, 8)
    : undefined;
  return {
    agent: 'claude',
    usedTokens: total,
    maxTokens: typeof max === 'number' ? max : null,
    percent,
    pressure: pressureFor(percent),
    overLimit: u.over_limit ? { tokensOver: u.over_limit.tokens_over, kind: u.over_limit.kind } : undefined,
    categories,
    observedAt: Date.now(),
  };
}

/** Codex reports a context window and a per-turn breakdown rather than a
 *  category table; `last` is what currently occupies the window. */
export function fromCodexTokenUsage(last: any, modelContextWindow: number | null | undefined): Omit<ContextState, 'advice'> | null {
  if (!modelContextWindow) return null;
  // inputTokens already INCLUDES cachedInputTokens (codexInputSplit.ts is the
  // one place that assumption lives). Adding cached on top double-counted the
  // cache and disagreed with the contextPct the adapter emits from the same
  // notification.
  const split = splitCodexInput(
    Number(last?.inputTokens ?? last?.input_tokens ?? 0),
    Number(last?.cachedInputTokens ?? last?.cached_input_tokens ?? 0),
  );
  const used = split.uncached + split.cached + Number(last?.outputTokens ?? last?.output_tokens ?? 0);
  if (!used) return null;
  const percent = Math.min(100, Math.round((used / modelContextWindow) * 100));
  return {
    agent: 'codex',
    usedTokens: used,
    maxTokens: modelContextWindow,
    percent,
    pressure: pressureFor(percent),
    observedAt: Date.now(),
  };
}

export function withAdvice(state: Omit<ContextState, 'advice'> | null): ContextState | null {
  if (!state) return null;
  return { ...state, advice: adviseContext(state) };
}
