import { describe, expect, it } from 'vitest';
import { kick, simulate, metres, windFor, pointsFor, nextYards, judge, BAR, HALF } from './logic';

const f = (speed: number, angle = 0, curve = 0) => ({ speed, angle, curve });

describe('field goal', () => {
  it('a good straight kick is good from 20', () => {
    expect(simulate(kick(f(1.8)), 0, metres(20))).toBe('good');
  });
  it('a weak kick falls short from 50', () => {
    expect(simulate(kick(f(0.3)), 0, metres(50))).toBe('short');
  });
  it('a big kick makes it from 55 in calm air', () => {
    expect(simulate(kick(f(2.4)), 0, metres(55))).toBe('good');
  });
  it('aiming right goes wide right', () => {
    expect(simulate(kick(f(1.8, 0.5)), 0, metres(30))).toBe('wide-right');
  });
  it('wind pushes a straight kick wide, and aiming into it fixes it', () => {
    expect(simulate(kick(f(1.6)), 3, metres(45))).toBe('wide-right');
    expect(simulate(kick(f(1.6, -0.35)), 3, metres(45))).toBe('good');
  });
  it('a swipe bent right hooks the ball left', () => {
    expect(simulate(kick(f(1.6, 0, 0.4)), 0, metres(45))).toBe('wide-left');
    expect(simulate(kick(f(1.6, 0, 0.25)), 3, metres(45))).not.toBe('wide-left');
  });
  it('clips the upright', () => {
    const a = { x: HALF, y: BAR + 1, z: 9.9, vx: 0, vy: 0, vz: 10, hook: 0 };
    expect(judge(a, { ...a, z: 10.1 }, 10)).toBe('doink');
  });
  it('wind grows with distance and stays bounded', () => {
    expect(Math.abs(windFor(20, 1))).toBeLessThan(1);
    expect(Math.abs(windFor(60, 1))).toBeLessThanOrEqual(3.2);
    expect(windFor(40, 0)).toBeLessThan(0);
  });
  it('scores and moves back', () => {
    expect(pointsFor(20)).toBe(2);
    expect(pointsFor(55)).toBe(6);
    expect(nextYards(20, true)).toBe(25);
    expect(nextYards(20, false)).toBe(20);
    expect(nextYards(60, true)).toBe(60);
  });
});
