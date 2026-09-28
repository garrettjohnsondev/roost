/** Hatch: 2048 on a 4x4 (or 5x5) board. A cell holds the exponent (1 = 2,
 *  2 = 4, ...), 0 is empty. A golden egg is its exponent + GOLD: it merges
 *  with any tile of the same rank and pays triple. Pure, so it can be tested
 *  without a DOM. The board's size is read from its length. */
export const SIZE = 4;
export const GOLD = 100;
export type Board = number[]; // length size*size, row-major
export type Dir = 'up' | 'down' | 'left' | 'right';

export const rank = (v: number) => v % GOLD;
export const isGold = (v: number) => v >= GOLD;
export const sizeOf = (b: Board) => Math.round(Math.sqrt(b.length));
export const empty = (size = SIZE): Board => Array(size * size).fill(0);

export interface Slide {
  line: number[];
  gained: number;
  /** For each input slot, where its tile ends up (-1 for an empty slot). */
  dest?: number[];
  /** Input slots whose tile was swallowed by a merge. */
  absorbed?: number[];
  merges?: number;
  golds?: number;
}

/** Slide one line toward index 0, merging equal ranks once per pair. */
export function slideLine(line: number[]): Slide {
  const vals: Array<{ v: number; at: number }> = [];
  line.forEach((v, at) => { if (v > 0) vals.push({ v, at }); });
  const out: number[] = [];
  const dest = line.map(() => -1);
  const absorbed: number[] = [];
  let gained = 0, merges = 0, golds = 0;
  for (let i = 0; i < vals.length; i++) {
    const a = vals[i], b = vals[i + 1];
    if (b && rank(a.v) === rank(b.v)) {
      const r = rank(a.v) + 1;
      const gold = isGold(a.v) || isGold(b.v);
      dest[a.at] = out.length; dest[b.at] = out.length;
      absorbed.push(b.at);
      out.push(r);
      gained += 2 ** r * (gold ? 3 : 1);
      merges++; if (gold) golds++;
      i++;
    } else { dest[a.at] = out.length; out.push(a.v); }
  }
  while (out.length < line.length) out.push(0);
  return { line: out, gained, dest, absorbed, merges, golds };
}

function indices(dir: Dir, k: number, n: number): number[] {
  const r: number[] = [];
  for (let j = 0; j < n; j++) {
    if (dir === 'left') r.push(k * n + j);
    else if (dir === 'right') r.push(k * n + (n - 1 - j));
    else if (dir === 'up') r.push(j * n + k);
    else r.push((n - 1 - j) * n + k);
  }
  return r;
}

export interface Move {
  board: Board; gained: number; moved: boolean;
  /** Where every tile went, by board index. `absorbed` tiles vanish into `to`. */
  moves: Array<{ from: number; to: number; absorbed: boolean }>;
  merges: number; golds: number;
  /** Board indices where a merge landed. */
  mergedAt: number[];
}

export function move(b: Board, dir: Dir): Move {
  const n = sizeOf(b);
  const board = b.slice();
  let gained = 0, merges = 0, golds = 0;
  const moves: Move['moves'] = [];
  const mergedAt: number[] = [];
  for (let k = 0; k < n; k++) {
    const idx = indices(dir, k, n);
    const res = slideLine(idx.map((i) => b[i]));
    gained += res.gained; merges += res.merges ?? 0; golds += res.golds ?? 0;
    idx.forEach((i, j) => { board[i] = res.line[j]; });
    idx.forEach((i, j) => {
      const d = res.dest![j];
      if (d < 0) return;
      const ab = res.absorbed!.includes(j);
      moves.push({ from: i, to: idx[d], absorbed: ab });
      if (ab) mergedAt.push(idx[d]);
    });
  }
  return { board, gained, moved: board.some((v, i) => v !== b[i]), moves, merges, golds, mergedAt };
}

/** Drop a new egg on a free cell (10% cracked); sometimes a golden one. */
export function spawn(b: Board, rand: () => number = Math.random, goldChance = 0): Board {
  const free = b.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  if (!free.length) return b;
  const board = b.slice();
  const v = rand() < 0.9 ? 1 : 2;
  board[free[Math.floor(rand() * free.length)]] = goldChance > 0 && rand() < goldChance ? v + GOLD : v;
  return board;
}

export const canMove = (b: Board) => (['up', 'down', 'left', 'right'] as Dir[]).some((d) => move(b, d).moved);
export const maxTile = (b: Board) => Math.max(0, ...b.map(rank));

export function newBoard(rand: () => number = Math.random, size = SIZE): Board {
  return spawn(spawn(empty(size), rand), rand);
}

/** Merge chains: every move in a row that merges something grows the chain;
 *  from the third link on, merges pay a bonus (10% per link, up to +100%). */
export function comboBonus(gained: number, chain: number): number {
  if (chain < 3 || gained <= 0) return 0;
  return Math.round(gained * 0.1 * Math.min(chain - 2, 10));
}

/** How many haptic ticks a move earns: one for a merge, more for a big one. */
export function mergeTicks(merges: number, newTop: number): number {
  if (merges <= 0) return 0;
  const big = merges >= 3 ? merges + 1 : 1;
  return Math.min(12, big + (newTop >= 8 ? 2 : 0));
}

/** The ghost's score so far after `moves` of your moves: roughly how fast a
 *  steady player's score climbs, capped at their final score. */
export const ghostPace = (target: number, moves: number) => Math.min(target, Math.round(1.8 * Math.max(0, moves) ** 1.35));

/** What a ghost of this strength scores: Haiku ~2.3k, Astra ~20k. */
export const ghostScore = (s: number) => Math.round((1500 * (1 + 14 * s * s)) / 10) * 10;

/** The ladder: egg, cracked egg, then the crew, with Ollie at 2048. */
export const LADDER = ['egg', 'crack', 'pip', 'wren', 'fig', 'nell', 'juno', 'rue', 'bly', 'tuck', 'ollie', 'otto', 'moss', 'bram'];
export const who = (exp: number) => LADDER[Math.min(rank(exp), LADDER.length) - 1];
