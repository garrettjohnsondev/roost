/** Brick Nest: pure physics. World is 360 x 540 units; time in seconds. */
export const W = 360;
export const H = 540;
export const COLS = 8;
export const BW = 40;
export const BH = 16;
export const BX0 = (W - COLS * BW) / 2;
export const BY0 = 64;
export const PADDLE_Y = 480;
export const PADDLE_H = 12;
export const PADDLE_W = 72;
export const WIDE_W = 116;
export const BALL_R = 6;
export const BASE_SPEED = 300;
export const DROP_R = 9;

export type Kind = 'wide' | 'multi' | 'slow';
export interface Ball { x: number; y: number; vx: number; vy: number; stuck: boolean }
export interface Drop { x: number; y: number; kind: Kind }
export interface State {
  paddleX: number; // center
  balls: Ball[];
  bricks: number[]; // hp per cell, 0 = empty; row-major, COLS wide
  level: number;
  lives: number;
  score: number;
  drops: Drop[];
  wide: number; // seconds left
  slow: number;
}
export interface Events { broke: number; caught: Kind[]; lostLife: boolean; cleared: boolean; over: boolean }

/** Layouts: digit = hits to break, '.' = empty. */
export const LEVELS: string[][] = [
  ['11111111', '11111111', '22222222', '11111111', '11111111'],
  ['...11...', '..1221..', '.123321.', '12333321', '.123321.', '..1221..', '...11...'],
  ['1.1.1.1.', '.2.2.2.2', '1.1.1.1.', '.2.2.2.2', '3.3.3.3.', '.3.3.3.3'],
  ['33333333', '1......1', '1.2222.1', '1.2..2.1', '1.2222.1', '1......1', '33333333'],
  ['.22..22.', '21122112', '21111112', '.211112.', '..2112..', '...22...'],
];

export function bricksFor(level: number): number[] {
  const rows = LEVELS[level % LEVELS.length];
  const bump = Math.floor(level / LEVELS.length); // later loops get tougher
  const out: number[] = [];
  for (const r of rows) for (let c = 0; c < COLS; c++) {
    const ch = r[c] ?? '.';
    out.push(ch === '.' ? 0 : Math.min(3, Number(ch) + bump));
  }
  return out;
}

export const brickRect = (i: number) => ({ x: BX0 + (i % COLS) * BW, y: BY0 + Math.floor(i / COLS) * BH, w: BW, h: BH });
export const paddleW = (s: State) => (s.wide > 0 ? WIDE_W : PADDLE_W);
export const speedFor = (s: State) => (BASE_SPEED + Math.min(120, s.level * 20)) * (s.slow > 0 ? 0.65 : 1);

const stuckBall = (px: number): Ball => ({ x: px, y: PADDLE_Y - BALL_R - 1, vx: 0, vy: 0, stuck: true });

export function fresh(level = 0, lives = 3, score = 0): State {
  return { paddleX: W / 2, balls: [stuckBall(W / 2)], bricks: bricksFor(level), level, lives, score, drops: [], wide: 0, slow: 0 };
}

export function launch(s: State): State {
  const sp = speedFor(s);
  return { ...s, balls: s.balls.map((b) => (b.stuck ? { ...b, stuck: false, vx: sp * 0.35, vy: -sp * 0.94 } : b)) };
}

export function movePaddle(s: State, x: number): State {
  const half = paddleW(s) / 2;
  return { ...s, paddleX: Math.max(half, Math.min(W - half, x)) };
}

/** Circle vs rect: returns the axis to reflect on, or null. */
export function circleRect(cx: number, cy: number, r: number, x: number, y: number, w: number, h: number): 'x' | 'y' | null {
  const nx = Math.max(x, Math.min(cx, x + w)), ny = Math.max(y, Math.min(cy, y + h));
  const dx = cx - nx, dy = cy - ny;
  if (dx * dx + dy * dy > r * r) return null;
  const penX = Math.min(cx + r - x, x + w - (cx - r));
  const penY = Math.min(cy + r - y, y + h - (cy - r));
  return penX < penY ? 'x' : 'y';
}

function setSpeed(b: Ball, sp: number) {
  const m = Math.hypot(b.vx, b.vy) || 1;
  b.vx = (b.vx / m) * sp; b.vy = (b.vy / m) * sp;
  // never let it go flat
  if (Math.abs(b.vy) < sp * 0.3) { b.vy = Math.sign(b.vy || -1) * sp * 0.3; b.vx = Math.sign(b.vx || 1) * Math.sqrt(sp * sp - b.vy * b.vy); }
}

