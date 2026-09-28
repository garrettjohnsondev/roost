import { useEffect, useRef, useState } from 'react';
import type { GameMeta, GameProps, Ghost } from '../types';
import { sprite } from '../types';
import { sfx } from '../../economy/sound';
import { buzz, ticks } from '../../haptics';
import {
  BALL_R, BH, BOSS_H, BOSS_W, BOSS_Y, BW, DROP_R, EXPLOSIVE, H, PADDLE_H, PADDLE_Y, STEEL, W, brickRect, comboMult, fresh, isBoss, isSliding, launch,
  movePaddle, paddleW, shiftFor, step, type Events, type Kind, type State,
} from './logic';
import './style.css';

/** Brick Nest: Bram rides the paddle, bouncing an egg into pixel bricks.
 *  Drag anywhere to steer; lift your finger to launch. A paused run is saved
 *  and comes back as "tap to continue". */
export const meta: GameMeta = {
  id: 'breakout',
  name: 'Brick Nest',
  blurb: 'Bram bounces an egg at the bricks. Mind the crow.',
  host: 'bram',
  pack: 'quick',
  achievements: [
    { id: 'first', name: 'Crack', says: 'Break a brick.' },
    { id: 'clear', name: 'Clean sweep', says: 'Clear a level.' },
    { id: 'three', name: 'Nest egg', says: 'Reach level 4.' },
    { id: 'multi', name: 'Clutch', says: 'Have three eggs in the air.' },
    { id: 'big', name: 'Omelette', says: 'Score 5,000 in one run.' },
    { id: 'boom', name: 'Chain reaction', says: 'Take out 5 bricks with one blast.' },
    { id: 'combo', name: 'Hot streak', says: 'Hit a x4 combo.' },
    { id: 'crow', name: 'Scarecrow', says: 'Beat the crow on level 5.' },
  ],
  // Level 1 is worth ~1,000; a casual run clears it; a strong one goes past the crow.
  ghostScore: (s) => Math.round((700 + 14000 * s * s) / 10) * 10,
  safeCorner: 'bl',
};

type Mode = 'play' | 'resume' | 'over';
const HUES: Record<number, string[]> = { 1: ['#e8b04a', '#f0c870'], 2: ['#4fa3d9', '#7cc0ea'], 3: ['#c9563c', '#e07b5f'] };
const ROW_TINT = ['#e8b04a', '#8fc25a', '#4fa3d9', '#b07ad9', '#e07b9a', '#e8b04a', '#8fc25a'];
const DROP: Record<Kind, [string, string]> = {
  wide: ['#8fc25a', 'W'], multi: ['#e07b9a', 'M'], slow: ['#4fa3d9', 'S'], laser: ['#e8503a', 'L'], sticky: ['#e8b04a', 'C'], pebble: ['#6b6470', ''],
};
const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const imgCache = new Map<string, HTMLImageElement>();
function img(src: string) {
  let i = imgCache.get(src);
  if (!i) { i = new Image(); i.src = src; imgCache.set(src, i); }
  return i;
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string; sz: number }
interface Popup { x: number; y: number; text: string; life: number }
interface Fx { parts: Particle[]; pops: Popup[]; shake: number; squash: number; flash: number; banner: number; bannerText: string }
const freshFx = (): Fx => ({ parts: [], pops: [], shake: 0, squash: 0, flash: 0, banner: 0, bannerText: '' });

function brickColor(code: number, row: number): [string, string] {
  if (code === STEEL) return ['#8a8f9a', '#c4c8d0'];
  if (code === EXPLOSIVE) return ['#d9442f', '#f08a4a'];
  if (code === 1) return [ROW_TINT[row % ROW_TINT.length], '#ffffff66'];
  return [HUES[code]?.[0] ?? HUES[3][0], HUES[code]?.[1] ?? HUES[3][1]];
}

