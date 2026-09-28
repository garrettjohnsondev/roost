/** Canvas drawing for Roost Birds: pixel textures made at runtime, beetles
 *  drawn from a tiny pixel map, crew sprites for the birds. */
import type { Body } from './physics';
import { GROUND_Y } from './levels';
import { BIRDS, SLING, Sim, trajectory } from './game';
import type { BirdName } from './levels';

export const VIEW_W = 440; // world units across the screen at normal zoom
export const GROUND_SHOW = 34; // world units of ground under the grass line

export interface Cam { x: number; zoom: number }

// ---------- assets ----------

const imgs = new Map<string, HTMLImageElement>();
export function img(src: string): HTMLImageElement {
  let i = imgs.get(src);
  if (!i) { i = new Image(); i.src = src; imgs.set(src, i); }
  return i;
}
const ready = (i: HTMLImageElement) => i.complete && i.naturalWidth > 0;
export const birdSprite = (name: string, pose: string) => img(`/crew/${name}-${pose}.webp`);

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
}

type Tex = { pattern: CanvasPattern | null; canvas: HTMLCanvasElement };
const textures = new Map<string, Tex>();
function tile(key: string, w: number, h: number, paint: (g: CanvasRenderingContext2D, r: () => number) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  paint(g, rng(key.length * 977 + w * 31 + h));
  return c;
}
function texture(ctx: CanvasRenderingContext2D, key: string): CanvasPattern | null {
  let t = textures.get(key);
  if (!t) {
    const canvas = makeTile(key);
    t = { canvas, pattern: ctx.createPattern(canvas, 'repeat') };
    textures.set(key, t);
  }
  return t.pattern;
}

