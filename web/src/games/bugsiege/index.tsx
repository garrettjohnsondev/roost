import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameMeta, GameProps, Ghost } from '../types';
import { sprite } from '../types';
import { sfx } from '../../economy/sound';
import { buzz, ticks } from '../../haptics';
import {
  BUGS, COLS, DT, MAPS, ROWS, TOWERS, TOWER_ORDER, build, callWave, canCall, earlyBy, earlyCoins,
  ghostScore, newState, pathTiles, repoAt, revive, sell, sellValue, spotPos, stars, step, totalWaves,
  towerAt, upgrade, upgradeCost, type Ev, type State, type TowerKind,
} from './logic';
import { burst, draw, img, newFx, tickFx, type Fx } from './render';
import './style.css';

/** Bug Siege: a tower defense. Bugs march down the road to the repo; the crew
 *  holds the build pads. logic.ts is the sim, render.ts the pixels, this file
 *  the screens, input and the fixed-step loop. */
export const meta: GameMeta = {
  id: 'bugsiege',
  name: 'Bug Siege',
  blurb: 'The bugs want the repo. The crew has other plans.',
  host: 'bram',
  pack: 'stretch',
  orientation: 'landscape',
  safeCorner: 'bl',
  achievements: [
    { id: 'ship', name: 'Shipped', says: 'Hold a map to the last wave.' },
    { id: 'flawless', name: 'Zero regressions', says: 'Three stars on a map.' },
    { id: 'gc', name: 'Garbage collected', says: 'Take down a Memory Leak.' },
    { id: 'early', name: 'Ahead of schedule', says: 'Call 5 waves early in one map.' },
    { id: 'all', name: 'Full stack', says: 'Hold all three maps.' },
  ],
  inProgress: (s: Save | null) => !!s?.run,
  ghostScore,
};

interface Save { stars: number[]; unlocked: number; run: State | null }
function normalize(s: Save | null): Save {
  return {
    stars: MAPS.map((_, i) => Math.max(0, Math.min(3, Number(s?.stars?.[i]) || 0))),
    unlocked: Math.max(1, Math.min(MAPS.length, Number(s?.unlocked) || 1)),
    run: revive(s?.run ?? null),
  };
}

const HUD_H = 40;
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function useSize() {
  const [sz, setSz] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const f = () => setSz({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', f);
    window.addEventListener('orientationchange', f);
    return () => { window.removeEventListener('resize', f); window.removeEventListener('orientationchange', f); };
  }, []);
  return sz;
}

export function Game({ save, onSave, onScore, onAchieve, paused, best, ghost }: GameProps<Save>) {
  const [prog, setProg] = useState<Save>(() => normalize(save));
  const progRef = useRef(prog);
  progRef.current = prog;
  const [attempt, setAttempt] = useState(0);

  useEffect(() => { for (const k of TOWER_ORDER) { img(sprite(k)); img(sprite(k, 'cheer')); } }, []);

  const persist = useCallback((p: Save) => { progRef.current = p; setProg(p); onSave(p); }, [onSave]);

  const start = (m: number) => { sfx('tap'); setAttempt((a) => a + 1); persist({ ...progRef.current, run: newState(m) }); };

  if (!prog.run) return <MapSelect prog={prog} best={best} onPick={start} />;
  return (
    <Siege
      key={attempt}
      initial={prog.run}
      paused={paused}
      ghost={ghost ?? null}
      onAchieve={onAchieve}
      onCheckpoint={(s) => { onSave({ ...progRef.current, run: s }); }}
      onFinish={(s) => {
        const p = progRef.current;
        const st = stars(s);
        const next: Save = {
          stars: p.stars.map((v, i) => (i === s.map ? Math.max(v, st) : v)),
          unlocked: s.over === 'won' ? Math.max(p.unlocked, Math.min(MAPS.length, s.map + 2)) : p.unlocked,
          run: null,
        };
        progRef.current = next;
        onSave(next);
        onScore(s.score);
        if (s.over === 'won') {
          onAchieve('ship');
          if (st >= 3) onAchieve('flawless');
          if (next.stars.every((v) => v > 0)) onAchieve('all');
        }
      }}
      onLeave={(again) => {
        const p = { ...progRef.current, run: again !== null ? newState(again) : null };
        setAttempt((a) => a + 1);
        persist(p);
      }}
      unlocked={() => progRef.current.unlocked}
    />
  );
}

