import { Icon } from '../../icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameMeta, GameProps, Ghost } from '../types';
import { sprite } from '../types';
import { sfx } from '../../economy/sound';
import { buzz, ticks } from '../../haptics';
import { LEVELS, type BirdName } from './levels';
import { BIRDS, DT, SLING, Sim, type Phase } from './game';
import { birdName, drawFrame, GROUND_SHOW, img, type Aim, type Cam, type GhostView } from './render';
import { GROUND_Y } from './levels';
import { arc, collapseTicks, ghostFortScore, ghostScore, ghostShot } from './logic';
import './style.css';

/** Roost Birds: the crew slings themselves at forts full of bugs. A small
 *  hand-rolled rigid-body engine (physics.ts), seventeen forts (levels.ts),
 *  the rules (game.ts), pixel drawing (render.ts) and the pure wave-3 helpers
 *  (logic.ts); this file is the screens, the input and the loop. Sideways:
 *  the whole fort fits across the phone, the sling on the left. */
export const meta: GameMeta = {
  id: 'roostbirds',
  name: 'Roost Birds',
  blurb: 'Bugs in the code. Fling the crew at them.',
  host: 'pip',
  pack: 'stretch',
  orientation: 'landscape',
  // the top-right is open sky: nothing to aim at or tap there
  safeCorner: 'tr',
  ghostScore,
  achievements: [
    { id: 'first', name: 'First fix', says: 'Clear a fort.' },
    { id: 'perfect', name: 'Clean build', says: 'Three stars on a fort.' },
    { id: 'oneshot', name: 'One-liner', says: 'Clear a fort with your first bird.' },
    { id: 'finale', name: 'Heisenbug caught', says: 'Beat fort 12.' },
    { id: 'collector', name: 'Code review', says: 'Collect 30 stars.' },
    { id: 'chain', name: 'Cascading failure', says: 'Knock over 12 pieces with one shot.' },
    { id: 'panic', name: 'Kernel panic', says: 'Beat fort 17.' },
  ],
};

interface Save { stars: number[]; unlocked: number }

function normalize(s: Save | null): Save {
  const stars = LEVELS.map((_, i) => Math.max(0, Math.min(3, Number(s?.stars?.[i]) || 0)));
  const unlocked = Math.max(1, Math.min(LEVELS.length, Number(s?.unlocked) || 1));
  return { stars, unlocked };
}

const ALL_BIRDS: BirdName[] = ['rue', 'pip', 'ollie', 'wren', 'moss', 'bly', 'tuck'];
const HEADER = 36;

/** The play area: the whole window under the arcade's slim header. */
function useStageSize() {
  const get = () => ({ w: Math.max(280, window.innerWidth - 16), h: Math.max(220, window.innerHeight - HEADER - 4) });
  const [s, setS] = useState(get);
  useEffect(() => {
    const f = () => setS(get());
    window.addEventListener('resize', f);
    window.addEventListener('orientationchange', f);
    return () => { window.removeEventListener('resize', f); window.removeEventListener('orientationchange', f); };
  }, []);
  return s;
}

