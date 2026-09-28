/** Flap: pure physics. World units are a fixed 360 x 560 box; the canvas
 *  scales it. Time is in seconds. */
export const W = 360;
export const H = 560;
export const GROUND = 520; // top of the ground strip
export const GRAVITY = 1500;
export const FLAP_V = -430;
export const MAX_FALL = 620;
export const BIRD_X = 100;
export const BIRD_R = 13; // forgiving: the sprite is drawn at ~40px, hitbox is smaller
export const POST_W = 58;
export const SPACING = 210;

export interface Post { x: number; gapY: number; gap: number; passed: boolean; kind: 'branch' | 'chimney' }
export interface World { y: number; vy: number; posts: Post[]; score: number; t: number; dead: boolean }

export const fresh = (): World => ({ y: H * 0.42, vy: 0, posts: [], score: 0, t: 0, dead: false });

export const speedFor = (score: number) => Math.min(190, 135 + score * 1.5);
export const gapFor = (score: number) => Math.max(140, 185 - score * 1.2);

export function flap(w: World): World {
  return w.dead ? w : { ...w, vy: FLAP_V };
}

export function makePost(x: number, score: number, rnd: () => number): Post {
  const gap = gapFor(score);
  const margin = 70;
  const gapY = margin + gap / 2 + rnd() * (GROUND - 2 * margin - gap);
  return { x, gapY, gap, passed: false, kind: Math.floor(score / 10) % 2 === 0 ? 'branch' : 'chimney' };
}

/** Circle vs the two solid parts of a post. */
export function hitsPost(y: number, p: Post, r = BIRD_R): boolean {
  const cx = BIRD_X;
  const nearX = Math.max(p.x, Math.min(cx, p.x + POST_W));
  const dx = cx - nearX;
  const top = p.gapY - p.gap / 2, bot = p.gapY + p.gap / 2;
  // top solid: y in [-inf, top]; bottom solid: [bot, inf]
  const nearTop = Math.min(y, top);
  const nearBot = Math.max(y, bot);
  const dTop = dx * dx + (y - nearTop) ** 2;
  const dBot = dx * dx + (y - nearBot) ** 2;
  return dTop < r * r || dBot < r * r;
}

/** Advance the world by dt seconds. Returns the new world (dead once it hits). */
export function step(w: World, dt: number, rnd: () => number = Math.random): World {
  if (w.dead) return w;
  dt = Math.min(dt, 0.05);
  const vy = Math.min(MAX_FALL, w.vy + GRAVITY * dt);
  let y = w.y + vy * dt;
  const sp = speedFor(w.score);
  let score = w.score;
  let posts = w.posts.map((p) => ({ ...p, x: p.x - sp * dt })).filter((p) => p.x + POST_W > -10);
  const last = posts.at(-1);
  if (!last || last.x < W + 20 - SPACING) posts.push(makePost(last ? last.x + SPACING : W + 60, score, rnd));
  for (const p of posts) {
    if (!p.passed && p.x + POST_W < BIRD_X - BIRD_R) { p.passed = true; score++; }
  }
  let dead = false;
  if (y + BIRD_R >= GROUND) { y = GROUND - BIRD_R; dead = true; }
  if (y < -40) y = -40; // the sky is open, but not forever
  if (posts.some((p) => hitsPost(y, p))) dead = true;
  return { y, vy, posts, score, t: w.t + dt, dead };
}

/** Crew unlock milestones for the flier picker (best single-run score). */
export const FLIERS: { name: string; at: number }[] = [
  { name: 'pip', at: 0 }, { name: 'wren', at: 5 }, { name: 'ollie', at: 10 }, { name: 'fig', at: 15 },
  { name: 'juno', at: 20 }, { name: 'bram', at: 25 }, { name: 'nell', at: 30 }, { name: 'moss', at: 40 },
  { name: 'rue', at: 50 }, { name: 'bly', at: 60 }, { name: 'tuck', at: 75 }, { name: 'otto', at: 100 },
];
export const unlockedBy = (score: number) => FLIERS.filter((f) => score >= f.at).map((f) => f.name);
