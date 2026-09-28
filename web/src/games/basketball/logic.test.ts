import { describe, expect, it } from 'vitest';
import { launch, simulate, step, hoopMotion, hoopX, pointsFor, RIM_Y } from './logic';

const f = (speed: number, angle = 0) => ({ speed, angle });

describe('basketball', () => {
  it('a well-judged flick swishes', () => {
    expect(simulate(launch(f(1.34)))).toEqual({ made: true, swish: true });
  });
  it('too soft is an airball', () => {
    expect(simulate(launch(f(0.6))).made).toBe(false);
  });
  it('too hard off the glass can still go in, but not as a swish', () => {
    expect(simulate(launch(f(1.9)))).toEqual({ made: true, swish: false });
  });
  it('way too hard misses', () => {
    expect(simulate(launch(f(3.2))).made).toBe(false);
  });
  it('pulled wide misses', () => {
    expect(simulate(launch(f(1.34, 0.5))).made).toBe(false);
  });
  it('a moving hoop has to be led', () => {
    expect(simulate(launch(f(1.34)), 0.6).made).toBe(false);
    expect(simulate(launch(f(1.34, 0.2)), 0.35).made).toBe(true);
  });
  it('the hoop starts still and moves once you score', () => {
    expect(hoopMotion(0).amp).toBe(0);
    expect(hoopX(0, 3)).toBe(0);
    expect(hoopMotion(12).amp).toBeGreaterThan(0);
    expect(hoopMotion(40).speed).toBeGreaterThan(hoopMotion(12).speed);
  });
  it('a ball dropping through the ring counts', () => {
    const b = { x: 0, y: RIM_Y + 0.01, z: 4.5, vx: 0, vy: -3, vz: 0, touched: false, scored: false, done: false };
    expect(step(b, 1 / 60, 0).scored).toBe(true);
  });
  it('swishes are worth more', () => {
    expect(pointsFor(true)).toBe(3);
    expect(pointsFor(false)).toBe(2);
  });
});
