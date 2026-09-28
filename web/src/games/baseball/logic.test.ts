import { describe, expect, it } from 'vitest';
import { judgeSwing, pitchFor, pitchAt, fence, MOUND, RELEASE_Y } from './logic';

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
});
