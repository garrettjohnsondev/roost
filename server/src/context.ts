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

/** Whether to compact, and whether the person gets asked first.
 *
 *  Only compaction is ever offered as a one-tap action. `dispatch` needs a task
 *  to dispatch, and `handoff` costs continuity -- neither is a thing to do to
 *  someone's live session because a meter crossed a line. They stay advice.
 *
 *  `handledAt` is the pressure an offer was last made or acted on at, so the
 *  card appears once per ESCALATION rather than after every turn. Without it a
 *  degrading session re-asks on every single reply, which trains the person to
 *  dismiss it -- the surest way to make a useful prompt useless. */
export type CompactionIntent =
  /** `forget` means pressure has fallen back, so the caller should clear the
   *  level it last asked at. Without this the first compaction is the LAST one
   *  ever offered: pressure drops, climbs to 'degrading' again, matches the
   *  remembered level, and the card never returns for a context that is full
   *  again. Returned from the pure function rather than inferred by the caller,
   *  so the rule is testable. */
  | { kind: 'none'; forget?: boolean }
  | { kind: 'offer'; reason: string; percent: number | null; pressure: ContextPressure }
  | { kind: 'auto'; reason: string; percent: number | null; pressure: ContextPressure };

export function compactionIntent(opts: {
  state: ContextState | null;
  /** The remembered "keep doing this automatically" setting. */
  auto: boolean;
  handledAt: ContextPressure | null;
}): CompactionIntent {
  const s = opts.state;
  if (!s) return { kind: 'none' };
  // Unknown is never treated as pressure -- missing data is not a reading, and
  // compacting someone's context off the back of a null would be the most
  // destructive version of that mistake. This is enforced HERE and only here:
  // pressureFor(null) is 'unknown', which satisfies neither arm, so a null
  // percent can only ever get through on an explicit overLimit from the engine.
  // An earlier `if (percent == null && !overLimit) return none` guard above this
  // line was dead code -- mutation testing showed removing it broke nothing --
  // and a dead guard that looks load-bearing is worse than no guard, because the
  // next person trusts it instead of this.
  const worth = !!s.overLimit || s.pressure === 'degrading' || s.pressure === 'critical';
  if (!worth) {
    // Only a definite low reading forgets. 'unknown' must not: losing the meter
    // is not evidence the context drained.
    const fellBack = s.pressure === 'clear' || s.pressure === 'filling';
    return fellBack ? { kind: 'none', forget: true } : { kind: 'none' };
  }
  if (opts.handledAt === s.pressure) return { kind: 'none' };
  const reason =
    s.advice?.reason ??
    (s.percent != null ? `context ${s.percent}% full` : 'past the context window');
  const base = { reason, percent: s.percent, pressure: s.pressure };
  return opts.auto ? { kind: 'auto', ...base } : { kind: 'offer', ...base };
}
