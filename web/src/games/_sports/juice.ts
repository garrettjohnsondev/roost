import { ticks } from '../../haptics';
import type { Ghost } from '../types';
import { crewImg } from './stage';

/** The sports pack's juice (wave 3): particles, screen shake that respects
 *  reduced motion, a crowd that reacts, the see-through ghost, big words that
 *  pop, and haptics that never spam. Canvas only; the rules live in pace.ts. */

export const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// ---------- haptics ----------
let lastFeel = 0;
/** ticks(n, gap), but never more than a few times a second. `force` is for
 *  the moments that matter (a make after a rim hit, say). */
export function feel(n: number, gap = 45, force = false): void {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (!force && now - lastFeel < 180) return;
  lastFeel = now;
  ticks(n, gap);
}

// ---------- particles ----------
export interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; g: number }
export function burst(ps: Particle[], x: number, y: number, n: number, colors: string[], speed = 160, g = 380, size = 3): void {
  if (reducedMotion()) n = Math.ceil(n / 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = speed * (0.35 + Math.random() * 0.65);
    const max = 0.5 + Math.random() * 0.7;
    ps.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.3, life: max, max, color: colors[i % colors.length], size: size * (0.6 + Math.random() * 0.8), g });
  }
  if (ps.length > 400) ps.splice(0, ps.length - 400);
}
export function stepParticles(ps: Particle[], dt: number): void {
  for (const p of ps) { p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
  for (let i = ps.length - 1; i >= 0; i--) if (ps[i].life <= 0) ps.splice(i, 1);
}
export function drawParticles(ctx: CanvasRenderingContext2D, ps: Particle[]): void {
  for (const p of ps) {
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max * 1.4));
    ctx.fillStyle = p.color;
    const s = Math.max(1, Math.round(p.size));
    ctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
  }
  ctx.globalAlpha = 1;
}
export const CONFETTI = ['#ffe27a', '#f2c230', '#e8622c', '#5a86c9', '#7fd18b', '#f4f4f0'];

// ---------- shake ----------
export interface Shake { t: number; mag: number }
export const kickShake = (s: Shake, mag: number, t = 0.25) => { if (!reducedMotion()) { s.mag = Math.max(s.mag, mag); s.t = Math.max(s.t, t); } };
/** Advance the shake and return the offset to translate the scene by. */
export function shakeOffset(s: Shake, dt: number): [number, number] {
  if (s.t <= 0) return [0, 0];
  s.t = Math.max(0, s.t - dt);
  const m = s.mag * Math.min(1, s.t / 0.25);
  if (s.t === 0) s.mag = 0;
  return [Math.round((Math.random() * 2 - 1) * m), Math.round((Math.random() * 2 - 1) * m)];
}

// ---------- crowd ----------
const SHIRTS = ['#c95a4a', '#e0c35a', '#5a86c9', '#d9d4c7', '#7fbf7a', '#b07ac9'];
const SKIN = ['#f1c9a0', '#c58c5c', '#8a5a36', '#e8b48a'];
/** Rows of pixel fans in a box. `excite` 0..1 makes them jump; `wave` > 0
 *  sends a Mexican wave across (its value is the wave's phase, 0..1). */
export function drawCrowd(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, excite: number, now: number, wave = -1, cell = 7): void {
  const rows = Math.max(1, Math.floor(h / cell)), cols = Math.max(1, Math.floor(w / cell));
  const calm = reducedMotion();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = (r * 131 + c * 71) % 97;
      if (id % 11 === 0) continue; // an empty seat
      const cx = x + c * cell + (r % 2) * (cell / 2), cy = y + r * cell;
      let lift = 0;
      if (!calm) {
        if (excite > 0) lift += Math.max(0, Math.sin(now / 90 + id)) * excite * cell * 0.7;
        if (wave >= 0) { const d = Math.abs(c / cols - wave); if (d < 0.08) lift += (1 - d / 0.08) * cell * 0.9; }
        lift += Math.sin(now / 700 + id) * 0.4;
      }
      ctx.fillStyle = SHIRTS[id % SHIRTS.length];
      ctx.fillRect(Math.round(cx), Math.round(cy + cell * 0.45 - lift), cell - 2, Math.ceil(cell * 0.55));
      ctx.fillStyle = SKIN[id % SKIN.length];
      ctx.fillRect(Math.round(cx + 1), Math.round(cy - lift), cell - 4, Math.ceil(cell * 0.45));
      if (lift > cell * 0.4) { // arms up
        ctx.fillRect(Math.round(cx - 1), Math.round(cy - lift - 2), 1, 3);
        ctx.fillRect(Math.round(cx + cell - 2), Math.round(cy - lift - 2), 1, 3);
      }
    }
  }
}

