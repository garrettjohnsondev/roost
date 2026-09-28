import { describe, expect, it } from 'vitest';
import { autoHome, bestTargetF, canPlaceF, dealFree, hintF, isRun, isWonF, maxMove, moveF, pickF, type FState } from './freecell';
import { dailySeed, deal, ghostHome, ghostSecs, hint, type State } from './logic';

const c = (suit: number, rank: number) => suit * 13 + rank - 1;
const empty = (): FState => ({
  variant: 'freecell', tab: Array.from({ length: 8 }, () => []), cells: [null, null, null, null], found: [[], [], [], []], moves: 0, secs: 0, undos: 0,
});

describe('freecell', () => {
  it('deals all 52 face up into 7,7,7,7,6,6,6,6', () => {
    const s = dealFree(9);
    expect(s.tab.map((t) => t.length)).toEqual([7, 7, 7, 7, 6, 6, 6, 6]);
    expect(new Set(s.tab.flat()).size).toBe(52);
    expect(dealFree(9)).toEqual(dealFree(9));
  });

  it('runs alternate colours going down', () => {
    expect(isRun([c(0, 9), c(1, 8), c(2, 7)])).toBe(true);
    expect(isRun([c(0, 9), c(2, 8)])).toBe(false);
    expect(isRun([c(0, 9), c(1, 7)])).toBe(false);
  });

  it('limits supermoves by free cells and empty columns', () => {
    const s = empty();
    s.tab = [[c(0, 13)], [c(0, 1)], [c(0, 2)], [c(0, 3)], [c(0, 4)], [c(0, 5)], [c(0, 6)], [c(0, 7)]];
    expect(maxMove(s, false)).toBe(5); // 4 free cells, no empty columns
    s.cells = [c(1, 1), c(1, 2), null, null];
    expect(maxMove(s, false)).toBe(3);
    s.tab[7] = [];
    expect(maxMove(s, false)).toBe(6);
    expect(maxMove(s, true)).toBe(3);
  });

  it('moves singles and runs, to cells, columns and home', () => {
    let s = empty();
    s.tab[0] = [c(0, 10), c(1, 9), c(0, 8)];
    s.tab[1] = [c(3, 10)]; // red 10: can't take a red 9
    s.tab[2] = [c(2, 10)]; // black 10 takes the red 9 run
    s.tab[3] = [c(1, 1)];
    expect(pickF(s, { kind: 'tab', col: 0, idx: 1 })).toEqual([c(1, 9), c(0, 8)]);
    expect(canPlaceF(s, [c(1, 9), c(0, 8)], { kind: 'tab', col: 1 })).toBe(false);
    s = moveF(s, { kind: 'tab', col: 0, idx: 1 }, { kind: 'tab', col: 2 })!;
    expect(s.tab[2]).toEqual([c(2, 10), c(1, 9), c(0, 8)]);
    expect(bestTargetF(s, { kind: 'tab', col: 3, idx: 0 })).toEqual({ kind: 'found', suit: 1 });
    s = moveF(s, { kind: 'tab', col: 2, idx: 2 }, { kind: 'cell', i: 0 })!;
    expect(s.cells[0]).toBe(c(0, 8));
    expect(moveF(s, { kind: 'tab', col: 1, idx: 0 }, { kind: 'cell', i: 0 })).toBeNull(); // cell taken
    expect(s.moves).toBe(2);
  });

  it('auto-home sends only safe cards', () => {
    const s = empty();
    s.tab[0] = [c(0, 2), c(0, 1)];
    s.tab[1] = [c(1, 3)];
    s.cells[0] = c(1, 1);
    s.tab[2] = [c(1, 2)];
    const steps = autoHome(s);
    const last = steps[steps.length - 1];
    expect(last.found[0].length).toBe(2);
    expect(last.found[1].length).toBe(2); // the red 3 waits for the black 2s
    expect(last.moves).toBe(0);
  });

  it('wins when every suit is home and hints something useful', () => {
    const s = empty();
    s.found = [0, 1, 2, 3].map((su) => Array.from({ length: 13 }, (_, k) => c(su, k + 1)));
    expect(isWonF(s)).toBe(true);
    const t = empty();
    t.tab[0] = [c(0, 5), c(1, 1)];
    expect(hintF(t)).toEqual({ from: { kind: 'tab', col: 0, idx: 1 }, to: { kind: 'found', suit: 1 } });
    expect(hintF(empty())).toBeNull();
  });
});

describe('klondike wave 3', () => {
  const blank = (): State => ({ tab: Array.from({ length: 7 }, () => ({ cards: [], hidden: 0 })), stock: [], waste: [], found: [[], [], [], []], draw: 1, moves: 0, secs: 0, undos: 0 });

  it('hints home first, then turning a card over, then the waste, then a draw', () => {
    const s = blank();
    s.waste = [c(3, 1)];
    expect(hint(s)).toEqual({ from: { kind: 'waste' }, to: { kind: 'found', suit: 3 } });
    s.waste = [c(3, 5)];
    s.tab[0] = { cards: [c(0, 2), c(1, 9)], hidden: 1 };
    s.tab[1] = { cards: [c(0, 10)], hidden: 0 };
    expect(hint(s)).toEqual({ from: { kind: 'tab', col: 0, idx: 1 }, to: { kind: 'tab', col: 1 } });
    s.tab[0] = { cards: [c(2, 6)], hidden: 0 };
    s.tab[1] = { cards: [], hidden: 0 };
    expect(hint(s)).toEqual({ from: { kind: 'waste' }, to: { kind: 'tab', col: 0 } });
    s.waste = [c(3, 9)];
    s.stock = [c(1, 4)];
    expect(hint(s)).toBe('draw');
    expect(hint(blank())).toBeNull();
  });

  it('the daily deal is the same all day', () => {
    expect(deal(dailySeed(20000))).toEqual(deal(dailySeed(20000)));
    expect(dailySeed(20000)).not.toBe(dailySeed(20001));
    expect(dealFree(dailySeed(3))).toEqual(dealFree(dailySeed(3)));
  });

  it('ghosts: Moss is relaxed, Nell is quick, and the pace fills to 52', () => {
    expect(ghostSecs(0.2)).toBeGreaterThanOrEqual(420);
    expect(ghostSecs(0.95)).toBeLessThanOrEqual(180);
    expect(ghostSecs(0.95)).toBeGreaterThanOrEqual(120);
    expect(ghostSecs(0.5)).toBeLessThan(ghostSecs(0.4));
    expect(ghostHome(200, 0)).toBe(0);
    expect(ghostHome(200, 100)).toBe(26);
    expect(ghostHome(200, 500)).toBe(52);
  });
});
