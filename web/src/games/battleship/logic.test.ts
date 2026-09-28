import { describe, expect, it } from 'vitest';
import { seeded } from '../types';
import { N, SIZES, aiShot, allSunk, fire, newBoard, placeFleet, type Level } from './logic';

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
