/** Crew Kart drawing, Mode 7 style: each track is painted once into a
 *  palette-snapped bitmap (one texel = PX world px) that the ground renderer
 *  samples per scanline; the sky is a pre-rendered parallax strip; karts,
 *  boxes and scenery are pixel billboards scaled by depth. */
import { sprite } from '../types';
import { HW, N, buildTrack, type ItemKind, type Kart, type Race, type Track } from './logic';

export const PX = 2;
export const TILE = 16;

interface Theme {
  bg: [string, string];
  dots: string[];
  road: string;
  roadDot: string;
  kerb: [string, string];
  line: string | null;
  sky: [string, string];
  far: string;
  near: string;
}
export const THEMES: Record<string, Theme> = {
  garden: { bg: ['#5f9e3c', '#6aab45'], dots: ['#f3a6c8', '#f7e06a', '#ffffff', '#3d7a2c'], road: '#b89a6a', roadDot: '#a3865a', kerb: ['#efe8d6', '#c9523d'], line: null, sky: ['#5fb4ef', '#cdeefc'], far: '#7fa6c9', near: '#3f7f2e' },
  server: { bg: ['#1f2633', '#252e3e'], dots: ['#46e08a', '#e8b04a', '#4aa3ff', '#11151c'], road: '#3a4454', roadDot: '#333c4b', kerb: ['#f2c84b', '#1b1f27'], line: '#5b6a80', sky: ['#0b0f17', '#1d2a3c'], far: '#141a26', near: '#0d1119' },
  beach: { bg: ['#2f8fc4', '#379bd0'], dots: ['#bfe6f5', '#e9d49a', '#dcc284', '#f0a0a0'], road: '#a8744a', roadDot: '#8e5f3a', kerb: ['#ffffff', '#e05a4a'], line: null, sky: ['#ffb46b', '#ffe6b0'], far: '#2a74a8', near: '#d9bf7a' },
  city: { bg: ['#151a2e', '#1a2038'], dots: ['#f5d76e', '#6ea8f5', '#232a45', '#2d3656'], road: '#2c3040', roadDot: '#262a38', kerb: ['#ff5fa2', '#4ff0ff'], line: '#f5d76e', sky: ['#05060f', '#2a1f4a'], far: '#1a1733', near: '#0c0d1c' },
};

export const KART_COLOR: Record<string, string> = {
  pip: '#e8b04a', ollie: '#4a7fe8', bram: '#8b5a3c', wren: '#c9523d', moss: '#5f9e3c', fig: '#9b59b6',
  nell: '#e05a9a', juno: '#f28c28', rue: '#3cb3a0', bly: '#6ea8f5', tuck: '#d4c04a', otto: '#8a8f99',
};