function makeTile(key: string): HTMLCanvasElement {
  const px = (g: CanvasRenderingContext2D, x: number, y: number, c: string, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  switch (key) {
    case 'wood': return tile(key, 16, 16, (g, r) => {
      px(g, 0, 0, '#b8803f', 16, 16);
      for (let y = 0; y < 16; y++) {
        if (r() < 0.35) px(g, 0, y, '#a26d33', 16, 1);
        for (let x = 0; x < 16; x++) if (r() < 0.07) px(g, x, y, r() < 0.5 ? '#8e5c28' : '#c99452', 1 + Math.floor(r() * 3), 1);
      }
      px(g, 0, 7, '#7c4f22', 16, 1);
      px(g, 0, 15, '#7c4f22', 16, 1);
      px(g, 10, 3, '#6f4520', 2, 2);
    });
    case 'stone': return tile(key, 16, 16, (g, r) => {
      px(g, 0, 0, '#9a9ca6', 16, 16);
      for (let i = 0; i < 40; i++) px(g, Math.floor(r() * 16), Math.floor(r() * 16), r() < 0.5 ? '#868892' : '#b0b2bb');
      px(g, 0, 7, '#6d6f78', 16, 1); px(g, 0, 15, '#6d6f78', 16, 1);
      px(g, 5, 0, '#6d6f78', 1, 7); px(g, 13, 8, '#6d6f78', 1, 7);
      px(g, 0, 0, '#c2c4cc', 5, 1); px(g, 6, 0, '#c2c4cc', 7, 1); px(g, 0, 8, '#c2c4cc', 13, 1);
    });
    case 'glass': return tile(key, 16, 16, (g) => {
      px(g, 0, 0, 'rgba(160,215,240,0.55)', 16, 16);
      for (let i = 0; i < 5; i++) px(g, 3 + i, 10 - i * 2, 'rgba(255,255,255,0.8)', 1, 2);
      for (let i = 0; i < 3; i++) px(g, 10 + i, 14 - i * 2, 'rgba(255,255,255,0.55)', 1, 2);
    });
    case 'tnt': return tile(key, 16, 16, (g, r) => {
      px(g, 0, 0, '#d63a2a', 16, 16);
      for (let i = 0; i < 24; i++) px(g, Math.floor(r() * 16), Math.floor(r() * 16), r() < 0.5 ? '#c02f22' : '#e25040');
      px(g, 0, 0, '#8a1f14', 16, 2); px(g, 0, 14, '#8a1f14', 16, 2);
      px(g, 0, 0, '#8a1f14', 2, 16); px(g, 14, 0, '#8a1f14', 2, 16);
      px(g, 2, 2, '#f0705e', 12, 1);
    });
    case 'ground': return tile(key, 32, 32, (g, r) => {
      px(g, 0, 0, '#7a5231', 32, 32);
      for (let i = 0; i < 70; i++) px(g, Math.floor(r() * 32), Math.floor(r() * 32), r() < 0.5 ? '#6a4529' : '#8d6139', 1 + Math.floor(r() * 2), 1);
      for (let i = 0; i < 5; i++) px(g, Math.floor(r() * 30), Math.floor(r() * 30), '#9b9a8e', 2, 2);
    });
    default: return tile(key, 2, 2, (g) => px(g, 0, 0, '#f0f', 2, 2));
  }
}

// ---------- bugs ----------

const BUG_MAP = [
  '.a......a.',
  '..a....a..',
  '..HHHHHH..',
  '.HhHHHHhH.',
  'SBBSSSSBBS',
  'SWPSSSSPWS',
  'SSSSDDSSSS',
  'SDSSSSSSDS',
  'LSSSSSSSSL',
  'L.L....L.L',
];
const BUG_COLORS: Record<string, [string, string, string, string]> = {
  // shell, head, highlight, spots
  normal: ['#5f9b2c', '#2f5a17', '#8fce4f', '#3e6d1c'],
  boss: ['#8a3fbf', '#4f1f73', '#c07ff0', '#5d2a86'],
  red: ['#c9502f', '#7a2a16', '#f08a5f', '#8f3a22'],
};

function drawBug(ctx: CanvasRenderingContext2D, b: Body, time: number, flash = 0) {
  const pal = BUG_COLORS[b.tag === 'boss' ? 'boss' : b.id % 3 === 0 ? 'red' : 'normal'];
  const hurt = b.dmg / b.hp;
  const s = (b.r * 2.2) / 10;
  const bob = 1 + Math.sin(time * 4 + b.id) * 0.04;
  ctx.save();
  ctx.translate(b.x, b.y + b.r);
  ctx.rotate(b.a);
  ctx.scale(1, bob);
  ctx.translate(-5 * s, -10 * s); // feet on the bottom of the circle
  for (let y = 0; y < 10; y++) {
    const row = BUG_MAP[y];
    for (let x = 0; x < 10; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      let c = '#1b1b1b';
      if (ch === 'S') c = pal[0];
      else if (ch === 'H') c = pal[1];
      else if (ch === 'h') c = pal[2];
      else if (ch === 'D') c = pal[3];
      else if (ch === 'W') c = '#ffffff';
      else if (ch === 'P') c = '#e02424';
      ctx.fillStyle = c;
      ctx.fillRect(x * s, y * s, s + 0.05, s + 0.05);
    }
  }
  if (hurt > 0.35) {
    // a bandage over one eye: it's been hit
    ctx.fillStyle = '#f5e6c8';
    ctx.fillRect(1 * s, 4.5 * s, 3 * s, 1 * s);
  }
  ctx.restore();
  if (flash > 0) {
    // a white hit flash
    ctx.save();
    ctx.globalAlpha = Math.min(1, flash / 0.15) * 0.7;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 1.05, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  if (b.tag === 'boss') {
    // a health bar: bosses take a beating
    const left = Math.max(0, 1 - b.dmg / b.hp);
    const w = 36, x = b.x - w / 2, y = b.y - b.r - 14;
    ctx.fillStyle = 'rgba(20,16,30,0.8)';
    ctx.fillRect(x - 1, y - 1, w + 2, 6);
    ctx.fillStyle = left > 0.5 ? '#7fcb4f' : left > 0.25 ? '#f4b63f' : '#e2453a';
    ctx.fillRect(x, y, Math.max(0, w * left), 4);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(x, y, Math.max(0, w * left), 1);
  }
}

// ---------- blocks ----------

function drawBlock(ctx: CanvasRenderingContext2D, b: Body) {
  const tall = b.hh > b.hw;
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.a + (tall ? Math.PI / 2 : 0));
  const hw = tall ? b.hh : b.hw, hh = tall ? b.hw : b.hh;
  const pat = texture(ctx, b.mat);
  ctx.fillStyle = pat ?? '#a0642c';
  ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
  ctx.strokeStyle = b.mat === 'glass' ? 'rgba(235,250,255,0.9)' : b.mat === 'stone' ? '#4d4f57' : b.mat === 'tnt' ? '#5a120c' : '#5b3716';
  ctx.lineWidth = 1;
  ctx.strokeRect(-hw + 0.5, -hh + 0.5, hw * 2 - 1, hh * 2 - 1);
  // a pixel top-light and a shade line: blocks read as solid
  if (b.mat !== 'glass') {
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(-hw + 1, -hh + 1, hw * 2 - 2, 1.5);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(-hw + 1, hh - 2.5, hw * 2 - 2, 1.5);
  }
  if (b.mat === 'tnt') {
    ctx.save();
    if (tall) ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#ffe9a8';
    ctx.font = `bold ${Math.max(6, Math.min(b.hw, b.hh) * 0.7)}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TNT', 0, 0.5);
    ctx.restore();
  }
  const frac = b.dmg / b.hp;
  if (frac > 0.2) {
    const r = rng(b.id * 7919);
    ctx.strokeStyle = b.mat === 'glass' ? 'rgba(255,255,255,0.95)' : 'rgba(30,20,10,0.75)';
    ctx.lineWidth = 1;
    const n = frac > 0.6 ? 3 : frac > 0.4 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      let x = -hw + r() * hw * 2, y = -hh;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let i = 0; i < 4; i++) { x += (r() - 0.5) * 8; y += (hh * 2) / 4; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ---------- birds and sling ----------

function drawBird(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, r: number, a: number, pose: string, flip = false, sx = 1, sy = 1) {
  const i = birdSprite(name, pose);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  if (flip) ctx.scale(-1, 1);
  if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
  if (ready(i)) {
    const s = r * 2.9;
    ctx.drawImage(i, -s / 2, -s / 2 - r * 0.15, s, s);
  } else {
    ctx.fillStyle = '#f4b63f';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawSlingBack(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#6b3f1c';
  ctx.fillRect(SLING.x - 4, SLING.y + 6, 8, GROUND_Y - SLING.y - 6);
  ctx.fillRect(SLING.x + 4, SLING.y - 14, 6, 24);
  ctx.fillStyle = '#8a5428';
  ctx.fillRect(SLING.x - 2, SLING.y + 6, 3, GROUND_Y - SLING.y - 6);
}
function drawSlingFront(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#6b3f1c';
  ctx.fillRect(SLING.x - 12, SLING.y - 14, 6, 24);
  ctx.fillRect(SLING.x - 12, SLING.y + 6, 22, 6);
  ctx.fillStyle = '#8a5428';
  ctx.fillRect(SLING.x - 11, SLING.y - 14, 2, 22);
}
function band(ctx: CanvasRenderingContext2D, fx: number, fy: number, x: number, y: number) {
  ctx.strokeStyle = '#4a2410';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(x, y); ctx.stroke();
}

// ---------- frame ----------

export interface Aim { dx: number; dy: number; vx: number; vy: number; power: number }

/** The ghost being raced on this fort: their best shot as a faint arc, and
 *  their crew sprite floating see-through over it. */
export interface GhostView { sprite: string; name: string; arc: { x: number; y: number }[] }
export interface FrameOpts { ghost?: GhostView | null; reduced?: boolean }

const trails = new WeakMap<Sim, { x: number; y: number }[]>();

function drawGhost(ctx: CanvasRenderingContext2D, g: GhostView, time: number) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.4;
  g.arc.forEach((p, i) => { if (i % 2 === 0) ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3); });
  // float the ghost near the top of their arc
  const top = g.arc.reduce((m, p) => (p.y < m.y ? p : m), g.arc[0] ?? { x: SLING.x, y: SLING.y });
  const i = birdSprite(g.sprite, 'idle');
  const bob = Math.sin(time * 2.4) * 4;
  ctx.shadowColor = 'rgba(255,255,255,0.95)';
  ctx.shadowBlur = 10;
  if (ready(i)) ctx.drawImage(i, top.x - 15, top.y - 42 + bob, 30, 30);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.6;
  ctx.font = 'bold 8px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`${g.name}'s best`, top.x, top.y - 46 + bob);
  ctx.restore();
}

function drawClouds(ctx: CanvasRenderingContext2D, w: number, h: number, camX: number, time: number) {
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  for (let k = 0; k < 5; k++) {
    const span = w + 160;
    const x = Math.floor((((k * 211 - camX * 0.15 + time * (4 + k)) % span) + span) % span - 80);
    const y = Math.floor(14 + ((k * 53) % Math.max(20, h * 0.35)));
    const s = 3 + (k % 3);
    ctx.fillRect(x, y, s * 10, s * 2);
    ctx.fillRect(x + s * 2, y - s * 2, s * 5, s * 2);
    ctx.fillRect(x + s * 4, y - s * 3, s * 3, s);
  }
}

export function drawFrame(ctx: CanvasRenderingContext2D, sim: Sim, cam: Cam, w: number, h: number, dpr: number, aim: Aim | null, scene: HTMLImageElement, opts: FrameOpts = {}) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;

  // sky + scene, parallax
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#9ad3f0'); sky.addColorStop(1, '#e8f4ea');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  if (ready(scene)) {
    const groundScreen = h - GROUND_SHOW * cam.zoom;
    const sh = groundScreen + 14, sw = (scene.naturalWidth / scene.naturalHeight) * sh;
    let x0 = -((cam.x * cam.zoom * 0.3) % sw);
    if (x0 > 0) x0 -= sw;
    ctx.globalAlpha = 0.9;
    for (let x = x0; x < w; x += sw) ctx.drawImage(scene, Math.floor(x), Math.floor(groundScreen + 14 - sh), Math.ceil(sw) + 1, Math.ceil(sh));
    ctx.globalAlpha = 1;
    // a light veil so the fort reads over any backdrop
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(0, 0, w, groundScreen);
  }
  drawClouds(ctx, w, h, cam.x, sim.time);

  const shk = opts.reduced ? 0 : sim.shake;
  const shx = shk ? (Math.random() - 0.5) * shk : 0;
  const shy = shk ? (Math.random() - 0.5) * shk : 0;
  const z = cam.zoom * dpr;
  ctx.setTransform(z, 0, 0, z, (-cam.x * cam.zoom + shx) * dpr, (h - (GROUND_Y + GROUND_SHOW) * cam.zoom + shy) * dpr);
  ctx.imageSmoothingEnabled = false;

  // ground
  const gx0 = cam.x - 50, gx1 = cam.x + w / cam.zoom + 50;
  ctx.fillStyle = texture(ctx, 'ground') ?? '#7a5231';
  ctx.fillRect(gx0, GROUND_Y, gx1 - gx0, 200);
  ctx.fillStyle = '#5da83a';
  ctx.fillRect(gx0, GROUND_Y - 1, gx1 - gx0, 5);
  ctx.fillStyle = '#7fcb4f';
  for (let x = Math.floor(gx0 / 6) * 6; x < gx1; x += 6) ctx.fillRect(x, GROUND_Y - 2 - ((x / 6) % 3 === 0 ? 2 : 0), 2, 3);

  // birds waiting their turn
  sim.queue.forEach((name, i) => {
    const r = BIRDS[name].r;
    const hop = Math.max(0, Math.sin(sim.time * 3 + i * 1.7)) * 3;
    drawBird(ctx, name, SLING.x - 36 - i * 26, GROUND_Y - r - hop, r, 0, 'idle');
  });

  if (opts.ghost && sim.phase !== 'won' && sim.phase !== 'lost') drawGhost(ctx, opts.ghost, sim.time);

  // this shot's trail: little puffs where the bird has been
  let trail = trails.get(sim);
  if (!trail) { trail = []; trails.set(sim, trail); }
  if (sim.phase === 'flying' && sim.flyers[0] && !sim.flyers[0].dead) {
    const f = sim.flyers[0], last = trail[trail.length - 1];
    if (!last || Math.hypot(f.x - last.x, f.y - last.y) > 14) trail.push({ x: f.x, y: f.y });
  } else if (sim.phase === 'aim' && aim) trail.length = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  trail.forEach((p, i) => { const s = i % 3 === 0 ? 3 : 2; ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s); });

  drawSlingBack(ctx);
  const forkB = { x: SLING.x + 7, y: SLING.y - 10 }, forkF = { x: SLING.x - 9, y: SLING.y - 10 };
  const pouch = aim ? { x: SLING.x + aim.dx, y: SLING.y + aim.dy } : SLING;
  if (sim.phase === 'aim' && sim.current) band(ctx, forkB.x, forkB.y, pouch.x, pouch.y);

  for (const b of sim.world.bodies) {
    if (b.dead) continue;
    if (b.mat === 'wood' || b.mat === 'stone' || b.mat === 'glass' || b.mat === 'tnt') drawBlock(ctx, b);
  }
  for (const b of sim.bugs) if (!b.dead) drawBug(ctx, b, sim.time, sim.flash.get(b.id) ?? 0);
  for (const e of sim.eggs) {
    const b = e.body;
    ctx.fillStyle = '#fff4d6';
    ctx.fillRect(b.x - 5, b.y - 7, 10, 14);
    ctx.fillRect(b.x - 7, b.y - 4, 14, 10);
    ctx.fillStyle = Math.floor(e.t * 8) % 2 ? '#ff7a2f' : '#ffcc55';
    ctx.fillRect(b.x - 3, b.y - 2, 6, 4);
  }
  for (const f of sim.flyers) {
    if (f.dead) continue;
    const sp = Math.hypot(f.vx, f.vy);
    // stretch with speed, squash on a hit
    const sq = sim.squish.get(f.id) ?? 0;
    const st = Math.min(0.22, sp / 4000);
    const sx = sq > 0 ? 1 + sq * 2.2 : 1 + st, sy = sq > 0 ? 1 - sq * 2 : 1 - st * 0.6;
    const spinning = f.tag === 'bly' && Math.abs(f.w) > 5;
    drawBird(ctx, f.tag ?? 'rue', f.x, f.y, f.r, spinning ? sim.time * -14 : sp > 60 ? Math.atan2(f.vy, f.vx) * 0.6 : f.a * 0.3, sp > 60 ? 'side' : 'think', f.vx < -60 && !spinning, sx, sy);
  }

  if (sim.phase === 'aim' && sim.current) {
    if (aim && aim.power > 0.08) {
      const pts = trajectory(aim.vx, aim.vy, sim.world.gravity);
      pts.forEach((p, i) => {
        const s = Math.max(2, 4 - i * 0.08);
        ctx.globalAlpha = Math.max(0.25, 1 - i * 0.03);
        ctx.fillStyle = 'rgba(20,24,40,0.7)';
        ctx.fillRect(p.x - s / 2 - 1, p.y - s / 2 - 1, s + 2, s + 2);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
        ctx.globalAlpha = 1;
      });
    }
    const r = BIRDS[sim.current].r;
    const bob = aim ? 0 : Math.sin(sim.time * 4) * 1.2;
    const pull = aim ? aim.power : 0;
    drawBird(ctx, sim.current, pouch.x, pouch.y + bob, r, 0, aim ? 'side' : 'idle', false, 1 - pull * 0.12, 1 + pull * 0.1);
    band(ctx, forkF.x, forkF.y, pouch.x, pouch.y);
  }
  drawSlingFront(ctx);

  for (const b of sim.booms) {
    const k = b.t / 0.5;
    ctx.fillStyle = `rgba(255,${Math.round(200 - 120 * k)},60,${0.55 * (1 - k)})`;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * (0.3 + 0.7 * k), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,${0.8 * (1 - k)})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * (0.5 + 0.8 * k), 0, Math.PI * 2); ctx.stroke();
  }
  for (const p of sim.particles) {
    const life = Math.max(0, 1 - p.t / p.life);
    ctx.globalAlpha = p.dust ? life * 0.55 : life;
    ctx.fillStyle = p.color;
    if (p.rot !== undefined) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
      ctx.restore();
    } else ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  for (const p of sim.popups) {
    ctx.globalAlpha = Math.max(0, 1 - p.t / 1.2);
    ctx.font = `bold ${p.big ? 15 : 10}px ui-monospace, Menlo, monospace`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(p.text, p.x, p.y);
    ctx.fillStyle = p.big ? '#ffe36b' : '#ffffff';
    ctx.fillText(p.text, p.x, p.y);
  }
  ctx.globalAlpha = 1;

  // a marker when a bird flies above the top of the screen
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (sim.slowmo > 0) {
    // slow-mo letterbox on the last bug
    const k = Math.min(1, sim.slowmo * 3);
    ctx.fillStyle = 'rgba(10,12,24,0.55)';
    ctx.fillRect(0, 0, w, 14 * k);
    ctx.fillRect(0, h - 14 * k, w, 14 * k);
  }
  const top = GROUND_Y + GROUND_SHOW - h / cam.zoom;
  for (const f of sim.flyers) {
    if (f.dead || f.y > top) continue;
    const sx = (f.x - cam.x) * cam.zoom;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(sx - 7, 2, 14, 12);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(sx, 4); ctx.lineTo(sx - 4, 11); ctx.lineTo(sx + 4, 11); ctx.fill();
  }
}

export function birdName(n: BirdName) { return n.charAt(0).toUpperCase() + n.slice(1); }
