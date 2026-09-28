/** Bug Siege pixel drawing: a cached board layer, then bugs, crew towers,
 *  shots and effects on top each frame. Units are tiles; `v.tile` px each. */
import { sprite } from '../types';
import {
  BUGS, COLS, MAPS, ROWS, TOWERS, geo, pathTiles, posAt, repoAt, spotPos, towerAt,
  type Bug, type State, type TowerKind,
} from './logic';

export interface View { tile: number; ox: number; oy: number; w: number; h: number; dpr: number }
export interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; g?: number }
export interface FloatText { x: number; y: number; text: string; life: number; color: string }
export interface Line { pts: number[]; life: number; color: string; width: number }
export interface Ring { x: number; y: number; r: number; life: number; max: number; color: string }
export interface Fx { parts: Particle[]; texts: FloatText[]; lines: Line[]; rings: Ring[]; shake: number; repoHit: number }
export const newFx = (): Fx => ({ parts: [], texts: [], lines: [], rings: [], shake: 0, repoHit: 0 });

export interface Ui { spot: number | null; preview: TowerKind | null; time: number; reduced: boolean }

const imgs = new Map<string, HTMLImageElement>();
export function img(src: string): HTMLImageElement {
  let i = imgs.get(src);
  if (!i) { i = new Image(); i.src = src; imgs.set(src, i); }
  return i;
}

// ---- board layer ----
let boardKey = '';
let board: HTMLCanvasElement | null = null;
function hash(a: number, b: number) { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); }

function drawBoard(m: number, v: View): HTMLCanvasElement {
  const key = `${m}:${v.tile}:${v.dpr}`;
  if (board && boardKey === key) return board;
  const T = v.tile;
  const c = document.createElement('canvas');
  c.width = Math.ceil(COLS * T * v.dpr); c.height = Math.ceil(ROWS * T * v.dpr);
  const g = c.getContext('2d')!;
  g.scale(v.dpr, v.dpr);
  g.imageSmoothingEnabled = false;
  const map = MAPS[m];
  const road = pathTiles(m);
  const p = Math.max(1, Math.round(T / 12)); // one "pixel"
  for (let r = 0; r < ROWS; r++) for (let col = 0; col < COLS; col++) {
    const x = col * T, y = r * T;
    const onRoad = road.has(`${col},${r}`);
    if (onRoad) {
      g.fillStyle = (col + r) % 2 ? '#8a6a45' : '#846441';
      g.fillRect(x, y, T, T);
      for (let i = 0; i < 5; i++) {
        g.fillStyle = hash(col * 7 + i, r) > 0.5 ? '#9c7b52' : '#6f5236';
        g.fillRect(x + Math.floor(hash(col, r + i) * (T - p * 2)), y + Math.floor(hash(col + i, r) * (T - p * 2)), p * 2, p);
      }
    } else {
      g.fillStyle = map.tint;
      g.fillRect(x, y, T, T);
      g.fillStyle = 'rgba(255,255,255,0.035)';
      if ((col + r) % 2) g.fillRect(x, y, T, T);
      for (let i = 0; i < 3; i++) {
        const hx = x + Math.floor(hash(col + i * 3, r) * (T - p * 3)), hy = y + Math.floor(hash(col, r + i * 5) * (T - p * 3));
        g.fillStyle = 'rgba(160,220,120,0.25)';
        g.fillRect(hx, hy + p, p, p * 2); g.fillRect(hx + p * 2, hy, p, p * 3);
      }
      if (hash(col * 3, r * 7) > 0.9) { // a little flower / rock
        g.fillStyle = hash(col, r) > 0.5 ? '#f2d16b' : '#b8b8c8';
        g.fillRect(x + T * 0.6, y + T * 0.3, p * 2, p * 2);
      }
    }
  }
  // road edges
  g.fillStyle = 'rgba(0,0,0,0.22)';
  for (const k of road) {
    const [col, r] = k.split(',').map(Number);
    const x = col * T, y = r * T;
    if (!road.has(`${col},${r - 1}`)) g.fillRect(x, y, T, p);
    if (!road.has(`${col},${r + 1}`)) g.fillRect(x, y + T - p, T, p);
    if (!road.has(`${col - 1},${r}`) && col > 0) g.fillRect(x, y, p, T);
    if (!road.has(`${col + 1},${r}`) && col < COLS - 1) g.fillRect(x + T - p, y, p, T);
  }
  // build pads
  map.spots.forEach(([col, r]) => {
    const x = col * T + T * 0.1, y = r * T + T * 0.1, s = T * 0.8;
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + p, y + p * 2, s, s);
    g.fillStyle = '#8d8f9c'; g.fillRect(x, y, s, s);
    g.fillStyle = '#a9abb8'; g.fillRect(x, y, s, p * 2);
    g.fillStyle = '#6d6f7c'; g.fillRect(x, y + s - p * 2, s, p * 2);
    g.fillStyle = '#7b7d8a';
    g.fillRect(x + s / 2 - p / 2, y + p * 2, p, s - p * 4);
    g.fillRect(x + p * 2, y + s / 2 - p / 2, s - p * 4, p);
  });
  board = c; boardKey = key;
  return c;
}

