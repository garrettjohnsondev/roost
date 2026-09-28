/** Brick Nest: pure physics. World is 360 x 540 units; time in seconds.
 *
 *  Wave 3 adds: brick types (explosive, steel, sliding rows), two new
 *  power-ups (laser, sticky paddle), a combo multiplier for breaks between
 *  paddle touches, and a crow boss every fifth level. */
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
/** Brick codes: 1..3 = hits left, EXPLOSIVE = one hit and takes its
 *  neighbours with it, STEEL = never breaks (not needed to clear). */
export const EXPLOSIVE = 4;
export const STEEL = 9;
export const SLIDE = 16; // how far a sliding level's grid sways
export const BOSS_W = 72;
export const BOSS_H = 34;
export const BOSS_Y = BY0 + 2;
export const BOLT_V = 520;

export type Kind = 'wide' | 'multi' | 'slow' | 'laser' | 'sticky' | 'pebble';
export const POWERS: Kind[] = ['wide', 'multi', 'slow', 'laser', 'sticky'];
export interface Ball { x: number; y: number; vx: number; vy: number; stuck: boolean; off?: number }
export interface Drop { x: number; y: number; kind: Kind }
export interface Boss { x: number; vx: number; hp: number; max: number; cd: number }
export interface State {
  paddleX: number; // center
  balls: Ball[];
  bricks: number[]; // code per cell, 0 = empty; row-major, COLS wide
  level: number;
  lives: number;
  score: number;
  drops: Drop[];
  wide: number; // seconds left
  slow: number;
  laser?: number;
  sticky?: number;
  stun?: number;
  laserCd?: number;
  bolts?: { x: number; y: number }[];
  combo?: number;
  t?: number;
  boss?: Boss | null;
}
export interface Burst { x: number; y: number; kind: 'brick' | 'boom' | 'steel' | 'boss'; code: number }
export interface Events {
  broke: number; caught: Kind[]; lostLife: boolean; cleared: boolean; over: boolean;
  bursts: Burst[]; paddle: boolean; exploded: number; combo: number; bossHit: boolean; bossDown: boolean;
}

/** Layouts: digit = hits to break, x = explosive, s = steel, '.' = empty. */
export const LEVELS: string[][] = [
  ['11111111', '11111111', '22222222', '11111111', '11111111'],
  ['...11...', '..1221..', '.12xx21.', '12333321', '.123321.', '..1221..', '...11...'],
  ['1.1.1.1.', '.2.2.2.2', '1.x.1.x.', '.2.2.2.2', '3.3.3.3.', '.3.3.3.3'],
  ['33333333', '1......1', '1.2222.1', '1.2xx2.1', '1.2222.1', '1......1', 'ss3333ss'],
  ['11111111', '1x1111x1', '22222222', 's......s', '11111111'],
  ['.22..22.', '21122112', '21x11x12', '.211112.', '..2112..', '...22...'],
  ['s1s1s1s1', '1x1x1x1x', '22222222', '11111111', '.s.ss.s.'],
];
/** Every fifth level: the crow sits up top, a few bricks guard it. */
export const BOSS_ROWS = ['........', '........', '........', '........', '.1x11x1.', 's.1..1.s'];

export const isBoss = (level: number) => level % 5 === 4;
/** Sliding levels: the whole grid sways side to side. */
export const isSliding = (level: number) => !isBoss(level) && level % 5 >= 2;

export function bricksFor(level: number): number[] {
  const normal = level - Math.floor((level + 1) / 5);
  const rows = isBoss(level) ? BOSS_ROWS : LEVELS[normal % LEVELS.length];
  const bump = Math.floor(level / 10); // later loops get tougher
  const out: number[] = [];
  for (const r of rows) for (let c = 0; c < COLS; c++) {
    const ch = r[c] ?? '.';
    out.push(ch === '.' ? 0 : ch === 'x' ? EXPLOSIVE : ch === 's' ? STEEL : Math.min(3, Number(ch) + bump));
  }
  return out;
}

