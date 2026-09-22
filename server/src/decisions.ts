import { appendFileSync, mkdirSync } from 'node:fs';
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
