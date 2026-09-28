/** Bug Siege pixels. The world is painted at 16 px per unit into a small
 *  buffer and scaled up with nearest-neighbour, so every map, bug and tower
 *  is real chunky pixel art; crew sprites and numbers go on top at full res. */
import { sprite } from '../types';
import {
  BUGS, H, MAPS, PATH_HALF, TOWERS, W, geo, heroMax, posAt, stats, spotPos, HERO_XP,
  type BugKind, type Ev, type Kind, type State, type Theme, type Tower,
} from './logic';

export const PPU = 16;

// ---------------------------------------------------------------- images

const imgs = new Map<string, HTMLImageElement>();
export function img(src: string): HTMLImageElement {
  let i = imgs.get(src);
  if (!i) { i = new Image(); i.src = src; imgs.set(src, i); }
  return i;
}
const ready = (i: HTMLImageElement) => i.complete && i.naturalWidth > 0;

// ---------------------------------------------------------------- view

export interface View { w: number; h: number; dpr: number; k: number; bw: number; bh: number; ox: number; oy: number }
export function makeView(w: number, h: number, dpr: number): View {
  const S = Math.min(w / W, h / H);
  const k = S / PPU;
  const bw = Math.ceil(w / k), bh = Math.ceil(h / k);
  return { w, h, dpr, k, bw, bh, ox: Math.floor((bw - W * PPU) / 2), oy: Math.floor((bh - H * PPU) / 2) };
}
/** World units to CSS px. */
export const toScreen = (v: View, x: number, y: number): [number, number] => [(v.ox + x * PPU) * v.k, (v.oy + y * PPU) * v.k];
export const toWorld = (v: View, sx: number, sy: number): [number, number] => [(sx / v.k - v.ox) / PPU, (sy / v.k - v.oy) / PPU];
export const unitPx = (v: View) => PPU * v.k;

// ---------------------------------------------------------------- palettes

interface Pal { g: string[]; road: string[]; edge: string; deco: string[]; accent: string; sky: string }
export const PAL: Record<Theme, Pal> = {
  meadow: { g: ['#4f8a3a', '#5a9a42', '#46803a', '#63a449'], road: ['#d2ad72', '#c49f63', '#b38e55'], edge: '#7d6238', deco: ['#2f6b2c', '#3f8a35', '#ffd84a', '#f2f2f2', '#e86a8a'], accent: '#7bd66b', sky: '#2c5a26' },
  autumn: { g: ['#8f7a34', '#9c863b', '#846f2e', '#a8903f'], road: ['#c89a62', '#b98c55', '#a67c4a'], edge: '#6a4c2a', deco: ['#c8541e', '#e0842a', '#f2b33a', '#7a3a1a', '#5a3a1a'], accent: '#f2b33a', sky: '#5a4a1e' },
  swamp: { g: ['#3c5a3a', '#44643f', '#355236', '#4b6e45'], road: ['#7a6a48', '#6d5e3f', '#5f5236'], edge: '#3a3222', deco: ['#2c4f4a', '#3f7a6a', '#9ab85a', '#1f3a36', '#6fa0a0'], accent: '#9ab85a', sky: '#22382a' },
  desert: { g: ['#dcbc76', '#e4c681', '#d2b06b', '#e9cf8f'], road: ['#b48a52', '#a67e4a', '#977242'], edge: '#7a5a32', deco: ['#4f8a3a', '#3f7030', '#a08060', '#806048', '#e8d8a8'], accent: '#ffb347', sky: '#b8904e' },
  snow: { g: ['#e6eef4', '#dde8f0', '#eff4f8', '#d4e2ec'], road: ['#a9b9c8', '#9cadbe', '#8ea0b2'], edge: '#6f8296', deco: ['#2f5a4a', '#3f6f5a', '#ffffff', '#b8d8ec', '#6a8aa0'], accent: '#8ef0ff', sky: '#9fb6c8' },
  night: { g: ['#1f2a3a', '#233044', '#1b2533', '#28364a'], road: ['#3b4a5f', '#35435a', '#2f3c50'], edge: '#12192a', deco: ['#3a4a66', '#566a8a', '#5affa0', '#ff5a6a', '#5ab8ff'], accent: '#5affa0', sky: '#0e1420' },
};

// ---------------------------------------------------------------- terrain

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const terrainCache = new Map<string, HTMLCanvasElement>();

function roadStroke(c: CanvasRenderingContext2D, v: View, pts: Array<[number, number]>, width: number, color: string) {
  c.strokeStyle = color; c.lineWidth = width; c.lineJoin = 'round'; c.lineCap = 'round';
  c.beginPath();
  pts.forEach(([x, y], i) => { const px = v.ox + x * PPU, py = v.oy + y * PPU; if (i) c.lineTo(px, py); else c.moveTo(px, py); });
  c.stroke();
}

