/** Crew Kart, Mode 7 scene: the ground sampled per scanline into a small
 *  ImageData, a parallax sky strip one full turn wide, and pixel billboards
 *  (karts from behind, item boxes, trackside props) scaled by depth. */
import { PX, THEMES, TILE, hash, hex, trackBitmap } from './render';
import { rowStart, type Cam7 } from './mode7';

export interface Tex { w: number; h: number; data: Uint32Array; bg0: number; bg1: number }
const texes = new Map<string, Tex>();
const packed = (c: string) => { const [r, g, b] = hex(c); return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0; };

/** The track bitmap as packed pixels, ready to sample. */
export function texture(id: string): Tex {
  const hit = texes.get(id);
  if (hit) return hit;
  const c = trackBitmap(id);
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
  const th = THEMES[id] ?? THEMES.garden;
  const t: Tex = { w: c.width, h: c.height, data: new Uint32Array(d.data.buffer), bg0: packed(th.bg[0]), bg1: packed(th.bg[1]) };
  texes.set(id, t);
  return t;
}

/** Paint the ground: one affine walk per scanline, no allocations. */
export function drawGround(buf: Uint32Array, c: Cam7, tex: Tex) {
  const { W, H } = c;
  const top = Math.max(0, Math.floor(c.hor) + 1);
  const tw = tex.w, th = tex.h, td = tex.data, inv = 1 / PX, tinv = 1 / TILE;
  for (let row = top; row < H; row++) {
    const r = rowStart(c, row);
    let wx = r.x, wy = r.y;
    const sx = r.dx, sy = r.dy;
    let o = row * W;
    for (let col = 0; col < W; col++, o++) {
      const tx = (wx * inv) | 0, ty = (wy * inv) | 0;
      if (wx >= 0 && wy >= 0 && tx < tw && ty < th) buf[o] = td[ty * tw + tx];
      else buf[o] = ((Math.floor(wx * tinv) + Math.floor(wy * tinv)) & 1) ? tex.bg1 : tex.bg0;
      wx += sx; wy += sy;
    }
  }
}

/** The backdrop: strips exactly one full turn wide (2*pi*f px) so the far
 *  range turns in lock-step with the ground; the near layer is drawn at the
 *  same rate but lower, the clouds drift slower for parallax. */
