import { describe, expect, it } from 'vitest';
import { seeded } from '../types';
import { SIZES, chord, countAround, dig, newBoard, neighbors, toggleFlag, won } from './logic';

describe('minesweeper logic', () => {
  it('first dig is always safe and opens an area', () => {
    for (let s = 0; s < 50; s++) {
      const r = dig(newBoard('hard'), 37, seeded(s));
      expect(r.boom).toBe(false);
      expect(r.board.mines).toHaveLength(SIZES.hard.mines);
      expect(r.board.mines).not.toContain(37);
      expect(countAround(r.board, 37)).toBe(0);
      expect(r.board.open.filter(Boolean).length).toBeGreaterThan(1);
    }
  });

  it('neighbors respects edges', () => {
    const b = newBoard('easy');
    expect(neighbors(b, 0).sort()).toEqual([1, 8, 9]);
    expect(neighbors(b, 9)).toHaveLength(8);
  });

  it('digging a mine is a boom; flags block digging', () => {
    const b = dig(newBoard('easy'), 0, seeded(1)).board;
    const m = b.mines[0];
    const flagged = toggleFlag(b, m);
    expect(dig(flagged, m).boom).toBe(false);
    expect(dig(b, m).boom).toBe(true);
  });

  it('opening every safe cell wins', () => {
    let b = dig(newBoard('easy'), 0, seeded(2)).board;
    expect(won(b)).toBe(false);
    for (let i = 0; i < 64; i++) if (!b.mines.includes(i)) b = dig(b, i).board;
    expect(won(b)).toBe(true);
  });

  it('chord digs around a satisfied number', () => {
    let b = dig(newBoard('medium'), 0, seeded(3)).board;
    const n = b.open.findIndex((o, i) => o && countAround(b, i) > 0);
    for (const k of neighbors(b, n)) if (b.mines.includes(k)) b = toggleFlag(b, k);
    const r = chord(b, n);
    expect(r.boom).toBe(false);
    expect(neighbors(b, n).every((k) => r.board.open[k] || r.board.flag[k])).toBe(true);
  });
});
