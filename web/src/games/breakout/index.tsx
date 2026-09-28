import { useEffect, useRef, useState } from 'react';
import type { GameMeta, GameProps } from '../types';
import { sprite } from '../types';
import {
  BALL_R, BH, BW, DROP_R, H, PADDLE_H, PADDLE_Y, W, brickRect, fresh, launch, movePaddle, paddleW, step, type Kind, type State,
} from './logic';
import './style.css';

/** Brick Nest: Bram rides the paddle, bouncing an egg into pixel bricks.
 *  Drag anywhere to steer; lift your finger to launch. A paused run is saved
 *  and comes back as "tap to continue". */
export const meta: GameMeta = {
  id: 'breakout',
  name: 'Brick Nest',
  blurb: 'Bram bounces an egg at the bricks. Mind the drop.',
  host: 'bram',
  pack: 'quick',
  achievements: [
    { id: 'first', name: 'Crack', says: 'Break a brick.' },
    { id: 'clear', name: 'Clean sweep', says: 'Clear a level.' },
    { id: 'three', name: 'Nest egg', says: 'Reach level 4.' },
    { id: 'multi', name: 'Clutch', says: 'Have three eggs in the air.' },
    { id: 'big', name: 'Omelette', says: 'Score 5,000 in one run.' },
  ],
};

type Mode = 'play' | 'resume' | 'over';
const HUES: Record<number, string[]> = { 1: ['#e8b04a', '#f0c870'], 2: ['#4fa3d9', '#7cc0ea'], 3: ['#c9563c', '#e07b5f'] };
const ROW_TINT = ['#e8b04a', '#8fc25a', '#4fa3d9', '#b07ad9', '#e07b9a', '#e8b04a', '#8fc25a'];
const DROP: Record<Kind, [string, string]> = { wide: ['#8fc25a', 'W'], multi: ['#e07b9a', 'M'], slow: ['#4fa3d9', 'S'] };

const imgCache = new Map<string, HTMLImageElement>();
function img(src: string) {
  let i = imgCache.get(src);
  if (!i) { i = new Image(); i.src = src; imgCache.set(src, i); }
  return i;
}