const pixels = (rows: string[]) => rows.flatMap((r, y) => [...r].map((c, x) => (c === '#' ? `M${x} ${y}h1v1h-1z` : ''))).join('');
const STAR = pixels(['...#...', '...#...', '#######', '.#####.', '..###..', '.##.##.', '##...##']);
/** A pixel star (no emoji, no font glyph). */
function Star({ on, size = 14, style, className }: { on: boolean; size?: number; style?: React.CSSProperties; className?: string }) {
  return (
    <svg className={`game-roostbirds-star${on ? ' on' : ''}${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 7 7" style={style} aria-hidden>
      <path d={STAR} fill="currentColor" shapeRendering="crispEdges" />
    </svg>
  );
}
function Glyph({ d }: { d: string }) {
  return <svg width="14" height="14" viewBox="0 0 7 7" aria-hidden><path d={d} fill="currentColor" shapeRendering="crispEdges" /></svg>;
}
const MAP_ICON = pixels(['.......', '#######', '.......', '#######', '.......', '#######', '.......']);
const RETRY_ICON = pixels(['.###.#.', '#...##.', '#..###.', '#......', '#.....#', '.#...#.', '..###..']);

export function Game({ save, onSave, onScore, onAchieve, paused, ghost }: GameProps<Save>) {
  const [prog, setProg] = useState<Save>(() => normalize(save));
  const [playing, setPlaying] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const size = useStageSize();

  // preload sprites so the first shot isn't a yellow dot
  useEffect(() => {
    for (const n of ALL_BIRDS) for (const p of ['idle', 'side', 'think', 'cheer']) img(sprite(n, p));
    if (ghost) img(sprite(ghost.sprite, 'idle'));
  }, [ghost]);

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
    if (idx >= 16) onAchieve('panic');
    if (total >= 30) onAchieve('collector');
  }, [onAchieve, onSave, onScore]);

  if (playing === null) {
    return <WorldMap prog={prog} size={size} ghost={ghost ?? null} onPick={(i) => { setPlaying(i); setAttempt((a) => a + 1); }} />;
  }

  return (
    <Play
      key={`${playing}-${attempt}`}
      idx={playing}
      paused={paused}
      best={prog.stars[playing]}
      hasNext={playing + 1 < LEVELS.length}
      size={size}
      ghost={ghost ?? null}
      onEnd={finish}
      onChain={() => onAchieve('chain')}
      onRetry={() => setAttempt((a) => a + 1)}
      onNext={() => { setPlaying(playing + 1); setAttempt((a) => a + 1); }}
      onLevels={() => setPlaying(null)}
    />
  );
}

/** The forts as a winding trail across the sideways screen, stars under each. */
function WorldMap({ prog, size, ghost, onPick }: { prog: Save; size: { w: number; h: number }; ghost: Ghost | null; onPick: (i: number) => void }) {
  const total = prog.stars.reduce((a, b) => a + b, 0);
  const mapH = Math.max(150, size.h - 112);
  const step = 92;
  const pts = LEVELS.map((_, i) => ({ x: 56 + i * step, y: mapH * (0.5 + 0.3 * Math.sin(i * 1.15)) }));
  const width = pts[pts.length - 1].x + 90;
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
  const scroller = useRef<HTMLDivElement>(null);
  // start scrolled to the newest fort
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, pts[prog.unlocked - 1].x - el.clientWidth / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="game-roostbirds-root" style={{ height: size.h }}>
      <div className="game-roostbirds-title">
        <img src={sprite('pip', 'cheer')} alt="" />
        <div>
          <b>Bugs in the code.</b>
          <span>Drag back, let go, tap mid-air for a trick.</span>
        </div>
        <span className="game-roostbirds-total"><Star on size={14} /> {total}/{LEVELS.length * 3}</span>
        {ghost && <span className="game-roostbirds-ghostchip"><img src={sprite(ghost.sprite, 'idle')} alt="" />{ghost.name}'s ghost is out</span>}
      </div>
      <div className="game-roostbirds-map" ref={scroller} style={{ height: mapH }}>
        <div className="game-roostbirds-mapinner" style={{ width, height: mapH }}>
          <svg className="game-roostbirds-path" width={width} height={mapH} aria-hidden>
            <path d={path} fill="none" stroke="rgba(90,60,30,0.55)" strokeWidth="6" strokeDasharray="10 8" />
          </svg>
          {LEVELS.map((l, i) => {
            const locked = i >= prog.unlocked;
            const boss = l.bugs.some((b) => b.boss);
            return (
              <button
                key={i}
                className={`game-roostbirds-node${locked ? ' locked' : ''}${boss ? ' boss' : ''}${i === prog.unlocked - 1 ? ' next' : ''}`}
                style={{ left: pts[i].x - 26, top: pts[i].y - 26 }}
                disabled={locked}
                onClick={() => { sfx('tap'); onPick(i); }}
                title={l.name}
              >
                <span className="game-roostbirds-num">{locked ? <Icon name="lock" /> : i + 1}</span>
                <span className="game-roostbirds-stars">{[0, 1, 2].map((k) => <Star key={k} on={k < prog.stars[i]} size={10} />)}</span>
                <span className="game-roostbirds-name">{l.name}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="game-roostbirds-crew">
        {ALL_BIRDS.map((n) => (
          <div key={n}><img src={sprite(n, 'idle')} alt="" /><span>{BIRDS[n].says}</span></div>
        ))}
      </div>
    </div>
  );
}

interface Hud { phase: Phase; score: number; current: BirdName | null; queue: BirdName[]; bugs: number; stars: number; ability: boolean; slow: boolean }
const hudOf = (s: Sim): Hud => ({ phase: s.phase, score: s.score, current: s.current, queue: [...s.queue], bugs: s.bugsLeft, stars: s.stars, ability: s.abilityUsed, slow: s.slowmo > 0 });

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function Play({ idx, paused, best, hasNext, size, ghost, onEnd, onChain, onRetry, onNext, onLevels }: {
  idx: number; paused: boolean; best: number; hasNext: boolean; size: { w: number; h: number }; ghost: Ghost | null;
  onEnd: (idx: number, won: boolean, score: number, stars: number, firstBird: boolean) => void;
  onChain: () => void; onRetry: () => void; onNext: () => void; onLevels: () => void;
}) {
  const level = LEVELS[idx];
  const simRef = useRef<Sim>(null as unknown as Sim);
  if (!simRef.current) simRef.current = new Sim(idx);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dims = useRef({ w: 360, h: 260, dpr: 1 });
  const cam = useRef<Cam>({ x: -20, zoom: 0.5 });
  const manualX = useRef<number | null>(null);
  const aim = useRef<Aim | null>(null);
  const drag = useRef<{ kind: 'aim' | 'pan'; x0: number; y0: number; cam0: number; id: number } | null>(null);
  const [hud, setHud] = useState<Hud>(() => hudOf(simRef.current));
  const reported = useRef(false);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  const chainRef = useRef(onChain);
  chainRef.current = onChain;
  const reduced = useMemo(reducedMotion, []);

  const ghostView = useMemo<GhostView | null>(() => {
    if (!ghost) return null;
    const s = ghostShot(level, ghost.strength);
    return { sprite: ghost.sprite, name: ghost.name, arc: arc(s.vx, s.vy, level.width + 60) };
  }, [ghost, level]);
  const ghostFort = ghost ? ghostFortScore(level, ghost.strength) : 0;

  // the canvas fills the stage
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const { w, h } = size;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    dims.current = { w, h, dpr };
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }, [size]);

  // the whole fort, sling included, fits across the screen with sky to spare
  const fitZoom = () => Math.min(dims.current.w / (level.width + 60), dims.current.h / (GROUND_SHOW + 250));
  const viewW = () => dims.current.w / cam.current.zoom;

  // the loop: fixed physics steps (slower in slow-mo), eased camera, draw, HUD sync
  useEffect(() => {
    if (paused) return;
    const scene = img(`/scenes/${level.scene}.webp`);
    let raf = 0, last = performance.now(), acc = 0, hudKey = '';
    const lastSfx: Record<string, number> = {};
    const say = (name: string, gap = 120) => {
      const t = performance.now();
      if ((lastSfx[name] ?? 0) + gap > t) return;
      lastSfx[name] = t;
      sfx(name);
    };
    const frame = (now: number) => {
      const sim = simRef.current;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += dt * sim.tickReal(dt);
      let n = 0;
      while (acc >= DT && n < 20) { sim.step(); acc -= DT; n++; }
      if (n === 20) acc = 0;
      for (const e of sim.events.splice(0)) {
        if (e === 'launch') { say('whoosh'); ticks(1); }
        else if (e === 'impact') { say('hit'); ticks(1); }
        else if (e.startsWith('collapse:')) {
          const [, b, m] = e.split(':');
          const k = collapseTicks(Number(b), Number(m));
          if (k > 0) ticks(k, 40);
          if (k >= 6) say('crash', 300);
          if (k >= 12) chainRef.current();
        } else if (e === 'break') say('crash', 260);
        else if (e === 'boom') say('crash', 150);
        else if (e === 'squash') say('score', 150);
        else if (e === 'bounce') say('bounce', 150);
        else if (e === 'ability') say('tap');
        else if (e === 'won') { sfx('win'); buzz('pass'); }
        else if (e === 'lost') { sfx('lose'); buzz('fail'); }
      }

      // camera: aiming shows the whole fort; flight leans in and follows
      const c = cam.current;
      const fit = fitZoom();
      let wantZoom = fit;
      let tx = -20;
      if (sim.slowmoAt) {
        wantZoom = Math.min(fit * 1.7, dims.current.h / (GROUND_SHOW + 150));
        tx = sim.slowmoAt.x - dims.current.w / wantZoom / 2;
      } else if (sim.phase === 'flying') {
        wantZoom = Math.max(fit, Math.min(fit * 1.3, dims.current.h / (GROUND_SHOW + 230)));
        const lead = sim.flyers.filter((f) => !f.dead).reduce((m, f) => Math.max(m, f.x), 0);
        tx = lead ? lead - viewW() * 0.45 : c.x;
        manualX.current = null;
      } else if (sim.phase === 'won' || sim.phase === 'lost') tx = c.x;
      else if (manualX.current !== null) tx = manualX.current;
      c.zoom += (wantZoom - c.zoom) * Math.min(1, dt * 3.5);
      const maxX = Math.max(-20, level.width + 40 - viewW());
      tx = Math.max(-20, Math.min(maxX, tx));
      c.x += (tx - c.x) * Math.min(1, dt * (drag.current?.kind === 'pan' ? 20 : 3));

      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) {
        const { w, h, dpr } = dims.current;
        drawFrame(ctx, sim, c, w, h, dpr, aim.current, scene, { ghost: ghostView, reduced });
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
  }, [paused, ghostView]);

  // ---------- input ----------
  const toWorld = (clientX: number, clientY: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const sx = clientX - r.left, sy = clientY - r.top;
    const c = cam.current;
    return { sx, sy, x: c.x + sx / c.zoom, y: GROUND_Y + GROUND_SHOW - (dims.current.h - sy) / c.zoom };
  };

  const down = (e: React.PointerEvent) => {
    if (paused || drag.current) return;
    const sim = simRef.current;
    const p = toWorld(e.clientX, e.clientY);
    if (sim.phase === 'intro') { sim.skipIntro(); return; }
    if (sim.phase === 'flying') { sim.ability(); return; }
    if (sim.phase !== 'aim') return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const nearSling = Math.hypot(p.x - SLING.x, p.y - SLING.y) * cam.current.zoom < 70;
    const leftSide = p.sx < dims.current.w * 0.5;
    if (nearSling || leftSide) {
      drag.current = { kind: 'aim', x0: p.sx, y0: p.sy, cam0: cam.current.x, id: e.pointerId };
      aim.current = Sim.pull(SLING.x, SLING.y);
      sfx('tap');
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
      // relative drag: the bird follows your thumb's motion, not its spot;
      // a floor on the scale so a zoomed-out fort still aims comfortably
      const k = 1 / Math.max(z, 0.9);
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

  const tip = hud.phase === 'intro' ? `Fort ${idx + 1}: ${level.name}. Tap to start.`
    : hud.phase === 'aim' ? `Drag back on the left half, let go to fling ${birdName(hud.current ?? 'rue')}.`
      : hud.phase === 'flying' ? (hud.slow ? 'Last bug…' : hud.current && hud.current !== 'rue' && !hud.ability ? BIRDS[hud.current].says : '')
        : '';
  const beatGhost = ghost && hud.phase === 'won' && hud.score > ghostFort;

  return (
    <div className="game-roostbirds-root play" style={{ height: size.h }}>
      <div className="game-roostbirds-stage">
        <canvas
          ref={canvasRef}
          className="game-roostbirds-canvas"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={cancel}
        />
        <div className="game-roostbirds-hud">
          <button className="game-roostbirds-btn" onClick={onLevels} aria-label="Forts"><Glyph d={MAP_ICON} /></button>
          <button className="game-roostbirds-btn" onClick={onRetry} aria-label="Restart"><Glyph d={RETRY_ICON} /></button>
          <span className="game-roostbirds-lvl">{idx + 1}. {level.name}</span>
          <span className="game-roostbirds-birds">
            {hud.current && hud.phase !== 'won' && <img className="now" src={sprite(hud.current, 'idle')} alt={hud.current} />}
            {hud.phase !== 'won' && hud.queue.map((b, i) => <img key={i} src={sprite(b, 'idle')} alt={b} />)}
          </span>
          <span className="game-roostbirds-score">{hud.score.toLocaleString()}</span>
          <span className="game-roostbirds-bugcount">{hud.bugs} bug{hud.bugs === 1 ? '' : 's'}</span>
          {ghost && (
            <span className={`game-roostbirds-ghost${hud.score > ghostFort ? ' beaten' : ''}`} title={`${ghost.name}'s best on this fort`}>
              <img src={sprite(ghost.sprite, 'idle')} alt="" />{ghostFort.toLocaleString()}
            </span>
          )}
        </div>
        {tip && <div className="game-roostbirds-tip">{tip}</div>}
        {(hud.phase === 'won' || hud.phase === 'lost') && (
          <div className="game-roostbirds-end">
            {hud.phase === 'won' ? <>
              <img src={sprite(beatGhost ? ghost!.sprite : 'pip', 'cheer')} alt="" />
              <b>All bugs squashed</b>
              <div className="game-roostbirds-bigstars">
                {[0, 1, 2].map((k) => <Star key={k} on={k < hud.stars} size={34} style={{ animationDelay: `${0.9 + k * 0.25}s` }} />)}
              </div>
              <span>{hud.score.toLocaleString()}{hud.stars > best && best > 0 ? ' · new best' : ''}</span>
              {ghost && <span className="game-roostbirds-ghostline">{beatGhost ? `Past ${ghost.name}'s ghost (${ghostFort.toLocaleString()})` : `${ghost.name}'s ghost scored ${ghostFort.toLocaleString()} here`}</span>}
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
    </div>
  );
}
