import { describe, expect, it } from 'vitest';
import { BALL_R, COLS, H, LEVELS, PADDLE_Y, W, bricksFor, circleRect, fresh, launch, movePaddle, step, type State } from './logic';

const never = () => 0.99;

describe('breakout', () => {
  it('every level is COLS wide and has bricks', () => {
    LEVELS.forEach((l, i) => {
      l.forEach((r) => expect(r.length).toBe(COLS));
      expect(bricksFor(i).some((h) => h > 0)).toBe(true);
    });
  });
  it('ball stays on the paddle until launched', () => {
    let s = movePaddle(fresh(), 100);
    s = step(s, 0.1, never).s;
    expect(s.balls[0].x).toBe(100);
    s = step(launch(s), 0.05, never).s;
    expect(s.balls[0].y).toBeLessThan(PADDLE_Y - BALL_R - 1);
  });
  it('clamps the paddle', () => {
    expect(movePaddle(fresh(), -50).paddleX).toBeGreaterThan(0);
    expect(movePaddle(fresh(), 9999).paddleX).toBeLessThan(W);
  });
  it('circleRect picks the axis', () => {
    expect(circleRect(0, 0, 5, 20, 20, 10, 10)).toBeNull();
    expect(circleRect(25, 17, 5, 20, 20, 10, 10)).toBe('y');
    expect(circleRect(17, 25, 5, 20, 20, 10, 10)).toBe('x');
  });
  it('breaks a brick and bounces down', () => {
    const s: State = { ...fresh(), bricks: [1, ...Array(COLS * 5 - 1).fill(0)] };
    s.balls = [{ x: 40, y: 100, vx: 0, vy: -300, stuck: false }];
    let r = { s, ev: { broke: 0 } as { broke: number } };
    let broke = 0;
    for (let i = 0; i < 20; i++) { const n = step(r.s, 0.016, never); broke += n.ev.broke; r = n; if (n.ev.broke) break; }
    expect(broke).toBe(1);
  });
  it('clearing the last brick goes to the next level', () => {
    const s: State = { ...fresh(), bricks: [1, ...Array(COLS * 5 - 1).fill(0)] };
    s.balls = [{ x: 40, y: 100, vx: 0, vy: -300, stuck: false }];
    let cur = s, cleared = false;
    for (let i = 0; i < 40 && !cleared; i++) { const n = step(cur, 0.016, never); cleared = n.ev.cleared; cur = n.s; }
    expect(cleared).toBe(true);
    expect(cur.level).toBe(1);
  });
  it('losing all balls costs a life, then the game', () => {
    let s: State = { ...fresh(), lives: 2 };
    s.balls = [{ x: 10, y: H - 2, vx: 0, vy: 300, stuck: false }];
    s.paddleX = 300;
    let r = step(s, 0.05, never);
    expect(r.ev.lostLife).toBe(true);
    expect(r.s.lives).toBe(1);
    s = { ...r.s, balls: [{ x: 10, y: H - 2, vx: 0, vy: 300, stuck: false }] };
    r = step(s, 0.05, never);
    expect(r.ev.over).toBe(true);
  });
  it('multi-ball drop adds balls', () => {
    const s: State = { ...fresh(), drops: [{ x: W / 2, y: PADDLE_Y - 2, kind: 'multi' }] };
    s.balls = [{ x: 50, y: 300, vx: 100, vy: -280, stuck: false }];
    const r = step(s, 0.016, never);
    expect(r.ev.caught).toEqual(['multi']);
    expect(r.s.balls.length).toBe(3);
  });
});