export const shiftFor = (s: State) => (isSliding(s.level) ? Math.sin((s.t ?? 0) * 1.3) * SLIDE : 0);
export const brickRect = (i: number, shift = 0) => ({ x: BX0 + (i % COLS) * BW + shift, y: BY0 + Math.floor(i / COLS) * BH, w: BW, h: BH });
export const paddleW = (s: State) => (s.wide > 0 ? WIDE_W : PADDLE_W);
export const speedFor = (s: State) => (BASE_SPEED + Math.min(120, s.level * 20)) * (s.slow > 0 ? 0.65 : 1);
/** Combo multiplier: every 4 breaks between paddle touches adds x1, up to x5. */
export const comboMult = (combo: number) => Math.min(5, 1 + Math.floor(combo / 4));
export const clearedBricks = (b: number[]) => b.every((h) => h === 0 || h === STEEL);

const stuckBall = (px: number): Ball => ({ x: px, y: PADDLE_Y - BALL_R - 1, vx: 0, vy: 0, stuck: true, off: 0 });

export function makeBoss(level: number): Boss {
  const hp = 12 + level * 2;
  return { x: W / 2, vx: 55 + level * 4, hp, max: hp, cd: 2.4 };
}

export function fresh(level = 0, lives = 3, score = 0): State {
  return {
    paddleX: W / 2, balls: [stuckBall(W / 2)], bricks: bricksFor(level), level, lives, score, drops: [], wide: 0, slow: 0,
    laser: 0, sticky: 0, stun: 0, laserCd: 0, bolts: [], combo: 0, t: 0, boss: isBoss(level) ? makeBoss(level) : null,
  };
}

export function launch(s: State): State {
  const sp = speedFor(s);
  return {
    ...s,
    balls: s.balls.map((b) => {
      if (!b.stuck) return b;
      // A caught egg leaves at the angle it was caught; a fresh one goes up-right.
      const off = b.off ? Math.max(-1, Math.min(1, b.off / (paddleW(s) / 2))) : 0.36;
      const ang = off * 1.05;
      return { ...b, stuck: false, off: 0, vx: Math.sin(ang) * sp, vy: -Math.cos(ang) * sp };
    }),
  };
}

export function movePaddle(s: State, x: number): State {
  if ((s.stun ?? 0) > 0) return s;
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

/** Neighbours (8-way) of a cell. */
export function neighbours(i: number, n: number): number[] {
  const r = Math.floor(i / COLS), c = i % COLS, out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const rr = r + dr, cc = c + dc;
    if (cc < 0 || cc >= COLS || rr < 0) continue;
    const j = rr * COLS + cc;
    if (j < n) out.push(j);
  }
  return out;
}

/** One hit on brick i (ball or laser). Handles break scoring, drops and
 *  explosive chains. Returns false for steel (it just bounces). */
function hitBrick(s: State, i: number, ev: Events, rnd: () => number, shift: number): boolean {
  const code = s.bricks[i];
  const r = brickRect(i, shift);
  if (code === STEEL) { ev.bursts.push({ x: r.x + r.w / 2, y: r.y + r.h / 2, kind: 'steel', code }); return false; }
  if (code === EXPLOSIVE) {
    // Chain: every explosive in the blast goes off too.
    const queue = [i];
    const seen = new Set<number>();
    while (queue.length) {
      const j = queue.shift()!;
      if (seen.has(j)) continue;
      seen.add(j);
      const was = s.bricks[j];
      if (!was || was === STEEL) continue;
      s.bricks[j] = 0;
      breakScore(s, j, was, ev, rnd, shift, was === EXPLOSIVE ? 'boom' : 'brick');
      if (j !== i) ev.exploded++;
      if (was === EXPLOSIVE) for (const k of neighbours(j, s.bricks.length)) queue.push(k);
    }
    return true;
  }
  s.bricks[i]--;
  s.score += 10;
  if (!s.bricks[i]) breakScore(s, i, code, ev, rnd, shift, 'brick');
  return true;
}

