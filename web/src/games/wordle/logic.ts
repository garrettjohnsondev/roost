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

export interface Save { day: number; guesses: string[]; streak: number; lastWonDay: number | null; done: boolean }

/** Bring a save up to today: a new day clears the board; missing a day breaks the streak. */
export function forToday(s: Save | null, today: number): Save {
  if (!s) return { day: today, guesses: [], streak: 0, lastWonDay: null, done: false };
  if (s.day === today) return s;
  const kept = s.lastWonDay !== null && s.lastWonDay >= today - 1 ? s.streak : 0;
  return { day: today, guesses: [], streak: kept, lastWonDay: s.lastWonDay, done: false };
}

/** Apply a finished game to the streak. */
export function finish(s: Save, won: boolean): Save {
  if (!won) return { ...s, done: true, streak: 0 };
  const streak = s.lastWonDay === s.day - 1 ? s.streak + 1 : 1;
  return { ...s, done: true, streak, lastWonDay: s.day };
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
