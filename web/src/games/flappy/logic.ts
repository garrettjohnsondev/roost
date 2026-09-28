/** Flap: pure physics, played sideways (wave 3). The world is H units tall
 *  and as wide as the phone's long side allows (World.vw); the canvas
 *  scales it. Time is in seconds.
 *
 *  Wave 3 adds: feathers to collect (every 10 is a shield that forgives one
 *  crash), wind gusts that shove you up or down, and a boss chimney stretch
 *  (five swaying chimneys) every 20 gaps. */
export const H = 360;
export const GROUND = 330; // top of the ground strip
export const MIN_W = 480;
export const MAX_W = 1000;
export const GRAVITY = 980;
export const FLAP_V = -290;
export const MAX_FALL = 420;
export const BIRD_X = 140;
export const BIRD_R = 10; // forgiving: the sprite is drawn at ~34px, hitbox is smaller
export const POST_W = 46;
export const SPACING = 230;
export const FEATHER_R = 9;
export const SHIELD_AT = 10; // feathers per shield
export const GHOST_X = BIRD_X - 44;

export type PostKind = 'branch' | 'chimney' | 'boss';
export interface Post { x: number; gapY: number; gap: number; passed: boolean; kind: PostKind; n: number; baseY?: number; amp?: number; phase?: number }
export interface Feather { x: number; y: number }
/** A gust zone scrolls with the world; inside it, force pushes vy. */
export interface Gust { x: number; w: number; force: number }
export interface World {
  y: number; vy: number; posts: Post[]; score: number; t: number; dead: boolean;
  vw: number; n: number; feathers: Feather[]; gusts: Gust[]; got: number; shields: number; grace: number;
}

export const fresh = (vw = 720): World => ({
  y: H * 0.42, vy: 0, posts: [], score: 0, t: 0, dead: false,
  vw: clampW(vw), n: 0, feathers: [], gusts: [], got: 0, shields: 0, grace: 0,
});
export const clampW = (w: number) => Math.max(MIN_W, Math.min(MAX_W, Math.round(w)));
/** A save from before wave 3 has no `n`; it can't be resumed. */
export const isCurrent = (w: unknown): w is World => !!w && typeof (w as World).n === 'number' && Array.isArray((w as World).feathers);

export const speedFor = (n: number) => Math.min(175, 120 + n * 1.2);
export const gapFor = (n: number) => Math.max(92, 122 - n * 0.8);
/** Gap n (1-based): 16-20 of every 20 are the boss chimneys. */
export const kindFor = (n: number): PostKind => ((n - 1) % 20 >= 15 ? 'boss' : Math.floor((n - 1) / 10) % 2 === 0 ? 'branch' : 'chimney');

export function flap(w: World): World {
  return w.dead ? w : { ...w, vy: FLAP_V };
}

export function makePost(x: number, n: number, rnd: () => number): Post {
  const kind = kindFor(n);
  const gap = gapFor(n) + (kind === 'boss' ? 14 : 0);
  const margin = 40;
  if (kind === 'boss') {
    const amp = 34 + rnd() * 20;
    const lo = margin + gap / 2 + amp, hi = GROUND - margin - gap / 2 - amp;
    const baseY = lo + rnd() * Math.max(0, hi - lo);
    const phase = rnd() * Math.PI * 2;
    return { x, gapY: baseY + Math.sin(phase) * amp, gap, passed: false, kind, n, baseY, amp, phase };
  }
  const gapY = margin + gap / 2 + rnd() * (GROUND - 2 * margin - gap);
  return { x, gapY, gap, passed: false, kind, n };
}

/** Circle vs the two solid parts of a post. */
export function hitsPost(y: number, p: Post, r = BIRD_R, cx = BIRD_X): boolean {
  const nearX = Math.max(p.x, Math.min(cx, p.x + POST_W));
  const dx = cx - nearX;
  const top = p.gapY - p.gap / 2, bot = p.gapY + p.gap / 2;
  const nearTop = Math.min(y, top);
  const nearBot = Math.max(y, bot);
  const dTop = dx * dx + (y - nearTop) ** 2;
  const dBot = dx * dx + (y - nearBot) ** 2;
  return dTop < r * r || dBot < r * r;
}

/** Where a perfect flier sits at column x: eased from one gap's centre to
 *  the next. Used for the ghost bird. */
export function courseY(posts: Post[], x: number): number {
  const ahead = posts.find((p) => p.x + POST_W >= x);
  if (!ahead) return H * 0.42;
  const behind = [...posts].reverse().find((p) => p.x + POST_W < x);
  if (!behind || x >= ahead.x) return ahead.gapY;
  const from = behind.x + POST_W, span = ahead.x - from;
  const k = span > 0 ? Math.max(0, Math.min(1, (x - from) / span)) : 1;
  const e = k * k * (3 - 2 * k);
  return behind.gapY + (ahead.gapY - behind.gapY) * e;
}

