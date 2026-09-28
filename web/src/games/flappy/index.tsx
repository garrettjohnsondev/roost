import { useEffect, useRef, useState } from 'react';
import type { GameMeta, GameProps } from '../types';
import { sprite } from '../types';
import { BIRD_R, BIRD_X, FLIERS, GROUND, H, POST_W, W, flap, fresh, step, unlockedBy, type World } from './logic';
import './style.css';

/** Flap: tap to keep a crew bird aloft through gaps in branches and chimneys.
 *  The save persists (who's unlocked, who's flying); a paused run rides
 *  along in it so the needs-you banner never costs a run. */
export const meta: GameMeta = {
  id: 'flappy',
  name: 'Flap',
  blurb: 'One tap, one flap. Thread the branches.',
  host: 'wren',
  pack: 'quick',
  achievements: [
    { id: 'first', name: 'Lift-off', says: 'Pass one gap.' },
    { id: 'ten', name: 'Treeline', says: 'Pass 10 gaps in a run.' },
    { id: 'chimney', name: 'Rooftops', says: 'Reach the chimneys (20).' },
    { id: 'fifty', name: 'Migration', says: 'Pass 50 gaps in a run.' },
    { id: 'friend', name: 'New wings', says: 'Unlock a second flier.' },
  ],
  inProgress: (s: { run?: unknown }) => !!s?.run,
};

interface Save { unlocked: string[]; chosen: string; run?: World | null }
type Mode = 'ready' | 'play' | 'resume' | 'over';

const SCENES = ['picnic', 'orchard', 'rooftop', 'lanterns'];
const imgCache = new Map<string, HTMLImageElement>();
function img(src: string) {
  let i = imgCache.get(src);
  if (!i) { i = new Image(); i.src = src; imgCache.set(src, i); }
  return i;
}

