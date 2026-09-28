import { describe, expect, it } from 'vitest';
import { seeded } from '../types';
import {
  N, SIZES, STREAK_FOR_BURST, aiShot, allSunk, burstCells, dailyBoard, fire, fireMany, ghostShots, isHoriz, moveNest,
  newBoard, nextStreak, placeFleet, rotateNest, sonar, type Board, type Level,
} from './logic';

describe('battleship logic', () => {
  it('places a legal fleet', () => {
    for (let s = 1; s < 50; s++) {
      const nests = placeFleet(seeded(s));
      expect(nests.map((n) => n.cells.length)).toEqual(SIZES);
      const all = nests.flatMap((n) => n.cells);
      expect(new Set(all).size).toBe(all.length);
      expect(all.every((c) => c >= 0 && c < N * N)).toBe(true);
    }
  });

  it('fires, sinks and refuses repeats', () => {
    let b = newBoard(seeded(3));
    const nest = b.nests[4].cells;
    let r = fire(b, nest[0]);
    expect(r.result.kind).toBe('hit');
    b = r.board;
    expect(fire(b, nest[0]).result.kind).toBe('repeat');
    r = fire(b, nest[1]);
    expect(r.result.kind).toBe('sunk');
    const empty = b.shots.findIndex((_, i) => !b.nests.some((n) => n.cells.includes(i)));
    expect(fire(b, empty).result.kind).toBe('miss');
  });

  it('every level finishes, and hard beats easy on average', () => {
    const avg = (level: Level) => {
      let total = 0;
      for (let s = 1; s <= 30; s++) {
        const rand = seeded(s * 7);
        let b = newBoard(seeded(s));
        let shots = 0;
        while (!allSunk(b)) {
          const i = aiShot(b, level, rand);
          const r = fire(b, i);
          expect(r.result.kind).not.toBe('repeat');
          b = r.board;
          shots++;
        }
        total += shots;
      }
      return total / 30;
    };
    const easy = avg('easy'), hard = avg('hard');
    expect(hard).toBeLessThan(easy);
    expect(avg('normal')).toBeLessThanOrEqual(N * N);
  });
});

const avgShots = (level: Level, runs = 120) => {
  let total = 0;
  for (let s = 1; s <= runs; s++) {
    const rand = seeded(s * 7);
    let b = newBoard(seeded(s));
    let shots = 0;
    while (!allSunk(b)) { b = fire(b, aiShot(b, level, rand)).board; shots++; }
    total += shots;
  }
  return total / runs;
};

describe('nests wave 3', () => {
  it('drags nests only to legal spots', () => {
    const b: Board = { nests: [{ cells: [0, 1, 2] }, { cells: [16, 17] }], shots: Array(N * N).fill(0) };
    expect(moveNest(b, 0, 6, 0, true)).toBeNull(); // off the pond
    expect(moveNest(b, 0, 0, 1, false)).toBeNull(); // over the other nest
    expect(moveNest(b, 0, 3, 3, true)!.nests[0].cells).toEqual([27, 28, 29]);
    expect(moveNest(b, 0, 7, 5, false)!.nests[0].cells).toEqual([47, 55, 63]);
  });

  it('rotates, sliding back when it would poke off the pond', () => {
    const b: Board = { nests: [{ cells: [61, 62, 63] }], shots: Array(N * N).fill(0) };
    const r = rotateNest(b, 0)!;
    expect(isHoriz(r.nests[0])).toBe(false);
    expect(r.nests[0].cells).toEqual([45, 53, 61]);
    expect(isHoriz(rotateNest(r, 0)!.nests[0])).toBe(true);
  });

  it('sonar counts unfound nest cells in the 3x3', () => {
    let b: Board = { nests: [{ cells: [9, 10, 11] }], shots: Array(N * N).fill(0) };
    expect(sonar(b, 1)).toBe(2); // 9 and 10
    expect(sonar(b, 63)).toBe(0);
    b = fire(b, 9).board;
    expect(sonar(b, 1)).toBe(1);
  });

  it('bursts hit three in a row, clipped at the edge, and skip repeats', () => {
    expect(burstCells(0)).toEqual([0, 1]);
    expect(burstCells(7)).toEqual([6, 7]);
    expect(burstCells(10)).toEqual([9, 10, 11]);
    let b: Board = { nests: [{ cells: [9, 10] }], shots: Array(N * N).fill(0) };
    b = fire(b, 11).board;
    const r = fireMany(b, burstCells(10));
    expect(r.results.map((x) => x.kind)).toEqual(['hit', 'sunk']);
    expect(allSunk(r.board)).toBe(true);
  });

  it('three hits in a row earn a burst', () => {
    let st = { streak: 0, earned: false };
    st = nextStreak(st.streak, true); st = nextStreak(st.streak, true);
    expect(st.earned).toBe(false);
    st = nextStreak(st.streak, true);
    expect(st).toEqual({ streak: 0, earned: true });
    expect(nextStreak(2, false)).toEqual({ streak: 0, earned: false });
    expect(STREAK_FOR_BURST).toBe(3);
  });

  it('the daily pond is the same all day', () => {
    expect(dailyBoard(20000)).toEqual(dailyBoard(20000));
    expect(dailyBoard(20000)).not.toEqual(dailyBoard(20001));
  });

  it('ghosts: Moss is looser than the easy AI, Nell sharper than the hard AI', () => {
    expect(ghostShots(0.2)).toBeGreaterThan(avgShots('easy'));
    expect(ghostShots(0.95)).toBeLessThan(avgShots('hard'));
    expect(ghostShots(0.95)).toBeGreaterThanOrEqual(SIZES.reduce((a, b) => a + b) + 10);
    expect(ghostShots(0.5)).toBeLessThan(ghostShots(0.4));
  });
});