// ---------- ghost ----------
/** The ghost you're racing: their crew sprite at ~40% with a soft white glow
 *  and a floaty bob, and their score ticking alongside yours. */
export function drawGhost(ctx: CanvasRenderingContext2D, g: Ghost, x: number, footY: number, size: number, now: number, score: number, you: number, mode: 'left' | 'right' = 'right'): void {
  const bob = reducedMotion() ? 0 : Math.sin(now / 420) * size * 0.06;
  const img = crewImg(g.sprite, 'idle');
  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.shadowColor = 'rgba(255,255,255,.95)';
  ctx.shadowBlur = size * 0.35;
  if (img.complete && img.naturalWidth) ctx.drawImage(img, Math.round(x - size / 2), Math.round(footY - size + bob), Math.round(size), Math.round(size));
  ctx.restore();
  const ahead = score > you;
  ctx.save();
  ctx.font = `bold ${Math.max(10, Math.round(size * 0.32))}px ui-monospace, monospace`;
  ctx.textAlign = mode === 'right' ? 'left' : 'right';
  ctx.textBaseline = 'middle';
  const tx = mode === 'right' ? x + size * 0.55 : x - size * 0.55;
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  ctx.fillText(`${g.name} ${score}`, tx + 1, footY - size * 0.5 + bob + 1);
  ctx.fillStyle = ahead ? 'rgba(255,220,220,.9)' : 'rgba(255,255,255,.85)';
  ctx.fillText(`${g.name} ${score}`, tx, footY - size * 0.5 + bob);
  ctx.restore();
}

// ---------- words ----------
/** A big word that pops in (scale overshoot) and fades. `age` in seconds. */
export function popText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, color: string, age: number, life = 1.4): void {
  if (age > life) return;
  const k = Math.min(1, age / 0.18);
  const scale = reducedMotion() ? 1 : k < 1 ? 0.4 + 0.8 * k : 1 + 0.2 * Math.max(0, 1 - (age - 0.18) / 0.2);
  ctx.save();
  ctx.globalAlpha = Math.min(1, (life - age) / 0.3);
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.font = `bold ${Math.round(px)}px ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.fillText(text, 2, 2);
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** A small label with a dark backing, for multipliers and "CLUTCH". */
export function tag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, bg: string, fg = '#1a1a1a', align: CanvasTextAlign = 'left'): void {
  ctx.save();
  ctx.font = `bold ${Math.round(px)}px ui-monospace, monospace`;
  const w = ctx.measureText(text).width + px;
  const left = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  ctx.fillStyle = bg;
  ctx.fillRect(Math.round(left), Math.round(y), Math.round(w), Math.round(px * 1.5));
  ctx.fillStyle = fg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + px / 2, y + px * 0.78);
  ctx.restore();
}

/** Rain streaks over the whole stage. `amount` 0..1. */
export function drawRain(ctx: CanvasRenderingContext2D, w: number, h: number, now: number, amount: number, slant = 0.25): void {
  if (amount <= 0) return;
  ctx.strokeStyle = 'rgba(200,220,255,.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const n = Math.round(70 * amount);
  for (let i = 0; i < n; i++) {
    const sx = (i * 97.13) % w, speed = 500 + (i % 7) * 40;
    const y = ((now / 1000) * speed + i * 53) % (h + 20) - 10;
    const x = (sx + y * slant) % w;
    ctx.moveTo(x, y); ctx.lineTo(x - 8 * slant, y - 8);
  }
  ctx.stroke();
}
