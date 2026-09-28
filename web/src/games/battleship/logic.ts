import { seeded } from '../types';

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

// ---- Wave 3: drag placement, sonar, burst shots, daily pond, ghosts ----

/** The cells a nest of `size` covers from (x, y), or null if off the pond. */
export function nestCells(x: number, y: number, size: number, horiz: boolean): number[] | null {
  if (x < 0 || y < 0 || (horiz ? x + size > N || y >= N : y + size > N || x >= N)) return null;
  return Array.from({ length: size }, (_, k) => (horiz ? idx(x + k, y) : idx(x, y + k)));
}

export const isHoriz = (n: Nest) => n.cells.length < 2 || n.cells[1] - n.cells[0] === 1;

/** Move nest k so it starts at (x, y) facing `horiz`; null if it would leave
 *  the pond or overlap another nest. Only for placement (no shots yet). */
export function moveNest(b: Board, k: number, x: number, y: number, horiz: boolean): Board | null {
  const cells = nestCells(x, y, b.nests[k].cells.length, horiz);
  if (!cells) return null;
  const others = new Set(b.nests.flatMap((n, j) => (j === k ? [] : n.cells)));
  if (cells.some((c) => others.has(c))) return null;
  return { ...b, nests: b.nests.map((n, j) => (j === k ? { cells } : n)) };
}

/** Turn nest k a quarter about its first cell, sliding it back along the
 *  new line if it would poke off the pond or into a neighbour. */
export function rotateNest(b: Board, k: number): Board | null {
  const n = b.nests[k];
  const [x, y] = xy(n.cells[0]);
  const horiz = !isHoriz(n);
  for (let back = 0; back < n.cells.length; back++) {
    const r = moveNest(b, k, horiz ? x - back : x, horiz ? y : y - back, horiz);
    if (r) return r;
  }
  return null;
}

/** Sonar: how many unfound nest cells sit in the 3x3 around i. */
export function sonar(b: Board, i: number): number {
  const [cx, cy] = xy(i);
  let n = 0;
  for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
    if (x < 0 || y < 0 || x >= N || y >= N) continue;
    const c = idx(x, y);
    if (b.shots[c] !== 2 && nestAt(b, c) >= 0) n++;
  }
  return n;
}

/** A burst hits i and its left/right neighbours (clipped to the pond). */
export function burstCells(i: number): number[] {
  const [x] = xy(i);
  return [x > 0 ? i - 1 : -1, i, x < N - 1 ? i + 1 : -1].filter((c) => c >= 0);
}

/** Fire at several cells at once (repeats are skipped). */
export function fireMany(b: Board, cells: number[]): { board: Board; results: Array<ShotResult & { cell: number }> } {
  const results: Array<ShotResult & { cell: number }> = [];
  for (const c of cells) {
    const r = fire(b, c);
    if (r.result.kind === 'repeat') continue;
    b = r.board;
    results.push({ ...r.result, cell: c });
  }
  return { board: b, results };
}

/** Hits in a row that earn a burst. */
export const STREAK_FOR_BURST = 3;

/** The streak after a shot, and whether it just earned a burst. */
export function nextStreak(streak: number, hit: boolean): { streak: number; earned: boolean } {
  if (!hit) return { streak: 0, earned: false };
  const n = streak + 1;
  return n >= STREAK_FOR_BURST ? { streak: 0, earned: true } : { streak: n, earned: false };
}

/** Today's pond: the same foe nests for everyone all day. */
export const dailyBoard = (day: number): Board => newBoard(seeded(day * 977 + 13));

/** Shots a ghost of this strength needs to find every nest. Moss (0.2) is
 *  looser than the easy AI (~48 shots); Nell (0.95) beats the hard AI (~34). */
export const ghostShots = (strength: number) => Math.round(57.3 - 26.7 * strength);
