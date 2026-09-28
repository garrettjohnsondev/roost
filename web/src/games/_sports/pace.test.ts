import { describe, expect, it } from 'vitest';
import { ghostPace, ghostAt, streakMult, isClutch, makeTicks } from './pace';

describe('ghost pace', () => {
  it('starts at zero, ends on the target and never goes down', () => {
    for (const t of [0, 3, 17, 74]) {
      const p = ghostPace(t, 10, 3);
      expect(p).toHaveLength(11);
      expect(p[0]).toBe(0);
      expect(p[10]).toBe(t);
      for (let i = 1; i < p.length; i++) expect(p[i]).toBeGreaterThanOrEqual(p[i - 1]);
    }
  });
  it('is the same every time for the same seed', () => {
    expect(ghostPace(20, 10, 5)).toEqual(ghostPace(20, 10, 5));
  });
  it('reads part-way through the round', () => {
    expect(ghostAt(30, 60, 0)).toBe(0);
    expect(ghostAt(30, 60, 1)).toBe(30);
    const mid = ghostAt(30, 60, 0.5);
    expect(mid).toBeGreaterThanOrEqual(0);
    expect(mid).toBeLessThanOrEqual(30);
  });
});

describe('streaks and clutch', () => {
  it('multiplies a hot streak', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(streakMult)).toEqual([1, 1, 1, 2, 2, 3, 3]);
  });
  it('only the last attempt is clutch', () => {
    expect(isClutch(9, 10)).toBe(true);
    expect(isClutch(8, 10)).toBe(false);
  });
  it('a streak adds ticks, up to a cap', () => {
    expect(makeTicks(2, 1)).toBe(2);
    expect(makeTicks(2, 3)).toBe(4);
    expect(makeTicks(2, 20)).toBe(5);
    expect(makeTicks(5, 20)).toBe(6);
  });
});
