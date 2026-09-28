/** Hatch: 2048 on a 4x4 board. A cell holds the exponent (1 = 2, 2 = 4, ...),
 *  0 is empty. Pure, so it can be tested without a DOM. */
export const SIZE = 4;
export type Board = number[]; // length 16, row-major
export type Dir = 'up' | 'down' | 'left' | 'right';

export const empty = (): Board => Array(SIZE * SIZE).fill(0);

/** Slide one line toward index 0, merging equal pairs once. */
export function slideLine(line: number[]): { line: number[]; gained: number } {
  const vals = line.filter((v) => v > 0);
  const out: number[] = [];
  let gained = 0;
  for (let i = 0; i < vals.length; i++) {
    if (i + 1 < vals.length && vals[i] === vals[i + 1]) {
      out.push(vals[i] + 1);
      gained += 2 ** (vals[i] + 1);
      i++;
    } else out.push(vals[i]);
  }
  while (out.length < line.length) out.push(0);
  return { line: out, gained };
}

function indices(dir: Dir, k: number): number[] {
  const r: number[] = [];
  for (let j = 0; j < SIZE; j++) {
    if (dir === 'left') r.push(k * SIZE + j);
    else if (dir === 'right') r.push(k * SIZE + (SIZE - 1 - j));
    else if (dir === 'up') r.push(j * SIZE + k);
    else r.push((SIZE - 1 - j) * SIZE + k);
  }
  return r;
}

export function move(b: Board, dir: Dir): { board: Board; gained: number; moved: boolean } {
  const board = b.slice();
  let gained = 0;
  for (let k = 0; k < SIZE; k++) {
    const idx = indices(dir, k);
    const res = slideLine(idx.map((i) => b[i]));
    gained += res.gained;
    idx.forEach((i, j) => { board[i] = res.line[j]; });
  }
  return { board, gained, moved: board.some((v, i) => v !== b[i]) };
}

export function spawn(b: Board, rand: () => number = Math.random): Board {
  const free = b.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  if (!free.length) return b;
  const board = b.slice();
  board[free[Math.floor(rand() * free.length)]] = rand() < 0.9 ? 1 : 2;
  return board;
}

export const canMove = (b: Board) => (['up', 'down', 'left', 'right'] as Dir[]).some((d) => move(b, d).moved);
export const maxTile = (b: Board) => Math.max(0, ...b);

export function newBoard(rand: () => number = Math.random): Board {
  return spawn(spawn(empty(), rand), rand);
}

/** The ladder: egg, cracked egg, then the crew, with Ollie at 2048. */
export const LADDER = ['egg', 'crack', 'pip', 'wren', 'fig', 'nell', 'juno', 'rue', 'bly', 'tuck', 'ollie', 'otto', 'moss', 'bram'];
export const who = (exp: number) => LADDER[Math.min(exp, LADDER.length) - 1];