function breakScore(s: State, i: number, code: number, ev: Events, rnd: () => number, shift: number, kind: Burst['kind']) {
  const r = brickRect(i, shift);
  ev.broke++;
  s.combo = (s.combo ?? 0) + 1;
  ev.combo = s.combo;
  s.score += 10 * (s.level + 1) * comboMult(s.combo);
  ev.bursts.push({ x: r.x + r.w / 2, y: r.y + r.h / 2, kind, code });
  if (rnd() < 0.14) s.drops.push({ x: r.x + r.w / 2, y: r.y + r.h / 2, kind: POWERS[Math.floor(rnd() * POWERS.length) % POWERS.length] });
}

function hitBoss(s: State, ev: Events, x: number, y: number) {
  const b = s.boss!;
  b.hp--;
  s.score += 30;
  ev.bossHit = true;
  ev.bursts.push({ x, y, kind: 'boss', code: 0 });
  if (b.hp <= 0) {
    s.score += 500 + 100 * s.level;
    ev.bossDown = true;
    ev.bursts.push({ x: b.x, y: BOSS_Y + BOSS_H / 2, kind: 'boom', code: 0 });
    s.boss = null;
  }
}

export function step(s0: State, dt: number, rnd: () => number = Math.random): { s: State; ev: Events } {
  const ev: Events = { broke: 0, caught: [], lostLife: false, cleared: false, over: false, bursts: [], paddle: false, exploded: 0, combo: s0.combo ?? 0, bossHit: false, bossDown: false };
  dt = Math.min(dt, 0.05);
  const s: State = {
    ...s0, bricks: [...s0.bricks], balls: s0.balls.map((b) => ({ ...b })), drops: s0.drops.map((d) => ({ ...d })),
    bolts: (s0.bolts ?? []).map((b) => ({ ...b })), boss: s0.boss ? { ...s0.boss } : null,
  };
  s.t = (s.t ?? 0) + dt;
  s.wide = Math.max(0, s.wide - dt);
  s.slow = Math.max(0, s.slow - dt);
  s.laser = Math.max(0, (s.laser ?? 0) - dt);
  s.sticky = Math.max(0, (s.sticky ?? 0) - dt);
  s.stun = Math.max(0, (s.stun ?? 0) - dt);
  const pw = paddleW(s);
  s.paddleX = Math.max(pw / 2, Math.min(W - pw / 2, s.paddleX));
  const sp = speedFor(s);
  const shift = shiftFor(s);

  // the crow boss paces and drops pebbles
  if (s.boss) {
    const b = s.boss;
    b.x += b.vx * dt;
    if (b.x < BOSS_W / 2 + 4) { b.x = BOSS_W / 2 + 4; b.vx = Math.abs(b.vx); }
    if (b.x > W - BOSS_W / 2 - 4) { b.x = W - BOSS_W / 2 - 4; b.vx = -Math.abs(b.vx); }
    b.cd -= dt;
    if (b.cd <= 0) { b.cd = Math.max(1.1, 2.4 - s.level * 0.05); s.drops.push({ x: b.x, y: BOSS_Y + BOSS_H, kind: 'pebble' }); }
  }

  // laser bolts
  if (s.laser > 0) {
    s.laserCd = (s.laserCd ?? 0) - dt;
    if (s.laserCd <= 0) {
      s.laserCd = 0.35;
      s.bolts!.push({ x: s.paddleX - pw / 2 + 5, y: PADDLE_Y - 4 }, { x: s.paddleX + pw / 2 - 5, y: PADDLE_Y - 4 });
    }
  }
  const bolts: { x: number; y: number }[] = [];
  for (const bo of s.bolts!) {
    bo.y -= BOLT_V * dt;
    let gone = bo.y < 0;
    if (!gone && s.boss && Math.abs(bo.x - s.boss.x) < BOSS_W / 2 && bo.y < BOSS_Y + BOSS_H && bo.y > BOSS_Y) { hitBoss(s, ev, bo.x, bo.y); gone = true; }
    if (!gone) for (let i = 0; i < s.bricks.length; i++) {
      if (!s.bricks[i]) continue;
      const r = brickRect(i, shift);
      if (bo.x >= r.x && bo.x <= r.x + r.w && bo.y >= r.y && bo.y <= r.y + r.h) { hitBrick(s, i, ev, rnd, shift); gone = true; break; }
    }
    if (!gone) bolts.push(bo);
  }
  s.bolts = bolts;

  const alive: Ball[] = [];
  for (const b of s.balls) {
    if (b.stuck) { b.x = s.paddleX + (b.off ?? 0); b.y = PADDLE_Y - BALL_R - 1; alive.push(b); continue; }
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
        ev.paddle = true;
        s.combo = 0;
        if (s.sticky > 0) {
          b.stuck = true; b.off = b.x - s.paddleX; b.vx = 0; b.vy = 0; b.y = PADDLE_Y - BALL_R - 1;
          break;
        }
        const off = Math.max(-1, Math.min(1, (b.x - s.paddleX) / (pw / 2)));
        const ang = off * 1.05; // up to ~60 degrees
        b.vx = Math.sin(ang) * sp; b.vy = -Math.cos(ang) * sp;
        b.y = PADDLE_Y - BALL_R;
      }
      // boss
      if (s.boss) {
        const bx = s.boss.x - BOSS_W / 2;
        const axis = circleRect(b.x, b.y, BALL_R, bx, BOSS_Y, BOSS_W, BOSS_H);
        if (axis) {
          if (axis === 'x') b.vx = b.x < s.boss.x ? -Math.abs(b.vx) : Math.abs(b.vx);
          else b.vy = b.y < BOSS_Y + BOSS_H / 2 ? -Math.abs(b.vy) : Math.abs(b.vy);
          hitBoss(s, ev, b.x, b.y);
          continue;
        }
      }
      // bricks (one per substep)
      for (let i = 0; i < s.bricks.length; i++) {
        if (!s.bricks[i]) continue;
        const r = brickRect(i, shift);
        const axis = circleRect(b.x, b.y, BALL_R, r.x, r.y, r.w, r.h);
        if (!axis) continue;
        if (axis === 'x') b.vx = b.x < r.x + r.w / 2 ? -Math.abs(b.vx) : Math.abs(b.vx);
        else b.vy = b.y < r.y + r.h / 2 ? -Math.abs(b.vy) : Math.abs(b.vy);
        hitBrick(s, i, ev, rnd, shift);
        break;
      }
    }
    if (!lost) alive.push(b);
  }
  s.balls = alive;

  // drops
  const kept: Drop[] = [];
  for (const d of s.drops) {
    d.y += (d.kind === 'pebble' ? 150 : 110) * dt;
    if (d.y + DROP_R >= PADDLE_Y && d.y - DROP_R <= PADDLE_Y + PADDLE_H && Math.abs(d.x - s.paddleX) <= pw / 2 + DROP_R) {
      ev.caught.push(d.kind);
      if (d.kind === 'pebble') { s.stun = 0.9; continue; }
      s.score += 25;
      if (d.kind === 'wide') s.wide = 12;
      if (d.kind === 'slow') s.slow = 9;
      if (d.kind === 'laser') { s.laser = 8; s.laserCd = 0; }
      if (d.kind === 'sticky') s.sticky = 12;
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
    s.wide = 0; s.slow = 0; s.laser = 0; s.sticky = 0; s.stun = 0; s.combo = 0; s.drops = []; s.bolts = [];
    if (s.lives <= 0) { ev.over = true; s.lives = 0; }
    else s.balls = [stuckBall(s.paddleX)];
  }
  if (!ev.over && clearedBricks(s.bricks) && !s.boss) {
    ev.cleared = true;
    const next = fresh(s.level + 1, s.lives, s.score + 100);
    next.paddleX = s.paddleX;
    next.balls = [stuckBall(s.paddleX)];
    return { s: next, ev };
  }
  return { s, ev };
}
