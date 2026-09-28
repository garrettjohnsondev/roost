import { Icon } from '../../icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameMeta, GameProps } from '../types';
import { sprite } from '../types';
import { LEVELS, type BirdName } from './levels';
import { BIRDS, DT, SLING, Sim, type Phase } from './game';
import { birdName, drawFrame, GROUND_SHOW, img, VIEW_W, type Aim, type Cam } from './render';
import { GROUND_Y } from './levels';
import './style.css';

/** Roost Birds: the crew slings themselves at forts full of bugs. A small
 *  hand-rolled rigid-body engine (physics.ts), fourteen forts (levels.ts),
 *  the rules (game.ts) and pixel drawing (render.ts); this file is the
 *  screens, the input and the loop. */
export const meta: GameMeta = {
  id: 'roostbirds',
  name: 'Roost Birds',
  blurb: 'Bugs in the code. Fling the crew at them.',
  host: 'pip',
  pack: 'stretch',
  achievements: [
    { id: 'first', name: 'First fix', says: 'Clear a fort.' },
    { id: 'perfect', name: 'Clean build', says: 'Three stars on a fort.' },
    { id: 'oneshot', name: 'One-liner', says: 'Clear a fort with your first bird.' },
    { id: 'finale', name: 'Heisenbug caught', says: 'Beat fort 12.' },
    { id: 'collector', name: 'Code review', says: 'Collect 30 stars.' },
  ],
};

interface Save { stars: number[]; unlocked: number }

function normalize(s: Save | null): Save {
  const stars = LEVELS.map((_, i) => Math.max(0, Math.min(3, Number(s?.stars?.[i]) || 0)));
  const unlocked = Math.max(1, Math.min(LEVELS.length, Number(s?.unlocked) || 1));
  return { stars, unlocked };
}

const ALL_BIRDS: BirdName[] = ['rue', 'pip', 'ollie', 'wren', 'moss'];

