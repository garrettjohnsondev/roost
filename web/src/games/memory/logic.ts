/** Pure Crew Match logic: flip two, keep them if they match. */
export const CREW = ['pip', 'ollie', 'bram', 'wren', 'moss', 'fig', 'nell', 'juno', 'rue', 'bly', 'tuck', 'otto'];
/** The biggest board runs out of crew, so a few turn up twice in a
 *  different pose: a sleeping Pip is not an idle Pip. */
const LOOKALIKES = ['pip:sleep', 'wren:sleep', 'otto:sleep', 'fig:sleep', 'juno:sleep'];

export type Size = 16 | 20 | 24 | 30;
export const SIZES: Size[] = [16, 20, 24, 30];
export const colsFor = (size: Size) => (size === 30 ? 5 : 4);
/** Seconds on the clock in timed mode; each match adds MATCH_BONUS. */
export const TIME_FOR: Record<Size, number> = { 16: 45, 20: 60, 24: 80, 30: 105 };
export const MATCH_BONUS = 2;
/** Matches in a row that earn a peek. */
export const COMBO_FOR_PEEK = 3;

export interface State {
  size: Size;
  cards: string[];      // "name" or "name:pose" per slot
  matched: boolean[];
  open: number[];       // face-up unmatched cards (0..2)
  moves: number;        // pairs flipped
  misses: number;
  /** Wave 3 (older saves lack these). */
  combo?: number;       // matches in a row
  bestCombo?: number;
  peeks?: number;
  timed?: boolean;
  left?: number;        // seconds left in timed mode
}

/** A card's sprite name and pose. */
export function face(card: string): { name: string; pose: string } {
  const [name, pose = 'idle'] = card.split(':');
  return { name, pose };
}

export function deal(size: Size, rand: () => number, timed = false): State {
  const pool = CREW.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const kinds = [...pool, ...LOOKALIKES].slice(0, size / 2);
  const cards = kinds.flatMap((c) => [c, c]);
  for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
  return {
    size, cards, matched: cards.map(() => false), open: [], moves: 0, misses: 0,
    combo: 0, bestCombo: 0, peeks: 0, timed, left: timed ? TIME_FOR[size] : undefined,
  };
}

/** Flip card i. If two were already open (a miss showing), they close first. */
export function flip(s: State, i: number): State {
  if (s.matched[i] || (s.timed && (s.left ?? 0) <= 0)) return s;
  let open = s.open.length === 2 ? [] : s.open;
  if (open.includes(i)) return s;
  open = [...open, i];
  if (open.length < 2) return { ...s, open };
  const [a, b] = open;
  const moves = s.moves + 1;
  if (s.cards[a] === s.cards[b]) {
    const matched = s.matched.slice();
    matched[a] = matched[b] = true;
    const combo = (s.combo ?? 0) + 1;
    return {
      ...s, matched, open: [], moves, combo,
      bestCombo: Math.max(s.bestCombo ?? 0, combo),
      peeks: (s.peeks ?? 0) + (combo % COMBO_FOR_PEEK === 0 ? 1 : 0),
      left: s.timed ? (s.left ?? 0) + MATCH_BONUS : s.left,
    };
  }
  return { ...s, open, moves, misses: s.misses + 1, combo: 0 };
}

/** Spend a peek (the UI flashes every card for a moment). */
export const spendPeek = (s: State): State | null => ((s.peeks ?? 0) > 0 ? { ...s, peeks: (s.peeks ?? 0) - 1 } : null);

/** Run the timed-mode clock down by dt seconds. */
export function tick(s: State, dt: number): State {
  if (!s.timed || done(s)) return s;
  return { ...s, left: Math.max(0, (s.left ?? 0) - dt) };
}
export const timeUp = (s: State) => !!s.timed && (s.left ?? 0) <= 0 && !done(s);

/** Close a showing miss. */
export const settle = (s: State): State => (s.open.length === 2 ? { ...s, open: [] } : s);
export const done = (s: State) => s.matched.every(Boolean);

/** Moves a ghost of this strength takes to clear 4x4 (8 pairs). Perfect
 *  memory averages ~13, a casual player well over 20. */
export const ghostMoves = (strength: number) => Math.round(25.3 - 12.6 * strength);

/** Where the ghost's pace puts it after `moves` of yours: pairs found. */
export const ghostPairs = (target: number, pairs: number, moves: number) => Math.min(pairs, Math.floor((pairs * moves) / Math.max(1, target)));
