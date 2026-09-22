import type { AgentKind } from './protocol.js';
import type { AutoRouteConfig, RouteCandidate } from './config.js';
import type { Headroom, Surplus } from './quota.js';
import type { Tier } from './router.js';

/** Phase 4: quota-aware routing, as a pure function.
 *
 *  Scarcity steps the tier DOWN and prefers the vendor with better KNOWN
 *  headroom; surplus plus the user's boost toggle steps it UP. Two rules are
 *  load-bearing: missing data is never a reason to move work (unknown/stale
 *  ranks last and never wins a move), and a live chat is bound to one adapter,
 *  so for a locked session the other vendor can only be suggested. */

export type Presence = 'present' | 'absent' | 'unknown';

export interface VendorState {
  route: AutoRouteConfig;
  headroom: Headroom;
  presence: Presence;
  surplus: Surplus | null;
}

export interface RouteInput {
  tier: Tier;
  vendors: Partial<Record<AgentKind, VendorState>>;
  /** A chat session: route only within this vendor, suggest the other. */
  lockAgent?: AgentKind;
  /** "Use the good models" while a surplus window is live. */
  boost?: boolean;
}

export interface RouteDecision {
  agent: AgentKind;
  model: string;
  effort?: string;
  tier: Tier;
  reason: string;
  steppedDown: boolean;
  steppedUp: boolean;
  /** Allowed, but the vendor is near its limit: light tier only. */
  gated: boolean;
  /** Nothing usable: every candidate vendor is exhausted or absent. */
  refused: boolean;
  /** Locked session under pressure while the other vendor has room. */
  suggestOther?: AgentKind;
}

const TIERS: Tier[] = ['light', 'standard', 'heavy'];
/** Known states rank by pressure; unknown and stale rank LAST, so they can
 *  never be the reason work moves. */
const RANK: Record<Headroom['state'], number> = { room: 0, tight: 1, gated: 2, exhausted: 3, unknown: 9, stale: 9 };

function stepDown(t: Tier): Tier {
  return TIERS[Math.max(0, TIERS.indexOf(t) - 1)];
}

export function chooseRoute(input: RouteInput): RouteDecision {
  const present = (Object.entries(input.vendors) as Array<[AgentKind, VendorState]>).filter(([, v]) => v && v.presence !== 'absent');
  const pool = input.lockAgent ? present.filter(([a]) => a === input.lockAgent) : present;
  if (!pool.length) {
    return { agent: input.lockAgent ?? 'claude', model: '', tier: input.tier, reason: 'no vendor available', steppedDown: false, steppedUp: false, gated: false, refused: true };
  }
  const usable = pool.filter(([, v]) => v.headroom.state !== 'exhausted');
  if (!usable.length) {
    const [a, v] = pool[0];
    return { agent: a, model: '', tier: input.tier, reason: `${a}: ${v.headroom.reason}`, steppedDown: false, steppedUp: false, gated: true, refused: true };
  }
  // Stable sort by known pressure. A tie keeps input order.
  const ranked = [...usable].sort(([, x], [, y]) => RANK[x.headroom.state] - RANK[y.headroom.state]);
  const [agent, v] = ranked[0];
  const state = v.headroom.state;

  let tier = input.tier;
  const notes: string[] = [];
  let steppedDown = false;
  let steppedUp = false;
  let gated = false;
  if (state === 'gated') {
    gated = true;
    if (tier !== 'light') {
      tier = 'light';
      steppedDown = true;
    }
    notes.push(`${agent} ${v.headroom.reason} — gated, light tier only`);
  } else if (state === 'tight') {
    const t = stepDown(tier);
    if (t !== tier) {
      tier = t;
      steppedDown = true;
      notes.push(`${agent} ${v.headroom.reason} — stepped down`);
    } else {
      notes.push(`${agent} ${v.headroom.reason}`);
    }
  } else if (state === 'unknown' || state === 'stale') {
    notes.push(`${agent}: ${v.headroom.reason} — no move on missing data`);
  } else {
    notes.push(`${agent} has room`);
  }

  // Surplus is spent only when nothing longer-horizon is under pressure --
  // that guard lives in QuotaStore.surplus(); here it is boost + not gated.
  if (input.boost && v.surplus) {
    if (gated || state === 'tight') {
      notes.push('boost held: window under pressure');
    } else if (tier !== 'heavy') {
      tier = 'heavy';
      steppedUp = true;
      notes.push(`surplus: ${v.surplus.reason} — using the heavy tier`);
    } else {
      notes.push(`surplus: ${v.surplus.reason}`);
    }
  }

  // A tier may name candidates across vendors; take the one on the
  // best-ranked vendor that is actually usable.
  const target = v.route[tier];
  let pick: { agent: AgentKind; model: string; effort?: string } = { agent, model: target.model, effort: target.effort };
  const cands: RouteCandidate[] = (target.candidates ?? []).filter((c) => usable.some(([a]) => a === c.agent));
  if (cands.length && !input.lockAgent) {
    const best = [...cands].sort((c1, c2) => RANK[input.vendors[c1.agent]!.headroom.state] - RANK[input.vendors[c2.agent]!.headroom.state])[0];
    pick = { agent: best.agent, model: best.model, effort: best.effort };
    notes.push(`candidate ${best.model} on ${best.agent}`);
  }

  let suggestOther: AgentKind | undefined;
  if (input.lockAgent && (state === 'tight' || state === 'gated')) {
    const other = present.find(([a, o]) => a !== input.lockAgent && o.headroom.state === 'room');
    if (other) suggestOther = other[0];
  }

  return { ...pick, tier, reason: notes.join('; '), steppedDown, steppedUp, gated, refused: false, suggestOther };
}
