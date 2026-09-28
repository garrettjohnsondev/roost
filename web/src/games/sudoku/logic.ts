/** Pure sudoku: 81-cell arrays, 0 = empty. `diag` turns on the X variant:
 *  both long diagonals must hold 1 to 9 too. */

export type Grid = number[];
export type Level = 'easy' | 'medium';
export type Variant = 'classic' | 'diagonal';
export const CLUES: Record<Level, number> = { easy: 38, medium: 30 };

const ROW = (i: number) => Math.floor(i / 9);
const COL = (i: number) => i % 9;
const BOX = (i: number) => Math.floor(ROW(i) / 3) * 3 + Math.floor(COL(i) / 3);
export const onD1 = (i: number) => ROW(i) === COL(i);
export const onD2 = (i: number) => ROW(i) + COL(i) === 8;

const makePeers = (diag: boolean): number[][] => Array.from({ length: 81 }, (_, i) => {
  const out: number[] = [];
  for (let j = 0; j < 81; j++) {
    if (j === i) continue;
    if (ROW(j) === ROW(i) || COL(j) === COL(i) || BOX(j) === BOX(i) ||
      (diag && ((onD1(i) && onD1(j)) || (onD2(i) && onD2(j))))) out.push(j);
  }
  return out;
});
export const peers: number[][] = makePeers(false);
export const diagPeers: number[][] = makePeers(true);
export const peersOf = (diag = false) => (diag ? diagPeers : peers);

/** Count solutions up to `limit`, optionally filling `out` with the first one. */
export function countSolutions(g: Grid, limit = 2, rand?: () => number, out?: Grid, diag = false): number {
  const grid = g.slice();
  const rows = Array(9).fill(0), cols = Array(9).fill(0), boxes = Array(9).fill(0);
  let d1 = 0, d2 = 0;
  const dmask = (i: number) => (diag ? (onD1(i) ? d1 : 0) | (onD2(i) ? d2 : 0) : 0);
  for (let i = 0; i < 81; i++) if (grid[i]) {
    const b = 1 << grid[i];
    if ((rows[ROW(i)] | cols[COL(i)] | boxes[BOX(i)] | dmask(i)) & b) return 0;
    rows[ROW(i)] |= b; cols[COL(i)] |= b; boxes[BOX(i)] |= b;
    if (diag) { if (onD1(i)) d1 |= b; if (onD2(i)) d2 |= b; }
  }
  let found = 0;
  const go = (): boolean => {
    let best = -1, bestMask = 0, bestN = 10;
    for (let i = 0; i < 81; i++) if (!grid[i]) {
      const mask = ~(rows[ROW(i)] | cols[COL(i)] | boxes[BOX(i)] | dmask(i)) & 0x3fe;
      let n = 0; for (let m = mask; m; m &= m - 1) n++;
      if (n < bestN) { best = i; bestMask = mask; bestN = n; if (n <= 1) break; }
    }
    if (best < 0) {
      found++;
      if (found === 1 && out) for (let i = 0; i < 81; i++) out[i] = grid[i];
      return found >= limit;
    }
    const digits: number[] = [];
    for (let d = 1; d <= 9; d++) if (bestMask & (1 << d)) digits.push(d);
    if (rand) for (let k = digits.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [digits[k], digits[j]] = [digits[j], digits[k]]; }
    const r = ROW(best), c = COL(best), bx = BOX(best), a1 = diag && onD1(best), a2 = diag && onD2(best);
    for (const d of digits) {
      const b = 1 << d;
      grid[best] = d; rows[r] |= b; cols[c] |= b; boxes[bx] |= b;
      if (a1) d1 |= b;
      if (a2) d2 |= b;
      if (go()) return true;
      grid[best] = 0; rows[r] &= ~b; cols[c] &= ~b; boxes[bx] &= ~b;
      if (a1) d1 &= ~b;
      if (a2) d2 &= ~b;
    }
    return false;
  };
  go();
  return found;
}

export function solve(g: Grid, diag = false): Grid | null {
  const out = Array(81).fill(0);
  return countSolutions(g, 1, undefined, out, diag) ? out : null;
}

