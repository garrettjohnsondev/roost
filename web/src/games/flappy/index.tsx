import { useEffect, useRef, useState } from 'react';
import type { GameMeta, GameProps, Ghost } from '../types';
import { sprite } from '../types';
import { sfx } from '../../economy/sound';
import { buzz, ticks } from '../../haptics';
import {
  BIRD_R, BIRD_X, FLIERS, GHOST_X, GRAVITY, GROUND, H, MIN_W, POST_W, SHIELD_AT, clampW, courseY, flap, fresh, ghostPassed, isCurrent, speedFor,
  step, unlockedBy, type World,
} from './logic';
import './style.css';

/** Flap: tap to keep a crew bird aloft through gaps in branches and chimneys,
 *  played sideways so the course runs along the long side of the phone.
 *  The save persists (who's unlocked, who's flying); a paused run rides
 *  along in it so the needs-you banner never costs a run. */
export const meta: GameMeta = {
  id: 'flappy',
  name: 'Flap',
  blurb: 'One tap, one flap. Thread the branches, ride the wind.',
  host: 'wren',
  pack: 'quick',
  achievements: [
    { id: 'first', name: 'Lift-off', says: 'Pass one gap.' },
    { id: 'ten', name: 'Treeline', says: 'Pass 10 gaps in a run.' },
    { id: 'chimney', name: 'Rooftops', says: 'Reach the chimneys (20).' },
    { id: 'fifty', name: 'Migration', says: 'Pass 50 gaps in a run.' },
    { id: 'friend', name: 'New wings', says: 'Unlock a second flier.' },
    { id: 'shield', name: 'Down cushion', says: 'Collect 10 feathers for a shield.' },
    { id: 'boss', name: 'Chimney sweep', says: 'Clear the first chimney stretch (20).' },
  ],
  inProgress: (s: { run?: unknown }) => !!s?.run,
  // A casual run gets ~5-10 gaps; 50+ takes real hands.
  ghostScore: (s) => Math.round(4 + 56 * Math.pow(s, 1.6)),
  orientation: 'landscape',
  safeCorner: 'br',
};

interface Save { unlocked: string[]; chosen: string; run?: World | null }
type Mode = 'ready' | 'play' | 'resume' | 'over';

const SCENES = ['picnic', 'orchard', 'rooftop', 'lanterns'];
const SKIES: [string, string][] = [['#8cc4ea', '#d8ecf6'], ['#9fd0e0', '#f2e6c8'], ['#e8a67a', '#f6d8b0'], ['#2c2f5a', '#6a5a8a']];
const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const imgCache = new Map<string, HTMLImageElement>();
function img(src: string) {
  let i = imgCache.get(src);
  if (!i) { i = new Image(); i.src = src; imgCache.set(src, i); }
  return i;
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string; sz: number }
interface Fx { parts: Particle[]; shake: number; flapT: number; banner: number; bannerText: string; dist: number }
interface GhostBird { y: number; vy: number; x: number; dead: boolean }
const freshFx = (): Fx => ({ parts: [], shake: 0, flapT: 0, banner: 0, bannerText: '', dist: 0 });
const freshGhost = (): GhostBird => ({ y: H * 0.42, vy: 0, x: GHOST_X, dead: false });

function puff(fx: Fx, x: number, y: number, n: number, c: string, spread = 90) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = 20 + Math.random() * spread;
    fx.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4 + Math.random() * 0.4, max: 0.8, c, sz: 3 });
  }
}

/** Fill the sideways screen: world height is fixed, width follows the phone. */
function layout() {
  const aw = Math.max(200, window.innerWidth - 8), ah = Math.max(160, window.innerHeight - 36 - 8);
  const scale = Math.min(ah / H, aw / MIN_W);
  return { scale, vw: clampW(aw / scale) };
}

function drawFeather(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x - 2, y - 7, 4, 12);
  ctx.fillRect(x - 4, y - 5, 2, 8);
  ctx.fillStyle = '#e8b04a';
  ctx.fillRect(x + 2, y - 5, 2, 8);
  ctx.fillStyle = '#b07a44';
  ctx.fillRect(x - 1, y + 5, 2, 4);
}

