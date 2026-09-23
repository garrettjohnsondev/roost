import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, appendFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir, type RoostConfig } from './config.js';
import { priceFor, estimateCost, type PriceBasis } from './pricing.js';
import type { AgentKind } from './protocol.js';

/** One agent turn. Tokens are PER CALL — never a cumulative total. agent-sync
 *  logged Codex's thread-cumulative `total_token_usage` as if it were per-call,
 *  producing single records of 15-18M tokens and a claimed $1,193 of "spend". */
export interface CallRecord {
  at: number;
  sessionId: string;
  taskId?: string;
  agentSessionId?: string;
  turnId?: string;
  agent: AgentKind;
  /** The real model id. Never ''. */
  model: string;
  /** chat | triage | plan | review | reconcile | execute | explore | test | probe */
  role: string;
  /** Crew member who held the role, for per-persona attribution. */
  persona?: string;
  tier?: string;
  inTok: number;
  outTok: number;
  cacheReadTok: number;
  cacheWriteTok: number;
  reasoningTok?: number;
  /** null means unpriceable. It never means free. */
  costUsd: number | null;
  costBasis: PriceBasis;
  ms?: number;
}

export interface Rollup {
  calls: number;
  usd: number | null;
  unpricedCalls: number;
  inTok: number;
  outTok: number;
  cacheTok: number;
  byAgent: Record<string, { calls: number; usd: number | null; inTok: number; outTok: number }>;
  byRole: Record<string, { calls: number; usd: number | null; inTok: number; outTok: number }>;
  byPersona: Record<string, { calls: number; usd: number | null; inTok: number; outTok: number }>;
}

/** The honesty contract. Any field that cannot be supported by real per-call
 *  data means the whole report is null and the UI shows nothing. */
export interface SavingsReport {
  actualUsd: number;
  soloUsd: number;
  savedPct: number;
  /** Named, so "saved vs what?" always has an answer. */
  flagshipModel: string;
  calls: number;
  unpricedCalls: number;
  basis: 'sdk' | 'mixed' | 'estimated';
  from: number;
  to: number;
}

const MAX_LINES = 50_000;
const MAX_BYTES = 20 * 1024 * 1024;

export class CallLedger {
  private rows: CallRecord[] = [];

  constructor(private readonly dir = dataDir()) {
    this.load();
  }

  private file() {
    return join(this.dir, 'usage.jsonl');
  }

  /** Rows that failed to reach disk. Retried on the next record() -- a row
   *  dropped silently is a ledger that lies about what happened. */
  private unflushed: string[] = [];
  private appendWarned = false;

  record(r: CallRecord): void {
    this.rows.push(r);
    this.unflushed.push(JSON.stringify(r));
    try {
      mkdirSync(this.dir, { recursive: true });
      appendFileSync(this.file(), this.unflushed.join('\n') + '\n');
      this.unflushed = [];
      this.appendWarned = false;
    } catch (err: any) {
      if (!this.appendWarned) {
        this.appendWarned = true;
        console.error(`[roost] ledger append failed (${err?.message ?? err}); ${this.unflushed.length} row(s) held in memory, retried on the next call`);
      }
    }
  }

  since(ts: number, f?: { agent?: AgentKind; sessionId?: string; taskId?: string; role?: string }): CallRecord[] {
    return this.rows.filter(
      (r) =>
        r.at >= ts &&
        (!f?.agent || r.agent === f.agent) &&
        (!f?.sessionId || r.sessionId === f.sessionId) &&
        (!f?.taskId || r.taskId === f.taskId) &&
        (!f?.role || r.role === f.role),
    );
  }