// ---- bugs ----
function drawBug(g: CanvasRenderingContext2D, b: Bug, T: number, t: number, m: number) {
  const def = BUGS[b.kind];
  const s = def.size * T * 1.35;
  const p = Math.max(1, s / 8);
  const px = b.x * T, py = b.y * T;
  const phase = t * 10 + b.id;
  g.save();
  g.translate(px, py);
  // shadow
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.beginPath(); g.ellipse(0, s * 0.55, s * 0.55, s * 0.18, 0, 0, Math.PI * 2); g.fill();
  const rect = (x: number, y: number, w: number, h: number, c: string) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h)); };
  switch (b.kind) {
    case 'moth': {
      const flap = Math.abs(Math.sin(phase * 1.6));
      g.translate(0, -s * 0.2 + Math.sin(phase) * p);
      for (const side of [-1, 1]) {
        const ww = s * (0.35 + 0.55 * flap);
        g.fillStyle = '#d9ccb4';
        g.beginPath(); g.moveTo(side * p, -s * 0.35); g.lineTo(side * (p + ww), -s * 0.55); g.lineTo(side * (p + ww * 0.8), s * 0.05); g.lineTo(side * p, s * 0.1); g.fill();
        g.fillStyle = '#b8a888';
        g.beginPath(); g.moveTo(side * p, s * 0.05); g.lineTo(side * (p + ww * 0.6), s * 0.15); g.lineTo(side * (p + ww * 0.4), s * 0.45); g.lineTo(side * p, s * 0.3); g.fill();
        rect(side > 0 ? p + ww * 0.45 : -p - ww * 0.45 - p * 2, -s * 0.3, p * 2, p * 2, '#7a6a55');
      }
      rect(-p * 1.5, -s * 0.5, p * 3, s, '#5c4a3a');
      rect(-p * 2, -s * 0.7, p, p * 2, '#5c4a3a'); rect(p, -s * 0.7, p, p * 2, '#5c4a3a');
      break;
    }
    case 'beetle': case 'stag': {
      const gg = geo(m, b.path), [ax, ay] = posAt(gg, b.d + 0.05);
      g.rotate(Math.atan2(ay - b.y, ax - b.x) + Math.PI / 2);
      const leg = Math.sin(phase * 1.5) > 0 ? p : -p;
      const shell = b.kind === 'stag' ? '#7a3a22' : '#2f6e4a', hi = b.kind === 'stag' ? '#a8563a' : '#4fa06f';
      for (let i = -1; i <= 1; i++) { rect(-s * 0.7, i * s * 0.3 + (i % 2 ? leg : -leg), s * 1.4, p, '#1d1d24'); }
      rect(-s * 0.5, -s * 0.5, s, s, shell);
      rect(-s * 0.5, -s * 0.5, s, p * 1.5, hi);
      rect(-p / 2, -s * 0.5, p, s, 'rgba(0,0,0,0.3)');
      rect(-s * 0.3, -s * 0.8, s * 0.6, s * 0.35, '#1d1d24');
      if (b.kind === 'stag') {
        rect(-s * 0.45, -s * 1.15, p * 1.5, s * 0.45, '#caa070'); rect(s * 0.45 - p * 1.5, -s * 1.15, p * 1.5, s * 0.45, '#caa070');
        rect(-s * 0.45, -s * 1.15, p * 3, p * 1.5, '#caa070'); rect(s * 0.45 - p * 3, -s * 1.15, p * 3, p * 1.5, '#caa070');
      }
      rect(-s * 0.2, -s * 0.7, p, p, '#ffe070'); rect(s * 0.2 - p, -s * 0.7, p, p, '#ffe070');
      break;
    }
    case 'glitch': {
      const cols = ['#ff3cf0', '#3cf6ff', '#e8ff3c', '#ffffff'];
      for (let i = 0; i < 4; i++) {
        const jx = (hash(b.id, Math.floor(t * 12) + i) - 0.5) * s, jy = (hash(Math.floor(t * 12) + i, b.id) - 0.5) * s;
        rect(jx - p * 1.5, jy - p * 1.5, p * 3, p * 3, cols[(i + Math.floor(t * 8)) % 4]);
      }
      break;
    }
    case 'blob': case 'drip': case 'leak': {
      const sq = Math.sin(phase * 0.8) * 0.12;
      const w = s * (1 + sq), h = s * (1 - sq);
      const body = b.kind === 'leak' ? '#b54cff' : b.kind === 'blob' ? '#c070ff' : '#d99bff';
      g.fillStyle = body;
      g.beginPath(); g.ellipse(0, s * 0.5 - h * 0.5, w * 0.6, h * 0.55, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(-w * 0.3, s * 0.5 - h * 0.9, w * 0.2, p * 1.5);
      rect(-w * 0.22, s * 0.5 - h * 0.6, p * 1.5, p * 2, '#1a0f24'); rect(w * 0.12, s * 0.5 - h * 0.6, p * 1.5, p * 2, '#1a0f24');
      if (b.kind === 'leak') {
        // dripping bytes
        for (let i = 0; i < 5; i++) {
          const k = (t * 1.3 + i * 0.37) % 1;
          rect(-w * 0.5 + i * w * 0.25, s * 0.5 - h * 0.2 + k * s * 0.5, p * 1.5, p * 1.5, `rgba(214,120,255,${1 - k})`);
        }
        // crown of hex
        g.fillStyle = '#ffe45c';
        g.font = `bold ${Math.round(p * 5)}px monospace`;
        g.textAlign = 'center';
        g.fillText('0xFF', 0, s * 0.5 - h * 1.15);
      }
      break;
    }
  }
  if (b.flash > 0) { g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.ellipse(0, 0, s * 0.6, s * 0.6, 0, 0, Math.PI * 2); g.fill(); }
  g.restore();
  if (b.slowT > 0) { g.fillStyle = 'rgba(140,230,255,0.35)'; g.fillRect(px - s * 0.6, py - s * 0.6, s * 1.2, s * 1.2); }
  if (b.hp < b.max) {
    const bw = Math.max(T * 0.5, s * 1.4), by = py - s - p * 4;
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(px - bw / 2 - 1, by - 1, bw + 2, p * 1.5 + 2);
    const f = Math.max(0, b.hp / b.max);
    g.fillStyle = f > 0.5 ? '#6ee06e' : f > 0.25 ? '#f2c230' : '#ff5a4a';
    g.fillRect(px - bw / 2, by, bw * f, p * 1.5);
  }
}