// ---------------------------------------------------------------------------

function MapSelect({ prog, best, onPick }: { prog: Save; best: number | undefined; onPick: (m: number) => void }) {
  const total = prog.stars.reduce((a, b) => a + b, 0);
  return (
    <div className="game-bugsiege-select">
      <div className="game-bugsiege-title">
        <img src={sprite('bram', 'cheer')} alt="" />
        <div>
          <b>Bug Siege</b>
          <span>Tap a stone pad to post a crew member. Hold the road until the last wave.</span>
          <small>Stars {total}/{MAPS.length * 3}{best !== undefined && <> · best {best}</>}</small>
        </div>
      </div>
      <div className="game-bugsiege-maps">
        {MAPS.map((m, i) => {
          const locked = i >= prog.unlocked;
          return (
            <button key={m.id} className={`game-bugsiege-map${locked ? ' is-locked' : ''}`} disabled={locked} onClick={() => onPick(i)}>
              <MiniMap m={i} />
              <b>{m.name}</b>
              <span>{locked ? `Hold ${MAPS[i - 1].name} to unlock` : `${m.blurb} ${m.waves} waves.`}</span>
              <Stars n={prog.stars[i]} />
            </button>
          );
        })}
      </div>
      <div className="game-bugsiege-roster">
        {TOWER_ORDER.map((k) => (
          <div key={k} className="game-bugsiege-rostercard">
            <img src={sprite(k)} alt="" />
            <b>{TOWERS[k].name}</b>
            <span>{TOWERS[k].role}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stars({ n, big }: { n: number; big?: boolean }) {
  return (
    <span className={`game-bugsiege-stars${big ? ' is-big' : ''}`}>
      {[0, 1, 2].map((i) => <i key={i} className={i < n ? 'on' : ''} style={{ animationDelay: `${i * 180}ms` }} />)}
    </span>
  );
}

function MiniMap({ m }: { m: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const g = c.getContext('2d')!;
    const k = 6;
    c.width = COLS * k; c.height = ROWS * k;
    g.fillStyle = MAPS[m].tint; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#8a6a45';
    for (const t of pathTiles(m)) { const [x, y] = t.split(',').map(Number); g.fillRect(x * k, y * k, k, k); }
    g.fillStyle = '#a9abb8';
    for (const [x, y] of MAPS[m].spots) g.fillRect(x * k + 1, y * k + 1, k - 2, k - 2);
    const [rx, ry] = repoAt(m);
    g.fillStyle = '#7fd8ff'; g.fillRect(rx * k, ry * k - 2, k, k + 2);
  }, [m]);
  return <canvas ref={ref} className="game-bugsiege-mini" />;
}

// ---------------------------------------------------------------------------

interface SiegeProps {
  initial: State;
  paused: boolean;
  ghost: Ghost | null;
  onAchieve: (id: string) => void;
  onCheckpoint: (s: State) => void;
  onFinish: (s: State) => void;
  onLeave: (again: number | null) => void;
  unlocked: () => number;
}

function Siege({ initial, paused, ghost, onAchieve, onCheckpoint, onFinish, onLeave, unlocked }: SiegeProps) {
  const size = useSize();
  const sRef = useRef<State>(initial);
  const fxRef = useRef<Fx>(newFx());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [preview, setPreview] = useState<TowerKind | null>(null);
  const [speed, setSpeed] = useState<1 | 2>(1);
  const [, setHud] = useState(0);
  const [banner, setBanner] = useState<{ n: number; text: string } | null>(null);
  const [done, setDone] = useState<State['over']>(initial.over);
  const uiRef = useRef({ sel, preview });
  uiRef.current = { sel, preview };
  const cb = useRef({ onAchieve, onCheckpoint, onFinish });
  cb.current = { onAchieve, onCheckpoint, onFinish };

  const s = sRef.current;
  const availW = size.w;
  const availH = Math.max(160, size.h - 36 - HUD_H);
  const T = Math.max(16, Math.floor(Math.min(availW / COLS, availH / ROWS)));
  const W = T * COLS, H = T * ROWS;

  const flashBanner = (text: string) => setBanner((b) => ({ n: (b?.n ?? 0) + 1, text }));

  // --- events -> juice ---
  const last = useRef({ hit: 0, kill: 0, leak: 0 });
  const handle = useCallback((evs: Ev[]) => {
    const fx = fxRef.current, now = performance.now(), L = last.current;
    for (const e of evs) {
      switch (e.k) {
        case 'hit':
          burst(fx, e.x, e.y, TOWERS[e.kind].color, 3, 1.5, 0.05);
          if (now - L.hit > 140) { sfx('hit'); L.hit = now; }
          break;
        case 'kill': {
          const def = BUGS[e.bug];
          burst(fx, e.x, e.y, e.bug === 'glitch' ? '#3cf6ff' : e.bug === 'moth' ? '#d9ccb4' : e.bug.match(/blob|drip|leak/) ? '#c070ff' : '#4fa06f', def.boss ? 60 : 8 + def.size * 20, def.boss ? 4 : 2.2);
          fx.texts.push({ x: e.x, y: e.y - 0.3, text: `+${e.coins}`, life: 0.9, color: '#ffe45c' });
          if (def.lives >= 2 && !def.boss) fx.shake = Math.max(fx.shake, 0.4);
          if (now - L.kill > 110) { sfx('coin'); L.kill = now; }
          break;
        }
        case 'boss':
          fx.shake = 1.6;
          fx.rings.push({ x: e.x, y: e.y, r: 2.5, life: 0.8, max: 0.8, color: '#c070ff' });
          fx.texts.push({ x: e.x, y: e.y - 0.8, text: 'GARBAGE COLLECTED', life: 1.8, color: '#fff' });
          sfx('crash'); ticks(6);
          cb.current.onAchieve('gc');
          break;
        case 'leak':
          fx.repoHit = 1; fx.shake = Math.max(fx.shake, 0.7);
          burst(fx, e.x, e.y, '#ff5a4a', 12, 2.5);
          fx.texts.push({ x: e.x - 0.3, y: e.y - 0.6, text: `-${e.lives}`, life: 1, color: '#ff5a4a' });
          if (now - L.leak > 1200) { buzz('fail'); sfx('crash'); L.leak = now; }
          break;
        case 'chain':
          fx.lines.push({ pts: e.pts, life: 0.16, color: '#ffe45c', width: 2 });
          break;
        case 'snipe':
          fx.lines.push({ pts: [e.x, e.y - 0.2, e.tx, e.ty], life: 0.22, color: '#e2c4ff', width: 3 });
          burst(fx, e.tx, e.ty, '#c68cff', 6, 2);
          break;
        case 'splash':
          fx.rings.push({ x: e.x, y: e.y, r: e.r, life: 0.35, max: 0.35, color: '#ff9a3c' });
          burst(fx, e.x, e.y, '#ff9a3c', 10, 2.5, 0.08);
          fx.shake = Math.max(fx.shake, 0.25);
          break;
        case 'wave': {
          sfx('whoosh');
          const w = WAVES_WITH_BOSS.has(e.n) ? `Wave ${e.n}: boss inbound` : `Wave ${e.n}`;
          flashBanner(e.early ? `${w}  +${earlyCoins(e.early)} early` : w);
          if (sRef.current.early >= 5) cb.current.onAchieve('early');
          cb.current.onCheckpoint(sRef.current);
          break;
        }
        case 'won':
          sfx('win'); buzz('pass'); setDone('won'); setSel(null);
          cb.current.onFinish(sRef.current);
          break;
        case 'lost':
          sfx('lose'); buzz('fail'); setDone('lost'); setSel(null);
          cb.current.onFinish(sRef.current);
          break;
      }
    }
  }, []);

  // --- the loop: fixed steps, stops on pause ---
  useEffect(() => {
    if (paused || done) return;
    let raf = 0, prev = performance.now(), acc = 0, hudAt = 0, saveAt = prev;
    const reduced = reducedMotion();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - prev) / 1000); prev = now;
      const st = sRef.current, fx = fxRef.current;
      acc += dt * speed;
      let n = 0;
      while (acc >= DT && n < 12) {
        handle(step(st));
        acc -= DT; n++;
        if (st.over) break;
      }
      if (n >= 12) acc = 0;
      // ambient fx: flames and frost
      for (const b of st.bugs) {
        if (b.burnT > 0 && Math.random() < dt * 14) fx.parts.push({ x: b.x + (Math.random() - 0.5) * 0.3, y: b.y, vx: 0, vy: -1.2, life: 0.4, max: 0.4, color: Math.random() < 0.5 ? '#ff9a3c' : '#ff5a4a', size: 0.06 });
        if (b.slowT > 0 && Math.random() < dt * 6) fx.parts.push({ x: b.x + (Math.random() - 0.5) * 0.4, y: b.y - 0.2, vx: 0, vy: 0.4, life: 0.5, max: 0.5, color: '#dff9ff', size: 0.04 });
      }
      tickFx(fx, dt * speed);
      const c = canvasRef.current;
      if (c) {
        const g = c.getContext('2d');
        if (g) {
          const dpr = Math.min(2, window.devicePixelRatio || 1);
          if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
          draw(g, st, { tile: T, ox: 0, oy: 0, w: W, h: H, dpr }, fx, { spot: uiRef.current.sel, preview: uiRef.current.preview, time: now / 1000, reduced });
          if (ghost) drawGhost(g, st, T, now / 1000, ghost);
        }
      }
      if (now - hudAt > 100) { hudAt = now; setHud((h) => h + 1); }
      if (now - saveAt > 4000) { saveAt = now; if (!st.over) cb.current.onCheckpoint(st); }
      if (!st.over) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [paused, done, speed, T, W, H, handle, ghost]);

  // draw once while paused / finished so the board is never blank
  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const g = c.getContext('2d'); if (!g) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    draw(g, sRef.current, { tile: T, ox: 0, oy: 0, w: W, h: H, dpr }, fxRef.current, { spot: sel, preview, time: performance.now() / 1000, reduced: true });
  }, [W, H, T, sel, preview, paused, done]);

  // save when leaving mid-run
  useEffect(() => () => { if (!sRef.current.over) cb.current.onCheckpoint(sRef.current); }, []);

  // --- input ---
  const tapBoard = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (done) return;
    const r = e.currentTarget.getBoundingClientRect();
    const col = Math.floor(((e.clientX - r.left) / r.width) * COLS), row = Math.floor(((e.clientY - r.top) / r.height) * ROWS);
    const i = MAPS[s.map].spots.findIndex(([c, rr]) => c === col && rr === row);
    if (i < 0 || i === sel) { setSel(null); setPreview(null); return; }
    sfx('tap');
    setSel(i); setPreview(null);
  };

  const choose = (k: TowerKind) => {
    if (sel === null) return;
    if (preview !== k) { setPreview(k); sfx('tap'); return; }
    if (build(s, sel, k)) {
      const [x, y] = spotPos(s.map, sel);
      burst(fxRef.current, x, y + 0.3, '#d8d0b8', 14, 2);
      fxRef.current.rings.push({ x, y, r: 0.7, life: 0.3, max: 0.3, color: TOWERS[k].color });
      sfx('coin'); ticks(1);
      setSel(null); setPreview(null);
      cb.current.onCheckpoint(s);
    }
  };
  const doUpgrade = () => {
    if (sel === null || !upgrade(s, sel)) return;
    const [x, y] = spotPos(s.map, sel);
    burst(fxRef.current, x, y, '#ffe45c', 18, 2.5);
    fxRef.current.rings.push({ x, y, r: 0.9, life: 0.4, max: 0.4, color: '#ffe45c' });
    sfx('score'); ticks(2);
    setHud((h) => h + 1);
    cb.current.onCheckpoint(s);
  };
  const doSell = () => {
    if (sel === null) return;
    const v = sell(s, sel);
    if (!v) return;
    const [x, y] = spotPos(s.map, sel);
    fxRef.current.texts.push({ x, y: y - 0.3, text: `+${v}`, life: 1, color: '#ffe45c' });
    burst(fxRef.current, x, y, '#a9abb8', 10, 2);
    sfx('coin');
    setSel(null); setPreview(null);
    cb.current.onCheckpoint(s);
  };
  const call = () => {
    if (!canCall(s)) return;
    const evs: Ev[] = [];
    callWave(s, evs);
    handle(evs);
    setHud((h) => h + 1);
  };

  // --- HUD numbers ---
  const total = totalWaves(s);
  const early = Math.ceil(earlyBy(s));
  const callable = canCall(s) && !done;
  const tw = sel !== null ? towerAt(s, sel) : undefined;
  const ghostPace = ghost ? Math.round(ghost.target * Math.min(1, s.t / (total * 24))) : 0;

  // radial menu placement
  const menu = (() => {
    if (sel === null || done) return null;
    const [x, y] = spotPos(s.map, sel);
    const R = Math.max(T * 1.7, 78);
    const cx = Math.max(R + 22, Math.min(W - R - 22, x * T)), cy = Math.max(R + 22, Math.min(H - R - 22, y * T));
    return { cx, cy, R, infoTop: y * T > H / 2 };
  })();

  return (
    <div className="game-bugsiege-root" style={{ width: W }}>
      <div className="game-bugsiege-hud" style={{ height: HUD_H }}>
        <span className="game-bugsiege-stat" title="Coins"><i className="game-bugsiege-coin" />{s.coins}</span>
        <span className={`game-bugsiege-stat${s.lives <= 5 ? ' is-low' : ''}`} title="Repo health"><i className="game-bugsiege-heart" />{s.lives}</span>
        <span className="game-bugsiege-stat">Wave <b>{Math.max(1, s.wave)}</b>/{total}</span>
        <span className="game-bugsiege-stat game-bugsiege-score">{s.score}</span>
        {ghost && (
          <span className="game-bugsiege-ghost" title={`${ghost.name}'s pace`}>
            <span className="game-bugsiege-ghostbar">
              <i style={{ width: `${Math.min(100, (s.score / Math.max(1, ghost.target)) * 100)}%` }} />
              <img className="game-bugsiege-ghostface" src={ghost.sprite.startsWith('/') ? ghost.sprite : sprite(ghost.sprite)} alt="" style={{ left: `${Math.min(100, (ghostPace / Math.max(1, ghost.target)) * 100)}%` }} />
            </span>
            <small>{ghost.name} {ghostPace}</small>
          </span>
        )}
        <span className="game-bugsiege-spacer" />
        <button className="game-bugsiege-btn" onClick={() => { setSpeed((v) => (v === 1 ? 2 : 1)); sfx('tap'); }} aria-label="Game speed">
          <Chevrons n={speed} /> x{speed}
        </button>
        <button className={`game-bugsiege-btn game-bugsiege-call${callable ? ' is-ready' : ''}`} disabled={!callable} onClick={call}>
          {s.wave === 0 ? 'Send wave 1' : s.wave >= total ? 'Last wave' : callable ? <>Call {s.wave + 1} <small>+{earlyCoins(early)}</small></> : `Wave ${s.wave + 1} soon`}
        </button>
      </div>
      <div className="game-bugsiege-stage" style={{ width: W, height: H }}>
        <canvas ref={canvasRef} style={{ width: W, height: H }} onPointerDown={tapBoard} />
        {banner && <div key={banner.n} className="game-bugsiege-banner">{banner.text}</div>}
        {s.wave === 0 && !done && sel === null && (
          <div className="game-bugsiege-hint">Tap a stone pad to post the crew, then send the first wave.</div>
        )}
        {menu && (
          <div className="game-bugsiege-radial" style={{ left: menu.cx, top: menu.cy }} onPointerDown={(e) => e.stopPropagation()}>
            {!tw ? (
              <>
                {TOWER_ORDER.map((k, i) => {
                  const a = -Math.PI / 2 + (i / TOWER_ORDER.length) * Math.PI * 2;
                  const cost = TOWERS[k].levels[0].cost;
                  const poor = s.coins < cost;
                  return (
                    <button key={k} className={`game-bugsiege-opt${preview === k ? ' is-picked' : ''}${poor ? ' is-poor' : ''}`}
                      style={{ transform: `translate(${Math.cos(a) * menu.R}px, ${Math.sin(a) * menu.R}px)`, animationDelay: `${i * 18}ms` }}
                      disabled={poor} onClick={() => choose(k)} aria-label={`${TOWERS[k].name}, ${cost} coins`}>
                      <img src={sprite(k)} alt="" />
                      <small>{preview === k ? 'Post' : cost}</small>
                    </button>
                  );
                })}
              </>
            ) : (
              <>
                <button className="game-bugsiege-opt game-bugsiege-act" disabled={tw.level >= 2 || s.coins < upgradeCost(tw)}
                  style={{ transform: `translate(${-menu.R * 0.75}px, ${-menu.R * 0.6}px)` }} onClick={doUpgrade}>
                  <b>{tw.level >= 2 ? 'MAX' : 'Up'}</b>
                  <small>{tw.level >= 2 ? '' : upgradeCost(tw)}</small>
                </button>
                <button className="game-bugsiege-opt game-bugsiege-act is-sell"
                  style={{ transform: `translate(${menu.R * 0.75}px, ${-menu.R * 0.6}px)` }} onClick={doSell}>
                  <b>Sell</b><small>+{sellValue(tw)}</small>
                </button>
              </>
            )}
          </div>
        )}
        {menu && (
                <div className={`game-bugsiege-info ${menu.infoTop ? 'is-top' : 'is-bottom'}`}>
                  {tw ? <><b>{TOWERS[tw.kind].name} · L{tw.level + 1}</b><span>{describe(tw.kind, tw.level)}</span><em>{tw.kills} squashed</em></> : preview ? <><b>{TOWERS[preview].name}</b><span>{TOWERS[preview].role}</span><em>tap again to post</em></> : <><b>Post a bird</b><span>pick one to preview</span></>}
                </div>
        )}
        {done && (
          <div className="game-overlay game-bugsiege-end">
            <img src={sprite(done === 'won' ? 'bram' : 'moss', done === 'won' ? 'cheer' : 'sleep')} alt="" />
            <b>{done === 'won' ? `${MAPS[s.map].name} holds` : 'The bugs got in'}</b>
            {done === 'won' && <Stars n={stars(s)} big />}
            <p>{s.score} points · {s.kills} bugs squashed{s.bossKills ? ` · ${s.bossKills} leak${s.bossKills > 1 ? 's' : ''} plugged` : ''}</p>
            {ghost && <p>{s.score > ghost.target ? `You beat ${ghost.name}'s ghost.` : `${ghost.name}'s ghost posted ${ghost.target}.`}</p>}
            <div className="game-bugsiege-endrow">
              <button className="chip" onClick={() => onLeave(s.map)}>Again</button>
              {done === 'won' && s.map + 1 < MAPS.length && s.map + 1 < unlocked() && <button className="chip" onClick={() => onLeave(s.map + 1)}>Next map</button>}
              <button className="chip" onClick={() => onLeave(null)}>Maps</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const WAVES_WITH_BOSS = new Set([12, 15]);

function describe(k: TowerKind, level: number): string {
  const L = TOWERS[k].levels[level];
  const bits = [`${L.dmg} dmg`, `${L.rate}/s`, `range ${L.range}`];
  if (L.splash) bits.push('splash');
  if (L.slow) bits.push(`slow ${Math.round(L.slow * 100)}%`);
  if (L.chain) bits.push(`chains ${L.chain}`);
  if (L.burn) bits.push(`burn ${L.burn}/s`);
  if (L.pierce) bits.push('cracks armor');
  return bits.join(' · ');
}

function Chevrons({ n }: { n: number }) {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true">
      <path d="M1 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="2" />
      {n > 1 && <path d="M7 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="2" />}
    </svg>
  );
}

/** The ghost bird hovers by the repo, see-through, keeping its own score. */
function drawGhost(g: CanvasRenderingContext2D, s: State, T: number, t: number, ghost: Ghost) {
  const [c, r] = repoAt(s.map);
  const im = img(ghost.sprite.startsWith('/') ? ghost.sprite : sprite(ghost.sprite));
  const x = Math.min(COLS - 0.6, c + 0.2) * T, y = (r - 1.3) * T + Math.sin(t * 2) * T * 0.08;
  g.save();
  g.globalAlpha = 0.4;
  g.shadowColor = '#fff'; g.shadowBlur = 14;
  if (im.complete && im.naturalWidth) g.drawImage(im, x - T * 0.45, y - T * 0.45, T * 0.9, T * 0.9);
  g.restore();
}
