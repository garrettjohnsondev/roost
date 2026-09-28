import { seeded } from '../types';
import { isRed, rankOf, suitOf, type Card } from './logic';

/** FreeCell, pure. Every card is dealt face up into eight columns; four free
 *  cells hold one card each. Build down in alternating colours, home up by
 *  suit. A run moves as one if there are enough free cells and empty
 *  columns to shuffle it across by hand (the "supermove"). */
export interface FState {
  variant: 'freecell';
  tab: Card[][];
  cells: Array<Card | null>;
  found: Card[][]; // indexed by suit
  moves: number;
  secs: number;
  undos: number;
  daily?: number;
}

export type FFrom = { kind: 'cell'; i: number } | { kind: 'found'; suit: number } | { kind: 'tab'; col: number; idx: number };
export type FTo = { kind: 'cell'; i: number } | { kind: 'found'; suit: number } | { kind: 'tab'; col: number };

export function dealFree(seed: number): FState {
  const rnd = seeded(seed);
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const tab: Card[][] = Array.from({ length: 8 }, () => []);
  deck.forEach((c, i) => tab[i % 8].push(c));
  return { variant: 'freecell', tab, cells: [null, null, null, null], found: [[], [], [], []], moves: 0, secs: 0, undos: 0 };
}

const clone = (s: FState): FState => ({ ...s, tab: s.tab.map((c) => [...c]), cells: [...s.cells], found: s.found.map((f) => [...f]) });

/** Alternating colours, each one lower than the last. */
export function isRun(cards: Card[]): boolean {
  for (let i = 1; i < cards.length; i++) {
    if (isRed(cards[i]) === isRed(cards[i - 1]) || rankOf(cards[i - 1]) !== rankOf(cards[i]) + 1) return false;
  }
  return true;
}

/** The longest run you can move at once. Moving into an empty column
 *  leaves one fewer empty column to shuffle through. */
export function maxMove(s: FState, toEmpty: boolean): number {
  const free = s.cells.filter((c) => c === null).length;
  const empty = s.tab.filter((c) => !c.length).length - (toEmpty ? 1 : 0);
  return (free + 1) * 2 ** Math.max(0, empty);
}

export function pickF(s: FState, from: FFrom): Card[] | null {
  if (from.kind === 'cell') { const c = s.cells[from.i]; return c === null || c === undefined ? null : [c]; }
  if (from.kind === 'found') { const f = s.found[from.suit]; return f.length ? [f[f.length - 1]] : null; }
  const col = s.tab[from.col];
  if (!col || from.idx < 0 || from.idx >= col.length) return null;
  const cards = col.slice(from.idx);
  return isRun(cards) ? cards : null;
}

export function canPlaceF(s: FState, cards: Card[], to: FTo): boolean {
  const c = cards[0];
  if (to.kind === 'cell') return cards.length === 1 && s.cells[to.i] === null;
  if (to.kind === 'found') return cards.length === 1 && suitOf(c) === to.suit && s.found[to.suit].length === rankOf(c) - 1;
  const col = s.tab[to.col];
  if (!col) return false;
  if (cards.length > maxMove(s, !col.length)) return false;
  const top = col[col.length - 1];
  if (top === undefined) return true;
  return isRed(top) !== isRed(c) && rankOf(top) === rankOf(c) + 1;
}

export function moveF(s: FState, from: FFrom, to: FTo): FState | null {
  if (from.kind === to.kind && (from.kind === 'tab' ? from.col === (to as { col: number }).col : from.kind === 'cell' ? from.i === (to as { i: number }).i : true)) return null;
  const cards = pickF(s, from);
  if (!cards || !canPlaceF(s, cards, to)) return null;
  const n = clone(s);
  if (from.kind === 'cell') n.cells[from.i] = null;
  else if (from.kind === 'found') n.found[from.suit].pop();
  else n.tab[from.col].splice(from.idx);
  if (to.kind === 'cell') n.cells[to.i] = cards[0];
  else if (to.kind === 'found') n.found[to.suit].push(cards[0]);
  else n.tab[to.col].push(...cards);
  n.moves++;
  return n;
}

/** Where a tap sends a card: home, then onto a card, then an empty column,
 *  then a free cell. */
