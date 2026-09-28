import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './config.js';

/** The fun layer (#49): a streak of days you've checked in on the crew.
 *  Days are the phone's local dates ("2026-09-28"), sent by the phone. */
export interface Streak { streak: number; best: number; today: boolean; firstToday: boolean }

export function streakOf(days: string[], today: string): number {
  const set = new Set(days);
  let n = 0;
  const d = new Date(`${today}T12:00:00Z`);
  while (set.has(d.toISOString().slice(0, 10))) { n++; d.setUTCDate(d.getUTCDate() - 1); }
  return n;
}

const file = () => join(dataDir(), 'visits.json');
export function visit(today: string): Streak {
  let s: { days: string[]; best: number } = { days: [], best: 0 };
  try { s = { days: [], best: 0, ...JSON.parse(readFileSync(file(), 'utf8')) }; } catch { /* first visit */ }
  const firstToday = !s.days.includes(today);
  if (firstToday) s.days = [...s.days, today].sort().slice(-400);
  const streak = streakOf(s.days, today);
  s.best = Math.max(s.best, streak);
  try { mkdirSync(dataDir(), { recursive: true }); writeFileSync(file(), JSON.stringify(s)); } catch { /* next time */ }
  return { streak, best: s.best, today: true, firstToday };
}