function burst(fx: Fx, ev: Events) {
  for (const b of ev.bursts) {
    const row = Math.max(0, Math.floor((b.y - 64) / BH));
    const c = b.kind === 'boom' ? '#f5a142' : b.kind === 'steel' ? '#dfe3ea' : b.kind === 'boss' ? '#2b2530' : brickColor(b.code, row)[0];
    const n = b.kind === 'boom' ? 14 : b.kind === 'steel' ? 3 : 8;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * (b.kind === 'boom' ? 180 : 110);
      fx.parts.push({ x: b.x, y: b.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, life: 0.5 + Math.random() * 0.3, max: 0.8, c, sz: b.kind === 'boom' ? 4 : 3 });
    }
    if (b.kind === 'boom') fx.flash = 0.15;
  }
}

function drawCrow(ctx: CanvasRenderingContext2D, x: number, hp: number, max: number, t: number, hurt: number) {
  const y = BOSS_Y, bx = x - BOSS_W / 2;
  const flapUp = Math.sin(t * 8) > 0;
  ctx.fillStyle = hurt > 0 ? '#ffffff' : '#2b2530';
  // wings
  ctx.fillRect(bx - 10, y + (flapUp ? 4 : 14), 18, 10);
  ctx.fillRect(bx + BOSS_W - 8, y + (flapUp ? 4 : 14), 18, 10);
  // body and head
  ctx.fillRect(bx + 6, y + 6, BOSS_W - 12, BOSS_H - 8);
  ctx.fillRect(bx + 18, y, BOSS_W - 36, 10);
  ctx.fillStyle = hurt > 0 ? '#ffffff' : '#433a4a';
  ctx.fillRect(bx + 10, y + 10, BOSS_W - 20, 4);
  // eyes and beak
  ctx.fillStyle = '#f2d24a';
  ctx.fillRect(bx + 24, y + 4, 5, 5);
  ctx.fillRect(bx + BOSS_W - 29, y + 4, 5, 5);
  ctx.fillStyle = '#e8903a';
  ctx.fillRect(x - 5, y + 12, 10, 6);
  ctx.fillRect(x - 2, y + 18, 4, 3);
  // hp bar
  ctx.fillStyle = '#00000080';
  ctx.fillRect(bx, y + BOSS_H + 3, BOSS_W, 4);
  ctx.fillStyle = '#e8503a';
  ctx.fillRect(bx, y + BOSS_H + 3, BOSS_W * (hp / max), 4);
}

function drawGhost(ctx: CanvasRenderingContext2D, g: Ghost, score: number, t: number) {
  const x0 = 60, x1 = W - 60, y = 42;
  const frac = Math.min(1, score / Math.max(1, g.target));
  ctx.fillStyle = '#ffffff22';
  ctx.fillRect(x0, y - 1, x1 - x0, 3);
  ctx.fillStyle = frac >= 1 ? '#8fc25a' : '#f4ecd8';
  ctx.fillRect(x0, y - 1, (x1 - x0) * frac, 3);
  // you: a little egg riding the track
  ctx.fillRect(x0 + (x1 - x0) * frac - 2, y - 4, 5, 8);
  const gi = img(sprite(g.sprite, 'idle'));
  const bob = Math.sin(t * 2.4) * 2;
  ctx.save();
  ctx.globalAlpha = frac >= 1 ? 0.2 : 0.42;
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 8;
  if (gi.complete && gi.naturalWidth) ctx.drawImage(gi, x1 - 11, y - 20 + bob, 22, 22);
  ctx.restore();
  ctx.fillStyle = '#ffffff99';
  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`${g.name} ${g.target}`, x1, y + 12);
}