// ---- towers ----
function drawCrew(g: CanvasRenderingContext2D, kind: TowerKind, x: number, y: number, T: number, opts: { alpha?: number; kick?: number; flip?: boolean; level?: number; bob?: number; pose?: string }) {
  const im = img(sprite(kind, opts.pose ?? 'idle'));
  const kick = opts.kick ?? 0;
  const sw = T * (1.05 + kick * 0.9), sh = T * (1.05 - kick * 0.9);
  g.save();
  g.globalAlpha = opts.alpha ?? 1;
  g.translate(x, y + T * 0.3 + (opts.bob ?? 0));
  if (opts.flip) g.scale(-1, 1);
  if (im.complete && im.naturalWidth) g.drawImage(im, -sw / 2, -sh, sw, sh);
  else { g.fillStyle = TOWERS[kind].color; g.fillRect(-T * 0.3, -T * 0.6, T * 0.6, T * 0.6); }
  g.restore();
  if (opts.level !== undefined) {
    const p = Math.max(2, T / 10);
    for (let i = 0; i <= opts.level; i++) {
      g.fillStyle = '#1a1a1a'; g.fillRect(x - T * 0.35 + i * p * 1.6 - 1, y + T * 0.28 - 1, p + 2, p + 2);
      g.fillStyle = i === 2 ? '#ffe45c' : TOWERS[kind].color; g.fillRect(x - T * 0.35 + i * p * 1.6, y + T * 0.28, p, p);
    }
  }
}