export interface Puzzle { givens: Grid; solution: Grid }

/** A random full grid, then dig holes while the solution stays unique. */
export function generate(rand: () => number, level: Level, diag = false): Puzzle {
  const solution = Array(81).fill(0);
  countSolutions(Array(81).fill(0), 1, rand, solution, diag);
  const givens = solution.slice();
  const order = Array.from({ length: 81 }, (_, i) => i);
  for (let k = 80; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [order[k], order[j]] = [order[j], order[k]]; }
  // The X rule adds information, so dig a little deeper to keep it honest.
  const target = CLUES[level] - (diag ? 4 : 0);
  let clues = 81;
  for (const i of order) {
    if (clues <= target) break;
    const keep = givens[i];
    givens[i] = 0;
    if (countSolutions(givens, 2, undefined, undefined, diag) !== 1) givens[i] = keep;
    else clues--;
  }
  return { givens, solution };
}

/** Cells whose value clashes with a peer. */
export function conflicts(g: Grid, diag = false): Set<number> {
  const bad = new Set<number>();
  const ps = peersOf(diag);
  for (let i = 0; i < 81; i++) if (g[i]) for (const j of ps[i]) if (g[j] === g[i]) bad.add(i);
  return bad;
}

export const isSolved = (g: Grid, solution: Grid) => g.every((v, i) => v === solution[i]);

/** Auto-notes: every digit still possible in each empty cell, as bitmasks (1 << d). */
export function candidates(g: Grid, diag = false): number[] {
  const ps = peersOf(diag);
  return g.map((v, i) => {
    if (v) return 0;
    let m = 0x3fe;
    for (const j of ps[i]) if (g[j]) m &= ~(1 << g[j]);
    return m;
  });
}

/** Where a hint should go: the selected cell if it's empty or wrong, else a
 *  wrong cell, else the empty cell with the fewest candidates. -1 when solved. */
export function hintCell(g: Grid, solution: Grid, sel: number | null, diag = false): number {
  if (sel !== null && g[sel] !== solution[sel]) return sel;
  const wrong = g.findIndex((v, i) => v && v !== solution[i]);
  if (wrong >= 0) return wrong;
  const c = candidates(g, diag);
  let best = -1, bestN = 10;
  for (let i = 0; i < 81; i++) if (!g[i]) {
    let n = 0; for (let m = c[i]; m; m &= m - 1) n++;
    if (n < bestN) { best = i; bestN = n; }
  }
  return best;
}

/** Units (row, column, box, and diagonals for X) that cell `i` sits in and that are now complete and right. */
export function completedUnits(g: Grid, solution: Grid, i: number, diag = false): number[][] {
  const bx = BOX(i);
  const units: number[][] = [
    Array.from({ length: 9 }, (_, k) => ROW(i) * 9 + k),
    Array.from({ length: 9 }, (_, k) => k * 9 + COL(i)),
    Array.from({ length: 9 }, (_, k) => (Math.floor(bx / 3) * 3 + Math.floor(k / 3)) * 9 + (bx % 3) * 3 + (k % 3)),
  ];
  if (diag && onD1(i)) units.push(Array.from({ length: 9 }, (_, k) => k * 10));
  if (diag && onD2(i)) units.push(Array.from({ length: 9 }, (_, k) => k * 9 + 8 - k));
  return units.filter((u) => u.every((j) => g[j] && g[j] === solution[j]));
}

export interface Streak { last: number; count: number; best: number }
/** Solving the daily on `day`: continues a streak from yesterday, else starts over. */
export function bumpStreak(s: Streak | null | undefined, day: number): Streak {
  if (!s) return { last: day, count: 1, best: 1 };
  if (s.last === day) return s;
  const count = s.last === day - 1 ? s.count + 1 : 1;
  return { last: day, count, best: Math.max(s.best, count) };
}
/** The streak as it stands today (a missed day shows 0). */
export const liveStreak = (s: Streak | null | undefined, today: number) => (s && s.last >= today - 1 ? s.count : 0);

/** A ghost of this strength solves in this many seconds. */
export const ghostScore = (strength: number) => Math.round(1000 - 830 * Math.pow(strength, 0.9));
