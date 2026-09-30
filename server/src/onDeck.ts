import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './config.js';

/** Where we left off, and what's on deck (roadmap #46). The crew already
 *  says what's next at the end of a job ("Next up is item 43…"); this keeps
 *  the latest such line per project so the home card can offer Continue. */
export interface OnDeck { text: string; at: number; crew?: string; sessionId?: string }

// A real hand-off line only: "Next up: …", "Next step is …", "On deck: …".
// A bare "Next, …" is narration ("Next, the label bug") -- it made a to-do out
// of work already in hand, and Continue sent it (2026-09-30).
const NEXT = /^(?:[-*>\s]*)(?:\*\*)?(?:(?:next up|next steps?|up next|on deck|still to do|what's next|left to do)(?:\*\*)?\s*(?:is|are|:|—|-)|next(?:\*\*)?\s*:(?:\*\*)?)\s*(.+)$/im;

/** The "what's next" sentence in a reply, or null. One line, trimmed. */
export function extractOnDeck(text: string): string | null {
  // Only the end of a reply hands off; a "next" in the middle is the plan.
  const m = NEXT.exec(text.slice(-700));
  if (!m) return null;
  let s = m[1].replace(/\*\*/g, '').replace(/`/g, '').trim();
  const stop = s.search(/(?<=[.!?])\s/);
  if (stop > 20) s = s.slice(0, stop);
  s = s.replace(/[.:]\s*$/, '');
  if (s.length < 6) return null;
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
}

const file = () => join(dataDir(), 'ondeck.json');
let cache: Record<string, OnDeck> | null = null;

export function readOnDeck(): Record<string, OnDeck> {
  if (cache) return cache;
  try { cache = JSON.parse(readFileSync(file(), 'utf8')); } catch { cache = {}; }
  return cache!;
}

export function noteOnDeck(cwd: string, entry: OnDeck): void {
  const all = { ...readOnDeck(), [cwd]: entry };
  cache = all;
  try {
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(`${file()}.tmp`, JSON.stringify(all));
    renameSync(`${file()}.tmp`, file());
  } catch { /* best effort: the card just won't show it */ }
}

/** Newer work in the project makes the old note stale: drop it. */
export function clearOnDeck(cwd: string): void {
  const all = readOnDeck();
  if (!all[cwd]) return;
  const { [cwd]: _gone, ...rest } = all;
  cache = rest;
  try { writeFileSync(`${file()}.tmp`, JSON.stringify(rest)); renameSync(`${file()}.tmp`, file()); } catch { /* best effort */ }
}
