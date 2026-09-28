import { describe, expect, it } from 'vitest';
import { WIDTH, drop, slide, speed } from './logic';

describe('stack', () => {
  const top = { x: 100, w: 100 };
  it('keeps full width on a perfect drop', () => {
    expect(drop(top, 103, 100)).toEqual({ block: top, perfect: true, cut: null });
  });
  it('slices the overhang', () => {
    expect(drop(top, 130, 100)).toEqual({ block: { x: 130, w: 70 }, perfect: false, cut: { x: 200, w: 30 } });
    expect(drop(top, 60, 100)).toEqual({ block: { x: 100, w: 60 }, perfect: false, cut: { x: 60, w: 40 } });
  });
  it('misses entirely', () => {
    expect(drop(top, 250, 100).block).toBeNull();
  });
  it('bounces and speeds up', () => {
    const r = slide(WIDTH - 55, 1, 100, 0.1, 0);
    expect(r.dir).toBe(-1);
    expect(r.x).toBeLessThanOrEqual(WIDTH - 50);
    expect(speed(40)).toBeGreaterThan(speed(0));
  });
});