function drawRepo(g: CanvasRenderingContext2D, m: number, T: number, t: number, hit: number, lives: number) {
  const [c, r] = repoAt(m);
  const x = c * T + T * 0.08, y = r * T - T * 0.35, w = T * 0.84, h = T * 1.2;
  const pulse = 0.5 + 0.5 * Math.sin(t * 3);
  const glow = g.createRadialGradient(x + w / 2, y + h / 2, 2, x + w / 2, y + h / 2, T * 1.3);
  glow.addColorStop(0, hit > 0 ? `rgba(255,80,80,${0.6 * hit + 0.2})` : `rgba(120,220,255,${0.25 + pulse * 0.2})`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glow; g.fillRect(x - T, y - T, w + T * 2, h + T * 2);
  g.fillStyle = '#20232e'; g.fillRect(x, y, w, h);
  g.fillStyle = '#2d3140'; g.fillRect(x, y, w, T * 0.08);
  const p = Math.max(1, T / 14);
  for (let i = 0; i < 4; i++) {
    const ly = y + T * 0.2 + i * h * 0.2;
    g.fillStyle = '#3a3f52'; g.fillRect(x + p * 2, ly, w - p * 4, h * 0.14);
    const on = (Math.floor(t * 4 + i * 1.7) % 3) !== 0;
    g.fillStyle = lives > 5 ? (on ? '#6ee06e' : '#2e6a2e') : (on ? '#ff5a4a' : '#6a2e2e');
    g.fillRect(x + w - p * 5, ly + p, p * 2, p * 2);
    g.fillStyle = '#7fd8ff'; g.fillRect(x + p * 4, ly + p, (w * 0.4) * (0.4 + 0.6 * hash(i, Math.floor(t * 2))), p);
  }
}

export function draw(g: CanvasRenderingContext2D, s: State, v: View, fx: Fx, ui: Ui) {
  const T = v.tile, t = ui.time;
  g.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#12141b'; g.fillRect(0, 0, v.w, v.h);
  const sh = ui.reduced ? 0 : fx.shake;
  g.translate(v.ox + (sh ? (Math.random() - 0.5) * sh * T * 0.3 : 0), v.oy + (sh ? (Math.random() - 0.5) * sh * T * 0.3 : 0));
  g.drawImage(drawBoard(s.map, v), 0, 0, COLS * T, ROWS * T);

  // entrance arrows before the first wave
  if (s.wave === 0) {
    MAPS[s.map].paths.forEach((_, i) => {
      const gg = geo(s.map, i);
      for (let k = 0; k < 4; k++) {
        const d = ((t * 1.5 + k * 1.2) % 4.8) + 0.6;
        const [x, y] = posAt(gg, d), [x2, y2] = posAt(gg, d + 0.1);
        g.save(); g.translate(x * T, y * T); g.rotate(Math.atan2(y2 - y, x2 - x));
        g.fillStyle = `rgba(255,228,92,${0.7 - d / 8})`;
        g.beginPath(); g.moveTo(T * 0.18, 0); g.lineTo(-T * 0.1, -T * 0.14); g.lineTo(-T * 0.1, T * 0.14); g.fill();
        g.restore();
      }
    });
  }

  drawRepo(g, s.map, T, t, fx.repoHit, s.lives);

  // selection ring / range
  if (ui.spot !== null) {
    const [x, y] = spotPos(s.map, ui.spot);
    const tw = towerAt(s, ui.spot);
    const kind = tw?.kind ?? ui.preview;
    if (kind) {
      const L = TOWERS[kind].levels[tw ? tw.level : 0];
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1.5;
      g.setLineDash([T * 0.15, T * 0.1]);
      g.beginPath(); g.arc(x * T, y * T, L.range * T, 0, Math.PI * 2); g.fill(); g.stroke();
      g.setLineDash([]);
    }
    g.strokeStyle = '#ffe45c'; g.lineWidth = 2;
    const pz = 1 + Math.sin(t * 6) * 0.04;
    g.strokeRect((x - 0.45 * pz) * T, (y - 0.45 * pz) * T, 0.9 * pz * T, 0.9 * pz * T);
  }

  // towers (row order so lower ones overlap)
  const towers = [...s.towers].sort((a, b) => spotPos(s.map, a.spot)[1] - spotPos(s.map, b.spot)[1]);
  for (const tw of towers) {
    const [x, y] = spotPos(s.map, tw.spot);
    if (tw.level === 2) {
      g.fillStyle = `rgba(255,228,92,${0.15 + 0.1 * Math.sin(t * 4 + tw.spot)})`;
      g.beginPath(); g.arc(x * T, y * T, T * 0.5, 0, Math.PI * 2); g.fill();
    }
    drawCrew(g, tw.kind, x * T, y * T, T, { kick: ui.reduced ? 0 : tw.kick, flip: Math.cos(tw.aim) < 0, level: tw.level, pose: tw.kick > 0.05 ? 'cheer' : 'idle' });
  }
  // see-through placement preview
  if (ui.spot !== null && ui.preview && !towerAt(s, ui.spot)) {
    const [x, y] = spotPos(s.map, ui.spot);
    g.save(); g.shadowColor = '#fff'; g.shadowBlur = 12;
    drawCrew(g, ui.preview, x * T, y * T, T, { alpha: 0.45, bob: Math.sin(t * 4) * T * 0.05 });
    g.restore();
  }

  // bugs (sorted by y)
  const bugs = [...s.bugs].sort((a, b) => a.y - b.y);
  for (const b of bugs) if (b.d > 0.05) drawBug(g, b, T, t, s.map);

  // shots
  for (const sh of s.shots) {
    const c = TOWERS[sh.kind].color, x = sh.x * T, y = sh.y * T;
    const r = sh.kind === 'bram' ? T * 0.14 : sh.kind === 'ollie' ? T * 0.11 : T * 0.07;
    g.fillStyle = c; g.shadowColor = c; g.shadowBlur = 6;
    g.fillRect(x - r, y - r, r * 2, r * 2);
    g.shadowBlur = 0;
    g.fillStyle = '#fff'; g.fillRect(x - r / 3, y - r / 3, r * 0.66, r * 0.66);
  }

  // lines (lightning, sniper tracers)
  for (const l of fx.lines) {
    g.strokeStyle = l.color; g.globalAlpha = Math.min(1, l.life * 6); g.lineWidth = l.width;
    g.shadowColor = l.color; g.shadowBlur = 8;
    g.beginPath();
    for (let i = 0; i < l.pts.length; i += 2) {
      const x = l.pts[i] * T, y = l.pts[i + 1] * T;
      if (i === 0) g.moveTo(x, y);
      else {
        if (l.width < 3) { // jagged lightning
          const px = l.pts[i - 2] * T, py = l.pts[i - 1] * T;
          g.lineTo((px + x) / 2 + (Math.random() - 0.5) * T * 0.3, (py + y) / 2 + (Math.random() - 0.5) * T * 0.3);
        }
        g.lineTo(x, y);
      }
    }
    g.stroke();
    g.shadowBlur = 0; g.globalAlpha = 1;
  }
  for (const r of fx.rings) {
    const k = 1 - r.life / r.max;
    g.strokeStyle = r.color; g.globalAlpha = 1 - k; g.lineWidth = Math.max(1, T * 0.08 * (1 - k));
    g.beginPath(); g.arc(r.x * T, r.y * T, r.r * T * (0.3 + 0.7 * k), 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1;
  }
  for (const p of fx.parts) {
    g.globalAlpha = Math.max(0, p.life / p.max);
    g.fillStyle = p.color;
    const z = p.size * T;
    g.fillRect(p.x * T - z / 2, p.y * T - z / 2, z, z);
  }
  g.globalAlpha = 1;
  g.textAlign = 'center';
  g.font = `bold ${Math.round(T * 0.3)}px monospace`;
  for (const f of fx.texts) {
    g.globalAlpha = Math.min(1, f.life * 2);
    g.fillStyle = '#000'; g.fillText(f.text, f.x * T + 1, f.y * T + 1);
    g.fillStyle = f.color; g.fillText(f.text, f.x * T, f.y * T);
  }
  g.globalAlpha = 1;
  // leak vignette
  if (fx.repoHit > 0) {
    g.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    g.strokeStyle = `rgba(255,60,60,${fx.repoHit * 0.6})`; g.lineWidth = 10;
    g.strokeRect(0, 0, v.w, v.h);
  }
}

/** Advance effects by real seconds (effects keep the game's speed-up). */
export function tickFx(fx: Fx, dt: number) {
  for (const p of fx.parts) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.g ?? 0) * dt; }
  fx.parts = fx.parts.filter((p) => p.life > 0).slice(-400);
  for (const f of fx.texts) { f.life -= dt; f.y -= dt * 0.6; }
  fx.texts = fx.texts.filter((f) => f.life > 0);
  for (const l of fx.lines) l.life -= dt;
  fx.lines = fx.lines.filter((l) => l.life > 0);
  for (const r of fx.rings) r.life -= dt;
  fx.rings = fx.rings.filter((r) => r.life > 0);
  fx.shake = Math.max(0, fx.shake - dt * 3);
  fx.repoHit = Math.max(0, fx.repoHit - dt * 1.5);
}

export function burst(fx: Fx, x: number, y: number, color: string, n: number, speed = 2, size = 0.07) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.8);
    fx.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.5, life: 0.5 + Math.random() * 0.4, max: 0.9, color, size, g: 4 });
  }
}
