import { quotaStore, type Headroom } from './quota.js';
import { callLedger } from './ledger.js';
import { loadConfig, type BudgetConfig } from './config.js';
import { modelRegistry } from './registry.js';
import { logDecision } from './decisions.js';
import type { AgentKind } from './protocol.js';

/** The gate in front of every dispatch. policy.ts computed levels that nothing
 *  ever consulted; this is the live call site. It answers three questions
 *  before an agent process is spawned: is the vendor here, does it have
 *  quota, and is the task still inside its ceiling. A hard budget has to be
 *  enforced across the whole agent tree -- per-agent caps do not bound a tree. */

export class GateRefused extends Error {
  readonly status = 429;
}

export interface GateDeps {
  headroom: (agent: AgentKind) => Headroom;
  presence: (agent: AgentKind) => 'present' | 'absent' | 'unknown';
  /** Tokens the task has consumed so far, from the ledger. */
  taskTokens: (taskId: string) => number;
  budget: BudgetConfig;
}

export function liveGateDeps(): GateDeps {
  const budget = loadConfig().budget;
  return {
    headroom: (a) => quotaStore().headroom(a, budget),
    presence: (a) => modelRegistry().presence(a),
    taskTokens: (id) => callLedger().since(0, { taskId: id }).reduce((s, r) => s + r.inTok + r.outTok + r.cacheReadTok + r.cacheWriteTok, 0),
    budget,
  };
}

const dispatchCounts = new Map<string, number>();

export function resetTaskBudget(taskId: string): void {
  dispatchCounts.delete(taskId);
}

export interface GateVerdict {
  ok: true;
  /** Allowed, but the vendor is near its limit -- callers should prefer the light tier. */
  gated: boolean;
  reason: string;
}

export function guardDispatch(spec: { agent: AgentKind; taskId?: string; role?: string }, deps: GateDeps = liveGateDeps()): GateVerdict {
  const refuse = (reason: string): never => {
    logDecision({ kind: 'gate', rule: 'quota', action: 'refused', agent: spec.agent, taskId: spec.taskId, role: spec.role, reason });
    throw new GateRefused(reason);
  };

  if (deps.presence(spec.agent) === 'absent') refuse(`${spec.agent} is not signed in`);
  const h = deps.headroom(spec.agent);
  if (h.state === 'exhausted') refuse(`${spec.agent} ${h.reason}`);

  if (spec.taskId) {
    const n = (dispatchCounts.get(spec.taskId) ?? 0) + 1;
    const max = deps.budget.maxDispatchesPerTask;
    if (max && n > max) refuse(`task ${spec.taskId} reached its dispatch ceiling (${max})`);
    const cap = deps.budget.maxTaskTokens;
    if (cap) {
      const used = deps.taskTokens(spec.taskId);
      if (used >= cap) refuse(`task ${spec.taskId} reached its token ceiling (${used.toLocaleString()} of ${cap.toLocaleString()})`);
    }
    dispatchCounts.set(spec.taskId, n);
  }

  const gated = h.state === 'gated';
  if (gated) logDecision({ kind: 'gate', rule: 'quota', action: 'allowed-gated', agent: spec.agent, taskId: spec.taskId, role: spec.role, reason: h.reason });
  return { ok: true, gated, reason: h.reason };
}