const strips = new Map<string, { far: HTMLCanvasElement; near: HTMLCanvasElement; w: number }>();
function skyStrips(id: string, f: number, hor: number) {
  const key = `${id}:${Math.round(f)}:${hor}`;
  const hit = strips.get(key);
  if (hit) return hit;
  const th = THEMES[id] ?? THEMES.garden;
  const w = Math.round(Math.PI * 2 * f);
  const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = hor + 1; return c; };
  const far = mk(), near = mk();
  const gf = far.getContext('2d')!, gn = near.getContext('2d')!;
  const ridge = (x: number, seed: number, amp: number, base: number) => {
    const u = (x / w) * Math.PI * 2;
    return base - amp * (0.5 * Math.sin(u * 3 + seed) + 0.3 * Math.sin(u * 7 + seed * 2) + 0.2 * Math.sin(u * 13 + seed * 3));
  };
  if (id === 'city') {
    let x = 0;
    while (x < w - 12) {
      const bw = 10 + Math.floor(hash(x, 1, 3) * 16), bh = 10 + Math.floor(hash(x, 2, 3) * hor * 0.5);
      gf.fillStyle = th.far; gf.fillRect(x, hor - bh, bw, bh + 1);
      for (let wy = hor - bh + 2; wy < hor - 1; wy += 3) for (let wx = x + 2; wx < x + bw - 1; wx += 3) {
        const v = hash(wx, wy, 5);
        if (v < 0.3) { gf.fillStyle = v < 0.22 ? '#f5d76e' : '#6ea8f5'; gf.fillRect(wx, wy, 1, 1); }
      }
      x += bw + (hash(x, 3, 3) < 0.3 ? 3 : 0);
    }
    for (let i = 0; i < 50; i++) { gn.fillStyle = hash(i, 7, 7) < 0.5 ? '#ff5fa2' : '#4ff0ff'; gn.fillRect(Math.floor(hash(i, 8, 7) * w), hor - 1, 3, 1); }
  } else if (id === 'server') {
    for (let x = 0; x < w - 12; x += 14) {
      const bh = Math.floor(hor * (0.45 + 0.2 * hash(x, 0, 2)));
      gf.fillStyle = th.far; gf.fillRect(x, hor - bh, 12, bh + 1);
      for (let ly = hor - bh + 3; ly < hor - 2; ly += 3) {
        const v = hash(x, ly, 4);
        gf.fillStyle = v < 0.4 ? '#46e08a' : v < 0.55 ? '#e8b04a' : v < 0.7 ? '#4aa3ff' : '#20283a';
        gf.fillRect(x + 2 + Math.floor(hash(ly, x, 1) * 7), ly, 2, 1);
      }
    }
    gn.fillStyle = th.near;
    for (let x = 0; x < w; x++) { const y = Math.round(hor - 3 - 3 * Math.abs(Math.sin((x / w) * Math.PI * 40))); gn.fillRect(x, y, 1, hor - y + 1); }
  } else {
    gf.fillStyle = th.far;
    for (let x = 0; x < w; x++) { const y = Math.round(ridge(x, 1.3, hor * (id === 'beach' ? 0.08 : 0.3), hor * (id === 'beach' ? 0.9 : 0.62))); gf.fillRect(x, y, 1, hor - y + 1); }
    if (id === 'garden') {
      gf.fillStyle = '#eef4fa';
      for (let x = 0; x < w; x++) { const y = Math.round(ridge(x, 1.3, hor * 0.3, hor * 0.62)); if (y < hor * 0.45) gf.fillRect(x, y, 1, 2); }
    }
    gn.fillStyle = th.near;
    for (let x = 0; x < w; x++) { const y = Math.round(ridge(x, 4.1, hor * 0.1, hor * 0.92)); gn.fillRect(x, y, 1, hor - y + 1); }
    for (let i = 0; i < (id === 'garden' ? 70 : 28); i++) {
      const x = Math.floor(hash(i, 1, 11) * (w - 8)) + 4, y = Math.round(ridge(x, 4.1, hor * 0.1, hor * 0.92));
      if (id === 'garden') {
        gn.fillStyle = '#2f6a22'; gn.fillRect(x - 3, y - 6, 7, 5); gn.fillRect(x - 2, y - 8, 5, 8);
        gn.fillStyle = '#5aa840'; gn.fillRect(x - 1, y - 7, 2, 2);
      } else {
        gn.fillStyle = '#7a5230'; gn.fillRect(x, y - 10, 1, 10);
        gn.fillStyle = '#2f7a3a'; gn.fillRect(x - 4, y - 11, 9, 1); gn.fillRect(x - 3, y - 12, 7, 1); gn.fillRect(x - 5, y - 10, 2, 1); gn.fillRect(x + 4, y - 10, 2, 1);
      }
    }
  }
  const out = { far, near, w };
  strips.set(key, out);
  return out;
}

const wrapMod = (v: number, m: number) => ((v % m) + m) % m;

