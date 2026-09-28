/** Pure Battleship ("Nests") logic: an 8x8 pond, nests of 5,4,3,3,2. */
export const N = 8;
export const SIZES = [5, 4, 3, 3, 2];

export interface Nest { cells: number[] } // cell index = y*N + x
export type Level = 'easy' | 'normal' | 'hard';
/** Shot marks per cell: 0 unknown, 1 miss, 2 hit. */
export type Shots = number[];

export interface Board { nests: Nest[]; shots: Shots }

export const idx = (x: number, y: number) => y * N + x;
export const xy = (i: number): [number, number] => [i % N, Math.floor(i / N)];

export function placeFleet(rand: () => number): Nest[] {
  for (;;) {
    const taken = new Set<number>();
    const nests: Nest[] = [];
    let ok = true;
    for (const size of SIZES) {
      let placed = false;
      for (let tries = 0; tries < 200 && !placed; tries++) {
        const horiz = rand() < 0.5;
        const x = Math.floor(rand() * (horiz ? N - size + 1 : N));
        const y = Math.floor(rand() * (horiz ? N : N - size + 1));
        const cells = Array.from({ length: size }, (_, k) => (horiz ? idx(x + k, y) : idx(x, y + k)));
        if (cells.some((c) => taken.has(c))) continue;
        cells.forEach((c) => taken.add(c));
        nests.push({ cells });
        placed = true;
      }
      if (!placed) { ok = false; break; }
    }
    if (ok) return nests;
  }
}

export const newBoard = (rand: () => number): Board => ({ nests: placeFleet(rand), shots: Array(N * N).fill(0) });

export const nestAt = (b: Board, i: number) => b.nests.findIndex((n) => n.cells.includes(i));
export const isSunk = (b: Board, k: number) => b.nests[k].cells.every((c) => b.shots[c] === 2);
export const allSunk = (b: Board) => b.nests.every((_, k) => isSunk(b, k));

export type ShotResult = { kind: 'miss' | 'hit' | 'sunk' | 'repeat'; nest: number };

/** Fire at cell i. Returns the new board and what happened. */
export function fire(b: Board, i: number): { board: Board; result: ShotResult } {
  if (b.shots[i] !== 0) return { board: b, result: { kind: 'repeat', nest: -1 } };
  const k = nestAt(b, i);
  const shots = b.shots.slice();
  shots[i] = k >= 0 ? 2 : 1;
  const board = { ...b, shots };
  if (k < 0) return { board, result: { kind: 'miss', nest: -1 } };
  return { board, result: { kind: isSunk(board, k) ? 'sunk' : 'hit', nest: k } };
}

const neighbors = (i: number) => {
  const [x, y] = xy(i);
  const out: number[] = [];
  if (x > 0) out.push(i - 1);
  if (x < N - 1) out.push(i + 1);
  if (y > 0) out.push(i - N);
  if (y < N - 1) out.push(i + N);
  return out;
};

/** What the AI can see: shot marks plus which hit cells belong to sunk nests. */
function view(b: Board) {
  const sunkCells = new Set<number>();
  const remaining: number[] = [];
  b.nests.forEach((n, k) => (isSunk(b, k) ? n.cells.forEach((c) => sunkCells.add(c)) : remaining.push(n.cells.length)));
  return { sunkCells, remaining };
}

/** Probability density: count placements of remaining nests consistent with
 *  the shots; placements over open hits are weighted heavily (target mode). */
export function density(b: Board): number[] {
  const { sunkCells, remaining } = view(b);
  const open = (i: number) => b.shots[i] === 2 && !sunkCells.has(i);
  const score = Array(N * N).fill(0);
  for (const size of remaining) {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) for (const horiz of [true, false]) {
      if (horiz ? x + size > N : y + size > N) continue;
      const cells = Array.from({ length: size }, (_, k) => (horiz ? idx(x + k, y) : idx(x, y + k)));
      if (cells.some((c) => b.shots[c] === 1 || sunkCells.has(c))) continue;
      const hits = cells.filter(open).length;
      const w = hits ? 1 + hits * 50 : 1;
      for (const c of cells) if (b.shots[c] === 0) score[c] += w;
    }
  }
  return score;
}

export function aiShot(b: Board, level: Level, rand: () => number): number {
  const unknown = b.shots.map((s, i) => (s === 0 ? i : -1)).filter((i) => i >= 0);
  const pick = (arr: number[]) => arr[Math.floor(rand() * arr.length)];
  const { sunkCells } = view(b);
  const openHits = b.shots.map((s, i) => (s === 2 && !sunkCells.has(i) ? i : -1)).filter((i) => i >= 0);
  if (level === 'easy') {
    // Moss wanders: follows up a hit only half the time.
    if (openHits.length && rand() < 0.5) {
      const adj = openHits.flatMap(neighbors).filter((i) => b.shots[i] === 0);
      if (adj.length) return pick(adj);
    }
    return pick(unknown);
  }
  if (level === 'normal') {
    const adj = openHits.flatMap(neighbors).filter((i) => b.shots[i] === 0);
    if (adj.length) return pick(adj);
    const parity = unknown.filter((i) => (xy(i)[0] + xy(i)[1]) % 2 === 0);
    return pick(parity.length ? parity : unknown);
  }
  const d = density(b);
  let cand = unknown;
  if (!openHits.length) {
    const parity = unknown.filter((i) => (xy(i)[0] + xy(i)[1]) % 2 === 0);
    if (parity.length) cand = parity;
  }
  const max = Math.max(...cand.map((i) => d[i]));
  if (max <= 0) return pick(unknown);
  return pick(cand.filter((i) => d[i] === max));
}
