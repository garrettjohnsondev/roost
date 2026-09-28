import { describe, expect, it } from 'vitest';
import { streakOf } from '../src/visits.js';

describe('the streak', () => {
  it('counts back from today', () => {
    expect(streakOf(['2026-09-26', '2026-09-27', '2026-09-28'], '2026-09-28')).toBe(3);
  });
  it('a missed day breaks it', () => {
    expect(streakOf(['2026-09-25', '2026-09-27', '2026-09-28'], '2026-09-28')).toBe(2);
    expect(streakOf(['2026-09-26'], '2026-09-28')).toBe(0);
  });
});