function draw(ctx: CanvasRenderingContext2D, w: World, flier: string, fx: Fx, ghost: Ghost | null | undefined, gb: GhostBird) {
  ctx.imageSmoothingEnabled = false;
  const W = w.vw;
  const phase = Math.floor(w.score / 10) % SCENES.length;
  ctx.save();
  if (fx.shake > 0 && !reduced()) ctx.translate((Math.random() - 0.5) * fx.shake * 10, (Math.random() - 0.5) * fx.shake * 10);
  // layer 0: sky
  const [top, bottom] = SKIES[phase];
  const grad = ctx.createLinearGradient(0, 0, 0, GROUND);
  grad.addColorStop(0, top); grad.addColorStop(1, bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(-10, -10, W + 20, H + 20);
  // layer 1: far hills (slowest)
  ctx.fillStyle = phase === 3 ? '#3a3a66' : '#a9cfa0';
  const hx = fx.dist * 0.1;
  for (let x = -8; x < W + 8; x += 8) {
    const hh = 40 + Math.sin((x + hx) * 0.012) * 18 + Math.sin((x + hx) * 0.031) * 8;
    ctx.fillRect(x, GROUND - 60 - hh, 8, hh + 60);
  }
  // layer 2: the scene art
  const scene = img(`/scenes/${SCENES[phase]}.webp`);
  if (scene.complete && scene.naturalWidth) {
    const sh = GROUND * 0.8, sw = sh * (scene.naturalWidth / scene.naturalHeight);
    const off = -((fx.dist * 0.3) % sw);
    ctx.globalAlpha = 0.55;
    for (let x = off; x < W; x += sw) ctx.drawImage(scene, x, GROUND - sh, sw, sh);
    ctx.globalAlpha = 1;
  }
  // layer 3: clouds
  ctx.fillStyle = '#ffffffb0';
  for (let i = 0; i < 5; i++) {
    const span = W + 160;
    const cx = ((i * 263 - fx.dist * 0.45) % span + span) % span - 80, cy = 30 + ((i * 71) % 90);
    ctx.fillRect(cx, cy, 56, 10); ctx.fillRect(cx + 10, cy - 8, 30, 8); ctx.fillRect(cx + 6, cy + 10, 44, 4);
  }
  // gusts: streaks that show which way the wind blows
  for (const g of w.gusts) {
    const up = g.force < 0;
    ctx.fillStyle = up ? 'rgba(160,220,255,0.16)' : 'rgba(120,120,170,0.16)';
    ctx.fillRect(g.x, 0, g.w, GROUND);
    ctx.fillStyle = up ? 'rgba(255,255,255,0.7)' : 'rgba(60,60,110,0.55)';
    for (let k = 0; k < 9; k++) {
      const sx = g.x + 8 + ((k * 37) % Math.max(1, g.w - 16));
      const sy = (((k * 61 + (up ? -1 : 1) * w.t * 220) % GROUND) + GROUND) % GROUND;
      ctx.fillRect(sx, sy, 2, 14);
      ctx.fillRect(sx - 3, up ? sy : sy + 12, 8, 2);
    }
  }
  for (const p of w.posts) {
    const tp = p.gapY - p.gap / 2, bt = p.gapY + p.gap / 2;
    if (p.kind === 'branch') {
      ctx.fillStyle = '#6b4424';
      ctx.fillRect(p.x + 7, 0, POST_W - 14, tp);
      ctx.fillRect(p.x + 7, bt, POST_W - 14, GROUND - bt);
      ctx.fillStyle = '#4e3018';
      ctx.fillRect(p.x + 7, 0, 4, tp); ctx.fillRect(p.x + 7, bt, 4, GROUND - bt);
      ctx.fillStyle = '#3f8f3a';
      ctx.fillRect(p.x - 3, tp - 16, POST_W + 6, 16);
      ctx.fillRect(p.x - 3, bt, POST_W + 6, 16);
      ctx.fillStyle = '#62b04f';
      ctx.fillRect(p.x + 1, tp - 16, POST_W - 2, 5);
      ctx.fillRect(p.x + 1, bt, POST_W - 2, 5);
    } else {
      const boss = p.kind === 'boss';
      ctx.fillStyle = boss ? '#5a2a30' : '#a4483a';
      ctx.fillRect(p.x + 3, 0, POST_W - 6, tp);
      ctx.fillRect(p.x + 3, bt, POST_W - 6, GROUND - bt);
      ctx.fillStyle = boss ? '#3a1a20' : '#7a2f25';
      for (let y = 6; y < GROUND; y += 12) {
        if (y < tp - 10 || y > bt + 10) ctx.fillRect(p.x + 3, y, POST_W - 6, 2);
      }
      ctx.fillStyle = boss ? '#e8503a' : '#3b3b44';
      ctx.fillRect(p.x - 2, tp - 10, POST_W + 4, 10);
      ctx.fillRect(p.x - 2, bt, POST_W + 4, 10);
      if (boss) {
        // smoke curls off the lip
        ctx.fillStyle = '#ffffff55';
        for (let k = 0; k < 3; k++) {
          const sy = bt + 14 + ((w.t * 30 + k * 12) % 36);
          ctx.fillRect(p.x + 10 + k * 10 + Math.sin(w.t * 3 + k) * 3, sy, 6, 6);
        }
      }
    }
  }
  const bob = Math.sin(w.t * 5) * 3;
  for (const f of w.feathers) drawFeather(ctx, f.x, f.y + bob);
  // ground (moves with the course)
  ctx.fillStyle = '#5c8a3a';
  ctx.fillRect(-10, GROUND, W + 20, H - GROUND + 10);
  ctx.fillStyle = '#7fb24f';
  const g = -(fx.dist % 24);
  for (let x = g; x < W; x += 24) ctx.fillRect(x, GROUND, 12, 5);
  ctx.fillStyle = '#4a7030';
  for (let x = g + 6; x < W; x += 24) ctx.fillRect(x, GROUND + 12, 4, 3);
  // the ghost: see-through, with a soft glow and a floaty bob
  if (ghost) {
    const gi = img(sprite(ghost.sprite, 'side'));
    ctx.save();
    ctx.globalAlpha = gb.dead ? Math.max(0, 0.4 - (gb.y - GROUND) / 200) : 0.4;
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 12;
    ctx.translate(gb.x, gb.y + (gb.dead ? 0 : Math.sin(w.t * 3) * 3));
    if (gb.dead) ctx.rotate(Math.min(2.5, gb.vy / 200));
    if (gi.complete && gi.naturalWidth) ctx.drawImage(gi, -16, -16, 32, 32);
    else { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    if (!gb.dead) {
      ctx.fillStyle = '#ffffffb0';
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${ghost.name} ${ghost.target}`, gb.x, gb.y - 20);
    }
  }
  // the bird: stretch on the flap, squash as it falls
  const bird = img(sprite(flier, 'side'));
  const s = fx.flapT > 0 ? 1 + fx.flapT * 0.35 : 1 - Math.min(0.12, Math.max(0, w.vy) / 3000);
  const blink = w.grace > 0 && Math.floor(w.t * 12) % 2 === 0;
  ctx.save();
  ctx.translate(BIRD_X, w.y);
  ctx.rotate(Math.max(-0.5, Math.min(1.1, w.vy / 400)));
  ctx.scale(1 / s, s);
  if (!blink) {
    if (bird.complete && bird.naturalWidth) ctx.drawImage(bird, -17, -17, 34, 34);
    else { ctx.fillStyle = '#e8b04a'; ctx.beginPath(); ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore();
  if (w.shields > 0) {
    ctx.strokeStyle = `rgba(255,236,150,${0.5 + Math.sin(w.t * 6) * 0.2})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(BIRD_X, w.y, 20, 0, Math.PI * 2); ctx.stroke();
  }
  for (const p of fx.parts) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.c;
    ctx.fillRect(p.x, p.y, p.sz, p.sz);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // HUD
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 4;
  ctx.font = 'bold 34px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.strokeText(String(w.score), W / 2, 44);
  ctx.fillText(String(w.score), W / 2, 44);
  drawFeather(ctx, 16, 20);
  ctx.font = 'bold 14px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.lineWidth = 3;
  const fl = `${w.got % SHIELD_AT}/${SHIELD_AT}`;
  ctx.strokeText(fl, 28, 25);
  ctx.fillText(fl, 28, 25);
  for (let i = 0; i < w.shields; i++) {
    ctx.strokeStyle = '#ffe46a';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(22 + i * 18, 44, 6, 0, Math.PI * 2); ctx.stroke();
  }
  if (fx.banner > 0) {
    ctx.globalAlpha = Math.min(1, fx.banner);
    ctx.fillStyle = '#000000a0';
    ctx.fillRect(0, H / 2 - 22, W, 36);
    ctx.fillStyle = '#ffe46a';
    ctx.font = 'bold 18px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(fx.bannerText, W / 2, H / 2 + 2);
    ctx.globalAlpha = 1;
  }
}

export function Game({ save, onSave, onScore, onAchieve, paused, best, ghost }: GameProps<Save>) {
  const [prog, setProg] = useState<Save>(() => ({ unlocked: save?.unlocked?.length ? save.unlocked : ['pip'], chosen: save?.chosen ?? 'pip' }));
  const resumable = isCurrent(save?.run) && !save!.run!.dead;
  const [mode, setMode] = useState<Mode>(resumable ? 'resume' : 'ready');
  const [size, setSize] = useState(layout);
  const world = useRef<World>(resumable ? save!.run! : fresh(size.vw));
  const [final, setFinal] = useState(0);
  const [newFliers, setNewFliers] = useState<string[]>([]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const fx = useRef<Fx>(freshFx());
  const gb = useRef<GhostBird>(freshGhost());
  const { scale, vw } = size;

  useEffect(() => {
    const f = () => setSize(layout());
    window.addEventListener('resize', f);
    window.addEventListener('orientationchange', f);
    return () => { window.removeEventListener('resize', f); window.removeEventListener('orientationchange', f); };
  }, []);

  // Size the canvas for the device.
  useEffect(() => {
    world.current = { ...world.current, vw };
    const c = canvas.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(vw * scale * dpr);
    c.height = Math.round(H * scale * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    draw(ctx, world.current, prog.chosen, fx.current, ghost, gb.current);
    // Redraw once sprites arrive.
    const t = setTimeout(() => draw(ctx, world.current, prog.chosen, fx.current, ghost, gb.current), 300);
    return () => clearTimeout(t);
  }, [scale, vw, prog.chosen, ghost]);

  // Keep a paused run in the save, so the needs-you banner can't lose it.
  useEffect(() => {
    if (paused && mode === 'play') {
      setMode('resume');
      onSave({ ...prog, run: world.current });
    }
  }, [paused, mode, prog, onSave]);

  useEffect(() => {
    if (paused || mode !== 'play') return;
    const ctx = canvas.current!.getContext('2d')!;
    let raf = 0;
    let last = performance.now();
    let seen = world.current.score;
    let lastTick = 0;
    const tick = (n: number, now: number) => { if (now - lastTick > 150) { lastTick = now; ticks(n); } };
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const prev = world.current;
      const w = step(prev, dt);
      world.current = w;
      const f = fx.current;
      if (!w.dead) f.dist += speedFor(prev.score) * dt;
      for (const p of f.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 200 * dt; p.life -= dt; }
      f.parts = f.parts.filter((p) => p.life > 0).slice(-160);
      f.shake = Math.max(0, f.shake - dt * 3);
      f.flapT = Math.max(0, f.flapT - dt * 5);
      f.banner = Math.max(0, f.banner - dt);
      // the ghost flies the course until its target, then tumbles
      const g = gb.current;
      if (ghost) {
        if (!g.dead) {
          const want = courseY(w.posts, GHOST_X);
          g.y += (want - g.y) * Math.min(1, dt * 6);
          if (ghostPassed(w.posts, w) >= ghost.target) {
            const next = w.posts.find((p) => p.x + POST_W >= GHOST_X);
            if (next && next.x - GHOST_X < 12) { g.dead = true; g.vy = -120; puff(f, g.x, g.y, 8, '#ffffff'); }
          }
        } else if (g.y < H + 60) {
          g.vy += GRAVITY * 0.6 * dt; g.y += g.vy * dt; g.x -= speedFor(w.score) * dt * 0.5;
        }
      }
      if (w.got > prev.got) {
        sfx('coin');
        puff(f, BIRD_X + 6, w.y, 6, '#ffe46a', 60);
        if (w.shields > prev.shields) { tick(2, now); onAchieve('shield'); f.banner = 1; f.bannerText = 'Shield!'; }
      }
      if (w.shields < prev.shields && !w.dead) {
        sfx('hit'); tick(4, now); f.shake = 0.7; puff(f, BIRD_X, w.y, 12, '#ffe46a', 120);
      }
      if (w.gusts.some((gu) => BIRD_X >= gu.x && BIRD_X <= gu.x + gu.w) && !prev.gusts.some((gu) => BIRD_X >= gu.x && BIRD_X <= gu.x + gu.w)) sfx('whoosh');
      if (w.n > prev.n && w.n % 20 === 16) { f.banner = 1.6; f.bannerText = 'Chimney stretch!'; }
      if (w.score !== seen) {
        seen = w.score;
        sfx('score');
        tick(1, now);
        if (w.score >= 1) onAchieve('first');
        if (w.score >= 10) onAchieve('ten');
        if (w.score >= 20) { onAchieve('chimney'); onAchieve('boss'); }
        if (w.score >= 50) onAchieve('fifty');
        if (w.score % 20 === 0) { f.banner = 1.2; f.bannerText = 'Stretch cleared!'; }
      }
      draw(ctx, w, prog.chosen, f, ghost, g);
      if (w.dead) {
        sfx('crash');
        buzz('fail');
        f.shake = 1;
        puff(f, BIRD_X, w.y, 16, '#ffffff', 140);
        draw(ctx, w, prog.chosen, f, ghost, g);
        const got = unlockedBy(w.score).filter((n) => !prog.unlocked.includes(n));
        const next: Save = { unlocked: [...prog.unlocked, ...got], chosen: prog.chosen, run: null };
        if (next.unlocked.length > 1) onAchieve('friend');
        setNewFliers(got);
        setProg(next);
        setFinal(w.score);
        onScore(w.score);
        onSave(next); // persistent: unlocks outlive the run
        setMode('over');
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [paused, mode, prog, onAchieve, onSave, onScore, ghost]);

  const doFlap = () => {
    world.current = flap(world.current);
    fx.current.flapT = 1;
    puff(fx.current, BIRD_X - 12, world.current.y + 8, 3, '#ffffffc0', 40);
    sfx('tap');
  };
  const tap = () => {
    if (paused) return;
    if (mode === 'ready') { world.current = fresh(vw); fx.current = freshFx(); gb.current = freshGhost(); doFlap(); setMode('play'); }
    else if (mode === 'play') doFlap();
    else if (mode === 'resume') { doFlap(); setMode('play'); }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === ' ' || e.key === 'ArrowUp') { e.preventDefault(); tap(); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const choose = (name: string) => {
    const next = { ...prog, chosen: name };
    setProg(next);
    onSave({ ...next, run: null });
  };
  const again = () => { world.current = fresh(vw); fx.current = freshFx(); gb.current = freshGhost(); setNewFliers([]); setMode('ready'); };
  const nextLock = FLIERS.find((f) => !prog.unlocked.includes(f.name));

  const picker = (
    <div className="game-flappy-pick" onPointerDown={(e) => e.stopPropagation()}>
      {FLIERS.map((f) => {
        const open = prog.unlocked.includes(f.name);
        return (
          <button
            key={f.name}
            className={`game-flappy-flier${f.name === prog.chosen ? ' on' : ''}`}
            disabled={!open}
            onClick={(e) => { e.stopPropagation(); choose(f.name); }}
            aria-label={open ? `Fly as ${f.name}` : `Locked until ${f.at}`}
          >
            {open ? <img src={sprite(f.name, 'idle')} alt="" /> : <span>{f.at}</span>}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="game-flappy">
      <div className="game-flappy-wrap" style={{ width: vw * scale, height: H * scale }} onPointerDown={tap}>
        <canvas ref={canvas} style={{ width: vw * scale, height: H * scale }} />
        {mode === 'ready' && (
          <div className="game-overlay">
            <img src={sprite(prog.chosen, 'cheer')} alt="" />
            <p>Tap to flap. Grab feathers: every {SHIELD_AT} is a shield. Mind the wind.</p>
            {ghost && <p className="game-flappy-dim">{ghost.name}'s ghost flies with you and drops at {ghost.target}.</p>}
            {picker}
            {nextLock && <p className="game-flappy-dim">{nextLock.name} joins at {nextLock.at} · tap to start</p>}
          </div>
        )}
        {mode === 'resume' && (
          <div className="game-overlay">
            <img src={sprite(prog.chosen, 'peek')} alt="" />
            <p>Paused at {world.current.score}. Tap to continue.</p>
          </div>
        )}
        {mode === 'over' && (
          <div className="game-overlay" onPointerDown={(e) => e.stopPropagation()}>
            <img src={sprite(prog.chosen, 'think')} alt="" />
            <p>{final} {final === 1 ? 'gap' : 'gaps'}. {best !== undefined && final >= best && final > 0 ? 'Best yet!' : 'Again?'}</p>
            {ghost && <p className="game-flappy-dim">{final > ghost.target ? `You outflew ${ghost.name}'s ghost.` : `${ghost.name}'s ghost made ${ghost.target}.`}</p>}
            {newFliers.length > 0 && <p><b>{newFliers.join(', ')}</b> can fly now!</p>}
            {picker}
            <button className="chip" onClick={again}>Fly again</button>
          </div>
        )}
      </div>
    </div>
  );
}
