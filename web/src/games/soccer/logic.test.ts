import { describe, expect, it } from 'vitest';
import { shoot, shotAt, keeperDive, resolve, isTopCorner, SPOT, HALF_W } from './logic';

const f = (speed: number, angle = 0, curve = 0) => ({ speed, angle, curve });
const nowhere = { x: 0, y: 0.8, read: false };

describe('penalty kicks', () => {
  it('a hard flick goes higher, and too hard sails over', () => {
    expect(shoot(f(1.2)).y).toBeLessThan(shoot(f(2)).y);
    expect(resolve(shoot(f(3.5, 0.2)), { x: -2, y: 1, read: false })).toBe('over');
  });
  it('angle aims, and too wide is wide', () => {
    expect(shoot(f(1.5, 0.25)).x).toBeGreaterThan(2);
    expect(resolve(shoot(f(1.5, 0.6)), nowhere)).toBe('wide');
  });
  it('a bent swipe finishes to the other side and bulges on the way', () => {
    const s = shoot(f(1.5, 0.1, 0.3));
    expect(s.x).toBeLessThan(shoot(f(1.5, 0.1)).x);
    expect(shotAt(s, 0.5).x).toBeGreaterThan(s.x / 2);
    expect(shotAt(s, 1)).toMatchObject({ z: SPOT });
    expect(shotAt(s, 1).x).toBeCloseTo(s.x);
  });
  it('the keeper saves what he reaches and not what he does not', () => {
    const s = shoot(f(1.5, 0.25));
    expect(resolve(s, { x: s.x, y: s.y, read: true })).toBe('saved');
    expect(resolve(s, { x: -2, y: 1, read: false })).toBe('goal');
    expect(resolve({ x: 0.1, y: 1, time: 0.5, bend: 0, curve: 0 }, { x: 0, y: 1, read: false })).toBe('saved');
  });
  it('hits the post', () => {
    expect(resolve({ x: HALF_W, y: 1, time: 0.5, bend: 0, curve: 0 }, nowhere)).toBe('post');
  });
  it('gets smarter: reads more shots later in the round', () => {
    const s = shoot(f(1.5, 0.25));
    const reads = (n: number) => Array.from({ length: 100 }, (_, i) => keeperDive(s, n, [], i / 100, 0.5, 0.5).read).filter(Boolean).length;
    expect(reads(9)).toBeGreaterThan(reads(0));
  });
  it('leans toward the side you keep shooting', () => {
    const s = shoot(f(1.5, 0.25));
    const right = [2, 2.5, 3, 2, 2.2, 3];
    const dives = Array.from({ length: 50 }, (_, i) => keeperDive(s, 8, right, 0.99, 0.5, i / 50));
    expect(dives.filter((d) => d.x > 0).length).toBeGreaterThan(30);
  });
  it('knows a top corner', () => {
    expect(isTopCorner({ x: 3.2, y: 2.1, time: 0.4, bend: 0, curve: 0 })).toBe(true);
    expect(isTopCorner({ x: 0, y: 2.1, time: 0.4, bend: 0, curve: 0 })).toBe(false);
  });
});
