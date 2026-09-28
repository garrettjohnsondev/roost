/** Pure minesweeper rules. A board is flat arrays indexed r * cols + c. */

export type Size = 'easy' | 'medium' | 'hard';
export const SIZES: Record<Size, { cols: number; rows: number; mines: number; label: string }> = {
  easy: { cols: 8, rows: 8, mines: 10, label: 'Easy' },
  medium: { cols: 10, rows: 12, mines: 20, label: 'Medium' },
  hard: { cols: 12, rows: 16, mines: 35, label: 'Hard' },
};

export interface Board {
  size: Size;
  cols: number;
  rows: number;
  /** Empty until the first dig (so the first dig is always safe). */
  mines: number[];
  open: boolean[];
  flag: boolean[];
}

export function newBoard(size: Size): Board {
  const { cols, rows } = SIZES[size];
  const n = cols * rows;
  return { size, cols, rows, mines: [], open: Array(n).fill(false), flag: Array(n).fill(false) };
}

export function neighbors(b: Pick<Board, 'cols' | 'rows'>, i: number): number[] {
  const r = Math.floor(i / b.cols), c = i % b.cols, out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && cc >= 0 && rr < b.rows && cc < b.cols) out.push(rr * b.cols + cc);
  }
  return out;
}

/** Place mines avoiding `safe` and its neighbours (so the first dig opens an area). */
export function placeMines(b: Board, safe: number, rand: () => number = Math.random): Board {
  const count = SIZES[b.size].mines;
  const n = b.cols * b.rows;
  const banned = new Set([safe, ...neighbors(b, safe)]);
  const pool: number[] = [];
  for (let i = 0; i < n; i++) if (!banned.has(i)) pool.push(i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return { ...b, mines: pool.slice(0, count).sort((a, z) => a - z) };
}

export const isMine = (b: Board, i: number) => b.mines.includes(i);
export const countAround = (b: Board, i: number) => neighbors(b, i).filter((j) => isMine(b, j)).length;

export type DigResult = { board: Board; boom: boolean };

/** Dig a cell; flood-opens zeros. Places mines on the first dig. */
export function dig(b0: Board, i: number, rand: () => number = Math.random): DigResult {
  let b = b0.mines.length ? b0 : placeMines(b0, i, rand);
  if (b.open[i] || b.flag[i]) return { board: b, boom: false };
  if (isMine(b, i)) {
    const open = b.open.slice(); open[i] = true;
    return { board: { ...b, open }, boom: true };
  }
  const mineSet = new Set(b.mines);
  const open = b.open.slice();
  const stack = [i];
  while (stack.length) {
    const j = stack.pop()!;
    if (open[j] || b.flag[j]) continue;
    open[j] = true;
    const around = neighbors(b, j);
    if (around.every((k) => !mineSet.has(k))) for (const k of around) if (!open[k]) stack.push(k);
  }
  b = { ...b, open };
  return { board: b, boom: false };
}

/** Tap on an opened number whose flags are all placed: dig the rest around it. */
export function chord(b: Board, i: number): DigResult {
  if (!b.open[i]) return { board: b, boom: false };
  const around = neighbors(b, i);
  const flags = around.filter((k) => b.flag[k]).length;
  if (flags !== countAround(b, i) || flags === 0) return { board: b, boom: false };
  let board = b, boom = false;
  for (const k of around) {
    if (board.open[k] || board.flag[k]) continue;
    const r = dig(board, k);
    board = r.board;
    boom = boom || r.boom;
  }
  return { board, boom };
}

export function toggleFlag(b: Board, i: number): Board {
  if (b.open[i]) return b;
  const flag = b.flag.slice(); flag[i] = !flag[i];
  return { ...b, flag };
}

export function won(b: Board): boolean {
  if (!b.mines.length) return false;
  const mineSet = new Set(b.mines);
  return b.open.every((o, i) => o || mineSet.has(i));
}

export const flagsLeft = (b: Board) => SIZES[b.size].mines - b.flag.filter(Boolean).length;
