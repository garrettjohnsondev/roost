import { describe, expect, it } from 'vitest';
import { HAPTICS, buzz } from './haptics';

describe('haptics', () => {
  it('three distinct patterns, none alike', () => {
    const shapes = Object.values(HAPTICS).map((p) => p.join(','));
    expect(new Set(shapes).size).toBe(3);
  });
  it('pass rises, fail is two heavy beats, approval is one short tap', () => {
    const on = (p: number[]) => p.filter((_, i) => i % 2 === 0);
    expect(on(HAPTICS.pass).at(-1)!).toBeGreaterThan(on(HAPTICS.pass)[0]);
    expect(on(HAPTICS.fail)).toHaveLength(2);
    expect(HAPTICS.approval).toEqual([60]);
  });
  it('is a no-op where the API is missing (iOS Safari)', () => {
    expect(buzz('pass')).toBe(false);
  });
});