export function step(s0: State, dt: number, rnd: () => number = Math.random): { s: State; ev: Events } {
  const ev: Events = { broke: 0, caught: [], lostLife: false, cleared: false, over: false };
  dt = Math.min(dt, 0.05);
  const s: State = { ...s0, bricks: [...s0.bricks], balls: s0.balls.map((b) => ({ ...b })), drops: s0.drops.map((d) => ({ ...d })) };
  s.wide = Math.max(0, s.wide - dt);
  s.slow = Math.max(0, s.slow - dt);
  const pw = paddleW(s);
  s.paddleX = Math.max(pw / 2, Math.min(W - pw / 2, s.paddleX));
  const sp = speedFor(s);

  const alive: Ball[] = [];
  for (const b of s.balls) {
    if (b.stuck) { b.x = s.paddleX; b.y = PADDLE_Y - BALL_R - 1; alive.push(b); continue; }
    setSpeed(b, sp);
    const n = Math.max(1, Math.ceil((sp * dt) / 4));
    let lost = false;
    for (let k = 0; k < n; k++) {
      b.x += (b.vx * dt) / n; b.y += (b.vy * dt) / n;
      if (b.x < BALL_R) { b.x = BALL_R; b.vx = Math.abs(b.vx); }
      if (b.x > W - BALL_R) { b.x = W - BALL_R; b.vx = -Math.abs(b.vx); }
      if (b.y < BALL_R) { b.y = BALL_R; b.vy = Math.abs(b.vy); }
      if (b.y > H + BALL_R) { lost = true; break; }
      // paddle
      if (b.vy > 0 && circleRect(b.x, b.y, BALL_R, s.paddleX - pw / 2, PADDLE_Y, pw, PADDLE_H)) {
        const off = Math.max(-1, Math.min(1, (b.x - s.paddleX) / (pw / 2)));
        const ang = off * 1.05; // up to ~60 degrees
        b.vx = Math.sin(ang) * sp; b.vy = -Math.cos(ang) * sp;
        b.y = PADDLE_Y - BALL_R;
      }
      // bricks (one per substep)
      for (let i = 0; i < s.bricks.length; i++) {
        if (!s.bricks[i]) continue;
        const r = brickRect(i);
        const axis = circleRect(b.x, b.y, BALL_R, r.x, r.y, r.w, r.h);
        if (!axis) continue;
        if (axis === 'x') b.vx = b.x < r.x + r.w / 2 ? -Math.abs(b.vx) : Math.abs(b.vx);
        else b.vy = b.y < r.y + r.h / 2 ? -Math.abs(b.vy) : Math.abs(b.vy);
        s.bricks[i]--;
        s.score += 10;
        if (!s.bricks[i]) {
          ev.broke++;
          s.score += 10 * (s.level + 1);
          if (rnd() < 0.14) {
            const kinds: Kind[] = ['wide', 'multi', 'slow'];
            s.drops.push({ x: r.x + r.w / 2, y: r.y + r.h / 2, kind: kinds[Math.floor(rnd() * 3) % 3] });
          }
        }
        break;
      }
    }
    if (!lost) alive.push(b);
  }
  s.balls = alive;

  // drops
  const kept: Drop[] = [];
  for (const d of s.drops) {
    d.y += 110 * dt;
    if (d.y + DROP_R >= PADDLE_Y && d.y - DROP_R <= PADDLE_Y + PADDLE_H && Math.abs(d.x - s.paddleX) <= pw / 2 + DROP_R) {
      ev.caught.push(d.kind);
      s.score += 25;
      if (d.kind === 'wide') s.wide = 12;
      if (d.kind === 'slow') s.slow = 9;
      if (d.kind === 'multi') {
        const src = s.balls.find((b) => !b.stuck) ?? s.balls[0];
        if (src) {
          const spd = speedFor(s);
          for (const a of [-0.6, 0.6]) {
            s.balls.push({ x: src.x, y: Math.min(src.y, PADDLE_Y - 20), vx: Math.sin(a) * spd, vy: -Math.cos(a) * spd, stuck: false });
          }
        }
      }
    } else if (d.y < H + 20) kept.push(d);
  }
  s.drops = kept;

  if (s.balls.length === 0) {
    s.lives--;
    ev.lostLife = true;
    s.wide = 0; s.slow = 0; s.drops = [];
    if (s.lives <= 0) { ev.over = true; s.lives = 0; }
    else s.balls = [stuckBall(s.paddleX)];
  }
  if (!ev.over && s.bricks.every((h) => h === 0)) {
    ev.cleared = true;
    const next = fresh(s.level + 1, s.lives, s.score + 100);
    next.paddleX = s.paddleX;
    next.balls = [stuckBall(s.paddleX)];
    return { s: next, ev };
  }
  return { s, ev };
}
