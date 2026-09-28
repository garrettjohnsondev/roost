import { seeded } from '../types';

/** Klondike, pure. A card is 0..51: suit = floor(c / 13), rank = c % 13 + 1.
 *  Suits: 0 spades, 1 hearts, 2 clubs, 3 diamonds (odd = red). */
export type Card = number;
export const suitOf = (c: Card) => Math.floor(c / 13);
export const rankOf = (c: Card) => (c % 13) + 1;
export const isRed = (c: Card) => suitOf(c) % 2 === 1;
export const SUITS = ['♠', '♥', '♣', '♦'];
export const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export interface Col { cards: Card[]; hidden: number }
export interface State {
  tab: Col[];
  stock: Card[]; // top is the end
  waste: Card[]; // top is the end
  found: Card[][]; // indexed by suit
  draw: 1 | 3;
  moves: number;
  secs: number;
  undos: number;
  /** Set when this is the daily deal (its day number). */
  daily?: number;
}

export type From = { kind: 'waste' } | { kind: 'found'; suit: number } | { kind: 'tab'; col: number; idx: number };
export type To = { kind: 'found'; suit: number } | { kind: 'tab'; col: number };

export function deal(seed: number, draw: 1 | 3 = 1): State {
  const rnd = seeded(seed);
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const tab: Col[] = [];
  let k = 0;
  for (let i = 0; i < 7; i++) {
    tab.push({ cards: deck.slice(k, k + i + 1), hidden: i });
    k += i + 1;
  }
  return { tab, stock: deck.slice(k), waste: [], found: [[], [], [], []], draw, moves: 0, secs: 0, undos: 0 };
}

const clone = (s: State): State => ({
  ...s,
  tab: s.tab.map((c) => ({ cards: [...c.cards], hidden: c.hidden })),
  stock: [...s.stock],
  waste: [...s.waste],
  found: s.found.map((f) => [...f]),
});

/** Tap the stock: draw 1 or 3, or turn the waste back over when empty. */
export function drawStock(s: State): State | null {
  if (!s.stock.length && !s.waste.length) return null;
  const n = clone(s);
  if (!n.stock.length) {
    n.stock = n.waste.reverse();
    n.waste = [];
  } else {
    for (let i = 0; i < s.draw && n.stock.length; i++) n.waste.push(n.stock.pop()!);
  }
  n.moves++;
  return n;
}

/** The cards picked up from a location (bottom first), or null if not movable. */
export function pick(s: State, from: From): Card[] | null {
  if (from.kind === 'waste') return s.waste.length ? [s.waste[s.waste.length - 1]] : null;
  if (from.kind === 'found') { const f = s.found[from.suit]; return f.length ? [f[f.length - 1]] : null; }
  const col = s.tab[from.col];
  if (!col || from.idx < col.hidden || from.idx >= col.cards.length) return null;
  return col.cards.slice(from.idx);
}

export function canPlace(s: State, cards: Card[], to: To): boolean {
  const c = cards[0];
  if (to.kind === 'found') {
    return cards.length === 1 && suitOf(c) === to.suit && s.found[to.suit].length === rankOf(c) - 1;
  }
  const col = s.tab[to.col];
  if (!col) return false;
  const top = col.cards[col.cards.length - 1];
  if (top === undefined) return rankOf(c) === 13;
  return isRed(top) !== isRed(c) && rankOf(top) === rankOf(c) + 1;
}

export function move(s: State, from: From, to: To): State | null {
  if (from.kind === 'tab' && to.kind === 'tab' && from.col === to.col) return null;
  if (from.kind === 'found' && to.kind === 'found') return null;
  const cards = pick(s, from);
  if (!cards || !canPlace(s, cards, to)) return null;
  const n = clone(s);
  if (from.kind === 'waste') n.waste.pop();
  else if (from.kind === 'found') n.found[from.suit].pop();
  else {
    const col = n.tab[from.col];
    col.cards.splice(from.idx);
    if (col.hidden > 0 && col.hidden >= col.cards.length) col.hidden = col.cards.length - 1;
  }
  if (to.kind === 'found') n.found[to.suit].push(...cards);
  else n.tab[to.col].cards.push(...cards);
  n.moves++;
  return n;
}

/** Where a tap sends a card: foundation first (single card), else the next
 *  tableau column that takes it, preferring a real card over an empty column. */