function draw(ctx: CanvasRenderingContext2D, s: State, fx: Fx, ghost: Ghost | null | undefined) {
  ctx.imageSmoothingEnabled = false;
  const t = s.t ?? 0;
  ctx.save();
  if (fx.shake > 0 && !reduced()) ctx.translate((Math.random() - 0.5) * fx.shake * 8, (Math.random() - 0.5) * fx.shake * 8);
  // backdrop: a dusk gradient behind the treehouse
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, isBoss(s.level) ? '#2a1a26' : '#1d1a2e');
  grad.addColorStop(1, '#141218');
  ctx.fillStyle = grad;
  ctx.fillRect(-10, -10, W + 20, H + 20);
  ctx.fillStyle = '#ffffff14';
  for (let i = 0; i < 24; i++) ctx.fillRect((i * 97) % W, (i * 53) % 300, 2, 2);
  const scene = img('/scenes/treehouse.webp');
  if (scene.complete && scene.naturalWidth) {
    const sh = H * 0.55, sw = sh * (scene.naturalWidth / scene.naturalHeight);
    ctx.globalAlpha = 0.28;
    ctx.drawImage(scene, (W - sw) / 2, H - sh, sw, sh);
    ctx.globalAlpha = 1;
  }
  const shift = shiftFor(s);
  s.bricks.forEach((code, i) => {
    if (!code) return;
    const r = brickRect(i, shift);
    const row = Math.floor(i / 8);
    const [base, hi] = brickColor(code, row);
    ctx.fillStyle = '#00000055';
    ctx.fillRect(r.x + 2, r.y + 3, BW - 2, BH - 2);
    ctx.fillStyle = base;
    ctx.fillRect(r.x + 1, r.y + 1, BW - 2, BH - 2);
    ctx.fillStyle = hi;
    ctx.fillRect(r.x + 1, r.y + 1, BW - 2, 3);
    ctx.fillStyle = '#00000040';
    ctx.fillRect(r.x + 1, r.y + BH - 4, BW - 2, 3);
    if (code === STEEL) {
      ctx.fillStyle = '#5c616b';
      for (const dx of [5, BW - 8]) ctx.fillRect(r.x + dx, r.y + 6, 3, 3);
    } else if (code === EXPLOSIVE) {
      // a pixel bomb with a flickering fuse
      ctx.fillStyle = '#2b2530';
      ctx.fillRect(r.x + BW / 2 - 4, r.y + 5, 8, 7);
      ctx.fillStyle = Math.sin(t * 14 + i) > 0 ? '#ffe46a' : '#f08a4a';
      ctx.fillRect(r.x + BW / 2 + 3, r.y + 3, 3, 3);
    } else if (code > 1) {
      ctx.fillStyle = '#ffffffaa';
      for (let k = 0; k < code; k++) ctx.fillRect(r.x + 6 + k * 6, r.y + 7, 3, 3);
    } else {
      // a glint that sweeps across the rows
      const gx = ((t * 90 + row * 30) % (W + 120)) - 60;
      if (gx > r.x && gx < r.x + BW) { ctx.fillStyle = '#ffffff55'; ctx.fillRect(gx, r.y + 2, 3, BH - 5); }
    }
  });
  if (s.boss) drawCrow(ctx, s.boss.x, s.boss.hp, s.boss.max, t, fx.flash);
  for (const d of s.drops) {
    const [c, label] = DROP[d.kind];
    if (d.kind === 'pebble') {
      ctx.fillStyle = c;
      ctx.fillRect(d.x - 5, d.y - 5, 10, 10);
      ctx.fillStyle = '#9a939f';
      ctx.fillRect(d.x - 4, d.y - 4, 4, 3);
      continue;
    }
    const pulse = Math.sin(t * 8) > 0 ? 1 : 0;
    ctx.fillStyle = '#00000060';
    ctx.fillRect(d.x - DROP_R + 2, d.y - DROP_R + 2, DROP_R * 2, DROP_R * 2);
    ctx.fillStyle = c;
    ctx.fillRect(d.x - DROP_R - pulse, d.y - DROP_R, DROP_R * 2 + pulse * 2, DROP_R * 2);
    ctx.fillStyle = '#1d1a24';
    ctx.font = 'bold 13px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, d.x, d.y + 5);
  }
  for (const b of s.bolts ?? []) {
    ctx.fillStyle = '#ff7a5a';
    ctx.fillRect(b.x - 1, b.y - 8, 3, 10);
    ctx.fillStyle = '#fff2c0';
    ctx.fillRect(b.x, b.y - 8, 1, 6);
  }
  // paddle, squashing on each bounce
  const pw = paddleW(s);
  const sq = fx.squash;
  const pww = pw * (1 + sq * 0.12), phh = PADDLE_H * (1 - sq * 0.35);
  const px = s.paddleX - pww / 2, py = PADDLE_Y + (PADDLE_H - phh);
  const stunned = (s.stun ?? 0) > 0;
  ctx.fillStyle = stunned ? '#6b6470' : (s.sticky ?? 0) > 0 ? '#c9922e' : '#8a5a2e';
  ctx.fillRect(px, py, pww, phh);
  ctx.fillStyle = (s.sticky ?? 0) > 0 ? '#f2d24a' : '#b07a44';
  ctx.fillRect(px, py, pww, 4);
  ctx.fillStyle = '#5e3b1c';
  for (let x = px + 6; x < px + pww - 4; x += 10) ctx.fillRect(x, py + 6, 5, 2);
  if ((s.laser ?? 0) > 0) {
    ctx.fillStyle = '#e8503a';
    ctx.fillRect(px + 2, py - 5, 5, 6);
    ctx.fillRect(px + pww - 7, py - 5, 5, 6);
  }
  const bram = img(sprite('bram', stunned ? 'think' : s.balls.some((b) => b.stuck) ? 'hold' : 'idle'));
  if (bram.complete && bram.naturalWidth) ctx.drawImage(bram, s.paddleX - 18, PADDLE_Y + PADDLE_H - 6, 36, 36);
  for (const b of s.balls) {
    ctx.fillStyle = '#00000050';
    ctx.beginPath(); ctx.ellipse(b.x + 2, b.y + 3, BALL_R, BALL_R * 1.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f4ecd8';
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, BALL_R, BALL_R * 1.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b89c6a';
    ctx.fillRect(b.x - 2, b.y - 2, 2, 2);
    ctx.fillRect(b.x + 1, b.y + 2, 2, 2);
  }
  for (const p of fx.parts) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.c;
    ctx.fillRect(p.x, p.y, p.sz, p.sz);
  }
  ctx.globalAlpha = 1;
  ctx.font = 'bold 12px ui-monospace, monospace';
  ctx.textAlign = 'center';
  for (const p of fx.pops) {
    ctx.globalAlpha = Math.min(1, p.life * 2);
    ctx.fillStyle = '#ffe46a';
    ctx.fillText(p.text, p.x, p.y);
  }
  ctx.globalAlpha = 1;
  if (fx.flash > 0) { ctx.fillStyle = `rgba(255,220,160,${fx.flash})`; ctx.fillRect(-10, -10, W + 20, H + 20); }
  ctx.restore();

  // HUD
  ctx.fillStyle = '#f4ecd8';
  ctx.font = 'bold 14px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`${s.score}`, 12, 24);
  const mult = comboMult(s.combo ?? 0);
  if (mult > 1) { ctx.fillStyle = '#ffe46a'; ctx.font = 'bold 12px ui-monospace, monospace'; ctx.fillText(`x${mult}`, 12, 40); }
  ctx.fillStyle = '#f4ecd8';
  ctx.font = 'bold 14px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(isBoss(s.level) ? `Level ${s.level + 1} · Crow` : `Level ${s.level + 1}${isSliding(s.level) ? ' · sway' : ''}`, W / 2, 24);
  for (let i = 0; i < s.lives; i++) {
    const x = W - 16 - i * 14;
    ctx.fillRect(x - 4, 14, 8, 10);
    ctx.fillRect(x - 3, 12, 6, 2);
    ctx.fillRect(x - 3, 24, 6, 1);
  }
  if (ghost) drawGhost(ctx, ghost, s.score, t);
  const fxs = [
    s.wide > 0 && `wide ${Math.ceil(s.wide)}`, s.slow > 0 && `slow ${Math.ceil(s.slow)}`,
    (s.laser ?? 0) > 0 && `laser ${Math.ceil(s.laser!)}`, (s.sticky ?? 0) > 0 && `catch ${Math.ceil(s.sticky!)}`,
  ].filter(Boolean).join(' · ');
  if (fxs) { ctx.textAlign = 'right'; ctx.fillStyle = '#ffffffaa'; ctx.font = '11px ui-monospace, monospace'; ctx.fillText(fxs, W - 8, H - 8); }
  if (fx.banner > 0) {
    ctx.globalAlpha = Math.min(1, fx.banner);
    ctx.fillStyle = '#000000a0';
    ctx.fillRect(0, H / 2 - 24, W, 40);
    ctx.fillStyle = '#ffe46a';
    ctx.font = 'bold 18px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(fx.bannerText, W / 2, H / 2 + 2);
    ctx.globalAlpha = 1;
  }
}

