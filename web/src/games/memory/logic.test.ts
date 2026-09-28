import { describe, expect, it } from 'vitest';
import { seeded } from '../types';
import { COMBO_FOR_PEEK, MATCH_BONUS, SIZES, TIME_FOR, colsFor, deal, done, face, flip, ghostMoves, ghostPairs, settle, spendPeek, tick, timeUp, type Size } from './logic';

describe('crew match logic', () => {
  it('deals pairs', () => {
    for (const size of [16, 20] as const) {
      const s = deal(size, seeded(5));
      expect(s.cards).toHaveLength(size);
      const counts: Record<string, number> = {};
      s.cards.forEach((c) => (counts[c] = (counts[c] ?? 0) + 1));
      expect(Object.values(counts).every((n) => n === 2)).toBe(true);
    }
  });

  it('matches, misses, and finishes with perfect play', () => {
    let s = deal(16, seeded(9));
    const a = 0, b = s.cards.indexOf(s.cards[0], 1);
    const wrong = s.cards.findIndex((c) => c !== s.cards[0]);
    s = flip(s, a);
    expect(flip(s, a)).toBe(s);
    s = flip(s, wrong);
    expect(s.misses).toBe(1);
    expect(s.open).toHaveLength(2);
    s = settle(s);
    s = flip(flip(s, a), b);
    expect(s.matched[a] && s.matched[b]).toBe(true);
    expect(s.moves).toBe(2);
    for (let i = 0; i < 16; i++) {
      if (s.matched[i]) continue;
      const j = s.cards.findIndex((c, k) => k !== i && c === s.cards[i]);
      s = flip(flip(s, i), j);
    }
    expect(done(s)).toBe(true);
    expect(s.moves).toBe(9);
  });
});

/** A player who remembers each card seen with probability `mem`. */
function play(size: Size, mem: number, rand: () => number): number {
  let s = deal(size, rand);
  const known = new Map<number, string>();
  const see = (i: number) => { if (rand() < mem) known.set(i, s.cards[i]); };
  const unseen = () => s.cards.map((_, i) => i).filter((i) => !s.matched[i] && !known.has(i));
  const pairFor = (i: number) => [...known].find(([j, c]) => j !== i && c === s.cards[i] && !s.matched[j])?.[0];
  for (let guard = 0; guard < 500 && !done(s); guard++) {
    const pair = [...known].find(([i]) => !s.matched[i] && pairFor(i) !== undefined);
    if (pair) { s = settle(flip(flip(s, pair[0]), pairFor(pair[0])!)); continue; }
    const u = unseen();
    const a = u.length ? u[Math.floor(rand() * u.length)] : [...known.keys()].find((i) => !s.matched[i])!;
    s = flip(s, a); see(a);
    const m = pairFor(a);
    const rest = unseen().filter((i) => i !== a);
    const b = m ?? (rest.length ? rest[Math.floor(rand() * rest.length)] : s.cards.findIndex((c, i) => i !== a && !s.matched[i]));
    s = flip(s, b); see(b);
    s = settle(s);
  }
  return s.moves;
}

describe('crew match wave 3', () => {
  it('deals the bigger boards, with lookalike poses on 5x6', () => {
    for (const size of SIZES) {
      const s = deal(size, seeded(size));
      expect(s.cards).toHaveLength(size);
      expect(new Set(s.cards).size).toBe(size / 2);
    }
    const big = deal(30, seeded(2));
    expect(big.cards.some((c) => face(c).pose === 'sleep')).toBe(true);
    expect(face('pip')).toEqual({ name: 'pip', pose: 'idle' });
    expect(colsFor(30)).toBe(5);
  });

  it('combos earn peeks and a miss breaks the combo', () => {
    let s = deal(16, seeded(4));
    const pairOf = (i: number) => s.cards.findIndex((c, k) => k !== i && c === s.cards[i]);
    const matchNext = () => { const i = s.matched.findIndex((m) => !m); s = flip(flip(s, i), pairOf(i)); };
    matchNext(); matchNext();
    expect(s.combo).toBe(2);
    expect(s.peeks).toBe(0);
    matchNext();
    expect(s.combo).toBe(COMBO_FOR_PEEK);
    expect(s.peeks).toBe(1);
    expect(s.bestCombo).toBe(3);
    const i = s.matched.findIndex((m) => !m);
    const wrong = s.cards.findIndex((c, k) => !s.matched[k] && c !== s.cards[i]);
    s = settle(flip(flip(s, i), wrong));
    expect(s.combo).toBe(0);
    expect(s.bestCombo).toBe(3);
    s = spendPeek(s)!;
    expect(s.peeks).toBe(0);
    expect(spendPeek(s)).toBeNull();
  });

  it('timed mode runs down, matches add time, and time up locks the board', () => {
    let s = deal(16, seeded(6), true);
    expect(s.left).toBe(TIME_FOR[16]);
    s = tick(s, 10);
    expect(s.left).toBe(TIME_FOR[16] - 10);
    const i = 0, j = s.cards.indexOf(s.cards[0], 1);
    s = flip(flip(s, i), j);
    expect(s.left).toBe(TIME_FOR[16] - 10 + MATCH_BONUS);
    s = tick(s, 999);
    expect(timeUp(s)).toBe(true);
    expect(flip(s, 3)).toBe(s);
    expect(tick(deal(16, seeded(1)), 5).left).toBeUndefined();
  });

  it('ghosts: Moss is beatable by a forgetful player, Nell needs near-perfect memory', () => {
    const avg = (mem: number) => { let t = 0; for (let k = 1; k <= 200; k++) t += play(16, mem, seeded(k * 31)); return t / 200; };
    const perfect = avg(1), casual = avg(0.5);
    expect(perfect).toBeGreaterThan(8);
    expect(ghostMoves(0.2)).toBeGreaterThan(casual);
    expect(ghostMoves(0.95)).toBeLessThanOrEqual(Math.ceil(perfect) + 1);
    expect(ghostMoves(0.95)).toBeGreaterThan(8);
  });

  it('the ghost pace marker never passes the board', () => {
    expect(ghostPairs(20, 8, 0)).toBe(0);
    expect(ghostPairs(20, 8, 10)).toBe(4);
    expect(ghostPairs(20, 8, 40)).toBe(8);
  });
});

import { ghostMovesFor } from './logic';
describe('each board has its own ghost', () => {
  it('bigger boards give the ghost more moves', () => {
    expect(ghostMovesFor(0.5, 8)).toBeLessThan(ghostMovesFor(0.5, 10));
    expect(ghostMovesFor(0.5, 15)).toBeGreaterThan(ghostMovesFor(0.5, 12));
  });
});