export const hash = (x: number, y: number, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export const hex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

const bitmaps = new Map<string, HTMLCanvasElement>();
export function trackBitmap(id: string): HTMLCanvasElement {
  const hit = bitmaps.get(id);
  if (hit) return hit;
  const tr = buildTrack(id);
  const th = THEMES[id] ?? THEMES.garden;
  const W = Math.ceil(tr.w / PX), H = Math.ceil(tr.h / PX);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  // Ground tiles (4x4 pixels = 16 world px).
  const T = TILE / PX;
  for (let ty = 0; ty < H; ty += T) for (let tx = 0; tx < W; tx += T) {
    g.fillStyle = th.bg[((tx + ty) / T) % 2];
    g.fillRect(tx, ty, T, T);
  }
  const path = () => {
    g.beginPath();
    g.moveTo(tr.s[0].x / PX, tr.s[0].y / PX);
    for (const p of tr.s) g.lineTo(p.x / PX, p.y / PX);
    g.closePath();
  };
  g.lineJoin = 'round'; g.lineCap = 'round';
  // Scenery.
  if (id === 'beach') {
    g.strokeStyle = th.dots[1]; g.lineWidth = (HW * 2 + 200) / PX; path(); g.stroke();
    g.strokeStyle = th.dots[2]; g.lineWidth = (HW * 2 + 90) / PX; path(); g.stroke();
  }
  g.save(); g.scale(4 / PX, 4 / PX);
  if (id === 'city') {
    for (let by = 2; by < H; by += 22) for (let bx = 2; bx < W; bx += 26) {
      const bw = 14 + Math.floor(hash(bx, by, 1) * 8), bh = 12 + Math.floor(hash(bx, by, 2) * 8);
      g.fillStyle = th.dots[2 + Math.floor(hash(bx, by, 3) * 2)];
      g.fillRect(bx, by, bw, bh);
      for (let wy = by + 2; wy < by + bh - 2; wy += 3) for (let wx = bx + 2; wx < bx + bw - 2; wx += 3) {
        const v = hash(wx, wy, 4);
        if (v < 0.35) { g.fillStyle = v < 0.25 ? th.dots[0] : th.dots[1]; g.fillRect(wx, wy, 1, 1); }
      }
    }
  }
  if (id === 'server') {
    for (let by = 3; by < H; by += 16) for (let bx = 3; bx < W; bx += 9) {
      if (hash(bx, by, 5) < 0.3) continue;
      g.fillStyle = th.dots[3];
      g.fillRect(bx, by, 6, 12);
      for (let ly = by + 1; ly < by + 11; ly += 2) {
        g.fillStyle = th.dots[Math.floor(hash(bx, ly, 6) * 3)];
        g.fillRect(bx + 1 + Math.floor(hash(ly, bx, 7) * 4), ly, 1, 1);
      }
    }
  }
  g.restore();
  // Kerbs, road, centre line.
  g.strokeStyle = th.kerb[0]; g.lineWidth = (HW * 2 + 16) / PX; path(); g.stroke();
  g.setLineDash([24 / PX, 24 / PX]); g.lineCap = 'butt';
  g.strokeStyle = th.kerb[1]; path(); g.stroke();
  g.setLineDash([]); g.lineCap = 'round';
  g.strokeStyle = th.road; g.lineWidth = (HW * 2) / PX; path(); g.stroke();
  if (th.line) { g.setLineDash([20 / PX, 24 / PX]); g.strokeStyle = th.line; g.lineWidth = 4 / PX; path(); g.stroke(); g.setLineDash([]); }
  // Snap every pixel to the palette: crisp edges, no blur.
  const pal = [...th.bg, ...th.dots, th.road, th.roadDot, ...th.kerb, ...(th.line ? [th.line] : []), '#111111', '#ffffff'].map(hex);
  const img = g.getImageData(0, 0, W, H), d = img.data;
  const road = hex(th.road);
  for (let i = 0; i < d.length; i += 4) {
    let best = 0, bd = Infinity;
    for (let k = 0; k < pal.length; k++) {
      const q = pal[k], e = (d[i] - q[0]) ** 2 + (d[i + 1] - q[1]) ** 2 + (d[i + 2] - q[2]) ** 2;
      if (e < bd) { bd = e; best = k; }
    }
    let q = pal[best];
    const px = (i / 4) % W, py = Math.floor(i / 4 / W);
    if (q === road || (q[0] === road[0] && q[1] === road[1] && q[2] === road[2])) {
      if (hash(px, py, 8) < 0.07) q = hex(th.roadDot);
    } else if (q === pal[0] || q === pal[1]) {
      // Ground speckles: flowers, foam, blinkenlights, stars.
      const v = hash(px, py, 9);
      if (v < 0.02) q = hex(th.dots[0]);
      else if (v < 0.035) q = hex(th.dots[1]);
    }
    d[i] = q[0]; d[i + 1] = q[1]; d[i + 2] = q[2]; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // Start line: a chequer across the road.
  const p = tr.s[0], t = tr.t[0];
  const q = 12, qs = Math.ceil(q / PX) + 1;
  for (let a = -HW; a < HW; a += q) for (let row = 0; row < 2; row++) {
    const x = p.x - t.y * (a + q / 2) + t.x * (row * q - q / 2), y = p.y + t.x * (a + q / 2) + t.y * (row * q - q / 2);
    g.fillStyle = (Math.round((a + HW) / q) + row) % 2 ? '#111111' : '#ffffff';
    g.fillRect(Math.round(x / PX - qs / 2), Math.round(y / PX - qs / 2), qs, qs);
  }
  bitmaps.set(id, c);
  return c;
}

const imgs = new Map<string, HTMLImageElement>();
export function img(src: string) {
  let i = imgs.get(src);
  if (!i) { i = new Image(); i.src = src; imgs.set(src, i); }
  return i;
}
export const driverImg = (name: string, pose = 'idle') => img(sprite(name, pose));

export function drawItemIcon(g: CanvasRenderingContext2D, it: ItemKind, x: number, y: number, s: number) {
  const u = s / 12;
  const r = (a: number, b: number, w: number, h: number, c: string) => { g.fillStyle = c; g.fillRect(x + a * u, y + b * u, w * u, h * u); };
  if (it === 'feather') {
    for (let i = 0; i < 8; i++) r(2 + i, 9 - i, 2, 2, '#ffffff');
    for (let i = 0; i < 6; i++) r(4 + i, 5 - i, 2, 3, '#dfe8f5');
    r(1, 10, 2, 1, '#8b5a3c');
  } else if (it === 'shell') {
    r(3, 3, 6, 7, '#c9954a'); r(4, 2, 4, 1, '#c9954a'); r(4, 10, 4, 1, '#a0702e');
    r(5, 3, 1, 7, '#8b5a2c'); r(4, 4, 1, 2, '#f0d49a');
  } else if (it === 'oil') {
    r(5, 1, 2, 2, '#26262e'); r(4, 3, 4, 2, '#26262e'); r(3, 5, 6, 5, '#26262e'); r(4, 10, 4, 1, '#26262e');
    r(4, 6, 1, 2, '#8a7aff');
  } else {
    r(3, 1, 6, 1, '#6ec8ff'); r(2, 2, 8, 1, '#6ec8ff'); r(2, 3, 8, 5, '#3a8fd6'); r(3, 8, 6, 2, '#3a8fd6'); r(5, 10, 2, 1, '#3a8fd6');
    r(4, 3, 2, 4, '#bfe6ff');
  }
}

export function drawMinimap(g: CanvasRenderingContext2D, tr: Track, r: Race, ghost: { x: number; y: number } | null, x0: number, y0: number, mw: number, mh: number) {
  const k = Math.min(mw / tr.w, mh / tr.h);
  const ox = x0 + (mw - tr.w * k) / 2, oy = y0 + (mh - tr.h * k) / 2;
  g.fillStyle = 'rgba(10,12,20,0.45)';
  g.fillRect(x0 - 4, y0 - 4, mw + 8, mh + 8);
  g.strokeStyle = 'rgba(255,255,255,0.8)';
  g.lineWidth = 3;
  g.beginPath();
  for (let i = 0; i <= N; i += 4) { const p = tr.s[i % N]; i ? g.lineTo(ox + p.x * k, oy + p.y * k) : g.moveTo(ox + p.x * k, oy + p.y * k); }
  g.closePath();
  g.stroke();
  const s0 = tr.s[0];
  g.fillStyle = '#111'; g.fillRect(ox + s0.x * k - 2, oy + s0.y * k - 2, 4, 4);
  if (ghost) { g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.arc(ox + ghost.x * k, oy + ghost.y * k, 3, 0, Math.PI * 2); g.fill(); }
  for (const kt of [...r.karts].reverse()) {
    g.fillStyle = KART_COLOR[kt.name] ?? '#ccc';
    const s = kt.id === 0 ? 4 : 3;
    if (kt.id === 0) { g.fillStyle = '#fff'; g.fillRect(ox + kt.x * k - s - 1, oy + kt.y * k - s - 1, s * 2 + 2, s * 2 + 2); g.fillStyle = KART_COLOR[kt.name] ?? '#ccc'; }
    g.fillRect(ox + kt.x * k - s, oy + kt.y * k - s, s * 2, s * 2);
  }
}

export const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
export const fmtT = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
export type { Kart };