export function terrain(map: number, v: View): HTMLCanvasElement {
  const key = `${map}:${v.bw}x${v.bh}:${v.ox},${v.oy}`;
  const hit = terrainCache.get(key);
  if (hit) return hit;
  const m = MAPS[map], p = PAL[m.theme];
  const cv = document.createElement('canvas');
  cv.width = v.bw; cv.height = v.bh;
  const c = cv.getContext('2d')!;
  const r = rng(map * 7919 + 17);
  // ground: 4 px checker noise
  for (let y = 0; y < v.bh; y += 4) for (let x = 0; x < v.bw; x += 4) {
    const n = r();
    c.fillStyle = n < 0.62 ? p.g[0] : n < 0.84 ? p.g[1] : n < 0.95 ? p.g[2] : p.g[3];
    c.fillRect(x, y, 4, 4);
  }
  // soft patches
  for (let i = 0; i < 40; i++) {
    c.fillStyle = r() < 0.5 ? p.g[2] : p.g[3];
    const x = Math.floor(r() * v.bw / 4) * 4, y = Math.floor(r() * v.bh / 4) * 4, w = 8 + Math.floor(r() * 5) * 4;
    c.fillRect(x, y, w, 4); c.fillRect(x + 4, y - 4, w - 8, 12);
  }
  // theme water / features under the road
  if (m.theme === 'swamp') for (let i = 0; i < 9; i++) blob(c, r() * v.bw, r() * v.bh, 10 + r() * 16, '#2c4f5a', '#3f6f7a', r);
  if (m.theme === 'snow') for (let i = 0; i < 6; i++) blob(c, r() * v.bw, r() * v.bh, 8 + r() * 12, '#b8d8ec', '#d8ecf8', r);
  if (m.theme === 'night') {
    c.strokeStyle = '#2d3d56'; c.lineWidth = 1;
    for (let i = 0; i < 26; i++) { const x = Math.floor(r() * v.bw), y = Math.floor(r() * v.bh), l = 10 + Math.floor(r() * 30); c.beginPath(); c.moveTo(x + 0.5, y + 0.5); c.lineTo(x + l + 0.5, y + 0.5); c.lineTo(x + l + 0.5, y + l / 2 + 0.5); c.stroke(); c.fillStyle = '#3a5070'; c.fillRect(x + l - 1, y + l / 2 - 1, 3, 3); }
  }
  // road: dark edge, fill, lighter middle, pebbles
  const RW = PATH_HALF * 2 * PPU;
  for (const pts of m.paths) roadStroke(c, v, pts, RW + 4, p.edge);
  for (const pts of m.paths) roadStroke(c, v, pts, RW, p.road[1]);
  for (const pts of m.paths) roadStroke(c, v, pts, RW - 8, p.road[0]);
  for (let pi = 0; pi < m.paths.length; pi++) {
    const g = geo(map, pi);
    for (let d = 0; d < g.len; d += 0.35) {
      const [x, y, h] = posAt(g, d);
      const off = (r() - 0.5) * PATH_HALF * 1.6;
      const px = Math.round(v.ox + (x - Math.sin(h) * off) * PPU), py = Math.round(v.oy + (y + Math.cos(h) * off) * PPU);
      c.fillStyle = r() < 0.5 ? p.road[2] : p.road[0];
      c.fillRect(px, py, r() < 0.3 ? 2 : 1, 1);
      if (m.theme === 'night' && r() < 0.15) { c.fillStyle = '#4a6a8a'; c.fillRect(px, py, 2, 1); }
    }
  }
  // decorations away from road and pads
  const clear = (x: number, y: number, pad: number) => {
    for (let pi = 0; pi < m.paths.length; pi++) {
      const g = geo(map, pi);
      for (let d = 0; d < g.len; d += 0.3) { const [px, py] = posAt(g, d); if (Math.hypot(px - x, py - y) < PATH_HALF + pad) return false; }
    }
    return m.spots.every(([sx, sy]) => Math.hypot(sx - x, sy - y) > 1.1) && Math.hypot(m.hero[0] - x, m.hero[1] - y) > 0.5;
  };
  const decoN = 70;
  const decos: Array<[number, number, number]> = [];
  for (let i = 0; i < decoN * 4 && decos.length < decoN; i++) {
    const x = r() * (v.bw / PPU) - v.ox / PPU, y = r() * (v.bh / PPU) - v.oy / PPU;
    if (clear(x, y, 0.55)) decos.push([x, y, r()]);
  }
  decos.sort((a, b) => a[1] - b[1]);
  for (const [x, y, n] of decos) deco(c, m.theme, Math.round(v.ox + x * PPU), Math.round(v.oy + y * PPU), n, p);
  // entrances: dark burrows; exit: the repo
  for (const pts of m.paths) {
    const [ex, ey] = pts[0], [nx, ny] = pts[1];
    const a = Math.atan2(ny - ey, nx - ex);
    const bx = v.ox + (ex + Math.cos(a) * 1.2) * PPU, by = v.oy + (ey + Math.sin(a) * 1.2) * PPU;
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(bx, by, 11, 8, 0, 0, Math.PI * 2); c.fill();
  }
  const end = m.paths[0][m.paths[0].length - 1];
  const prev = m.paths[0][m.paths[0].length - 2];
  const ra = Math.atan2(end[1] - prev[1], end[0] - prev[0]);
  repo(c, Math.round(v.ox + (end[0] - Math.cos(ra) * 2.2) * PPU), Math.round(v.oy + (end[1] - Math.sin(ra) * 2.2) * PPU), m.theme);
  // build pads
  for (const [sx, sy] of m.spots) pad(c, Math.round(v.ox + sx * PPU), Math.round(v.oy + sy * PPU), m.theme);
  terrainCache.set(key, cv);
  if (terrainCache.size > 8) terrainCache.delete(terrainCache.keys().next().value!);
  return cv;
}

