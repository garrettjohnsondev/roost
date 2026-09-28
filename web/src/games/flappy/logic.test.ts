import { describe, expect, it } from 'vitest';
import {
  BIRD_X, FLAP_V, GHOST_X, GROUND, H, MAX_W, MIN_W, POST_W, SHIELD_AT, clampW, courseY, flap, fresh, ghostPassed, hitsPost, isCurrent, kindFor, makePost, step,
  unlockedBy, type Post, type World,
} from './logic';

const post = (x: number, gapY = 170, gap = 110, n = 1): Post => ({ x, gapY, gap, passed: false, kind: 'branch', n });
const mid = () => 0.5;
const noSpawn = (w: World): World => ({ ...w, posts: [post(5000)] }); // keep new posts off-screen

describe('flappy', () => {
  it('falls under gravity and flaps up', () => {
    let w = step(noSpawn(fresh()), 0.1, mid);
    expect(w.vy).toBeGreaterThan(0);
    w = step(flap(w), 0.016, mid);
    expect(w.vy).toBeLessThan(0);
  });
  it('dies on the ground', () => {
    let w = noSpawn(fresh());
    for (let i = 0; i < 200 && !w.dead; i++) w = step(w, 0.016, mid);
    expect(w.dead).toBe(true);
    expect(w.y).toBeLessThan(GROUND);
  });
  it('is frame-rate independent-ish', () => {
    let a = noSpawn(fresh()), b = noSpawn(fresh());
    for (let i = 0; i < 30; i++) a = step(a, 1 / 60, mid);
    for (let i = 0; i < 15; i++) b = step(b, 1 / 30, mid);
    expect(Math.abs(a.y - b.y)).toBeLessThan(6);
  });
  it('lays out sideways, clamped to the long side', () => {
    expect(fresh(300).vw).toBe(MIN_W);
    expect(fresh(4000).vw).toBe(MAX_W);
    expect(clampW(800)).toBe(800);
    expect(isCurrent(fresh())).toBe(true);
    expect(isCurrent({ y: 1, posts: [] })).toBe(false);
  });
  it('hits a post only on the solid parts', () => {
    const p = post(BIRD_X - POST_W / 2);
    expect(hitsPost(170, p)).toBe(false);
    expect(hitsPost(80, p)).toBe(true);
    expect(hitsPost(260, p)).toBe(true);
    expect(hitsPost(170 - 55 + 11, p)).toBe(false); // grazing the edge is forgiven
    expect(hitsPost(80, post(BIRD_X + 40))).toBe(false);
  });
  it('scores a passed gap once', () => {
    const w = { ...fresh(), y: 170, posts: [post(BIRD_X - POST_W - 12), post(5000)] };
    const n = step(w, 0.01, mid);
    expect(n.score).toBe(1);
    expect(step(n, 0.01, mid).score).toBe(1);
  });
  it('feathers add up to a shield that forgives one crash', () => {
    const w: World = { ...noSpawn(fresh()), y: 170, got: SHIELD_AT - 1, feathers: [{ x: BIRD_X + 2, y: 170 }] };
    const a = step(w, 0.01, mid);
    expect(a.got).toBe(SHIELD_AT);
    expect(a.feathers.length).toBe(0);
    expect(a.shields).toBe(1);
    const crash = step({ ...a, y: 60, posts: [post(BIRD_X - POST_W / 2), post(5000)] }, 0.01, mid);
    expect(crash.dead).toBe(false);
    expect(crash.shields).toBe(0);
    expect(crash.grace).toBeGreaterThan(0);
    // and the ground bounces you once too
    const low = step({ ...a, y: GROUND - 5, vy: 200 }, 0.02, mid);
    expect(low.dead).toBe(false);
    expect(low.vy).toBe(FLAP_V);
  });
  it('a gust shoves the bird while inside it', () => {
    const base: World = { ...noSpawn(fresh()), y: 170, vy: 0 };
    const up = step({ ...base, gusts: [{ x: BIRD_X - 50, w: 100, force: -600 }] }, 0.02, mid);
    const calm = step(base, 0.02, mid);
    expect(up.vy).toBeLessThan(calm.vy - 5);
  });
  it('every 20 gaps ends in a swaying boss chimney stretch', () => {
    expect(kindFor(1)).toBe('branch');
    expect(kindFor(11)).toBe('chimney');
    expect(kindFor(16)).toBe('boss');
    expect(kindFor(20)).toBe('boss');
    expect(kindFor(21)).toBe('branch');
    const p = makePost(400, 17, mid);
    const w: World = { ...fresh(), y: 170, posts: [p, post(5000)] };
    const a = step(w, 0.2, mid), b = step(a, 0.2, mid);
    expect(a.posts[0].gapY).not.toBeCloseTo(b.posts[0].gapY, 1);
    expect(p.gapY - p.gap / 2).toBeGreaterThan(0);
    expect(p.gapY + p.gap / 2).toBeLessThan(GROUND);
  });
  it('the ghost follows the gaps and counts its own', () => {
    const posts = [post(200, 100), post(500, 250)];
    expect(courseY(posts, 220)).toBe(100);
    expect(courseY(posts, 400)).toBeGreaterThan(100);
    expect(courseY(posts, 400)).toBeLessThan(250);
    expect(courseY([], 10)).toBeCloseTo(H * 0.42);
    const between = { ...post(GHOST_X - POST_W + 20), passed: true };
    const behind = { ...post(GHOST_X - POST_W - 40), passed: true };
    expect(ghostPassed([behind, between], { score: 5 })).toBe(4);
  });
  it('unlocks crew at milestones', () => {
    expect(unlockedBy(0)).toEqual(['pip']);
    expect(unlockedBy(10)).toContain('ollie');
  });
});
