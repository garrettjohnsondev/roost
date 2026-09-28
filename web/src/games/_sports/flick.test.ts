import { describe, expect, it } from 'vitest';
import { readFlick, project, type Pt } from './flick';

const line = (x0: number, y0: number, x1: number, y1: number, ms: number, n = 10): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n, t: (ms * i) / n }));

describe('readFlick', () => {
  it('ignores a tap', () => {
    expect(readFlick(line(0, 0, 3, -4, 50))).toBeNull();
  });
  it('reads a straight flick up', () => {
    const f = readFlick(line(100, 400, 100, 200, 100))!;
    expect(f.angle).toBeCloseTo(0);
    expect(f.speed).toBeCloseTo(2, 1);
    expect(Math.abs(f.curve)).toBeLessThan(0.01);
  });
  it('angles right when the finger goes right', () => {
    expect(readFlick(line(0, 200, 100, 0, 100))!.angle).toBeCloseTo(Math.atan2(100, 200));
  });
  it('measures speed on the release, not the wind-up', () => {
    const slow = line(0, 400, 0, 380, 1000);
    const fast = line(0, 380, 0, 180, 100).map((p) => ({ ...p, t: p.t + 1000 }));
    expect(readFlick([...slow, ...fast])!.speed).toBeGreaterThan(1.5);
  });
  it('reads a bend to the right as positive curve', () => {
    const pts: Pt[] = [0, 1, 2, 3, 4].map((i) => ({ x: [0, 20, 30, 20, 0][i], y: 400 - i * 50, t: i * 25 }));
    const f = readFlick(pts)!;
    expect(f.curve).toBeGreaterThan(0.1);
    const mirrored = readFlick(pts.map((p) => ({ ...p, x: -p.x })))!;
    expect(mirrored.curve).toBeCloseTo(-f.curve);
  });
});

describe('project', () => {
  it('shrinks with distance', () => {
    const c = { z: -5, y: 1, focal: 300, cx: 200, horizon: 150 };
    const near = project(c, 1, 0, 0), far = project(c, 1, 0, 20);
    expect(far.s).toBeLessThan(near.s);
    expect(far.x - 200).toBeLessThan(near.x - 200);
  });
});
