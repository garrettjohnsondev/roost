import { describe, expect, it } from 'vitest';
import { earned, nextUnlock, tierFor } from './outfits';

describe('level-ups you can see', () => {
  it('a fresh crew member wears nothing', () => {
    expect(tierFor(1)).toBe(0);
    expect(earned(1)).toEqual([]);
  });
  it('Ollie at 12 has the sash, hat, sunglasses and necklace; the robe is next', () => {
    expect(tierFor(12)).toBe(3);
    expect(earned(12)).toEqual(['Sash', 'Hat', 'Sunglasses', 'Necklace']);
    expect(nextUnlock(12)?.level).toBe(15);
  });
  it('full regalia at 15', () => {
    expect(tierFor(15)).toBe(4);
    expect(nextUnlock(40)).toBeNull();
  });
});
