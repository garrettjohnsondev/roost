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

/** Ordered weakest → strongest. Codex starts a rung lower than Claude. */
export const EFFORT_LADDER: Record<AgentKind, string[]> = {
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['minimal', 'low', 'medium', 'high', 'xhigh'],
};

/** Per-agent because the ladders are NOT aligned: Codex has an extra `minimal`
 *  rung below `low`, so a shared index would land heavy on `high` for Codex and
 *  `xhigh` for Claude. These indices keep the semantics equal on both sides —
 *  light = floor, standard = medium, heavy = xhigh — matching what the existing
 *  autoRoute defaults already ask for. */
const BASE_BY_TIER: Record<AgentKind, Record<Tier, number>> = {
  claude: { light: 0, standard: 1, heavy: 3 }, // low / medium / xhigh
  codex: { light: 0, standard: 2, heavy: 4 }, // minimal / medium / xhigh
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
}): EffortDecision {
  const ladder = EFFORT_LADDER[opts.agent];

  if (opts.override) {
    return { effort: opts.override, reason: 'set by you', clamped: false, adaptive: false };
  }

  // A model that budgets its own thinking beats any fixed guess we could make.
  if (opts.adaptive) {
    return { effort: '', reason: 'model chooses its own thinking budget', clamped: false, adaptive: true };
  }

  let idx = BASE_BY_TIER[opts.agent][opts.tier] ?? 1;
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