function blob(c: CanvasRenderingContext2D, x: number, y: number, r0: number, dark: string, light: string, r: () => number) {
  c.fillStyle = dark; c.beginPath(); c.ellipse(Math.round(x), Math.round(y), r0, r0 * 0.6, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = light; c.fillRect(Math.round(x - r0 / 3), Math.round(y - r0 * 0.2), Math.round(r0 / 2), 1);
  if (r() < 0.5) c.fillRect(Math.round(x + r0 / 5), Math.round(y + r0 * 0.1), Math.round(r0 / 3), 1);
}

function pad(c: CanvasRenderingContext2D, x: number, y: number, theme: Theme) {
  const stone = theme === 'night' ? ['#4a5a74', '#5d7090', '#2e3a4e'] : theme === 'snow' ? ['#9aa8b8', '#b8c6d4', '#6f7e90'] : ['#8a8478', '#a8a293', '#5f5a50'];
  c.fillStyle = 'rgba(0,0,0,0.28)'; c.beginPath(); c.ellipse(x, y + 3, 12, 6, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = stone[2]; c.beginPath(); c.ellipse(x, y + 1, 11, 6, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = stone[0]; c.beginPath(); c.ellipse(x, y, 10, 5, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = stone[1];
  c.fillRect(x - 6, y - 3, 4, 1); c.fillRect(x + 1, y - 4, 5, 1); c.fillRect(x - 8, y, 3, 1); c.fillRect(x + 4, y + 1, 4, 1);
  c.fillStyle = stone[2]; c.fillRect(x - 1, y - 5, 1, 10); c.fillRect(x - 10, y, 20, 1);
}

function repo(c: CanvasRenderingContext2D, x: number, y: number, theme: Theme) {
  // a little keep with a flag: the repo the bugs are after
  const wall = theme === 'night' ? '#56657e' : '#b8b0a0', dark = theme === 'night' ? '#35415a' : '#7d7568';
  c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(x - 13, y + 8, 28, 4);
  c.fillStyle = dark; c.fillRect(x - 13, y - 10, 26, 20);
  c.fillStyle = wall; c.fillRect(x - 12, y - 10, 24, 18);
  for (let i = 0; i < 4; i++) { c.fillStyle = wall; c.fillRect(x - 13 + i * 7, y - 14, 5, 4); }
  c.fillStyle = '#3a2a1a'; c.fillRect(x - 4, y - 2, 8, 10);
  c.fillStyle = '#ffd84a'; c.fillRect(x - 9, y - 6, 3, 3); c.fillRect(x + 6, y - 6, 3, 3);
  c.fillStyle = '#5a4a3a'; c.fillRect(x, y - 26, 1, 12);
  c.fillStyle = '#e8584a'; c.fillRect(x + 1, y - 26, 8, 5);
  c.fillStyle = '#fff'; c.fillRect(x + 3, y - 25, 3, 1);
}

function deco(c: CanvasRenderingContext2D, theme: Theme, x: number, y: number, n: number, p: Pal) {
  const shadow = () => { c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(x - 5, y + 1, 11, 2); };
  if (theme === 'meadow' || theme === 'autumn') {
    if (n < 0.35) { // tree
      shadow();
      c.fillStyle = '#5a3a1e'; c.fillRect(x - 1, y - 5, 3, 7);
      const leaf = theme === 'meadow' ? [p.deco[0], p.deco[1]] : [n < 0.17 ? p.deco[0] : p.deco[1], p.deco[2]];
      c.fillStyle = leaf[0]; c.fillRect(x - 6, y - 13, 13, 9); c.fillRect(x - 4, y - 16, 9, 3);
      c.fillStyle = leaf[1]; c.fillRect(x - 4, y - 14, 5, 3); c.fillRect(x - 5, y - 11, 3, 2);
    } else if (n < 0.7) { // flowers / leaves
      c.fillStyle = theme === 'meadow' ? (n < 0.5 ? p.deco[2] : p.deco[4]) : p.deco[3];
      c.fillRect(x, y, 2, 2); c.fillRect(x + 4, y + 2, 2, 2); c.fillStyle = p.deco[3]; c.fillRect(x + 2, y - 2, 1, 1);
    } else if (n < 0.85) { // rock
      c.fillStyle = '#6f6a60'; c.fillRect(x - 3, y - 2, 7, 4); c.fillStyle = '#9a948a'; c.fillRect(x - 2, y - 2, 3, 1);
    } else { // bush
      c.fillStyle = theme === 'meadow' ? '#3a7a30' : '#9a5a22'; c.fillRect(x - 4, y - 3, 9, 5); c.fillStyle = theme === 'meadow' ? '#4f9a3f' : '#c8742a'; c.fillRect(x - 3, y - 3, 4, 2);
    }
  } else if (theme === 'swamp') {
    if (n < 0.3) { // dead-ish tree with moss
      shadow(); c.fillStyle = '#4a3a2a'; c.fillRect(x - 1, y - 12, 3, 14); c.fillRect(x - 5, y - 9, 4, 2); c.fillRect(x + 2, y - 7, 4, 2);
      c.fillStyle = '#6f9a4a'; c.fillRect(x - 5, y - 8, 1, 4); c.fillRect(x + 5, y - 6, 1, 3);
    } else if (n < 0.65) { c.fillStyle = '#6f8a3a'; c.fillRect(x, y - 5, 1, 6); c.fillRect(x + 2, y - 7, 1, 8); c.fillStyle = '#5a3a1a'; c.fillRect(x + 2, y - 8, 1, 2); }
    else if (n < 0.8) { c.fillStyle = '#3f7a4a'; c.beginPath(); c.ellipse(x, y, 4, 2, 0, 0, Math.PI * 2); c.fill(); c.fillStyle = '#e86a8a'; c.fillRect(x, y - 1, 1, 1); }
    else { c.fillStyle = '#5a5a4a'; c.fillRect(x - 3, y - 2, 6, 3); }
  } else if (theme === 'desert') {
    if (n < 0.3) { // cactus
      shadow(); c.fillStyle = p.deco[1]; c.fillRect(x - 1, y - 12, 4, 14); c.fillRect(x - 5, y - 8, 3, 2); c.fillRect(x - 5, y - 11, 2, 4); c.fillRect(x + 4, y - 6, 3, 2); c.fillRect(x + 5, y - 9, 2, 4);
      c.fillStyle = p.deco[0]; c.fillRect(x, y - 11, 1, 12);
    } else if (n < 0.6) { c.fillStyle = p.deco[3]; c.fillRect(x - 4, y - 3, 9, 4); c.fillStyle = p.deco[2]; c.fillRect(x - 3, y - 3, 4, 1); }
    else if (n < 0.8) { c.fillStyle = '#c8a860'; c.fillRect(x - 6, y, 12, 1); c.fillRect(x - 3, y - 1, 6, 1); }
    else { c.fillStyle = p.deco[4]; c.fillRect(x - 2, y - 1, 5, 2); c.fillRect(x - 1, y - 2, 1, 1); }
  } else if (theme === 'snow') {
    if (n < 0.4) { // pine
      shadow(); c.fillStyle = '#4a3a2a'; c.fillRect(x, y - 3, 2, 4);
      c.fillStyle = p.deco[0]; c.fillRect(x - 5, y - 6, 12, 3); c.fillRect(x - 4, y - 10, 10, 4); c.fillRect(x - 2, y - 14, 6, 4); c.fillRect(x, y - 16, 2, 2);
      c.fillStyle = '#fff'; c.fillRect(x - 4, y - 7, 4, 1); c.fillRect(x - 2, y - 11, 3, 1); c.fillRect(x, y - 15, 2, 1);
    } else if (n < 0.7) { c.fillStyle = '#c8dcec'; c.fillRect(x - 4, y - 2, 9, 3); c.fillStyle = '#fff'; c.fillRect(x - 3, y - 3, 5, 1); }
    else { c.fillStyle = '#7f95a8'; c.fillRect(x - 3, y - 2, 6, 3); c.fillStyle = '#fff'; c.fillRect(x - 3, y - 3, 6, 1); }
  } else {
    if (n < 0.4) { // server rack
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(x - 5, y + 1, 12, 2);
      c.fillStyle = '#2a3548'; c.fillRect(x - 5, y - 16, 10, 17); c.fillStyle = '#3a4a64'; c.fillRect(x - 4, y - 15, 8, 15);
      for (let i = 0; i < 4; i++) { c.fillStyle = '#1a2230'; c.fillRect(x - 3, y - 13 + i * 4, 6, 2); c.fillStyle = [p.deco[2], p.deco[4], p.deco[3]][(i + Math.floor(n * 10)) % 3]; c.fillRect(x + 2, y - 13 + i * 4, 1, 1); }
    } else if (n < 0.7) { c.fillStyle = '#2d3d56'; c.fillRect(x - 3, y - 1, 7, 2); c.fillStyle = p.deco[4]; c.fillRect(x, y - 1, 1, 1); }
    else { c.fillStyle = '#3a4a66'; c.fillRect(x - 2, y - 4, 4, 5); c.fillStyle = p.deco[2]; c.fillRect(x - 1, y - 3, 1, 1); }
  }
}

// ---------------------------------------------------------------- towers

export function drawTower(c: CanvasRenderingContext2D, x: number, y: number, kind: Kind, level: number, spec: string | null, aim: number, t: number, grow = 1, kick = 0) {
  const sy = grow < 1 ? easeBack(grow) : 1;
  c.save();
  c.translate(x, y);
  c.scale(1, sy);
  const trim = level >= 4 ? '#ffd84a' : level === 3 ? '#e8e8e8' : level === 2 ? '#c8a060' : '#8a6a3a';
  if (kind === 'pecker') {
    c.fillStyle = '#5a3a1e'; c.fillRect(-7, -6, 14, 7);
    c.fillStyle = '#7a5230'; c.fillRect(-6, -14, 12, 9);
    c.fillStyle = '#3a2410'; c.fillRect(-2, -11, 4, 4);
    c.fillStyle = spec === 'talon' ? '#e0a15a' : '#4f9a3f'; c.fillRect(-8, -17, 16, 4); c.fillRect(-6, -19, 12, 2); c.fillRect(-3, -21, 6, 2);
    c.fillStyle = trim; c.fillRect(-7, -1, 14, 1);
    if (level >= 2) { c.fillStyle = trim; c.fillRect(-8, -13, 1, 7); c.fillRect(7, -13, 1, 7); }
    if (level >= 4) { c.fillStyle = spec === 'swarm' ? '#7bd66b' : '#e0a15a'; c.fillRect(8, -24, 1, 8); c.fillRect(9, -24, 4, 3); }
  } else if (kind === 'mortar') {
    c.fillStyle = '#6b5a45'; c.fillRect(-9, -7, 18, 8);
    c.fillStyle = '#8a7658'; c.fillRect(-8, -9, 16, 3);
    c.fillStyle = '#b89a6a'; for (let i = -7; i < 8; i += 3) c.fillRect(i, -10, 2, 1);
    // barrel follows aim
    const ax = Math.cos(aim), k = kick > 0 ? 1 : 0;
    c.fillStyle = spec === 'quake' ? '#6a6f8a' : '#c86a2a';
    c.fillRect(-3 + Math.round(ax * 2) - k, -15 + k, 6, 7);
    c.fillStyle = '#2a1a0a'; c.fillRect(-2 + Math.round(ax * 2) - k, -15 + k, 4, 2);
    c.fillStyle = '#f2ead8'; c.fillRect(-7, -9, 3, 3); c.fillRect(5, -9, 3, 3);
    c.fillStyle = trim; c.fillRect(-9, -1, 18, 1);
    if (level >= 3) { c.fillStyle = '#f2ead8'; c.fillRect(-1, -9, 3, 2); }
    if (level >= 4) { c.fillStyle = spec === 'cluster' ? '#ff9a3c' : '#9aa0ff'; c.fillRect(-10, -12, 2, 11); c.fillRect(8, -12, 2, 11); }
  } else if (kind === 'sniper') {
    c.fillStyle = '#5a4230'; c.fillRect(-5, -26, 2, 27); c.fillRect(3, -26, 2, 27);
    c.fillStyle = '#7a5a3a'; for (let i = -22; i < 0; i += 6) c.fillRect(-4, i, 8, 1);
    c.fillStyle = '#8a6a42'; c.fillRect(-7, -28, 14, 3);
    c.fillStyle = trim; c.fillRect(-7, -25, 14, 1);
    c.fillStyle = spec === 'piercer' ? '#6aa6ff' : '#c68cff'; c.fillRect(6, -34, 1, 8); c.fillRect(7, -34, 5, 3);
    if (level >= 2) { c.fillStyle = '#6a4a2e'; c.fillRect(-6, -2, 12, 3); }
    if (level >= 3) { c.fillStyle = '#c68cff'; c.fillRect(-8, -28, 1, 3); c.fillRect(7, -28, 1, 3); }
    if (level >= 4) { c.fillStyle = '#ffd84a'; c.fillRect(-1, -31, 2, 2); }
  } else {
    const glow = 0.5 + 0.5 * Math.sin(t * 3);
    c.fillStyle = '#4a5a6a'; c.fillRect(-7, -4, 14, 5);
    c.fillStyle = '#6a7a8a'; c.fillRect(-6, -5, 12, 2);
    c.fillStyle = spec === 'shatter' ? '#b88cff' : '#5ad0ff'; c.fillRect(-3, -20, 6, 16); c.fillRect(-5, -14, 2, 8); c.fillRect(3, -12, 2, 7);
    c.fillStyle = spec === 'shatter' ? '#e0c8ff' : '#c8f4ff'; c.fillRect(-2, -19, 2, 12); c.fillRect(-4, -13, 1, 5);
    c.fillStyle = `rgba(200,248,255,${0.35 + glow * 0.5})`; c.fillRect(-1, -23, 2, 2); c.fillRect(-4, -22, 1, 1); c.fillRect(3, -21, 1, 1);
    c.fillStyle = trim; c.fillRect(-7, 0, 14, 1);
    if (level >= 3) { c.fillStyle = '#c8f4ff'; c.fillRect(-8, -9, 1, 4); c.fillRect(7, -10, 1, 5); }
    if (level >= 4) { c.fillStyle = '#ffffff'; c.fillRect(-1, -26, 2, 1); c.fillRect(-2, -25, 4, 1); }
  }
  // level pips
  for (let i = 0; i < Math.min(level, 4); i++) { c.fillStyle = i === 3 ? '#ffd84a' : '#ffffff'; c.fillRect(-5 + i * 3, 3, 2, 2); }
  c.restore();
}
/** Where a tower's crew bird sits, in world units above the spot. */
export const crewLift = (kind: Kind) => (kind === 'sniper' ? 1.95 : kind === 'pecker' ? 1.3 : kind === 'mortar' ? 0.75 : 1.1);
const easeBack = (x: number) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

// ---------------------------------------------------------------- bugs

export function drawBug(c: CanvasRenderingContext2D, x: number, y: number, kind: BugKind, t: number, heading: number, flash: boolean, slowed: boolean) {
  const def = BUGS[kind];
  const sz = def.size * PPU;
  const leg = Math.floor(t * 12) % 2;
  const flip = Math.cos(heading) < -0.2 ? -1 : 1;
  const fly = def.fly;
  const lift = fly ? 7 + Math.sin(t * 6) * 1.5 : 0;
  c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(x, y + 2, sz * (fly ? 0.6 : 0.9), sz * 0.35, 0, 0, Math.PI * 2); c.fill();
  c.save(); c.translate(Math.round(x), Math.round(y - lift)); c.scale(flip, 1);
  const col = (a: string) => (flash ? '#ffffff' : a);
  switch (kind) {
    case 'mite':
      c.fillStyle = '#2a1a14'; for (let i = -1; i <= 1; i++) { c.fillRect(i * 3 - 1, 1 + (leg ^ (i & 1)), 1, 2); }
      c.fillStyle = col('#c8452f'); c.fillRect(-4, -4, 7, 6); c.fillRect(-3, -5, 5, 1);
      c.fillStyle = col('#1a1a1a'); c.fillRect(3, -3, 3, 4);
      c.fillStyle = '#ffd0c0'; c.fillRect(-2, -4, 2, 1); c.fillStyle = '#fff'; c.fillRect(5, -2, 1, 1);
      break;
    case 'moth': {
      const wing = Math.floor(t * 16) % 2 ? 4 : 2;
      c.fillStyle = col('#e8d8a0'); c.fillRect(-5, -4 - wing, 5, wing + 2); c.fillRect(-4, 0, 4, 2);
      c.fillStyle = col('#c8b070'); c.fillRect(-4, -3 - wing, 2, 1);
      c.fillStyle = col('#8a7040'); c.fillRect(-1, -3, 6, 4);
      c.fillStyle = '#1a1a1a'; c.fillRect(4, -3, 1, 1); c.fillStyle = '#8a7040'; c.fillRect(5, -6, 1, 3);
      break;
    }
    case 'beetle':
      c.fillStyle = '#10141a'; for (let i = -1; i <= 1; i++) c.fillRect(i * 3, 2 + (leg ^ (i & 1)), 1, 2);
      c.fillStyle = col('#1f4a5a'); c.fillRect(-6, -5, 10, 8); c.fillRect(-5, -6, 8, 1);
      c.fillStyle = col('#2f6f7a'); c.fillRect(-5, -5, 3, 2); c.fillStyle = '#0a1a20'; c.fillRect(-1, -5, 1, 8);
      c.fillStyle = col('#10202a'); c.fillRect(4, -3, 3, 4);
      c.fillStyle = '#9ad0e0'; c.fillRect(-4, -5, 1, 1);
      break;
    case 'gnat': {
      const wing = Math.floor(t * 24) % 2;
      c.fillStyle = 'rgba(220,240,255,0.8)'; c.fillRect(-3, -4 - wing * 2, 3, 2 + wing * 2); c.fillRect(1, -4 - wing * 2, 3, 2 + wing * 2);
      c.fillStyle = col('#3a3a4a'); c.fillRect(-2, -2, 5, 3); c.fillStyle = '#ff5a5a'; c.fillRect(3, -2, 1, 1);
      break;
    }
    case 'healer': {
      const p = 0.4 + 0.4 * Math.sin(t * 4);
      c.fillStyle = `rgba(120,255,140,${p * 0.35})`; c.beginPath(); c.arc(0, -1, 9, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#2a1a14'; for (let i = -1; i <= 1; i++) c.fillRect(i * 3, 2 + (leg ^ (i & 1)), 1, 2);
      c.fillStyle = col('#f2ece0'); c.fillRect(-5, -5, 9, 7); c.fillRect(-4, -6, 7, 1);
      c.fillStyle = '#3ac85a'; c.fillRect(-2, -5, 2, 6); c.fillRect(-4, -3, 6, 2);
      c.fillStyle = col('#c8b8a8'); c.fillRect(4, -3, 2, 3);
      break;
    }
    case 'stag':
      c.fillStyle = '#1a0e08'; for (let i = -2; i <= 1; i++) c.fillRect(i * 3, 3 + (leg ^ (i & 1)), 1, 2);
      c.fillStyle = col('#5a2a1a'); c.fillRect(-8, -7, 13, 10); c.fillRect(-7, -8, 11, 1);
      c.fillStyle = col('#7a3a24'); c.fillRect(-7, -7, 4, 2); c.fillStyle = '#2a120a'; c.fillRect(-2, -7, 1, 10);
      c.fillStyle = col('#3a1a10'); c.fillRect(5, -5, 4, 5);
      c.fillStyle = col('#c89a5a'); c.fillRect(8, -8, 1, 4); c.fillRect(9, -9, 2, 1); c.fillRect(8, 0, 1, 3); c.fillRect(9, 2, 2, 1);
      c.fillStyle = '#ffcc66'; c.fillRect(7, -4, 1, 1);
      break;
    case 'leak': case 'blob': {
      const s = kind === 'leak' ? 1 : 0.42;
      const wob = Math.sin(t * 5) * 1.2;
      c.scale(s, s);
      c.fillStyle = col('#6a2a9a'); c.beginPath(); c.ellipse(0, -8, 14 + wob, 12 - wob, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = col('#9a4ad0'); c.beginPath(); c.ellipse(-3, -11, 9, 6, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = col('#c88af0'); c.fillRect(-7, -16, 4, 2);
      c.fillStyle = '#fff'; c.fillRect(2, -12, 4, 4); c.fillRect(-4, -12, 4, 4);
      c.fillStyle = '#1a0a2a'; c.fillRect(4, -11, 2, 2); c.fillRect(-2, -11, 2, 2);
      c.fillStyle = col('#6a2a9a'); c.fillRect(-10, 1, 3, 3 + Math.floor(t * 3) % 3); c.fillRect(8, 2, 2, 2 + Math.floor(t * 4) % 3);
      if (kind === 'leak') { c.fillStyle = '#ffd84a'; c.fillRect(-6, -22, 12, 2); c.fillRect(-6, -25, 2, 3); c.fillRect(-1, -26, 2, 4); c.fillRect(4, -25, 2, 3); }
      break;
    }
  }
  c.restore();
  if (slowed) { c.fillStyle = 'rgba(160,236,255,0.9)'; c.fillRect(Math.round(x - 4), Math.round(y - lift - sz - 2), 1, 1); c.fillRect(Math.round(x + 3), Math.round(y - lift - sz), 1, 1); c.fillRect(Math.round(x), Math.round(y - lift - sz - 4), 1, 1); }
}

// ---------------------------------------------------------------- fx

export interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; kind: 'sq' | 'ring' | 'text' | 'beam' | 'coin'; text?: string; x2?: number; y2?: number; r?: number }
export interface Fx { parts: Particle[]; shake: number; flash: number }
export const newFx = (): Fx => ({ parts: [], shake: 0, flash: 0 });

export function burst(fx: Fx, x: number, y: number, n: number, colors: string[], speed = 3, size = 2, life = 0.5) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.8);
    fx.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, life: life * (0.6 + Math.random() * 0.6), max: life, color: colors[i % colors.length], size, kind: 'sq' });
  }
}
const BUG_COLOR: Record<BugKind, string[]> = {
  mite: ['#c8452f', '#1a1a1a'], moth: ['#e8d8a0', '#8a7040'], beetle: ['#1f4a5a', '#2f6f7a'], gnat: ['#3a3a4a', '#dcefff'],
  healer: ['#f2ece0', '#3ac85a'], stag: ['#5a2a1a', '#c89a5a'], leak: ['#6a2a9a', '#c88af0'], blob: ['#9a4ad0', '#6a2a9a'],
};

/** Turn sim events into particles and shake. */
export function applyEvents(fx: Fx, evs: Ev[], reduced: boolean) {
  const shake = (n: number) => { if (!reduced) fx.shake = Math.max(fx.shake, n); };
  for (const e of evs) {
    switch (e.t) {
      case 'build': case 'upgrade':
        burst(fx, e.x, e.y, 14, ['#c8b090', '#8a7a60', '#ffffff'], 3, 2, 0.5);
        fx.parts.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0.4, max: 0.4, color: '#ffffff', size: 1, kind: 'ring', r: 1.2 });
        break;
      case 'sell': fx.parts.push({ x: e.x, y: e.y - 1, vx: 0, vy: -1.2, life: 0.9, max: 0.9, color: '#ffd84a', size: 14, kind: 'text', text: `+${e.coins}` }); burst(fx, e.x, e.y, 10, ['#8a7a60'], 2); break;
      case 'hit': if (Math.random() < 0.5) burst(fx, e.x, e.y - 0.2, 2, [e.color], 1.5, 1, 0.25); break;
      case 'snipe': fx.parts.push({ x: e.x, y: e.y, x2: e.x2, y2: e.y2, vx: 0, vy: 0, life: 0.18, max: 0.18, color: e.crit ? '#ffe45c' : '#e8c8ff', size: e.crit ? 2 : 1, kind: 'beam' }); if (e.crit) fx.parts.push({ x: e.x2, y: e.y2 - 0.8, vx: 0, vy: -1.5, life: 0.7, max: 0.7, color: '#ffe45c', size: 13, kind: 'text', text: 'CRIT' }); break;
      case 'boom':
        burst(fx, e.x, e.y, 16, ['#ffb347', '#ff6a2a', '#fff2c0', '#6a5a4a'], 4, 2, 0.45);
        fx.parts.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0.3, max: 0.3, color: e.stun ? '#9aa0ff' : '#ffd08a', size: 2, kind: 'ring', r: e.r });
        shake(2.5);
        break;
      case 'pulse': fx.parts.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0.5, max: 0.5, color: '#bff6ff', size: 2, kind: 'ring', r: e.r }); break;
      case 'kill':
        burst(fx, e.x, e.y - 0.2, 10, [...BUG_COLOR[e.kind], '#ffffff'], 3, 2, 0.45);
        fx.parts.push({ x: e.x, y: e.y - 0.1, vx: 0, vy: 0, life: 0.3, max: 0.3, color: '#ffffff', size: 1, kind: 'ring', r: 0.5 });
        fx.parts.push({ x: e.x, y: e.y - 0.6, vx: (Math.random() - 0.5) * 0.8, vy: -2.4, life: 0.8, max: 0.8, color: '#ffd84a', size: 12, kind: 'coin', text: `+${e.coins}` });
        break;
      case 'split': burst(fx, e.x, e.y, 30, ['#6a2a9a', '#c88af0', '#ffffff'], 5, 3, 0.8); shake(7); break;
      case 'bossdown': fx.flash = 0.35; shake(9); break;
      case 'leak': fx.flash = Math.max(fx.flash, 0.2); shake(4); break;
      case 'levelup': fx.parts.push({ x: e.x, y: e.y - 1.4, vx: 0, vy: -0.8, life: 1.2, max: 1.2, color: '#7bd66b', size: 14, kind: 'text', text: `LEVEL ${e.level}` }); burst(fx, e.x, e.y, 16, ['#ffd84a', '#7bd66b'], 3, 2, 0.8); break;
      case 'ability': fx.parts.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0.55, max: 0.55, color: '#ffd84a', size: 3, kind: 'ring', r: e.r }); burst(fx, e.x, e.y, 26, ['#ffd84a', '#ffffff', '#ff9a3c'], 5, 2, 0.6); shake(5); break;
      case 'herodown': burst(fx, e.x, e.y, 18, ['#ffffff', '#c8c8c8'], 3, 2, 0.8); break;
      case 'won': burst(fx, W / 2, H / 2, 60, ['#ffd84a', '#7bd66b', '#8ef0ff', '#ff9a3c'], 8, 3, 1.4); break;
      default: break;
    }
  }
}