function ageFx(fx: Fx, dt: number) {
  for (const p of fx.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 420 * dt; p.life -= dt; }
  fx.parts = fx.parts.filter((p) => p.life > 0).slice(-220);
  for (const p of fx.pops) { p.y -= 30 * dt; p.life -= dt; }
  fx.pops = fx.pops.filter((p) => p.life > 0);
  fx.shake = Math.max(0, fx.shake - dt * 3);
  fx.squash = Math.max(0, fx.squash - dt * 6);
  fx.flash = Math.max(0, fx.flash - dt);
  fx.banner = Math.max(0, fx.banner - dt);
}

export function Game({ save, onSave, onScore, onAchieve, paused, best, ghost }: GameProps<State>) {
  const state = useRef<State>(save ?? fresh());
  const [mode, setMode] = useState<Mode>(save ? 'resume' : 'play');
  const [final, setFinal] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const fx = useRef<Fx>(freshFx());
  const lastTick = useRef(0);
  const scale = Math.min((Math.min(window.innerWidth, 420) - 16) / W, (window.innerHeight - 150) / H);

  useEffect(() => {
    const c = canvas.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(W * scale * dpr);
    c.height = Math.round(H * scale * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    draw(ctx, state.current, fx.current, ghost);
    const t = setTimeout(() => draw(ctx, state.current, fx.current, ghost), 300);
    return () => clearTimeout(t);
  }, [scale, ghost]);

  useEffect(() => {
    if (paused && mode === 'play') {
      setMode('resume');
      onSave(state.current);
    }
  }, [paused, mode, onSave]);

  useEffect(() => {
    if (paused || mode !== 'play') return;
    const ctx = canvas.current!.getContext('2d')!;
    let raf = 0;
    let last = performance.now();
    // Haptics: never more than a few a second.
    const tick = (n: number, now: number) => { if (now - lastTick.current > 140) { lastTick.current = now; ticks(n); } };
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const before = state.current;
      const { s, ev } = step(before, dt);
      state.current = s;
      const f = fx.current;
      ageFx(f, dt);
      burst(f, ev);
      if (ev.paddle) { f.squash = 1; sfx('bounce'); }
      if (ev.broke) {
        onAchieve('first');
        sfx(ev.exploded ? 'crash' : 'hit');
        tick(Math.min(12, ev.broke + (ev.combo >= 4 ? Math.floor(ev.combo / 4) : 0)), now);
        if (ev.exploded) f.shake = Math.min(1, 0.3 + ev.exploded * 0.1);
        if (ev.exploded >= 5) onAchieve('boom');
        const m = comboMult(ev.combo);
        if (m > 1 && ev.bursts.length) { const b = ev.bursts[ev.bursts.length - 1]; f.pops.push({ x: b.x, y: b.y, text: `x${m}`, life: 0.7 }); }
        if (m >= 4) onAchieve('combo');
      }
      if (ev.bossHit && !ev.broke) { sfx('hit'); tick(2, now); f.shake = Math.max(f.shake, 0.25); f.flash = Math.max(f.flash, 0.05); }
      if (ev.bossDown) { sfx('win'); ticks(10); f.shake = 1; f.banner = 1.6; f.bannerText = 'Crow down!'; if (before.level === 4) onAchieve('crow'); }
      for (const k of ev.caught) {
        if (k === 'pebble') { sfx('crash'); tick(2, now); f.shake = Math.max(f.shake, 0.4); }
        else { sfx('coin'); f.pops.push({ x: s.paddleX, y: PADDLE_Y - 12, text: DROP[k][1] === 'C' ? 'catch' : k, life: 0.8 }); }
      }
      if (s.balls.filter((b) => !b.stuck).length >= 3) onAchieve('multi');
      if (s.score >= 5000) onAchieve('big');
      if (ev.lostLife && !ev.over) { buzz('fail'); sfx('lose'); f.shake = 0.6; }
      if (ev.cleared) {
        onAchieve('clear');
        if (s.level >= 3) onAchieve('three');
        sfx('score');
        f.banner = 1.4;
        f.bannerText = isBoss(s.level) ? `Level ${s.level + 1}: the crow` : `Level ${s.level + 1}`;
        onSave(s); // a new level is a good checkpoint
      }
      draw(ctx, s, f, ghost);
      if (ev.over) {
        buzz('fail');
        sfx('lose');
        setFinal(s.score);
        onScore(s.score);
        onSave(null);
        setMode('over');
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [paused, mode, onAchieve, onSave, onScore, ghost]);

  // Drag anywhere in the stage: the paddle follows your finger's x.
  const down = useRef<{ x: number; moved: boolean } | null>(null);
  const toWorld = (clientX: number) => {
    const r = wrap.current!.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * W;
  };
  const onDown = (e: React.PointerEvent) => {
    if (paused) return;
    if (mode === 'resume') { setMode('play'); return; }
    if (mode !== 'play') return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    down.current = { x: e.clientX, moved: false };
    state.current = movePaddle(state.current, toWorld(e.clientX));
  };
  const onMove = (e: React.PointerEvent) => {
    if (mode !== 'play' || paused) return;
    if (e.pointerType === 'mouse' || down.current) {
      if (down.current && Math.abs(e.clientX - down.current.x) > 6) down.current.moved = true;
      state.current = movePaddle(state.current, toWorld(e.clientX));
    }
  };
  const onUp = () => {
    if (mode === 'play' && down.current) {
      if (state.current.balls.some((b) => b.stuck)) sfx('whoosh');
      state.current = launch(state.current);
    }
    down.current = null;
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (mode !== 'play') return;
      if (e.key === ' ') { e.preventDefault(); state.current = launch(state.current); }
      if (e.key === 'ArrowLeft') state.current = movePaddle(state.current, state.current.paddleX - 24);
      if (e.key === 'ArrowRight') state.current = movePaddle(state.current, state.current.paddleX + 24);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [mode]);

  const again = () => {
    state.current = fresh();
    fx.current = freshFx();
    const ctx = canvas.current!.getContext('2d')!;
    draw(ctx, state.current, fx.current, ghost);
    setMode('play');
  };

  return (
    <div className="game-breakout">
      <div
        ref={wrap}
        className="game-breakout-wrap"
        style={{ width: W * scale, height: H * scale }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => { down.current = null; }}
      >
        <canvas ref={canvas} style={{ width: W * scale, height: H * scale }} />
        {mode === 'resume' && (
          <div className="game-overlay">
            <img src={sprite('bram', 'peek')} alt="" />
            <p>Level {state.current.level + 1}, {state.current.score} points. Tap to continue.</p>
          </div>
        )}
        {mode === 'over' && (
          <div className="game-overlay" onPointerDown={(e) => e.stopPropagation()}>
            <img src={sprite('bram', 'think')} alt="" />
            <p>{final} points. {best !== undefined && final >= best && final > 0 ? 'Best yet!' : 'Again?'}</p>
            {ghost && <p className="game-breakout-dim">{final > ghost.target ? `Past ${ghost.name}'s ghost (${ghost.target}).` : `${ghost.name}'s ghost posted ${ghost.target}.`}</p>}
            <button className="chip" onClick={again}>Play again</button>
          </div>
        )}
      </div>
      <p className="game-breakout-hint">Drag to steer · let go to launch · bombs chain, steel holds</p>
    </div>
  );
}