  rollup(ts: number, f?: Parameters<CallLedger['since']>[1]): Rollup {
    const rows = this.since(ts, f);
    const bucket = () => ({ calls: 0, usd: null as number | null, inTok: 0, outTok: 0 });
    const out: Rollup = {
      calls: rows.length,
      usd: null,
      unpricedCalls: rows.filter((r) => r.costUsd == null).length,
      inTok: rows.reduce((s, r) => s + r.inTok, 0),
      outTok: rows.reduce((s, r) => s + r.outTok, 0),
      cacheTok: rows.reduce((s, r) => s + r.cacheReadTok + r.cacheWriteTok, 0),
      byAgent: {},
      byRole: {},
      byPersona: {},
    };
    const add = (m: Record<string, ReturnType<typeof bucket>>, k: string, r: CallRecord) => {
      const b = (m[k] ??= bucket());
      b.calls += 1;
      b.inTok += r.inTok;
      b.outTok += r.outTok;
      if (r.costUsd != null) b.usd = +((b.usd ?? 0) + r.costUsd).toFixed(6);
    };
    for (const r of rows) {
      if (r.costUsd != null) out.usd = +((out.usd ?? 0) + r.costUsd).toFixed(6);
      add(out.byAgent, r.agent, r);
      add(out.byRole, r.role, r);
      if (r.persona) add(out.byPersona, r.persona, r);
    }
    return out;
  }

  /** Re-price this scope's real token volume at the flagship rate. Returns null
   *  rather than a flattering number whenever the data can't support one. */
  savings(scope: { sinceTs: number; sessionId?: string; taskId?: string }, cfg: RoostConfig): SavingsReport | null {
    const rows = this.since(scope.sinceTs, { sessionId: scope.sessionId, taskId: scope.taskId });
    if (rows.length < 3) return null;

    // All-or-nothing: one unpriced call makes "actual" unknowable, and treating
    // it as free would flatter the saving by exactly that call's cost.
    if (rows.some((r) => r.costUsd == null)) return null;
    const actualUsd = +rows.reduce((s, r) => s + (r.costUsd as number), 0).toFixed(4);

    // "Solo" means: the heavy-tier model of whichever agents actually worked.
    const agents = [...new Set(rows.map((r) => r.agent))];
    const candidates = agents
      .map((a) => cfg.autoRoute[a]?.heavy?.model)
      .filter((m): m is string => !!m)
      .map((m) => ({ model: m, look: priceFor(m) }))
      .filter((c) => c.look.price);
    if (!candidates.length) return null; // never invent an unpriceable flagship

    const flagship = candidates.reduce((a, b) => ((a.look.price!.output ?? 0) >= (b.look.price!.output ?? 0) ? a : b));

    const inTok = rows.reduce((s, r) => s + r.inTok + r.cacheReadTok + r.cacheWriteTok, 0);
    const outTok = rows.reduce((s, r) => s + r.outTok, 0);
    const solo = estimateCost(flagship.model, { inTok, outTok });
    if (solo.usd == null) return null;
    const soloUsd = +solo.usd.toFixed(4);
    if (soloUsd <= actualUsd) return null;

    const bases = new Set(rows.map((r) => r.costBasis));
    const basis: SavingsReport['basis'] = bases.size === 1 && bases.has('sdk') ? 'sdk' : bases.has('sdk') ? 'mixed' : 'estimated';

    return {
      actualUsd,
      soloUsd,
      savedPct: Math.round((1 - actualUsd / soloUsd) * 100),
      flagshipModel: flagship.model,
      calls: rows.length,
      unpricedCalls: rows.filter((r) => r.costUsd == null).length,
      basis,
      from: scope.sinceTs,
      to: Date.now(),
    };
  }

  private load(): void {
    try {
      if (!existsSync(this.file())) return;
      const raw = readFileSync(this.file(), 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      const kept = lines.slice(-MAX_LINES);
      this.rows = kept
        .map((l) => {
          try {
            return JSON.parse(l) as CallRecord;
          } catch {
            return null;
          }
        })
        .filter(Boolean) as CallRecord[];
      // Compact on load when the file has outgrown its cap, atomically.
      if (lines.length > MAX_LINES || statSync(this.file()).size > MAX_BYTES) {
        const tmp = this.file() + '.tmp';
        writeFileSync(tmp, kept.join('\n') + '\n');
        renameSync(tmp, this.file());
      }
    } catch {
      this.rows = [];
    }
  }
}

let singleton: CallLedger | null = null;
export function callLedger(): CallLedger {
  if (!singleton) singleton = new CallLedger();
  return singleton;
}
export function __resetLedgerForTests(): void {
  singleton = null;
}