/** Advance the world by dt seconds. Returns the new world (dead once it hits). */
export function step(w: World, dt: number, rnd: () => number = Math.random): World {
  if (w.dead) return w;
  dt = Math.min(dt, 0.05);
  const t = w.t + dt;
  let vy = w.vy + GRAVITY * dt;
  const sp = speedFor(w.score);
  const move = sp * dt;
  const gusts = w.gusts.map((g) => ({ ...g, x: g.x - move })).filter((g) => g.x + g.w > -20);
  for (const g of gusts) if (BIRD_X >= g.x && BIRD_X <= g.x + g.w) vy += g.force * dt;
  vy = Math.max(-MAX_FALL, Math.min(MAX_FALL, vy));
  let y = w.y + vy * dt;
  let score = w.score, n = w.n, got = w.got, shields = w.shields;
  const grace = Math.max(0, w.grace - dt);
  const posts = w.posts.map((p) => {
    const q = { ...p, x: p.x - move };
    if (q.kind === 'boss') q.gapY = q.baseY! + Math.sin(t * 1.8 + q.phase!) * q.amp!;
    return q;
  }).filter((p) => p.x + POST_W > -10);
  let feathers = w.feathers.map((f) => ({ ...f, x: f.x - move })).filter((f) => f.x > -20);
  const last = posts.at(-1);
  if (!last || last.x < w.vw + 20 - SPACING) {
    const x = last ? last.x + SPACING : w.vw + 40;
    n++;
    const p = makePost(x, n, rnd);
    posts.push(p);
    // a feather between this gap and the one before, a little off the line
    if (last && rnd() < 0.6) {
      const fy = (last.gapY + p.gapY) / 2 + (rnd() - 0.5) * 70;
      feathers.push({ x: last.x + POST_W + (SPACING - POST_W) / 2, y: Math.max(30, Math.min(GROUND - 30, fy)) });
    }
    // gusts from gap 6 on, never in a boss stretch
    if (last && n > 6 && p.kind !== 'boss' && rnd() < 0.28) {
      gusts.push({ x: last.x + POST_W + 10, w: SPACING - POST_W - 20, force: (rnd() < 0.5 ? -1 : 1) * (420 + rnd() * 220) });
    }
  }
  for (const p of posts) {
    if (!p.passed && p.x + POST_W < BIRD_X - BIRD_R) { p.passed = true; score++; }
  }
  feathers = feathers.filter((f) => {
    const hit = (f.x - BIRD_X) ** 2 + (f.y - y) ** 2 < (FEATHER_R + BIRD_R) ** 2;
    if (hit) { got++; if (got % SHIELD_AT === 0) shields = Math.min(3, shields + 1); }
    return !hit;
  });
  let dead = false;
  let g2 = grace;
  if (y < -30) { y = -30; vy = Math.max(vy, 0); } // the sky is open, but not forever
  if (y + BIRD_R >= GROUND) {
    y = GROUND - BIRD_R;
    if (shields > 0 && grace <= 0) { shields--; g2 = 1.2; vy = FLAP_V; } else if (grace <= 0) dead = true; else vy = FLAP_V * 0.6;
  } else if (grace <= 0 && posts.some((p) => hitsPost(y, p))) {
    if (shields > 0) { shields--; g2 = 1.2; } else dead = true;
  }
  return { y, vy, posts, score, t, dead, vw: w.vw, n, feathers, gusts, got, shields, grace: g2 };
}

/** The ghost dies at its target: it flies the course until it has passed
 *  `target` gaps, then tumbles into the next one. */
export function ghostPassed(posts: Post[], w: Pick<World, 'score'>): number {
  // The ghost flies a little behind you: your count minus the gaps between you.
  const between = posts.filter((p) => p.passed && p.x + POST_W >= GHOST_X - BIRD_R).length;
  return w.score - between;
}

/** Crew unlock milestones for the flier picker (best single-run score). */
export const FLIERS: { name: string; at: number }[] = [
  { name: 'pip', at: 0 }, { name: 'wren', at: 5 }, { name: 'ollie', at: 10 }, { name: 'fig', at: 15 },
  { name: 'juno', at: 20 }, { name: 'bram', at: 25 }, { name: 'nell', at: 30 }, { name: 'moss', at: 40 },
  { name: 'rue', at: 50 }, { name: 'bly', at: 60 }, { name: 'tuck', at: 75 }, { name: 'otto', at: 100 },
];
export const unlockedBy = (score: number) => FLIERS.filter((f) => score >= f.at).map((f) => f.name);
