import { describe, expect, it } from 'vitest';
import {
  BALL_R, BOSS_Y, COLS, EXPLOSIVE, H, LEVELS, PADDLE_Y, STEEL, W, brickRect, bricksFor, circleRect, clearedBricks, comboMult, fresh, isBoss, launch, movePaddle, step, type State,
} from './logic';

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
  it('an explosive takes its neighbours, and chains', () => {
    const bricks = Array(COLS * 5).fill(0);
    bricks[0] = EXPLOSIVE; bricks[1] = EXPLOSIVE; bricks[COLS + 1] = 2; bricks[2] = 3; bricks[3] = 1;
    const s: State = { ...fresh(), bricks };
    s.balls = [{ x: brickRect(0).x + 20, y: 100, vx: 0, vy: -300, stuck: false }];
    let cur = s, exploded = 0;
    for (let i = 0; i < 20; i++) { const n = step(cur, 0.016, never); exploded += n.ev.exploded; cur = n.s; if (n.ev.broke) break; }
    expect(cur.bricks[1]).toBe(0);
    expect(cur.bricks[COLS + 1]).toBe(0);
    expect(cur.bricks[2]).toBe(0); // chained through the second explosive
    expect(cur.bricks[3]).toBe(1); // out of reach
    expect(exploded).toBe(3);
  });
  it('steel never breaks and is not needed to clear', () => {
    expect(clearedBricks([0, STEEL, 0])).toBe(true);
    expect(clearedBricks([0, STEEL, 1])).toBe(false);
    const bricks = Array(COLS * 5).fill(0);
    bricks[0] = STEEL; bricks[7] = 1;
    const s: State = { ...fresh(), bricks };
    s.balls = [{ x: brickRect(0).x + 20, y: 100, vx: 0, vy: -300, stuck: false }];
    let cur = s;
    for (let i = 0; i < 20; i++) cur = step(cur, 0.016, never).s;
    expect(cur.bricks[0]).toBe(STEEL);
    expect(cur.balls[0].vy).toBeGreaterThan(0);
  });
  it('sticky paddle catches the egg where it lands, then relaunches', () => {
    let s: State = { ...fresh(), sticky: 5 };
    s.balls = [{ x: W / 2 + 20, y: PADDLE_Y - 10, vx: 0, vy: 300, stuck: false }];
    s = step(s, 0.03, never).s;
    expect(s.balls[0].stuck).toBe(true);
    expect(s.balls[0].off).toBeCloseTo(20, 0);
    s = step(launch(s), 0.02, never).s;
    expect(s.balls[0].stuck).toBe(false);
    expect(s.balls[0].vx).toBeGreaterThan(0);
  });
  it('laser bolts chip bricks from below', () => {
    const bricks = Array(COLS * 5).fill(0);
    const col = Math.floor((W / 2 - 36 + 5 - 20) / 40);
    for (let r = 0; r < 5; r++) bricks[r * COLS + col] = 1;
    bricks[COLS * 5 - 1] = 1; // keep the level alive
    let s: State = { ...fresh(), bricks, laser: 3 };
    let broke = 0;
    for (let i = 0; i < 60; i++) { const n = step(s, 0.016, never); broke += n.ev.broke; s = n.s; }
    expect(broke).toBeGreaterThan(0);
  });
  it('combos multiply until the paddle is touched', () => {
    expect(comboMult(0)).toBe(1);
    expect(comboMult(4)).toBe(2);
    expect(comboMult(99)).toBe(5);
    let s: State = { ...fresh(), combo: 7 };
    s.balls = [{ x: W / 2, y: PADDLE_Y - 8, vx: 0, vy: 300, stuck: false }];
    const r = step(s, 0.02, never);
    expect(r.ev.paddle).toBe(true);
    expect(r.s.combo).toBe(0);
  });
  it('every fifth level is a boss that must fall to clear', () => {
    expect(isBoss(4)).toBe(true);
    expect(isBoss(9)).toBe(true);
    expect(isBoss(3)).toBe(false);
    const s = fresh(4);
    expect(s.boss).toBeTruthy();
    const b: State = { ...s, bricks: s.bricks.map(() => 0), boss: { ...s.boss!, hp: 1, vx: 0, x: W / 2 } };
    b.balls = [{ x: W / 2, y: BOSS_Y + 60, vx: 0, vy: -300, stuck: false }];
    let cur = b, down = false, cleared = false;
    for (let i = 0; i < 30 && !cleared; i++) { const n = step(cur, 0.016, never); down ||= n.ev.bossDown; cleared = n.ev.cleared; cur = n.s; }
    expect(down).toBe(true);
    expect(cleared).toBe(true);
    expect(cur.level).toBe(5);
  });
  it('a caught pebble stuns the paddle', () => {
    let s: State = { ...fresh(), drops: [{ x: W / 2, y: PADDLE_Y - 2, kind: 'pebble' }] };
    s = step(s, 0.016, never).s;
    expect(s.stun).toBeGreaterThan(0);
    expect(movePaddle(s, 40).paddleX).toBe(s.paddleX);
  });
});