function draw(ctx: CanvasRenderingContext2D, s: State) {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#1d1a24';
  ctx.fillRect(0, 0, W, H);
  const scene = img('/scenes/treehouse.webp');
  if (scene.complete && scene.naturalWidth) {
    const sh = H * 0.55, sw = sh * (scene.naturalWidth / scene.naturalHeight);
    ctx.globalAlpha = 0.28;
    ctx.drawImage(scene, (W - sw) / 2, H - sh, sw, sh);
    ctx.globalAlpha = 1;
  }
  s.bricks.forEach((hp, i) => {
    if (!hp) return;
    const r = brickRect(i);
    const row = Math.floor(i / 8);
    const [base, hi] = hp === 1 ? [ROW_TINT[row % ROW_TINT.length], '#ffffff55'] : HUES[hp] ?? HUES[3];
    ctx.fillStyle = base;
    ctx.fillRect(r.x + 1, r.y + 1, BW - 2, BH - 2);
    ctx.fillStyle = hp === 1 ? hi : HUES[hp][1];
    ctx.fillRect(r.x + 1, r.y + 1, BW - 2, 3);
    ctx.fillStyle = '#00000040';
    ctx.fillRect(r.x + 1, r.y + BH - 4, BW - 2, 3);
    if (hp > 1) { ctx.fillStyle = '#ffffffaa'; for (let k = 0; k < hp; k++) ctx.fillRect(r.x + 6 + k * 6, r.y + 7, 3, 3); }
  });
  for (const d of s.drops) {
    const [c, t] = DROP[d.kind];
    ctx.fillStyle = c;
    ctx.fillRect(d.x - DROP_R, d.y - DROP_R, DROP_R * 2, DROP_R * 2);
    ctx.fillStyle = '#1d1a24';
    ctx.font = 'bold 13px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(t, d.x, d.y + 5);
  }
  const pw = paddleW(s);
  const px = s.paddleX - pw / 2;
  ctx.fillStyle = '#8a5a2e';
  ctx.fillRect(px, PADDLE_Y, pw, PADDLE_H);
  ctx.fillStyle = '#b07a44';
  ctx.fillRect(px, PADDLE_Y, pw, 4);
  ctx.fillStyle = '#5e3b1c';
  for (let x = px + 6; x < px + pw - 4; x += 10) ctx.fillRect(x, PADDLE_Y + 6, 5, 2);
  const bram = img(sprite('bram', s.balls.some((b) => b.stuck) ? 'hold' : 'idle'));
  if (bram.complete && bram.naturalWidth) ctx.drawImage(bram, s.paddleX - 18, PADDLE_Y + PADDLE_H - 6, 36, 36);
  for (const b of s.balls) {
    ctx.fillStyle = '#f4ecd8';
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, BALL_R, BALL_R * 1.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b89c6a';
    ctx.fillRect(b.x - 2, b.y - 2, 2, 2);
    ctx.fillRect(b.x + 1, b.y + 2, 2, 2);
  }
  ctx.fillStyle = '#f4ecd8';
  ctx.font = 'bold 14px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`${s.score}`, 12, 26);
  ctx.textAlign = 'center';
  ctx.fillText(`Level ${s.level + 1}`, W / 2, 26);
  // Lives as little pixel eggs (no emoji: Roost draws its own).
  for (let i = 0; i < s.lives; i++) {
    const x = W - 16 - i * 14;
    ctx.fillStyle = '#f4ecd8';
    ctx.fillRect(x - 4, 16, 8, 10);
    ctx.fillRect(x - 3, 14, 6, 2);
    ctx.fillRect(x - 3, 26, 6, 1);
  }
  const fx = [s.wide > 0 && `wide ${Math.ceil(s.wide)}`, s.slow > 0 && `slow ${Math.ceil(s.slow)}`].filter(Boolean).join(' · ');
  if (fx) { ctx.textAlign = 'center'; ctx.fillStyle = '#ffffffaa'; ctx.font = '12px ui-monospace, monospace'; ctx.fillText(fx, W / 2, 46); }
}

export function Game({ save, onSave, onScore, onAchieve, paused, best }: GameProps<State>) {
  const state = useRef<State>(save ?? fresh());
  const [mode, setMode] = useState<Mode>(save ? 'resume' : 'play');
  const [final, setFinal] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const scale = Math.min((Math.min(window.innerWidth, 420) - 16) / W, (window.innerHeight - 150) / H);

  useEffect(() => {
    const c = canvas.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(W * scale * dpr);
    c.height = Math.round(H * scale * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    draw(ctx, state.current);
    const t = setTimeout(() => draw(ctx, state.current), 300);
    return () => clearTimeout(t);
  }, [scale]);

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
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { s, ev } = step(state.current, dt);
      state.current = s;
      if (ev.broke) onAchieve('first');
      if (s.balls.filter((b) => !b.stuck).length >= 3) onAchieve('multi');
      if (s.score >= 5000) onAchieve('big');
      if (ev.cleared) {
        onAchieve('clear');
        if (s.level >= 3) onAchieve('three');
        onSave(s); // a new level is a good checkpoint
      }
      draw(ctx, s);
      if (ev.over) {
        setFinal(s.score);
        onScore(s.score);
        onSave(null);
        setMode('over');
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, mode, onAchieve, onSave, onScore]);

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
    if (mode === 'play' && down.current) state.current = launch(state.current);
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
    const ctx = canvas.current!.getContext('2d')!;
    draw(ctx, state.current);
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
            <button className="chip" onClick={again}>Play again</button>
          </div>
        )}
      </div>
      <p className="game-breakout-hint">Drag to steer · let go to launch</p>
    </div>
  );
}
