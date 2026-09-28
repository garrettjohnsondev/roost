import { describe, expect, it } from 'vitest';
import { judgeSwing, pitchFor, pitchAt, fence, carry, windFor, isGolden, runsFor, onFire, ghostScore, MOUND, RELEASE_Y } from './logic';

describe('home run derby', () => {
  it('a perfect swing is a home run', () => {
    const h = judgeSwing(0.01, 0.1);
    expect(h.kind).toBe('homer');
    expect(h.perfect).toBe(true);
    expect(h.feet).toBeGreaterThan(430);
  });
  it('way off is a whiff', () => {
    expect(judgeSwing(0.3, 0).kind).toBe('miss');
    expect(judgeSwing(0, 1.5).kind).toBe('miss');
  });
  it('early is a foul to the left, late to the right', () => {
    const early = judgeSwing(-0.13, 0), late = judgeSwing(0.13, 0);
    expect(early.kind).toBe('foul');
    expect(early.spray).toBeLessThan(0);
    expect(late.kind).toBe('foul');
    expect(late.spray).toBeGreaterThan(0);
  });
  it('a little off still has a shot, a bit more is a fly out', () => {
    expect(judgeSwing(0.04, 0.1).kind).toBe('homer');
    expect(judgeSwing(0.075, 0.2).kind).toBe('fly');
  });
  it('topping it is a grounder, getting under it pops up', () => {
    expect(judgeSwing(0.05, 0.9).kind).toBe('grounder');
    const pop = judgeSwing(0.05, -1);
    expect(pop.launch).toBeGreaterThan(50);
    expect(pop.kind).toBe('fly');
  });
  it('pitches speed up but stay hittable', () => {
    const first = pitchFor(0, 0.5, 0.5, 0.5), late = pitchFor(30, 0.9, 0.5, 0.5);
    expect(late.time).toBeLessThan(first.time);
    expect(late.time).toBeGreaterThanOrEqual(0.58);
    expect(pitchFor(5, 0.1, 0.5, 0.5).kind).toBe('changeup');
  });
  it('the ball leaves the hand and arrives where aimed', () => {
    const p = pitchFor(5, 0.3, 1, 0);
    expect(pitchAt(p, 0)).toMatchObject({ z: MOUND, y: RELEASE_Y });
    const end = pitchAt(p, p.time);
    expect(end.z).toBeCloseTo(0);
    expect(end.y).toBeCloseTo(p.y);
    expect(end.x).toBeCloseTo(p.x);
  });
  it('the wall is deepest in centre', () => {
    expect(fence(0)).toBe(400);
    expect(fence(45)).toBe(330);
  });
  it('on fire, the perfect window is wider', () => {
    expect(judgeSwing(0.05, 0.1).perfect).toBe(false);
    expect(judgeSwing(0.05, 0.1, { fire: true }).perfect).toBe(true);
    expect(onFire(2)).toBe(false);
    expect(onFire(3)).toBe(true);
  });
  it('wind blowing out carries a fly, blowing in knocks it down', () => {
    const calm = judgeSwing(0.075, 0.2);
    expect(calm.kind).toBe('fly');
    expect(judgeSwing(0.075, 0.2, { wind: 12 }).feet).toBeGreaterThan(calm.feet);
    expect(judgeSwing(0.04, 0.1, { wind: -12 }).feet).toBeLessThan(judgeSwing(0.04, 0.1).feet);
    expect(carry(400, 10)).toBe(448);
    expect(Math.abs(windFor(0))).toBe(12);
    expect(Math.abs(windFor(1))).toBe(12);
  });
  it('gold balls count double, but not in the first few pitches', () => {
    expect(isGolden(1, 0.01)).toBe(false);
    expect(isGolden(5, 0.01)).toBe(true);
    expect(isGolden(5, 0.5)).toBe(false);
    expect(runsFor(true, true)).toBe(2);
    expect(runsFor(true, false)).toBe(1);
    expect(runsFor(false, true)).toBe(0);
  });
  it('ghosts: Moss is beatable, Nell needs a monster round', () => {
    expect(ghostScore(0.2)).toBeLessThanOrEqual(3);
    expect(ghostScore(0.95)).toBeGreaterThanOrEqual(18);
  });
});
