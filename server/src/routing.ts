import type { AgentKind } from './protocol.js';
import type { Tier } from './router.js';
import type { HeadroomState } from './quota.js';

/** Mechanical work (renames, formatting, applying a described edit) gains
 *  nothing from a large thinking budget — Aider's architect/editor result works
 *  precisely because the editor is a transcriber, not a reasoner. Reasoning work
 *  is where effort buys correctness. */
export type TaskKind = 'mechanical' | 'reasoning' | 'mixed';

export interface EffortDecision {
  effort: string;
  reason: string;
  /** The requested level was not supported by this model and was clamped. The
   *  SDK would otherwise downgrade silently, which hides the real setting. */
  clamped: boolean;
  /** The model chooses its own budget; we deliberately did not override it. */
  adaptive: boolean;
  steppedFrom?: string;
}

/** Changing top-level effort mid-conversation INVALIDATES THE PROMPT CACHE on
 *  every model without the per-message output-config beta. Cache reads bill at
 *  ~1/10 of input, so an effort router that flips per message can easily spend
 *  more on cache misses than it saves on thinking. Effort changes are therefore
 *  gated by hysteresis (see shouldApplyEffort) and preferred at boundaries where
 *  there is no warm cache to lose: a new session, or a fresh subagent dispatch.
 *  Anthropic also warns the steer is unreliable mid-flight — earlier replies were
 *  written at the previous level and the model stays consistent with them. */

/** Ordered weakest → strongest. Codex starts a rung lower than Claude. */
export const EFFORT_LADDER: Record<AgentKind, string[]> = {
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['minimal', 'low', 'medium', 'high', 'xhigh'],
};

/** Fallback only. The real base comes from the user's own
 *  autoRoute[agent][tier].effort, so routing tunes their configuration rather
 *  than overriding it — and so the two ladders (Codex carries an extra
 *  `minimal` rung) can't drift apart through naive shared indexing.
 *
 *  These defaults stop at `high` rather than `xhigh` deliberately: Anthropic
 *  warns `max` "can lead to overthinking" on structured work, and the
 *  inverted-U result in "When More Thinking Hurts" (ACL Findings 2026) finds
 *  extended reasoning abandoning previously correct answers. Bias up for hard
 *  tasks, but do not top out by default. */
const FALLBACK_BASE: Record<AgentKind, Record<Tier, string>> = {
  claude: { light: 'low', standard: 'medium', heavy: 'high' },
  codex: { light: 'minimal', standard: 'medium', heavy: 'high' },
};

function clampIndex(i: number, ladder: string[]): number {
  return Math.max(0, Math.min(ladder.length - 1, i));
}

/** Pick a reasoning budget for one task.
 *
 *  Effort is stepped BEFORE model under quota pressure, because it is the
 *  cheaper concession: reasoning tokens bill as OUTPUT (~5x input), so trimming
 *  effort removes the expensive half of a call while keeping the better model.
 *  Under surplus it is raised first for the same reason — thinking is the best
 *  thing to spend a window on that is about to reset. */
export function chooseEffort(opts: {
  tier: Tier;
  kind: TaskKind;
  agent: AgentKind;
  headroom: HeadroomState;
  surplus?: boolean;
  /** ModelInfo.supportedEffortLevels, when the engine told us. */
  supported?: string[] | null;
  /** ModelInfo.supportsAdaptiveThinking — the model budgets itself. */
  adaptive?: boolean;
  /** Explicit user choice always wins; routing never overrides a person. */
  override?: string | null;
  /** The configured effort for this tier (autoRoute[agent][tier].effort).
   *  Routing modulates the user's setting rather than replacing it. */
  configured?: string | null;
}): EffortDecision {
  const ladder = EFFORT_LADDER[opts.agent];

  if (opts.override) {
    return { effort: opts.override, reason: 'set by you', clamped: false, adaptive: false };
  }

  // A model that budgets its own thinking beats any fixed guess we could make.
  if (opts.adaptive) {
    return { effort: '', reason: 'model chooses its own thinking budget', clamped: false, adaptive: true };
  }

  const baseEffort = opts.configured || FALLBACK_BASE[opts.agent][opts.tier];
  let idx = ladder.indexOf(baseEffort);
  if (idx < 0) idx = ladder.indexOf(FALLBACK_BASE[opts.agent][opts.tier]);
  const notes: string[] = [`${opts.tier} task`];

  if (opts.kind === 'mechanical') {
    // Cap rather than floor: a heavy-tier mechanical job is still transcription.
    idx = Math.min(idx, 1);
    notes.push('mechanical work needs little thinking');
  } else if (opts.kind === 'reasoning' && opts.tier !== 'light') {
    idx += 1;
    notes.push('reasoning-heavy');
  }

  const before = ladder[clampIndex(idx, ladder)];

  if (opts.headroom === 'exhausted' || opts.headroom === 'gated') {
    idx = 0;
    notes.push(`quota ${opts.headroom} — minimum thinking`);
  } else if (opts.headroom === 'tight') {
    idx -= 1;
    notes.push('quota tight — trimming thinking before downgrading the model');
  } else if (opts.surplus) {
    idx += 1;
    notes.push('window resets soon with headroom — spending it on thinking');
  } else if (opts.headroom === 'unknown' || opts.headroom === 'stale') {
    idx = Math.min(idx, 2);
    notes.push('no live quota data — staying conservative');
  }

  idx = clampIndex(idx, ladder);
  let effort = ladder[idx];
  let clamped = false;

  // Never request a level the model does not implement: the SDK silently
  // downgrades, which would make the UI claim an effort that never applied.
  if (opts.supported && opts.supported.length) {
    if (!opts.supported.includes(effort)) {
      const allowed = ladder.filter((l) => opts.supported!.includes(l));
      if (allowed.length) {
        const target = ladder.indexOf(effort);
        effort = allowed.reduce((best, cur) =>
          Math.abs(ladder.indexOf(cur) - target) < Math.abs(ladder.indexOf(best) - target) ? cur : best,
        );
        clamped = true;
        notes.push(`clamped to ${effort} — model does not support the requested level`);
      }
    }
  }

  const steppedFrom = before !== effort ? before : undefined;
  return { effort, reason: notes.join('; '), clamped, adaptive: false, steppedFrom };
}