export function Game({ save, onSave, onScore, onAchieve, paused }: GameProps<Save>) {
  const [prog, setProg] = useState<Save>(() => normalize(save));
  const [playing, setPlaying] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);

  // preload sprites so the first shot isn't a yellow dot
  useEffect(() => {
    for (const n of ALL_BIRDS) for (const p of ['idle', 'side', 'think', 'cheer']) img(sprite(n, p));
  }, []);

  const progRef = useRef(prog);
  progRef.current = prog;
  const finish = useCallback((idx: number, won: boolean, score: number, stars: number, firstBird: boolean) => {
    if (!won) return;
    onScore(score);
    const p = progRef.current;
    const next: Save = {
      stars: p.stars.map((s, i) => (i === idx ? Math.max(s, stars) : s)),
      unlocked: Math.max(p.unlocked, Math.min(LEVELS.length, idx + 2)),
    };
    progRef.current = next;
    setProg(next);
    onSave(next);
    const total = next.stars.reduce((a, b) => a + b, 0);
    onAchieve('first');
    if (stars >= 3) onAchieve('perfect');
    if (firstBird) onAchieve('oneshot');
    if (idx >= 11) onAchieve('finale');
    if (total >= 30) onAchieve('collector');
  }, [onAchieve, onSave, onScore]);

  if (playing === null) {
    const total = prog.stars.reduce((a, b) => a + b, 0);
    return (
      <div className="game-roostbirds-root">
        <div className="game-roostbirds-title">
          <img src={sprite('pip', 'cheer')} alt="" />
          <div>
            <b>Bugs in the code.</b>
            <span>Drag back, let go, tap mid-air for a trick.</span>
          </div>
          <span className="game-roostbirds-total">★ {total}/{LEVELS.length * 3}</span>
        </div>
        <div className="game-roostbirds-grid">
          {LEVELS.map((l, i) => {
            const locked = i >= prog.unlocked;
            return (
              <button
                key={i}
                className={`game-roostbirds-level${locked ? ' locked' : ''}`}
                disabled={locked}
                onClick={() => { setPlaying(i); setAttempt((a) => a + 1); }}
              >
                <span className="game-roostbirds-num">{locked ? <Icon name="lock" /> : i + 1}</span>
                <span className="game-roostbirds-name">{l.name}</span>
                <span className="game-roostbirds-stars">{[0, 1, 2].map((k) => <i key={k} className={k < prog.stars[i] ? 'on' : ''}>★</i>)}</span>
              </button>
            );
          })}
        </div>
        <div className="game-roostbirds-crew">
          {ALL_BIRDS.map((n) => (
            <div key={n}><img src={sprite(n, 'idle')} alt="" /><span>{BIRDS[n].says}</span></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <Play
      key={`${playing}-${attempt}`}
      idx={playing}
      paused={paused}
      best={prog.stars[playing]}
      hasNext={playing + 1 < LEVELS.length}
      onEnd={finish}
      onRetry={() => setAttempt((a) => a + 1)}
      onNext={() => { setPlaying(playing + 1); setAttempt((a) => a + 1); }}
      onLevels={() => setPlaying(null)}
    />
  );
}

interface Hud { phase: Phase; score: number; current: BirdName | null; queue: BirdName[]; bugs: number; stars: number; ability: boolean }
const hudOf = (s: Sim): Hud => ({ phase: s.phase, score: s.score, current: s.current, queue: [...s.queue], bugs: s.bugsLeft, stars: s.stars, ability: s.abilityUsed });

function Play({ idx, paused, best, hasNext, onEnd, onRetry, onNext, onLevels }: {
  idx: number; paused: boolean; best: number; hasNext: boolean;
  onEnd: (idx: number, won: boolean, score: number, stars: number, firstBird: boolean) => void;
  onRetry: () => void; onNext: () => void; onLevels: () => void;
}) {
  const level = LEVELS[idx];
  const simRef = useRef<Sim>(null as unknown as Sim);
  if (!simRef.current) simRef.current = new Sim(idx);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useRef({ w: 360, h: 260, dpr: 1 });
  const cam = useRef<Cam>({ x: 0, zoom: 0.5 });
  const manualX = useRef<number | null>(null);
  const overview = useRef(true);
  const [overviewOn, setOverviewOn] = useState(false);
  const aim = useRef<Aim | null>(null);
  const drag = useRef<{ kind: 'aim' | 'pan'; x0: number; y0: number; cam0: number; id: number } | null>(null);
  const [hud, setHud] = useState<Hud>(() => hudOf(simRef.current));
  const reported = useRef(false);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;

  // size the canvas to the stage: full width, a landscape-ish window
  useEffect(() => {
    const el = wrapRef.current, c = canvasRef.current;
    if (!el || !c) return;
    const fit = () => {
      const w = Math.max(240, Math.floor(el.clientWidth));
      const h = Math.floor(Math.min(w * 0.8, window.innerHeight * 0.62, 560));
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      size.current = { w, h, dpr };
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const baseZoom = () => size.current.w / VIEW_W;
  const fitZoom = () => Math.min(baseZoom(), size.current.w / (level.width + 30));
  const viewW = () => size.current.w / cam.current.zoom;

  // the loop: fixed physics steps, eased camera, draw, and a HUD sync when it changed
  useEffect(() => {
    if (paused) return;
    const scene = img(`/scenes/${level.scene}.webp`);
    let raf = 0, last = performance.now(), acc = 0, hudKey = '';
    const frame = (now: number) => {
      const sim = simRef.current;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += dt;
      let n = 0;
      while (acc >= DT && n < 20) { sim.step(); acc -= DT; n++; }
      if (n === 20) acc = 0;
      for (const e of sim.events.splice(0)) {
        if ((e === 'boom' || e === 'squash') && typeof navigator.vibrate === 'function') navigator.vibrate(e === 'boom' ? 40 : 15);
      }
      if (sim.phase === 'aim' && overview.current && sim.time > 2.2 && !overviewOn) overview.current = false;

      // camera
      const c = cam.current;
      // aiming frames the sling and the nearest bug fort; flight zooms in close
      let wantZoom = baseZoom();
      if (sim.phase === 'intro' || overview.current) wantZoom = fitZoom();
      else if (sim.phase === 'aim' && manualX.current === null) {
        let near = Infinity;
        for (const b of sim.world.bodies) if (!b.dead && b.invM > 0 && b.mat !== 'bird' && b.mat !== 'egg') near = Math.min(near, b.x);
        if (near < Infinity) wantZoom = Math.max(fitZoom(), Math.min(baseZoom(), size.current.w / (near + 110)));
      }
      c.zoom += (wantZoom - c.zoom) * Math.min(1, dt * 3.5);
      const maxX = Math.max(0, level.width + 60 - viewW());
      let tx = 0;
      if (sim.phase === 'flying') {
        const lead = sim.flyers.filter((f) => !f.dead).reduce((m, f) => Math.max(m, f.x), 0);
        tx = lead ? lead - viewW() * 0.4 : c.x;
        manualX.current = null;
      } else if (sim.phase === 'won' || sim.phase === 'lost') tx = c.x;
      else if (manualX.current !== null) tx = manualX.current;
      if (sim.phase === 'intro' || overview.current) tx = 0;
      tx = Math.max(-20, Math.min(maxX, tx));
      c.x += (tx - c.x) * Math.min(1, dt * (drag.current?.kind === 'pan' ? 20 : 3));

      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) {
        const { w, h, dpr } = size.current;
        drawFrame(ctx, sim, c, w, h, dpr, aim.current, scene);
      }
      const hs = hudOf(sim);
      const key = JSON.stringify(hs);
      if (key !== hudKey) { hudKey = key; setHud(hs); }
      if ((sim.phase === 'won' || sim.phase === 'lost') && !reported.current) {
        reported.current = true;
        endRef.current(idx, sim.phase === 'won', sim.score, sim.stars, sim.phase === 'won' && sim.shots === 1 && level.birds.length >= 3);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, overviewOn]);

  // ---------- input ----------
  const toWorld = (clientX: number, clientY: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const sx = clientX - r.left, sy = clientY - r.top;
    const c = cam.current;
    return { sx, sy, x: c.x + sx / c.zoom, y: GROUND_Y + GROUND_SHOW - (size.current.h - sy) / c.zoom };
  };

  const down = (e: React.PointerEvent) => {
    if (paused || drag.current) return;
    const sim = simRef.current;
    const p = toWorld(e.clientX, e.clientY);
    if (sim.phase === 'intro') { sim.skipIntro(); overview.current = false; return; }
    if (sim.phase === 'flying') { sim.ability(); return; }
    if (sim.phase !== 'aim') return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const nearSling = Math.hypot(p.x - SLING.x, p.y - SLING.y) * cam.current.zoom < 70;
    const leftSide = p.sx < size.current.w * 0.5;
    if (nearSling || leftSide) {
      if (overviewOn) { setOverviewOn(false); overview.current = false; }
      drag.current = { kind: 'aim', x0: p.sx, y0: p.sy, cam0: cam.current.x, id: e.pointerId };
      aim.current = Sim.pull(SLING.x, SLING.y);
    } else {
      drag.current = { kind: 'pan', x0: p.sx, y0: p.sy, cam0: cam.current.x, id: e.pointerId };
    }
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const p = toWorld(e.clientX, e.clientY);
    const z = cam.current.zoom;
    if (d.kind === 'aim') {
      // relative drag: the bird follows your thumb's motion, not its spot
      const k = 1 / z;
      aim.current = Sim.pull(SLING.x + (p.sx - d.x0) * k, SLING.y + (p.sy - d.y0) * k);
    } else {
      manualX.current = d.cam0 - (p.sx - d.x0) / z;
    }
  };
  const up = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.kind === 'aim') {
      const a = aim.current;
      aim.current = null;
      if (a && a.power > 0.15) simRef.current.launch(a.vx, a.vy);
    }
  };
  const cancel = () => { drag.current = null; aim.current = null; };

  const toggleOverview = () => {
    const on = !overviewOn;
    overview.current = on;
    setOverviewOn(on);
    if (!on) manualX.current = null;
  };

  const tip = hud.phase === 'intro' ? `Fort ${idx + 1}: ${level.name}. Tap to start.`
    : hud.phase === 'aim' ? `Drag back on the left half, let go to fling ${birdName(hud.current ?? 'rue')}. Drag the right half to look around.`
      : hud.phase === 'flying' ? (hud.current && hud.current !== 'rue' && !hud.ability ? BIRDS[hud.current].says : 'Watch it fall…')
        : '';

  return (
    <div className="game-roostbirds-root">
      <div className="game-roostbirds-hud">
        <button className="game-roostbirds-btn" onClick={onLevels} aria-label="Levels">☰</button>
        <span className="game-roostbirds-lvl">{idx + 1}. {level.name}</span>
        <span className="game-roostbirds-score">{hud.score.toLocaleString()}</span>
        <button className={`game-roostbirds-btn${overviewOn ? ' on' : ''}`} onClick={toggleOverview} aria-label="See the whole fort">⤢</button>
        <button className="game-roostbirds-btn" onClick={onRetry} aria-label="Restart">↺</button>
      </div>
      <div className="game-roostbirds-birds">
        {hud.current && hud.phase !== 'won' && <img className="now" src={sprite(hud.current, 'idle')} alt={hud.current} />}
        {hud.phase !== 'won' && hud.queue.map((b, i) => <img key={i} src={sprite(b, 'idle')} alt={b} />)}
        <span className="game-roostbirds-bugcount">{hud.bugs} bug{hud.bugs === 1 ? '' : 's'} left</span>
      </div>
      <div className="game-roostbirds-stage" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="game-roostbirds-canvas"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={cancel}
        />
        {(hud.phase === 'won' || hud.phase === 'lost') && (
          <div className="game-roostbirds-end">
            {hud.phase === 'won' ? <>
              <img src={sprite('pip', 'cheer')} alt="" />
              <b>All bugs squashed</b>
              <div className="game-roostbirds-bigstars">
                {[0, 1, 2].map((k) => <i key={k} className={k < hud.stars ? 'on' : ''} style={{ animationDelay: `${0.9 + k * 0.25}s` }}>★</i>)}
              </div>
              <span>{hud.score.toLocaleString()}{hud.stars > best && best > 0 ? ' · new best' : ''}</span>
              <div className="game-roostbirds-row">
                <button className="chip" onClick={onLevels}>Forts</button>
                <button className="chip" onClick={onRetry}>Replay</button>
                {hasNext && <button className="chip active" onClick={onNext}>Next fort</button>}
              </div>
            </> : <>
              <img src={sprite('ollie', 'think')} alt="" />
              <b>{hud.bugs} bug{hud.bugs === 1 ? '' : 's'} still in the code</b>
              <span>Out of birds.</span>
              <div className="game-roostbirds-row">
                <button className="chip" onClick={onLevels}>Forts</button>
                <button className="chip active" onClick={onRetry}>Try again</button>
              </div>
            </>}
          </div>
        )}
      </div>
      <div className="game-roostbirds-tip">{tip}</div>
    </div>
  );
}
