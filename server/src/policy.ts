import type { BudgetConfig } from './config.js';
import type { CallLedger } from './ledger.js';
import type { QuotaStore, Headroom, Surplus } from './quota.js';
import type { AgentKind } from './protocol.js';

export type PolicyLevel = 'ok' | 'reprioritize' | 'gate' | 'hardstop';

export interface PolicyVerdict {
  level: PolicyLevel;
  reasons: string[];
  byAgent: Record<AgentKind, Headroom>;
  /** Present when a window is about to reset with capacity still on the table. */
  surplus: Surplus | null;
  /** Rolling-24h API value, null when too much of it is unpriceable to claim. */
  spentUsd: number | null;
}

const AGENTS: AgentKind[] = ['claude', 'codex'];

/** Ported from agent-sync's usage.js policy() with three corrections:
 *  expired windows no longer read as headroom (QuotaStore purges them to
 *  'unknown'); 'unknown'/'stale' on BOTH agents is reprioritize rather than ok;
 *  and the dollar branch is skipped rather than guessed when the ledger holds
 *  too many unpriceable calls. */
export function evaluatePolicy(quota: QuotaStore, ledger: CallLedger, budget: BudgetConfig): PolicyVerdict {
  const reasons: string[] = [];
  const byAgent = Object.fromEntries(AGENTS.map((a) => [a, quota.headroom(a, budget)])) as Record<AgentKind, Headroom>;

  let level: PolicyLevel = 'ok';
  const raise = (l: PolicyLevel) => {
    const order: PolicyLevel[] = ['ok', 'reprioritize', 'gate', 'hardstop'];
    if (order.indexOf(l) > order.indexOf(level)) level = l;
  };

  for (const agent of AGENTS) {
    const h = byAgent[agent];
    if (h.state === 'exhausted') {
      reasons.push(`${agent}: ${h.reason}`);
      raise('gate');
    } else if (h.state === 'gated') {
      reasons.push(`${agent}: ${h.reason}`);
      raise('gate');
    } else if (h.state === 'tight') {
      reasons.push(`${agent}: ${h.reason}`);
      raise('reprioritize');
    }
  }

  // Both suites exhausted is the only true wall: while one has room, work can
  // still be routed there, so the gate asks rather than stops.
  const exhausted = AGENTS.filter((a) => byAgent[a].state === 'exhausted');
  const hasRoom = AGENTS.some((a) => byAgent[a].state === 'room' || byAgent[a].state === 'tight');
  if (exhausted.length === AGENTS.length || (exhausted.length > 0 && !hasRoom)) {
    reasons.push('no subscription has usable headroom');
    raise('hardstop');
  }

  // Flying blind is not the same as flying clear.
  const blind = AGENTS.filter((a) => byAgent[a].state === 'unknown' || byAgent[a].state === 'stale');
  if (blind.length === AGENTS.length) {
    reasons.push('no live quota data for either subscription — routing cannot see limits');
    raise('reprioritize');
  }

  // Optional rolling-24h API-value ceiling across the whole agent tree.
  const day = ledger.rollup(Date.now() - 24 * 3600_000);
  const unpricedShare = day.calls ? day.unpricedCalls / day.calls : 0;
  let spentUsd: number | null = day.usd;
  if (unpricedShare > 0.1) {
    spentUsd = null;
    if (budget.dailyUsd) reasons.push(`daily ceiling not enforced: ${day.unpricedCalls}/${day.calls} calls are unpriceable`);
  } else if (budget.dailyUsd && day.usd != null) {
    const pct = (day.usd / budget.dailyUsd) * 100;
    if (pct >= budget.hardStopPct) {
      reasons.push(`daily API value ${Math.round(pct)}% of $${budget.dailyUsd}`);
      raise('hardstop');
    } else if (pct >= budget.gateAtPct) {
      reasons.push(`daily API value ${Math.round(pct)}% of $${budget.dailyUsd}`);
      raise('gate');
    } else if (pct >= budget.reprioritizeAtPct) {
      reasons.push(`daily API value ${Math.round(pct)}% of $${budget.dailyUsd}`);
      raise('reprioritize');
    }
  }

  // Surplus is reported at any level: even under pressure elsewhere, a window
  // about to reset with capacity left is worth spending rather than wasting.
  const surplus = AGENTS.map((a) => quota.surplus(a, budget)).find((s) => s) ?? null;
  if (surplus) reasons.push(`surplus: ${surplus.agent} — ${surplus.reason}`);

  return { level, reasons, byAgent, surplus, spentUsd };
}