export function bestTarget(s: State, from: From): To | null {
  const cards = pick(s, from);
  if (!cards) return null;
  if (from.kind !== 'found' && cards.length === 1) {
    const f: To = { kind: 'found', suit: suitOf(cards[0]) };
    if (canPlace(s, cards, f)) return f;
  }
  const start = from.kind === 'tab' ? from.col : -1;
  const order = Array.from({ length: 7 }, (_, i) => (start + 1 + i + 7) % 7).filter((c) => c !== start);
  for (const c of order) if (s.tab[c].cards.length && canPlace(s, cards, { kind: 'tab', col: c })) return { kind: 'tab', col: c };
  // A king already at the bottom of its column gains nothing from an empty one.
  const pointless = from.kind === 'tab' && from.idx === 0;
  if (!pointless) for (const c of order) if (!s.tab[c].cards.length && canPlace(s, cards, { kind: 'tab', col: c })) return { kind: 'tab', col: c };
  return null;
}

export const isWon = (s: State) => s.found.every((f) => f.length === 13);
export const allFaceUp = (s: State) => s.tab.every((c) => c.hidden === 0);

/** One step of auto-complete: the lowest card that can go home, else a draw. */
export function autoStep(s: State): State | null {
  let from: From | null = null;
  let low = 99;
  const consider = (f: From) => {
    const cards = pick(s, f);
    if (!cards || cards.length !== 1) return;
    if (!canPlace(s, cards, { kind: 'found', suit: suitOf(cards[0]) })) return;
    if (rankOf(cards[0]) < low) { low = rankOf(cards[0]); from = f; }
  };
  consider({ kind: 'waste' });
  s.tab.forEach((c, i) => { if (c.cards.length) consider({ kind: 'tab', col: i, idx: c.cards.length - 1 }); });
  if (from) {
    const cards = pick(s, from)!;
    return move(s, from, { kind: 'found', suit: suitOf(cards[0]) });
  }
  return drawStock(s);
}

/** Every state from here to the win, or null if auto-complete can't finish. */
export function autoComplete(s: State): State[] | null {
  if (!allFaceUp(s) || isWon(s)) return null;
  const out: State[] = [];
  let cur = s;
  for (let guard = 0; guard < 2000; guard++) {
    const n = autoStep(cur);
    if (!n) return null;
    out.push(n);
    if (isWon(n)) return out;
    cur = n;
  }
  return null;
}

// ---- Wave 3: hints, the daily deal, ghosts ----

/** A useful Klondike move to suggest: home first, then a run that turns a
 *  face-down card over, then the waste onto a column, else draw. Null when
 *  there's nothing left to try. */
export function hint(s: State): { from: From; to: To } | 'draw' | null {
  const tops: From[] = [{ kind: 'waste' }, ...s.tab.map((c, col) => ({ kind: 'tab', col, idx: c.cards.length - 1 }) as From)];
  for (const f of tops) {
    const cards = pick(s, f);
    if (cards && cards.length === 1) {
      const to: To = { kind: 'found', suit: suitOf(cards[0]) };
      if (canPlace(s, cards, to)) return { from: f, to };
    }
  }
  for (let col = 0; col < 7; col++) {
    const c = s.tab[col];
    if (!c.cards.length || c.hidden === 0) continue;
    const from: From = { kind: 'tab', col, idx: c.hidden };
    const cards = pick(s, from)!;
    for (let t = 0; t < 7; t++) if (t !== col && canPlace(s, cards, { kind: 'tab', col: t })) return { from, to: { kind: 'tab', col: t } };
  }
  const w = pick(s, { kind: 'waste' });
  if (w) for (let t = 0; t < 7; t++) if (canPlace(s, w, { kind: 'tab', col: t })) return { from: { kind: 'waste' }, to: { kind: 'tab', col: t } };
  return s.stock.length || s.waste.length ? 'draw' : null;
}

/** Today's deal, the same for everyone. */
export const dailySeed = (day: number) => (day * 7919 + 17) % 2 ** 31;

/** Seconds a ghost of this strength takes to win: Moss (0.2) about 8
 *  minutes, a relaxed game; Nell (0.95) about 2:30, which needs real speed. */
export const ghostSecs = (strength: number) => Math.round(570 - 440 * strength);

/** Cards the ghost has home by `secs`, pacing evenly to 52 at its target. */
export const ghostHome = (target: number, secs: number) => Math.min(52, Math.floor((52 * secs) / Math.max(1, target)));
