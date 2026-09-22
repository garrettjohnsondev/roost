import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './config.js';

/** The operator's record of what the harness decided and why: every route,
 *  every reviewer choice and size-gate outcome, every dispatch. Phase 4's
 *  "does the conference earn its keep" question is unanswerable without it,
 *  and stdout is not a record. */
export interface Decision {
  at: number;
  kind: 'route' | 'review' | 'dispatch' | 'gate';
  sessionId?: string;
  [key: string]: unknown;
}

export function decisionsPath(): string {
  return join(dataDir(), 'decisions.jsonl');
}

export function logDecision(d: Omit<Decision, 'at'>): void {
  try {
    mkdirSync(dataDir(), { recursive: true });
    appendFileSync(decisionsPath(), JSON.stringify({ at: Date.now(), ...d }) + '\n');
  } catch {
    /* a lost log line must never break the decision it describes */
  }
}

/** Most recent `limit` rows. The file is append-only JSONL; a corrupt line is
 *  skipped rather than poisoning the read. */
export function readDecisions(limit = 500): Decision[] {
  try {
    if (!existsSync(decisionsPath())) return [];
    return readFileSync(decisionsPath(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l) as Decision;
        } catch {
          return null;
        }
      })
      .filter((d): d is Decision => !!d && typeof d.at === 'number');
  } catch {
    return [];
  }
}

export interface DecisionsSummary {
  total: number;
  sinceMs: number;
  routes: number;
  dispatches: { total: number; ok: number; failed: number; meanMs: number | null };
  reviews: { total: number; skippedBySizeGate: number; byStrength: Record<string, number> };
  gates: { oneWriter: number };
}

/** Counts over rows at or after `sinceMs`. meanMs is null with no dispatches --
 *  never 0, which would read as "instant". */
export function summarizeDecisions(rows: Decision[], sinceMs: number): DecisionsSummary {
  const s: DecisionsSummary = {
    total: 0, sinceMs, routes: 0,
    dispatches: { total: 0, ok: 0, failed: 0, meanMs: null },
    reviews: { total: 0, skippedBySizeGate: 0, byStrength: {} },
    gates: { oneWriter: 0 },
  };
  let msSum = 0;
  let msN = 0;
  for (const r of rows) {
    if (r.at < sinceMs) continue;
    s.total += 1;
    switch (r.kind) {
      case 'route':
        s.routes += 1;
        break;
      case 'dispatch':
        s.dispatches.total += 1;
        if (r.ok === true) s.dispatches.ok += 1;
        else if (r.ok === false) s.dispatches.failed += 1;
        if (typeof r.ms === 'number') {
          msSum += r.ms;
          msN += 1;
        }
        break;
      case 'review': {
        s.reviews.total += 1;
        if (r.skipped === true) s.reviews.skippedBySizeGate += 1;
        const k = typeof r.strength === 'string' ? r.strength : 'unknown';
        s.reviews.byStrength[k] = (s.reviews.byStrength[k] ?? 0) + 1;
        break;
      }
      case 'gate':
        if (r.rule === 'one-writer') s.gates.oneWriter += 1;
        break;
    }
  }
  s.dispatches.meanMs = msN ? Math.round(msSum / msN) : null;
  return s;
}