export function tickFx(fx: Fx, dt: number) {
  for (const p of fx.parts) {
    p.life -= dt;
    if (p.kind === 'sq') { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 6 * dt; }
    else if (p.kind === 'text' || p.kind === 'coin') { p.x += p.vx * dt; p.y += p.vy * dt; p.vy *= 0.94; }
  }
  fx.parts = fx.parts.filter((p) => p.life > 0);
  if (fx.parts.length > 500) fx.parts.splice(0, fx.parts.length - 500);
  fx.shake = Math.max(0, fx.shake - dt * 20);
  fx.flash = Math.max(0, fx.flash - dt);
}

// ---------------------------------------------------------------- frame

export interface Scene {
  selected: number; // spot index, or -1
  heroCrew: string;
  tutorialSpot: number; // pad to pulse, or -1
  heroTarget: [number, number] | null;
  reduced: boolean;
}

let buf: HTMLCanvasElement | null = null;

export function draw(ctx: CanvasRenderingContext2D, s: State, v: View, fx: Fx, sc: Scene, t: number) {
  if (!buf) buf = document.createElement('canvas');
  if (buf.width !== v.bw || buf.height !== v.bh) { buf.width = v.bw; buf.height = v.bh; }
  const b = buf.getContext('2d')!;
  b.imageSmoothingEnabled = false;
  const m = MAPS[s.map];
  const X = (x: number) => Math.round(v.ox + x * PPU), Y = (y: number) => Math.round(v.oy + y * PPU);
  b.drawImage(terrain(s.map, v), 0, 0);
  // night: blinking LEDs over the racks feel alive
  if (m.theme === 'night' && Math.floor(t * 2) % 2) { b.fillStyle = 'rgba(90,255,160,0.08)'; b.fillRect(0, 0, v.bw, v.bh); }
  // pads: tutorial pulse and selection
  m.spots.forEach(([x, y], i) => {
    if (i === sc.tutorialSpot || i === sc.selected) {
      const a = 0.5 + 0.5 * Math.sin(t * 6);
      b.strokeStyle = i === sc.selected ? '#ffffff' : `rgba(255,216,74,${0.4 + a * 0.6})`;
      b.lineWidth = 1; b.beginPath(); b.ellipse(X(x), Y(y), 12 + (i === sc.selected ? 0 : a * 2), 6.5 + (i === sc.selected ? 0 : a), 0, 0, Math.PI * 2); b.stroke();
    }
  });
  // selected tower range
  const selT = sc.selected >= 0 ? s.towers.find((tw) => tw.spot === sc.selected) : null;
  if (selT) {
    const [x, y] = spotPos(s.map, selT.spot), r = stats(selT).range * PPU;
    b.fillStyle = 'rgba(255,255,255,0.1)'; b.beginPath(); b.ellipse(X(x), Y(y), r, r, 0, 0, Math.PI * 2); b.fill();
    b.strokeStyle = 'rgba(255,255,255,0.55)'; b.setLineDash([3, 3]); b.stroke(); b.setLineDash([]);
  }
  // hero target flag
  if (sc.heroTarget) { const [hx, hy] = sc.heroTarget; b.fillStyle = '#ffd84a'; b.fillRect(X(hx), Y(hy) - 8, 1, 8); b.fillRect(X(hx) + 1, Y(hy) - 8, 4, 3); }
  // depth-sorted: towers and bugs
  type D = { y: number; f: () => void };
  const items: D[] = [];
  for (const tw of s.towers) {
    const [x, y] = spotPos(s.map, tw.spot);
    items.push({ y, f: () => drawTower(b, X(x), Y(y), tw.kind, tw.level, tw.spec, tw.aim, t, tw.built, tw.kick) });
  }
  for (const bug of s.bugs) {
    items.push({ y: bug.y + (BUGS[bug.kind].fly ? 0.6 : 0), f: () => {
      drawBug(b, X(bug.x), Y(bug.y), bug.kind, t + bug.id * 0.37, bug.heading, bug.flash > 0, bug.slowT > 0);
      const def = BUGS[bug.kind];
      if (bug.hp < bug.max) {
        const w = def.boss ? 26 : 10, lift = (def.fly ? 7 : 0) + def.size * PPU * (def.boss ? 2.2 : 1.6) + 3;
        const bx = X(bug.x) - w / 2, by = Y(bug.y) - lift;
        b.fillStyle = '#1a0a0a'; b.fillRect(bx - 1, by - 1, w + 2, 3);
        b.fillStyle = bug.ampT > 0 ? '#c88af0' : '#e8423a'; b.fillRect(bx, by, w, 1);
        b.fillStyle = '#7bd66b'; b.fillRect(bx, by, Math.max(1, Math.round((w * bug.hp) / bug.max)), 1);
      }
    } });
  }
  items.sort((a, c) => a.y - c.y);
  for (const it of items) it.f();
  // shots
  for (const sh of s.shots) {
    if (sh.kind === 'shell') {
      const f = Math.min(1, sh.t / sh.dur), arc = Math.sin(f * Math.PI) * 2.2;
      b.fillStyle = 'rgba(0,0,0,0.3)'; b.fillRect(X(sh.x) - 1, Y(sh.y), 3, 1);
      b.fillStyle = '#f2ead8'; b.fillRect(X(sh.x) - 2, Y(sh.y - arc) - 2, 4, 5); b.fillStyle = '#c8b898'; b.fillRect(X(sh.x) + 1, Y(sh.y - arc), 1, 2);
    } else if (sh.kind === 'frost') {
      b.fillStyle = 'rgba(142,240,255,0.5)'; b.fillRect(X(sh.x - (sh.tx - sh.x) * 0.05) - 1, Y(sh.y) - 1, 3, 3);
      b.fillStyle = '#e8fcff'; b.fillRect(X(sh.x) - 1, Y(sh.y) - 2, 2, 4); b.fillRect(X(sh.x) - 2, Y(sh.y) - 1, 4, 2);
    } else {
      const a = Math.atan2(sh.ty - sh.y, sh.tx - sh.x);
      b.fillStyle = 'rgba(183,255,154,0.45)'; b.fillRect(X(sh.x - Math.cos(a) * 0.25), Y(sh.y - Math.sin(a) * 0.25), 2, 2);
      b.fillStyle = '#f2ffe8'; b.fillRect(X(sh.x), Y(sh.y), 2, 2);
    }
  }
  // particles on the pixel layer
  for (const p of fx.parts) {
    const a = Math.max(0, p.life / p.max);
    if (p.kind === 'sq') { b.globalAlpha = Math.min(1, a * 1.5); b.fillStyle = p.color; b.fillRect(X(p.x), Y(p.y), p.size, p.size); }
    else if (p.kind === 'ring') { b.globalAlpha = a; b.strokeStyle = p.color; b.lineWidth = p.size; const rr = (p.r ?? 1) * PPU * (1 - a * 0.6); b.beginPath(); b.ellipse(X(p.x), Y(p.y), rr, rr * 0.75, 0, 0, Math.PI * 2); b.stroke(); }
    else if (p.kind === 'beam') { b.globalAlpha = a; b.strokeStyle = p.color; b.lineWidth = p.size; b.beginPath(); b.moveTo(X(p.x), Y(p.y)); b.lineTo(X(p.x2!), Y(p.y2!)); b.stroke(); }
  }
  b.globalAlpha = 1;
  // ---- up to the screen
  const d = v.dpr;
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const sx = fx.shake > 0 ? (Math.random() - 0.5) * fx.shake : 0, sy = fx.shake > 0 ? (Math.random() - 0.5) * fx.shake : 0;
  ctx.fillStyle = PAL[m.theme].sky; ctx.fillRect(0, 0, v.w, v.h);
  ctx.drawImage(buf, 0, 0, v.bw, v.bh, sx, sy, v.bw * v.k, v.bh * v.k);
  ctx.translate(sx, sy);
  const U = unitPx(v);
  const scr = (x: number, y: number) => toScreen(v, x, y);
  // crew on towers
  for (const tw of s.towers) {
    const def = TOWERS[tw.kind];
    const crew = tw.spec ? def.specs.find((x) => x.id === tw.spec)!.crew : def.crew;
    const [x, y] = spotPos(s.map, tw.spot);
    const im = img(sprite(crew, tw.kick > 0 ? 'cheer' : 'idle'));
    if (!ready(im) || tw.built < 0.6) continue;
    const size = U * 0.95, [px, py] = scr(x, y - crewLift(tw.kind));
    const face = Math.cos(tw.aim) < 0 ? -1 : 1;
    ctx.save(); ctx.translate(px, py); ctx.scale(face, 1);
    ctx.drawImage(im, -size / 2, -size * 0.85 + (tw.kick > 0 ? -U * 0.08 : 0), size, size);
    ctx.restore();
  }
  // hero
  const h = s.hero;
  if (h.dead <= 0) {
    const im = img(sprite(sc.heroCrew, h.engaged >= 0 ? (h.swing > 0 ? 'cheer' : 'hold') : Math.hypot(h.tx - h.x, h.ty - h.y) > 0.05 ? 'side' : 'idle'));
    const [px, py] = scr(h.x, h.y);
    const size = U * 1.25, bob = Math.sin(t * 8) * U * 0.04;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(px, py + U * 0.05, U * 0.4, U * 0.14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,216,74,0.9)'; ctx.beginPath(); ctx.ellipse(px, py + U * 0.05, U * 0.42, U * 0.16, 0, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,216,74,0.8)'; ctx.stroke();
    if (ready(im)) {
      ctx.save(); ctx.translate(px + (h.swing > 0 ? h.face * U * 0.12 : 0), py + bob); ctx.scale(h.face, 1);
      ctx.drawImage(im, -size / 2, -size * 0.92, size, size); ctx.restore();
    }
    const bw = U * 0.9, hy = py - size - 6;
    ctx.fillStyle = '#1a0a0a'; ctx.fillRect(px - bw / 2 - 1, hy - 1, bw + 2, 5);
    ctx.fillStyle = '#e8423a'; ctx.fillRect(px - bw / 2, hy, bw, 3);
    ctx.fillStyle = '#7bd66b'; ctx.fillRect(px - bw / 2, hy, (bw * h.hp) / heroMax(h.level), 3);
    ctx.fillStyle = '#ffd84a'; ctx.font = `700 ${Math.max(9, Math.round(U * 0.36))}px ui-monospace, Menlo, monospace`; ctx.textAlign = 'center';
    ctx.fillText(`${h.level}`, px - bw / 2 - 7, hy + 4);
    if (h.level < HERO_XP.length) { ctx.fillStyle = '#5ab8ff'; ctx.fillRect(px - bw / 2, hy + 4, (bw * (h.xp - HERO_XP[h.level - 1])) / (HERO_XP[h.level] - HERO_XP[h.level - 1]), 1.5); }
  } else {
    const [px, py] = scr(MAPS[s.map].hero[0], MAPS[s.map].hero[1]);
    ctx.globalAlpha = 0.5; ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.round(U * 0.4)}px ui-monospace, Menlo, monospace`; ctx.textAlign = 'center';
    ctx.fillText(`${Math.ceil(h.dead)}`, px, py); ctx.globalAlpha = 1;
  }
  // floating text
  for (const p of fx.parts) {
    if (p.kind !== 'text' && p.kind !== 'coin') continue;
    const a = Math.min(1, (p.life / p.max) * 2);
    const [px, py] = scr(p.x, p.y);
    ctx.globalAlpha = a;
    ctx.font = `800 ${p.size}px ui-monospace, Menlo, monospace`; ctx.textAlign = 'center';
    if (p.kind === 'coin') { ctx.fillStyle = '#b8860b'; ctx.beginPath(); ctx.arc(px - 12, py - 4, 5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#ffd84a'; ctx.beginPath(); ctx.arc(px - 12, py - 4, 3.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#1a1206'; ctx.fillText(p.text ?? '', px + 1, py + 1);
    ctx.fillStyle = p.color; ctx.fillText(p.text ?? '', px, py);
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(d, 0, 0, d, 0, 0);
  if (fx.flash > 0) { ctx.fillStyle = `rgba(255,80,60,${fx.flash * 0.5})`; ctx.fillRect(0, 0, v.w, v.h); }
}

// ---------------------------------------------------------------- icons

/** A tower or bug drawn into a small canvas, for menus and the briefing. */
export function icon(cv: HTMLCanvasElement, what: { tower?: Kind; spec?: string | null; level?: number; bug?: BugKind }, css: number) {
  const px = what.tower ? 32 : what.bug === 'leak' || what.bug === 'stag' ? 26 : 18, dpr = Math.min(3, window.devicePixelRatio || 1);
  const low = document.createElement('canvas'); low.width = px; low.height = px;
  const c = low.getContext('2d')!;
  if (what.tower) drawTower(c, 16, 27, what.tower, what.level ?? 1, what.spec ?? null, 0, 0);
  if (what.bug) drawBug(c, px / 2, what.bug === 'leak' ? 24 : px * 0.66 + (BUGS[what.bug].fly ? 5 : 0), what.bug, 0.2, 0, false, false);
  cv.width = css * dpr; cv.height = css * dpr; cv.style.width = cv.style.height = `${css}px`;
  const o = cv.getContext('2d')!;
  o.imageSmoothingEnabled = false;
  o.drawImage(low, 0, 0, px, px, 0, 0, css * dpr, css * dpr);
  if (what.tower && (what.level ?? 1) < 4) {
    const def = TOWERS[what.tower];
    const im = img(sprite(def.crew));
    const put = () => { const s = css * dpr * 0.46; o.drawImage(im, css * dpr - s, 0, s, s); };
    if (ready(im)) put(); else im.addEventListener('load', put, { once: true });
  }
}
export { heroMax };
export type { Tower };
