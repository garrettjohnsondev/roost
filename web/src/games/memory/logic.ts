/** Pure Crew Match logic: flip two, keep them if they match. */
export const CREW = ['pip', 'ollie', 'bram', 'wren', 'moss', 'fig', 'nell', 'juno', 'rue', 'bly', 'tuck', 'otto'];

export type Size = 16 | 20;
export interface State {
  size: Size;
  cards: string[];      // crew name per slot
  matched: boolean[];
  open: number[];       // face-up unmatched cards (0..2)
  moves: number;        // pairs flipped
  misses: number;
}

export function deal(size: Size, rand: () => number): State {
  const pool = CREW.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const cards = pool.slice(0, size / 2).flatMap((c) => [c, c]);
  for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
  return { size, cards, matched: cards.map(() => false), open: [], moves: 0, misses: 0 };
}

/** Flip card i. If two were already open (a miss showing), they close first. */
export function flip(s: State, i: number): State {
  if (s.matched[i]) return s;
  let open = s.open.length === 2 ? [] : s.open;
  if (open.includes(i)) return s;
  open = [...open, i];
  if (open.length < 2) return { ...s, open };
  const [a, b] = open;
  const moves = s.moves + 1;
  if (s.cards[a] === s.cards[b]) {
    const matched = s.matched.slice();
    matched[a] = matched[b] = true;
    return { ...s, matched, open: [], moves };
  }
  return { ...s, open, moves, misses: s.misses + 1 };
}

/** Close a showing miss. */
export const settle = (s: State): State => (s.open.length === 2 ? { ...s, open: [] } : s);
export const done = (s: State) => s.matched.every(Boolean);
