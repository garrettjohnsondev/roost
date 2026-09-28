import { ANSWERS, VALID } from './words';
export type Mark = 'g' | 'y' | 'b';
export const ROWS = 6;

export const answerFor = (day: number) => ANSWERS[((day % ANSWERS.length) + ANSWERS.length) % ANSWERS.length];
export const isWord = (w: string) => VALID.has(w.toLowerCase());

/** Wordle marking, with repeated letters counted properly. */
export function mark(guess: string, answer: string): Mark[] {
  const out: Mark[] = Array(5).fill('b');
  const left: Record<string, number> = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) out[i] = 'g';
    else left[answer[i]] = (left[answer[i]] ?? 0) + 1;
  }
  for (let i = 0; i < 5; i++) {
    if (out[i] === 'g') continue;
    if (left[guess[i]]) { out[i] = 'y'; left[guess[i]]--; }
  }
  return out;
}

/** The best mark each letter has earned, for the keyboard. */
export function keyMarks(guesses: string[], answer: string): Record<string, Mark> {
  const rank = { b: 0, y: 1, g: 2 };
  const k: Record<string, Mark> = {};
  for (const g of guesses) {
    mark(g, answer).forEach((m, i) => { const c = g[i]; if (!k[c] || rank[m] > rank[k[c]]) k[c] = m; });
  }
  return k;
}

/** Unlimited practice words: a separate board that never touches the streak. */
export interface Practice { answer: string; guesses: string[]; done: boolean; hard?: boolean }

export interface Save {
  day: number; guesses: string[]; streak: number; lastWonDay: number | null; done: boolean;
  /** Hard mode for today's word: revealed hints must be used. Locked after the first guess. */
  hard?: boolean;
  /** Solves in 1..6 guesses (index 0..5) and misses (index 6), daily only. */
  dist?: number[];
  played?: number;
  maxStreak?: number;
  practice?: Practice | null;
}

/** Bring a save up to today: a new day clears the board; missing a day breaks the streak. */
export function forToday(s: Save | null, today: number): Save {
  if (!s) return { day: today, guesses: [], streak: 0, lastWonDay: null, done: false };
  if (s.day === today) return s;
  const kept = s.lastWonDay !== null && s.lastWonDay >= today - 1 ? s.streak : 0;
  return { ...s, day: today, guesses: [], streak: kept, lastWonDay: s.lastWonDay, done: false };
}

/** Apply a finished game to the streak and the stats. */
export function finish(s: Save, won: boolean): Save {
  const dist = (s.dist ?? Array(ROWS + 1).fill(0)).slice();
  dist[won ? Math.min(ROWS, s.guesses.length) - 1 : ROWS]++;
  const stats = { dist, played: (s.played ?? 0) + 1 };
  if (!won) return { ...s, ...stats, done: true, streak: 0 };
  const streak = s.lastWonDay === s.day - 1 ? s.streak + 1 : 1;
  return { ...s, ...stats, done: true, streak, maxStreak: Math.max(s.maxStreak ?? 0, streak), lastWonDay: s.day };
}

/** Hard mode: a guess must keep every green in place and use every yellow.
 *  Returns what's wrong, or null when the guess is allowed. */
export function hardModeError(guess: string, guesses: string[], answer: string): string | null {
  for (const g of guesses) {
    const m = mark(g, answer);
    for (let i = 0; i < 5; i++) {
      if (m[i] === 'g' && guess[i] !== g[i]) return `Letter ${i + 1} must be ${g[i].toUpperCase()}`;
    }
    const need: Record<string, number> = {};
    for (let i = 0; i < 5; i++) if (m[i] !== 'b') need[g[i]] = (need[g[i]] ?? 0) + 1;
    for (const [c, n] of Object.entries(need)) {
      if (guess.split('').filter((x) => x === c).length < n) return `Guess must contain ${c.toUpperCase()}`;
    }
  }
  return null;
}

/** A practice word: any answer but today's. */
export function practiceAnswer(today: number, rand: () => number = Math.random): string {
  const daily = answerFor(today);
  let w = daily;
  for (let i = 0; i < 10 && w === daily; i++) w = ANSWERS[Math.floor(rand() * ANSWERS.length)];
  return w === daily ? ANSWERS[(ANSWERS.indexOf(daily) + 1) % ANSWERS.length] : w;
}

/** What a ghost of this strength needs (7 = missed): Haiku 6, Astra 3. */
export const ghostScore = (s: number) => Math.max(2, Math.min(6, Math.round(6.4 - 3.6 * s)));

/** A ghost's rows for a finished board: hints that warm up, all green on the
 *  solving row (none when they missed, `target` 7). Seeded, so it's stable. */
export function ghostRows(target: number, seed: number): Mark[][] {
  let a = (seed * 2654435761) >>> 0;
  const rand = () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const n = Math.min(ROWS, target);
  const rows: Mark[][] = [];
  for (let r = 0; r < n; r++) {
    if (r === target - 1) { rows.push(Array<Mark>(5).fill('g')); break; }
    const warm = (r + 1) / (n + 1);
    const row: Mark[] = Array.from({ length: 5 }, () => { const x = rand(); return x < warm * 0.6 ? 'g' : x < warm * 0.6 + 0.25 ? 'y' : 'b'; });
    if (!row.some((m) => m !== 'g')) row[Math.floor(rand() * 5)] = 'y';
    rows.push(row);
  }
  return rows;
}

const EMOJI: Record<Mark, string> = { g: '🟩', y: '🟨', b: '⬛' };
export function shareText(day: number, guesses: string[], answer: string): string {
  const won = guesses.at(-1) === answer;
  const rows = guesses.map((g) => mark(g, answer).map((m) => EMOJI[m]).join(''));
  return `Roost Daily Word ${day} ${won ? guesses.length : 'X'}/${ROWS}\n\n${rows.join('\n')}`;
}

/** "hh:mm" until local midnight. */
export function untilMidnight(now = new Date()): string {
  const m = new Date(now); m.setHours(24, 0, 0, 0);
  const mins = Math.ceil((m.getTime() - now.getTime()) / 60000);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}
