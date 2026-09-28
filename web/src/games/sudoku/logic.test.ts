import { describe, expect, it } from 'vitest';
import { seeded } from '../types';
import {
  CLUES, bumpStreak, candidates, completedUnits, conflicts, countSolutions, generate, ghostScore, hintCell, isSolved, liveStreak, solve,
} from './logic';

describe('sudoku wave 3', () => {
  it('generates unique diagonal (X) puzzles with valid diagonals', () => {
    for (let s = 0; s < 3; s++) {
      const t0 = performance.now();
      const p = generate(seeded(500 + s), 'medium', true);
      expect(performance.now() - t0).toBeLessThan(400);
      expect(new Set(Array.from({ length: 9 }, (_, k) => p.solution[k * 10])).size).toBe(9);
      expect(new Set(Array.from({ length: 9 }, (_, k) => p.solution[k * 9 + 8 - k])).size).toBe(9);
      expect(countSolutions(p.givens, 2, undefined, undefined, true)).toBe(1);
      expect(solve(p.givens, true)).toEqual(p.solution);
    }
  });

  it('diagonal conflicts only count in X mode', () => {
    const g = Array(81).fill(0);
    g[0] = 5; g[80] = 5;
    expect(conflicts(g).size).toBe(0);
    expect(conflicts(g, true).has(80)).toBe(true);
  });

  it('auto-notes list exactly the digits still possible', () => {
    const p = generate(seeded(9), 'easy');
    const c = candidates(p.givens);
    for (let i = 0; i < 81; i++) {
      if (p.givens[i]) expect(c[i]).toBe(0);
      else expect(c[i] & (1 << p.solution[i])).toBeTruthy();
    }
  });

  it('hints fix the selected cell, else a wrong one, else the tightest empty', () => {
    const p = generate(seeded(11), 'easy');
    const g = p.givens.slice();
    const empty = g.indexOf(0);
    expect(hintCell(g, p.solution, empty)).toBe(empty);
    const other = g.indexOf(0, empty + 1);
    g[other] = (p.solution[other] % 9) + 1;
    expect(hintCell(g, p.solution, null)).toBe(other);
    expect(hintCell(p.solution, p.solution, null)).toBe(-1);
    expect(hintCell(p.givens, p.solution, null)).toBeGreaterThanOrEqual(0);
  });

  it('spots completed units', () => {
    const p = generate(seeded(12), 'easy');
    expect(completedUnits(p.solution, p.solution, 40).length).toBe(3);
    expect(completedUnits(p.solution, p.solution, 40, true).length).toBe(5);
    expect(completedUnits(p.givens, p.solution, p.givens.indexOf(0)).length).toBeLessThan(3);
  });

  it('keeps a daily streak', () => {
    let s = bumpStreak(null, 100);
    s = bumpStreak(s, 101);
    s = bumpStreak(s, 101);
    expect(s.count).toBe(2);
    expect(liveStreak(s, 102)).toBe(2);
    expect(liveStreak(s, 103)).toBe(0);
    s = bumpStreak(s, 104);
    expect(s).toEqual({ last: 104, count: 1, best: 2 });
  });

  it('ghost times get faster with strength', () => {
    expect(ghostScore(0.2)).toBeGreaterThan(700);
    expect(ghostScore(0.95)).toBeLessThan(260);
  });
});

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
