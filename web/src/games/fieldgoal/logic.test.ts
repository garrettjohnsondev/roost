import { describe, expect, it } from 'vitest';
import { kick, simulate, metres, windFor, pointsFor, nextYards, judge, weatherFor, windNow, centred, ghostScore, BAR, HALF } from './logic';

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
  it('streaks multiply, the middle earns a bonus, clutch doubles', () => {
    expect(pointsFor(30, 1)).toBe(3);
    expect(pointsFor(30, 3)).toBe(6);
    expect(pointsFor(30, 5)).toBe(9);
    expect(pointsFor(30, 1, true)).toBe(6);
    expect(pointsFor(30, 1, false, true)).toBe(4);
    expect(centred(0)).toBe(1);
    expect(centred(HALF)).toBe(0);
  });
  it('rain makes the ball heavy: a kick that makes it dry falls short wet', () => {
    expect(simulate(kick(f(1.5)), 0, metres(45))).toBe('good');
    expect(simulate(kick(f(1.5), 'rain'), 0, metres(45))).toBe('short');
  });
  it('weather starts clear and gusts swing the wind', () => {
    expect(weatherFor(0, 0.1)).toBe('clear');
    expect(weatherFor(5, 0.1)).toBe('rain');
    expect(weatherFor(5, 0.3)).toBe('gusty');
    expect(weatherFor(5, 0.9)).toBe('clear');
    expect(windNow(2, 'clear', 0.5)).toBe(2);
    expect(windNow(2, 'gusty', 0.5)).not.toBe(2);
  });
  it('ghosts: Moss is beatable, Nell needs a hot streak', () => {
    expect(ghostScore(0.2)).toBeLessThan(16);
    expect(ghostScore(0.95)).toBeGreaterThan(70);
    expect(ghostScore(0.5)).toBeGreaterThan(ghostScore(0.4));
  });
});
