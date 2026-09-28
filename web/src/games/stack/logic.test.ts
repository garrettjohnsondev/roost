import { describe, expect, it } from 'vitest';
import { MAX_W, WIDTH, applyPower, drop, ghostScore, grow, powerFor, skyPhase, slide, speed, sway, windy } from './logic';

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
    expect(slide(0, 1, 100, 0.1, 0, 0.5).x).toBeCloseTo(7.5);
  });
  it('magnet widens the perfect window', () => {
    expect(drop(top, 115, 100).perfect).toBe(false);
    expect(drop(top, 115, 100, 18).perfect).toBe(true);
  });
  it('grows the plank on a perfect streak', () => {
    expect(grow(top, 2)).toBe(top);
    expect(grow(top, 3)).toEqual({ x: 96, w: 108 });
    expect(grow({ x: 0, w: MAX_W }, 9).w).toBe(MAX_W);
  });
  it('sways on windy levels only', () => {
    expect(sway(5, 1)).toBe(0);
    expect(sway(12, 1)).toBe(0);
    expect(windy(16)).toBe(true);
    expect(Math.abs(sway(16, 1))).toBeGreaterThan(0);
  });
  it('hands out power-ups and applies them', () => {
    expect(powerFor(4)).toBeNull();
    expect(powerFor(5)).toBe('grow');
    expect(powerFor(12)).toBe('slow');
    expect(powerFor(19)).toBe('magnet');
    const buffs = { slow: 0, magnet: 0 };
    expect(applyPower('grow', { x: 100, w: 50 }, buffs).block).toEqual({ x: 80, w: 90 });
    expect(applyPower('slow', top, buffs).buffs.slow).toBe(5);
    expect(applyPower('magnet', top, buffs).buffs.magnet).toBe(3);
  });
  it('turns day into night into space', () => {
    expect(skyPhase(0).day).toBe(1);
    expect(skyPhase(30).dusk).toBeGreaterThan(0);
    expect(skyPhase(50).night).toBe(1);
    expect(skyPhase(100).space).toBe(1);
  });
  it('calibrates ghosts', () => {
    expect(ghostScore(0.2)).toBeLessThanOrEqual(16);
    expect(ghostScore(0.95)).toBeGreaterThanOrEqual(55);
  });
});
