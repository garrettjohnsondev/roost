import { describe, expect, it } from 'vitest';
import { seeded } from '../types';
import { SIZES, chord, chordSmart, countAround, dailyBoard, dig, ghostScore, newBoard, newlyOpened, neighbors, sonar, toggleFlag, won } from './logic';

describe('minesweeper wave 3', () => {
  it('daily board is the same for everyone and starts safe', () => {
    const a = dailyBoard(20000), b = dailyBoard(20000);
    expect(a.mines).toEqual(b.mines);
    expect(a.mines).toHaveLength(SIZES.medium.mines);
    expect(dailyBoard(20001).mines).not.toEqual(a.mines);
    const r = dig(a, a.start!);
    expect(r.boom).toBe(false);
    expect(r.board.open.filter(Boolean).length).toBeGreaterThan(1);
  });

  it('smart chord flags forced neighbours, and digs once satisfied', () => {
    let found = 0;
    for (let seed = 0; seed < 20; seed++) {
      const b = dig(newBoard('medium'), 0, seeded(seed)).board;
      const n = b.open.findIndex((o, i) => o && countAround(b, i) > 0 && neighbors(b, i).filter((k) => !b.open[k]).length === countAround(b, i));
      if (n < 0) continue;
      found++;
      const r = chordSmart(b, n);
      expect(r.flagged.length).toBe(countAround(b, n));
      expect(r.flagged.every((k) => b.mines.includes(k))).toBe(true);
    }
    expect(found).toBeGreaterThan(0);
    let b = dig(newBoard('medium'), 0, seeded(3)).board;
    const m = b.open.findIndex((o, i) => o && countAround(b, i) > 0);
    for (const k of neighbors(b, m)) if (b.mines.includes(k)) b = toggleFlag(b, k);
    const r2 = chordSmart(b, m);
    expect(r2.boom).toBe(false);
    expect(neighbors(b, m).every((k) => r2.board.open[k] || r2.board.flag[k])).toBe(true);
  });

  it('sonar finds a safe cell on the frontier', () => {
    const b = dig(newBoard('hard'), 40, seeded(5)).board;
    for (let s = 0; s < 10; s++) {
      const i = sonar(b, seeded(s));
      expect(i).toBeGreaterThanOrEqual(0);
      expect(b.mines).not.toContain(i);
      expect(b.open[i]).toBe(false);
      expect(neighbors(b, i).some((k) => b.open[k])).toBe(true);
    }
    expect(sonar(newBoard('easy'))).toBe(-1);
  });

  it('lists newly opened cells and calibrates ghosts', () => {
    const a = newBoard('easy');
    const z = dig(a, 0, seeded(2)).board;
    expect(newlyOpened(a, z).length).toBe(z.open.filter(Boolean).length);
    expect(ghostScore(0.2)).toBeGreaterThan(240);
    expect(ghostScore(0.95)).toBeLessThan(60);
  });
});

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