const MECHANICAL_HINT =
  /\b(rename|format|prettier|lint|typo|bump|import|reorder|indent|comment|docstring|changelog|whitespace|apply (the )?(patch|diff|change))\b/i;
const REASONING_HINT =
  /\b(design|architect|debug|investigate|why|race|concurren|deadlock|perf|optimi[sz]|refactor|migrate|security|algorithm|tradeoff|root cause)\b/i;

/** Cheap local classification, no model call. Deliberately conservative: when
 *  both or neither signal fires the answer is 'mixed', which changes nothing. */
export function classifyKind(text: string): TaskKind {
  const mech = MECHANICAL_HINT.test(text);
  const reason = REASONING_HINT.test(text);
  if (mech && !reason) return 'mechanical';
  if (reason && !mech) return 'reasoning';
  return 'mixed';
}


export interface EffortChange {
  apply: boolean;
  reason: string;
}

/** Should a proposed effort actually be pushed to a LIVE session?
 *
 *  Three guards, in order of importance:
 *   1. A fresh session or dispatch has no warm cache — always safe, always apply.
 *   2. Mid-session, only move for a change big enough to be worth a cache miss
 *      (more than one rung), because a one-rung nudge rarely pays for the reset.
 *   3. Never oscillate: if we already moved this session and the proposal walks
 *      it back, hold. Flapping is the worst case — it pays the cache cost every
 *      turn and buys nothing.
 *
 *  A model with per-message effort support has no cache penalty, so it skips
 *  straight to apply. */
export function shouldApplyEffort(opts: {
  current: string | null;
  proposed: string;
  agent: AgentKind;
  /** No warm cache yet — a new session or a one-shot dispatch. */
  fresh?: boolean;
  /** Model supports per-message effort without invalidating the cache. */
  perMessageEffort?: boolean;
  /** How many times effort has already moved in this session. */
  changesSoFar?: number;
}): EffortChange {
  if (!opts.current) return { apply: true, reason: 'no effort set yet' };
  if (opts.proposed === opts.current) return { apply: false, reason: 'unchanged' };
  if (opts.fresh) return { apply: true, reason: 'fresh context — no cache to lose' };
  if (opts.perMessageEffort) return { apply: true, reason: 'model supports per-message effort — cache preserved' };

  const ladder = EFFORT_LADDER[opts.agent];
  const from = ladder.indexOf(opts.current);
  const to = ladder.indexOf(opts.proposed);
  if (from < 0 || to < 0) return { apply: true, reason: 'unknown level — applying' };

  const distance = Math.abs(to - from);
  if (distance < 2) {
    return { apply: false, reason: `held at ${opts.current}: a one-rung change does not pay for a prompt-cache reset` };
  }
  if ((opts.changesSoFar ?? 0) >= 2) {
    return { apply: false, reason: `held at ${opts.current}: effort already moved ${opts.changesSoFar} times this session — flapping costs cache every turn` };
  }
  return { apply: true, reason: `${opts.current} → ${opts.proposed} is a ${distance}-rung change, worth the cache reset` };
}
