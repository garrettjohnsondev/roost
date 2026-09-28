import { describe, expect, it } from 'vitest';
import { seeded } from '../types';
import { CLUES, conflicts, countSolutions, generate, isSolved, solve } from './logic';

const validFull = (g: number[]) => {
  for (let k = 0; k < 9; k++) {
    const row = new Set(g.slice(k * 9, k * 9 + 9));
    const col = new Set(Array.from({ length: 9 }, (_, r) => g[r * 9 + k]));
    const box = new Set(Array.from({ length: 9 }, (_, j) => g[(Math.floor(k / 3) * 3 + Math.floor(j / 3)) * 9 + (k % 3) * 3 + (j % 3)]));
    if (row.size !== 9 || col.size !== 9 || box.size !== 9 || row.has(0)) return false;
  }
  return true;
};

describe('sudoku logic', () => {
  it('generates valid, unique, fast puzzles', () => {
    for (const level of ['easy', 'medium'] as const) {
      for (let s = 0; s < 5; s++) {
        const t0 = performance.now();
        const p = generate(seeded(1000 + s), level);
        expect(performance.now() - t0).toBeLessThan(200);
        expect(validFull(p.solution)).toBe(true);
        expect(countSolutions(p.givens, 2)).toBe(1);
        expect(p.givens.filter(Boolean).length).toBeGreaterThanOrEqual(CLUES[level]);
        expect(p.givens.every((v, i) => !v || v === p.solution[i])).toBe(true);
        expect(solve(p.givens)).toEqual(p.solution);
      }
    }
  });

  it('is deterministic per seed (daily puzzle)', () => {
    expect(generate(seeded(20000), 'easy')).toEqual(generate(seeded(20000), 'easy'));
  });

  it('flags conflicts and detects a solve', () => {
    const p = generate(seeded(7), 'easy');
    const g = p.givens.slice();
    const empty = g.indexOf(0);
    const row = Math.floor(empty / 9);
    const clash = g.slice(row * 9, row * 9 + 9).find(Boolean)!;
    g[empty] = clash;
    expect(conflicts(g).has(empty)).toBe(true);
    expect(isSolved(p.solution, p.solution)).toBe(true);
    expect(isSolved(p.givens, p.solution)).toBe(false);
  });
});