export function drawSky(g: CanvasRenderingContext2D, id: string, c: Cam7, t: number) {
  const th = THEMES[id] ?? THEMES.garden;
  const hor = Math.floor(c.hor);
  const grad = g.createLinearGradient(0, 0, 0, hor);
  grad.addColorStop(0, th.sky[0]); grad.addColorStop(1, th.sky[1]);
  g.fillStyle = grad; g.fillRect(0, 0, c.W, hor + 1);
  const turn = Math.PI * 2 * c.f;
  const pan = (-c.a / (Math.PI * 2)) * turn;
  if (id === 'city' || id === 'server') {
    for (let i = 0; i < 60; i++) {
      const x = wrapMod(hash(i, 1, 21) * turn + pan * 0.5, turn), y = Math.floor(hash(i, 2, 21) * hor * 0.7);
      if (x > c.W) continue;
      g.fillStyle = Math.sin(t * 2 + i) > 0.6 ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.85)';
      g.fillRect(Math.floor(x), y, 1, 1);
    }
    if (id === 'city') { const mx = wrapMod(pan * 0.5 + c.W * 0.3, turn); g.fillStyle = '#f2eed8'; g.fillRect(mx - 5, hor * 0.18, 10, 10); g.fillRect(mx - 6, hor * 0.18 + 2, 12, 6); g.fillStyle = '#c9c4ab'; g.fillRect(mx - 2, hor * 0.18 + 3, 2, 2); }
  } else {
    const sx = wrapMod(pan + c.W * 0.7, turn);
    g.fillStyle = id === 'beach' ? '#fff3c4' : '#fffbe0';
    g.fillRect(sx - 6, hor * 0.2 - 6, 12, 12); g.fillRect(sx - 8, hor * 0.2 - 4, 16, 8);
    g.fillStyle = 'rgba(255,255,255,0.92)';
    for (let i = 0; i < 6; i++) {
      const cx = wrapMod(hash(i, 4, 22) * turn + pan * 0.6 + t * 3, turn) - 30, cy = Math.floor(hor * (0.12 + 0.4 * hash(i, 5, 22)));
      if (cx > c.W) continue;
      g.fillRect(cx, cy, 24, 4); g.fillRect(cx + 4, cy - 3, 13, 3); g.fillRect(cx + 8, cy - 5, 6, 2);
    }
  }
  const s = skyStrips(id, c.f, hor);
  for (const cv of [s.far, s.near]) {
    const off = wrapMod(pan, s.w);
    g.drawImage(cv, off - s.w, 0);
    if (off < c.W) g.drawImage(cv, off, 0);
  }
}

/** Haze near the horizon so the far ground melts into the sky. */
export function drawFog(g: CanvasRenderingContext2D, id: string, c: Cam7) {
  const th = THEMES[id] ?? THEMES.garden;
  const hor = Math.floor(c.hor) + 1, depth = Math.round(c.H * 0.12);
  const grad = g.createLinearGradient(0, hor, 0, hor + depth);
  const [r, gg, b] = hex(th.sky[1]);
  grad.addColorStop(0, `rgba(${r},${gg},${b},0.85)`); grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = grad; g.fillRect(0, hor, c.W, depth);
}

const shades = new Map<string, string>();
export const shade = (c: string, k: number) => {
  const key = c + k;
  let s = shades.get(key);
  if (!s) {
    const [r, g, b] = hex(c);
    const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0');
    s = `#${f(r)}${f(g)}${f(b)}`;
    shades.set(key, s);
  }
  return s;
};

/** A kart seen from behind, contact point at (x,y); `u` = screen px per
 *  design pixel (the kart is 24 design px wide). `yaw` -1..1 turns it. */
export function drawKartRear(g: CanvasRenderingContext2D, x: number, y: number, u: number, color: string, driver: HTMLImageElement | null, yaw: number, bounce = 0) {
  const R = (a: number, b: number, w: number, h: number, c: string) => { g.fillStyle = c; g.fillRect(Math.round(x + a * u), Math.round(y + b * u), Math.max(1, Math.round(w * u)), Math.max(1, Math.round(h * u))); };
  const sh = Math.round(Math.max(-1, Math.min(1, yaw)) * 4);
  R(-13, -2, 26, 3, 'rgba(0,0,0,0.3)');
  y -= bounce * u;
  if (sh) R(sh > 0 ? 9 : -9 + sh, -10, Math.abs(sh), 5, shade(color, 0.75));
  R(-12, -8, 6, 8, '#1b1b22'); R(6, -8, 6, 8, '#1b1b22');
  R(-11, -7, 1, 6, '#44444f'); R(7, -7, 1, 6, '#44444f');
  const b = sh * 0.4;
  R(-8 + b, -11, 16, 7, color);
  R(-8 + b, -11, 16, 2, shade(color, 1.3));
  R(-8 + b, -6, 16, 2, shade(color, 0.65));
  R(-6 + b, -4, 3, 2, '#9aa0aa'); R(3 + b, -4, 3, 2, '#9aa0aa');
  R(-2 + b, -6, 4, 2, '#f5f5f5');
  const ds = 16, dx = -ds / 2 + sh * 0.7, dy = -10 - ds * 0.9;
  if (driver && driver.complete && driver.naturalWidth) g.drawImage(driver, Math.round(x + dx * u), Math.round(y + dy * u), Math.round(ds * u), Math.round(ds * u));
  else R(-4 + sh * 0.7, -19, 8, 8, shade(color, 1.4));
  R(-10 + b, -13, 20, 2, '#26262e');
  R(-9 + b, -12, 1, 2, '#26262e'); R(8 + b, -12, 1, 2, '#26262e');
}

