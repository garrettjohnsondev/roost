import { describe, expect, it } from 'vitest';
import { allFaceUp, autoComplete, bestTarget, canPlace, deal, drawStock, isWon, move, type State } from './logic';

const c = (suit: number, rank: number) => suit * 13 + rank - 1;
const empty = (): State => ({
  tab: Array.from({ length: 7 }, () => ({ cards: [], hidden: 0 })),
  stock: [], waste: [], found: [[], [], [], []], draw: 1, moves: 0, secs: 0, undos: 0,
});

describe('deal', () => {
  it('lays out 28 tableau cards and 24 in the stock, all distinct', () => {
    const s = deal(42);
    expect(s.tab.map((t) => t.cards.length)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(s.tab.map((t) => t.hidden)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(s.stock.length).toBe(24);
    const all = [...s.stock, ...s.tab.flatMap((t) => t.cards)];
    expect(new Set(all).size).toBe(52);
  });
  it('is deterministic per seed', () => {
    expect(deal(7)).toEqual(deal(7));
    expect(deal(7)).not.toEqual(deal(8));
  });
});

describe('stock', () => {
  it('draws 1 or 3 and recycles', () => {
    const s = deal(1);
    expect(drawStock(s)!.waste.length).toBe(1);
    const s3 = deal(1, 3);
    let n = drawStock(s3)!;
    expect(n.waste.length).toBe(3);
    for (let i = 0; i < 7; i++) n = drawStock(n)!;
    expect(n.stock.length).toBe(0);
    const back = drawStock(n)!;
    expect(back.stock.length).toBe(24);
    expect(back.stock).toEqual([...n.waste].reverse());
  });
});

describe('legal moves', () => {
  it('builds down in alternating colours, kings to empty columns', () => {
    const s = empty();
    s.tab[0].cards = [c(0, 8)]; // 8 of spades
    expect(canPlace(s, [c(1, 7)], { kind: 'tab', col: 0 })).toBe(true); // red 7
    expect(canPlace(s, [c(2, 7)], { kind: 'tab', col: 0 })).toBe(false); // black 7
    expect(canPlace(s, [c(1, 6)], { kind: 'tab', col: 0 })).toBe(false);
    expect(canPlace(s, [c(1, 13)], { kind: 'tab', col: 1 })).toBe(true);
    expect(canPlace(s, [c(1, 12)], { kind: 'tab', col: 1 })).toBe(false);
  });
  it('foundations go ace up in suit', () => {
    const s = empty();
    expect(canPlace(s, [c(3, 1)], { kind: 'found', suit: 3 })).toBe(true);
    expect(canPlace(s, [c(3, 2)], { kind: 'found', suit: 3 })).toBe(false);
    s.found[3] = [c(3, 1)];
    expect(canPlace(s, [c(3, 2)], { kind: 'found', suit: 3 })).toBe(true);
  });
  it('moving uncovers the card underneath', () => {
    const s = empty();
    s.tab[0] = { cards: [c(0, 2), c(1, 9)], hidden: 1 };
    s.tab[1] = { cards: [c(0, 10)], hidden: 0 };
    const n = move(s, { kind: 'tab', col: 0, idx: 1 }, { kind: 'tab', col: 1 })!;
    expect(n.tab[0]).toEqual({ cards: [c(0, 2)], hidden: 0 });
    expect(n.tab[1].cards).toEqual([c(0, 10), c(1, 9)]);
    expect(n.moves).toBe(1);
    expect(move(s, { kind: 'tab', col: 0, idx: 0 }, { kind: 'tab', col: 1 })).toBeNull(); // face down
  });
  it('tap prefers the foundation, then a column', () => {
    const s = empty();
    s.waste = [c(1, 1)];
    expect(bestTarget(s, { kind: 'waste' })).toEqual({ kind: 'found', suit: 1 });
    s.waste = [c(1, 7)];
    s.tab[4].cards = [c(2, 8)];
    expect(bestTarget(s, { kind: 'waste' })).toEqual({ kind: 'tab', col: 4 });
    s.tab[0].cards = [c(0, 13)];
    expect(bestTarget(s, { kind: 'tab', col: 0, idx: 0 })).toBeNull(); // king already at the bottom
  });
});

describe('auto-complete and win', () => {
  it('finishes when every card is face up', () => {
    const s = empty();
    // Each of four columns holds one suit, king down to ace, all face up.
    s.tab = s.tab.map((_, i) => ({ cards: i < 4 ? Array.from({ length: 13 }, (_, k) => c(i, 13 - k)) : [], hidden: 0 }));
    s.stock = [s.tab[3].cards.pop()!]; // the ace of diamonds waits in the stock
    expect(allFaceUp(s)).toBe(true);
    expect(isWon(s)).toBe(false);
    const steps = autoComplete(s)!;
    expect(steps).not.toBeNull();
    expect(isWon(steps[steps.length - 1])).toBe(true);
  });
  it('does not offer auto-complete with face-down cards', () => {
    expect(allFaceUp(deal(3))).toBe(false);
    expect(autoComplete(deal(3))).toBeNull();
  });
});