export function bestTargetF(s: FState, from: FFrom): FTo | null {
  const cards = pickF(s, from);
  if (!cards) return null;
  if (from.kind !== 'found' && cards.length === 1) {
    const f: FTo = { kind: 'found', suit: suitOf(cards[0]) };
    if (canPlaceF(s, cards, f)) return f;
  }
  const start = from.kind === 'tab' ? from.col : -1;
  const order = Array.from({ length: 8 }, (_, i) => (start + 1 + i + 8) % 8).filter((c) => c !== start);
  for (const c of order) if (s.tab[c].length && canPlaceF(s, cards, { kind: 'tab', col: c })) return { kind: 'tab', col: c };
  const whole = from.kind === 'tab' && from.idx === 0;
  if (!whole) for (const c of order) if (!s.tab[c].length && canPlaceF(s, cards, { kind: 'tab', col: c })) return { kind: 'tab', col: c };
  if (from.kind === 'tab' && cards.length === 1) {
    const i = s.cells.indexOf(null);
    if (i >= 0) return { kind: 'cell', i };
  }
  return null;
}

/** A card is safe to send home when nothing still out could need it. */
function safeHome(s: FState, c: Card): boolean {
  const r = rankOf(c);
  if (r <= 2) return true;
  const opp = [0, 1, 2, 3].filter((su) => (su % 2 === 1) !== isRed(c));
  return opp.every((su) => s.found[su].length >= r - 1);
}

/** Send every safe card home, one at a time. Returns each step (empty when
 *  nothing moved) so the view can fly them in. Doesn't count as moves. */
export function autoHome(s: FState): FState[] {
  const out: FState[] = [];
  let cur = s;
  for (let guard = 0; guard < 60; guard++) {
    let moved: FState | null = null;
    const froms: FFrom[] = [
      ...cur.cells.map((_, i) => ({ kind: 'cell', i }) as FFrom),
      ...cur.tab.map((c, col) => ({ kind: 'tab', col, idx: c.length - 1 }) as FFrom),
    ];
    for (const f of froms) {
      const cards = pickF(cur, f);
      if (!cards || cards.length !== 1 || !safeHome(cur, cards[0])) continue;
      moved = moveF(cur, f, { kind: 'found', suit: suitOf(cards[0]) });
      if (moved) break;
    }
    if (!moved) break;
    cur = { ...moved, moves: cur.moves };
    out.push(cur);
  }
  return out;
}

export const isWonF = (s: FState) => s.found.every((f) => f.length === 13);

/** A useful move to suggest, or null: home first, then a run onto a card
 *  (that doesn't just shuffle a whole column), then a free cell onto a card. */
export function hintF(s: FState): { from: FFrom; to: FTo } | null {
  const froms: FFrom[] = [
    ...s.cells.map((_, i) => ({ kind: 'cell', i }) as FFrom),
    ...s.tab.map((c, col) => ({ kind: 'tab', col, idx: c.length - 1 }) as FFrom),
  ];
  for (const f of froms) {
    const cards = pickF(s, f);
    if (cards && cards.length === 1) {
      const to: FTo = { kind: 'found', suit: suitOf(cards[0]) };
      if (canPlaceF(s, cards, to)) return { from: f, to };
    }
  }
  for (let col = 0; col < 8; col++) {
    const c = s.tab[col];
    for (let idx = 0; idx < c.length; idx++) {
      const from: FFrom = { kind: 'tab', col, idx };
      const cards = pickF(s, from);
      if (!cards) continue;
      for (let t = 0; t < 8; t++) {
        if (t === col || !s.tab[t].length) continue;
        if (canPlaceF(s, cards, { kind: 'tab', col: t })) return { from, to: { kind: 'tab', col: t } };
      }
    }
  }
  for (let i = 0; i < 4; i++) {
    const cards = pickF(s, { kind: 'cell', i });
    if (!cards) continue;
    for (let t = 0; t < 8; t++) if (s.tab[t].length && canPlaceF(s, cards, { kind: 'tab', col: t })) return { from: { kind: 'cell', i }, to: { kind: 'tab', col: t } };
  }
  return null;
}
