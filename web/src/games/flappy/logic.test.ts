import { describe, expect, it } from 'vitest';
import { BIRD_X, GROUND, POST_W, flap, fresh, hitsPost, step, unlockedBy, type Post } from './logic';

const post = (x: number, gapY = 250, gap = 160): Post => ({ x, gapY, gap, passed: false, kind: 'branch' });

describe('flappy', () => {
  it('falls under gravity and flaps up', () => {
    let w = step(fresh(), 0.1, () => 0.5);
    expect(w.vy).toBeGreaterThan(0);
    w = step(flap(w), 0.016, () => 0.5);
    expect(w.vy).toBeLessThan(0);
  });
  it('dies on the ground', () => {
    let w = fresh();
    for (let i = 0; i < 200 && !w.dead; i++) w = step(w, 0.016, () => 0.5);
    expect(w.dead).toBe(true);
    expect(w.y).toBeLessThan(GROUND);
  });
  it('is frame-rate independent-ish', () => {
    let a = fresh(), b = fresh();
    for (let i = 0; i < 30; i++) a = step(a, 1 / 60, () => 0.5);
    for (let i = 0; i < 15; i++) b = step(b, 1 / 30, () => 0.5);
    expect(Math.abs(a.y - b.y)).toBeLessThan(6);
  });
  it('hits a post only on the solid parts', () => {
    const p = post(BIRD_X - POST_W / 2);
    expect(hitsPost(250, p)).toBe(false);
    expect(hitsPost(120, p)).toBe(true);
    expect(hitsPost(400, p)).toBe(true);
    expect(hitsPost(250 - 80 + 14, p)).toBe(false); // grazing the edge is forgiven
    expect(hitsPost(120, post(BIRD_X + 40))).toBe(false);
  });
  it('scores a passed gap once', () => {
    const w = { ...fresh(), y: 250, posts: [post(BIRD_X - POST_W - 12)] };
    const n = step(w, 0.01, () => 0.5);
    expect(n.score).toBe(1);
    expect(step(n, 0.01, () => 0.5).score).toBe(1);
  });
  it('unlocks crew at milestones', () => {
    expect(unlockedBy(0)).toEqual(['pip']);
    expect(unlockedBy(10)).toContain('ollie');
  });
});