export function drawBoxBB(g: CanvasRenderingContext2D, x: number, y: number, u: number, t: number) {
  const s = Math.max(2, Math.round(12 * u));
  const hue = (t * 120) % 360;
  const bob = Math.round(Math.sin(t * 3) * 2 * u);
  const top = Math.round(y - s - 4 * u + bob), left = Math.round(x - s / 2);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(left, Math.round(y - u), s, Math.max(1, Math.round(2 * u)));
  g.fillStyle = `hsl(${hue},85%,58%)`; g.fillRect(left, top, s, s);
  const m = Math.max(1, Math.round(s * 0.14));
  g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillRect(left + m, top + m, s - 2 * m, s - 2 * m);
  if (s >= 8) {
    const q = s / 12;
    g.fillStyle = `hsl(${(hue + 180) % 360},70%,40%)`;
    const Q = (a: number, b: number, w: number, h: number) => g.fillRect(Math.round(left + a * q), Math.round(top + b * q), Math.max(1, Math.round(w * q)), Math.max(1, Math.round(h * q)));
    Q(4, 2, 4, 1.5); Q(7, 3, 1.5, 2.5); Q(5.5, 5, 2, 1.5); Q(5.5, 6.5, 1.5, 1.5); Q(5.5, 8.5, 1.5, 1.5);
  }
}

/** Trackside props, one family per theme; `v` in 0..1 picks a variant. */
export function drawProp(g: CanvasRenderingContext2D, id: string, x: number, y: number, u: number, v: number, t: number) {
  const R = (a: number, b: number, w: number, h: number, c: string) => { g.fillStyle = c; g.fillRect(Math.round(x + a * u), Math.round(y + b * u), Math.max(1, Math.round(w * u)), Math.max(1, Math.round(h * u))); };
  if (id === 'garden') {
    if (v < 0.5) { R(-2, -14, 4, 14, '#7a5230'); R(-9, -34, 18, 16, '#2f6a22'); R(-7, -40, 14, 24, '#3f8a2c'); R(-4, -36, 4, 4, '#6ab84a'); }
    else { R(-1, -10, 2, 10, '#3d7a2c'); R(-5, -16, 10, 6, v < 0.75 ? '#f3a6c8' : '#f7e06a'); R(-2, -15, 4, 4, '#ffffff'); }
  } else if (id === 'server') {
    R(-8, -40, 16, 40, '#11151c'); R(-7, -39, 14, 38, '#252e3e');
    for (let i = 0; i < 8; i++) R(-5 + ((i * 5) % 9), -36 + i * 4.5, 2, 1, Math.sin(t * 5 + i + v * 10) > 0 ? (i % 3 ? '#46e08a' : '#e8b04a') : '#11151c');
  } else if (id === 'beach') {
    if (v < 0.6) { R(-1, -34, 3, 34, '#8a5a32'); R(-12, -38, 24, 3, '#2f8a3a'); R(-9, -41, 18, 3, '#3fa048'); R(-14, -35, 5, 3, '#2f8a3a'); R(9, -35, 5, 3, '#2f8a3a'); R(-2, -37, 4, 4, '#6b4a2a'); }
    else { R(-8, -6, 16, 6, '#8a847a'); R(-5, -9, 10, 4, '#b8b2a4'); }
  } else {
    R(-1, -44, 2, 44, '#3a3f55'); R(-1, -46, 8, 2, '#3a3f55'); R(4, -45, 5, 3, '#f5d76e');
    g.fillStyle = 'rgba(245,215,110,0.16)'; g.fillRect(Math.round(x + 1 * u), Math.round(y - 42 * u), Math.max(1, Math.round(12 * u)), Math.round(42 * u));
  }
}
