/** Pure sudoku: 81-cell arrays, 0 = empty. */

export type Grid = number[];
export type Level = 'easy' | 'medium';
export const CLUES: Record<Level, number> = { easy: 38, medium: 30 };

const ROW = (i: number) => Math.floor(i / 9);
const COL = (i: number) => i % 9;
const BOX = (i: number) => Math.floor(ROW(i) / 3) * 3 + Math.floor(COL(i) / 3);

export const peers: number[][] = Array.from({ length: 81 }, (_, i) => {
  const out: number[] = [];
  for (let j = 0; j < 81; j++) if (j !== i && (ROW(j) === ROW(i) || COL(j) === COL(i) || BOX(j) === BOX(i))) out.push(j);
  return out;
});

/** Count solutions up to `limit`, optionally filling `out` with the first one. */
export function countSolutions(g: Grid, limit = 2, rand?: () => number, out?: Grid): number {
  const grid = g.slice();
  const rows = Array(9).fill(0), cols = Array(9).fill(0), boxes = Array(9).fill(0);
  for (let i = 0; i < 81; i++) if (grid[i]) {
    const b = 1 << grid[i];
    if ((rows[ROW(i)] | cols[COL(i)] | boxes[BOX(i)]) & b) return 0;
    rows[ROW(i)] |= b; cols[COL(i)] |= b; boxes[BOX(i)] |= b;
  }
  let found = 0;
  const go = (): boolean => {
    let best = -1, bestMask = 0, bestN = 10;
    for (let i = 0; i < 81; i++) if (!grid[i]) {
      const mask = ~(rows[ROW(i)] | cols[COL(i)] | boxes[BOX(i)]) & 0x3fe;
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
    const r = ROW(best), c = COL(best), bx = BOX(best);
    for (const d of digits) {
      const b = 1 << d;
      grid[best] = d; rows[r] |= b; cols[c] |= b; boxes[bx] |= b;
      if (go()) return true;
      grid[best] = 0; rows[r] &= ~b; cols[c] &= ~b; boxes[bx] &= ~b;
    }
    return false;
  };
  go();
  return found;
}

export function solve(g: Grid): Grid | null {
  const out = Array(81).fill(0);
  return countSolutions(g, 1, undefined, out) ? out : null;
}

export interface Puzzle { givens: Grid; solution: Grid }

/** A random full grid, then dig holes while the solution stays unique. */
export function generate(rand: () => number, level: Level): Puzzle {
  const solution = Array(81).fill(0);
  countSolutions(Array(81).fill(0), 1, rand, solution);
  const givens = solution.slice();
  const order = Array.from({ length: 81 }, (_, i) => i);
  for (let k = 80; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [order[k], order[j]] = [order[j], order[k]]; }
  let clues = 81;
  for (const i of order) {
    if (clues <= CLUES[level]) break;
    const keep = givens[i];
    givens[i] = 0;
    if (countSolutions(givens, 2) !== 1) givens[i] = keep;
    else clues--;
  }
  return { givens, solution };
}

/** Cells whose value clashes with a peer. */
export function conflicts(g: Grid): Set<number> {
  const bad = new Set<number>();
  for (let i = 0; i < 81; i++) if (g[i]) for (const j of peers[i]) if (g[j] === g[i]) bad.add(i);
  return bad;
}

export const isSolved = (g: Grid, solution: Grid) => g.every((v, i) => v === solution[i]);