function draw(ctx: CanvasRenderingContext2D, w: World, flier: string, bgX: number) {
  ctx.imageSmoothingEnabled = false;
  const scene = img(`/scenes/${SCENES[Math.floor(w.score / 10) % SCENES.length]}.webp`);
  ctx.fillStyle = '#9fc9e8';
  ctx.fillRect(0, 0, W, H);
  if (scene.complete && scene.naturalWidth) {
    const sh = GROUND, sw = sh * (scene.naturalWidth / scene.naturalHeight);
    const off = -(bgX % sw);
    for (let x = off; x < W; x += sw) ctx.drawImage(scene, x, 0, sw, sh);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(0, 0, W, GROUND);
  }
  for (const p of w.posts) {
    const top = p.gapY - p.gap / 2, bot = p.gapY + p.gap / 2;
    if (p.kind === 'branch') {
      ctx.fillStyle = '#6b4424';
      ctx.fillRect(p.x + 8, 0, POST_W - 16, top);
      ctx.fillRect(p.x + 8, bot, POST_W - 16, GROUND - bot);
      ctx.fillStyle = '#3f8f3a';
      ctx.fillRect(p.x, top - 18, POST_W, 18);
      ctx.fillRect(p.x, bot, POST_W, 18);
      ctx.fillStyle = '#62b04f';
      ctx.fillRect(p.x + 4, top - 18, POST_W - 8, 6);
      ctx.fillRect(p.x + 4, bot, POST_W - 8, 6);
    } else {
      ctx.fillStyle = '#a4483a';
      ctx.fillRect(p.x + 4, 0, POST_W - 8, top);
      ctx.fillRect(p.x + 4, bot, POST_W - 8, GROUND - bot);
      ctx.fillStyle = '#7a2f25';
      for (let y = 8; y < GROUND; y += 16) {
        if (y < top - 12 || y > bot + 12) ctx.fillRect(p.x + 4, y, POST_W - 8, 2);
      }
      ctx.fillStyle = '#3b3b44';
      ctx.fillRect(p.x, top - 12, POST_W, 12);
      ctx.fillRect(p.x, bot, POST_W, 12);
    }
  }
  ctx.fillStyle = '#5c8a3a';
  ctx.fillRect(0, GROUND, W, H - GROUND);
  ctx.fillStyle = '#7fb24f';
  const g = -(bgX * 4) % 24;
  for (let x = g; x < W; x += 24) ctx.fillRect(x, GROUND, 12, 6);
  const bird = img(sprite(flier, 'side'));
  if (bird.complete && bird.naturalWidth) {
    ctx.save();
    ctx.translate(BIRD_X, w.y);
    ctx.rotate(Math.max(-0.5, Math.min(1.1, w.vy / 600)));
    ctx.drawImage(bird, -22, -22, 44, 44);
    ctx.restore();
  } else {
    ctx.fillStyle = '#e8b04a';
    ctx.beginPath(); ctx.arc(BIRD_X, w.y, BIRD_R, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 4;
  ctx.font = 'bold 40px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.strokeText(String(w.score), W / 2, 60);
  ctx.fillText(String(w.score), W / 2, 60);
}

export function Game({ save, onSave, onScore, onAchieve, paused, best }: GameProps<Save>) {
  const [prog, setProg] = useState<Save>(() => ({ unlocked: save?.unlocked?.length ? save.unlocked : ['pip'], chosen: save?.chosen ?? 'pip' }));
  const [mode, setMode] = useState<Mode>(save?.run && !save.run.dead ? 'resume' : 'ready');
  const world = useRef<World>(save?.run && !save.run.dead ? save.run : fresh());
  const [final, setFinal] = useState(0);
  const [newFliers, setNewFliers] = useState<string[]>([]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const bgX = useRef(0);
  const scale = Math.min((Math.min(window.innerWidth, 420) - 16) / W, (window.innerHeight - 150) / H);

  // Size the canvas for the device.
  useEffect(() => {
    const c = canvas.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(W * scale * dpr);
    c.height = Math.round(H * scale * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    draw(ctx, world.current, prog.chosen, bgX.current);
    // Redraw once sprites arrive.
    const t = setTimeout(() => draw(ctx, world.current, prog.chosen, bgX.current), 300);
    return () => clearTimeout(t);
  }, [scale, prog.chosen]);

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
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const w = step(world.current, dt);
      world.current = w;
      if (!w.dead) bgX.current += dt * 18;
      if (w.score !== seen) {
        seen = w.score;
        if (w.score >= 1) onAchieve('first');
        if (w.score >= 10) onAchieve('ten');
        if (w.score >= 20) onAchieve('chimney');
        if (w.score >= 50) onAchieve('fifty');
      }
      draw(ctx, w, prog.chosen, bgX.current);
      if (w.dead) {
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
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, mode, prog, onAchieve, onSave, onScore]);

  const tap = () => {
    if (paused) return;
    if (mode === 'ready') { world.current = flap(fresh()); setMode('play'); }
    else if (mode === 'play') world.current = flap(world.current);
    else if (mode === 'resume') { world.current = flap(world.current); setMode('play'); }
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
  const again = () => { world.current = fresh(); setNewFliers([]); setMode('ready'); };
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
      <div className="game-flappy-wrap" style={{ width: W * scale, height: H * scale }} onPointerDown={tap}>
        <canvas ref={canvas} style={{ width: W * scale, height: H * scale }} />
        {mode === 'ready' && (
          <div className="game-overlay">
            <img src={sprite(prog.chosen, 'cheer')} alt="" />
            <p>Tap anywhere to flap. Slip through the gaps.</p>
            {picker}
            {nextLock && <p className="game-flappy-dim">{nextLock.name} joins at {nextLock.at}</p>}
            <p className="game-flappy-dim">Tap to start</p>
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
            {newFliers.length > 0 && <p><b>{newFliers.join(', ')}</b> can fly now!</p>}
            {picker}
            <button className="chip" onClick={again}>Fly again</button>
          </div>
        )}
      </div>
    </div>
  );
}
