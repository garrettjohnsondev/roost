import { describe, expect, it } from 'vitest';
import { seeded } from '../types';
import { deal, done, flip, settle } from './logic';

describe('crew match logic', () => {
  it('deals pairs', () => {
    for (const size of [16, 20] as const) {
      const s = deal(size, seeded(5));
      expect(s.cards).toHaveLength(size);
      const counts: Record<string, number> = {};
      s.cards.forEach((c) => (counts[c] = (counts[c] ?? 0) + 1));
      expect(Object.values(counts).every((n) => n === 2)).toBe(true);
    }
  });

  it('matches, misses, and finishes with perfect play', () => {
    let s = deal(16, seeded(9));
    const a = 0, b = s.cards.indexOf(s.cards[0], 1);
    const wrong = s.cards.findIndex((c) => c !== s.cards[0]);
    s = flip(s, a);
    expect(flip(s, a)).toBe(s);
    s = flip(s, wrong);
    expect(s.misses).toBe(1);
    expect(s.open).toHaveLength(2);
    s = settle(s);
    s = flip(flip(s, a), b);
    expect(s.matched[a] && s.matched[b]).toBe(true);
    expect(s.moves).toBe(2);
    for (let i = 0; i < 16; i++) {
      if (s.matched[i]) continue;
      const j = s.cards.findIndex((c, k) => k !== i && c === s.cards[i]);
      s = flip(flip(s, i), j);
    }
    expect(done(s)).toBe(true);
    expect(s.moves).toBe(9);
  });
});
