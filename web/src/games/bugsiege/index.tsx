import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameMeta, GameProps, Ghost } from '../types';
import { sprite } from '../types';
import { sfx } from '../../economy/sound';
import { buzz, ticks } from '../../haptics';
import {
  ABILITY_CD, BUGS, DT, GHOST_STRENGTH, KINDS, MAPS, MAP_GHOSTS, TOWERS, buildCost, build, callWave, canCall,
  earlyBonus, ghostScore, ghostTarget, mapBugs, moveHero, newState, preview, revive, sell, sellValue, specialize,
  spotPos, stars, step, totalWaves, towerAt, upgrade, upgradeCost, heroSpecial, type BugKind, type Kind, type State,
} from './logic';
import { order } from './bot';
import { applyEvents, draw, icon, img, makeView, newFx, tickFx, toScreen, toWorld, unitPx, type Fx, type View } from './render';
import './style.css';

/** Bug Siege, rebuilt on the Kingdom Rush model (owner, 2026-09-28): a world
 *  map of six levels, a briefing, fixed build spots with a four-tower ring
 *  menu, a hero you walk around, and stars at the end. logic.ts is the sim,
 *  render.ts the pixels, this file the screens and input. */
export const meta: GameMeta = {
  id: 'bugsiege',
  name: 'Bug Siege',
  blurb: 'Hold the road. Six maps, four towers, one very brave bird.',
  host: 'bram',
  pack: 'stretch',
  orientation: 'landscape',
  safeCorner: 'bl',
  ghostMode: 'custom',
  achievements: [
    { id: 'ship', name: 'Shipped', says: 'Hold any map to the last wave.' },
    { id: 'flawless', name: 'Zero regressions', says: 'Three stars on a map.' },
    { id: 'gc', name: 'Garbage collected', says: 'Take down a Memory Leak.' },
    { id: 'early', name: 'Ahead of schedule', says: 'Call 5 waves early in one map.' },
    { id: 'spec', name: 'Specialist', says: 'Train a tower to level 4.' },
    { id: 'hero', name: 'Main character', says: 'Get your hero to level 5.' },
    { id: 'all', name: 'Full stack', says: 'Hold all six maps.' },
  ],
  inProgress: (s: Save | null) => !!s?.run,
  ghostScore,
};

interface Save { stars: number[]; best: number[]; unlocked: number; hero: string; tut: boolean; run: State | null }
export const HEROES = ['pip', 'fig', 'rue', 'otto', 'juno'];
const SHORT: Record<Kind, string> = { pecker: 'Pecker', mortar: 'Mortar', sniper: 'Sniper', frost: 'Frost' };
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function normalize(s: Save | null): Save {
  return {
    stars: MAPS.map((_, i) => Math.max(0, Math.min(3, Number(s?.stars?.[i]) || 0))),
    best: MAPS.map((_, i) => Math.max(0, Number(s?.best?.[i]) || 0)),
    unlocked: Math.max(1, Math.min(MAPS.length, Number(s?.unlocked) || 1)),
    hero: HEROES.includes(s?.hero ?? '') ? s!.hero : 'pip',
    tut: !!s?.tut,
    run: revive(s?.run ?? null),
  };
}
const strip = (s: State): State => ({ ...s, events: [] });

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
function useSize() {
  const get = () => ({ w: window.innerWidth, h: Math.max(200, window.innerHeight - 36) });
  const [sz, setSz] = useState(get);
  useEffect(() => {
    const f = () => setSz(get());
    window.addEventListener('resize', f);
    window.addEventListener('orientationchange', f);
    return () => { window.removeEventListener('resize', f); window.removeEventListener('orientationchange', f); };
  }, []);
  return sz;
}

/** Per-map ghost: weak crew early, Nell on the last map. */
function mapGhost(map: number): Ghost {
  const name = MAP_GHOSTS[map];
  const strength = GHOST_STRENGTH[name];
  return { name: cap(name), sprite: name, strength, target: ghostTarget(map, strength) };
}

type Screen = { at: 'map' } | { at: 'brief'; map: number } | { at: 'play' } | { at: 'result'; state: State; stars: number; best: boolean; beat: boolean };

export function Game({ save, onSave, onScore, onAchieve, paused, ghost, onGhostBeaten }: GameProps<Save>) {
  const [prog, setProg] = useState<Save>(() => normalize(save));
  const progRef = useRef(prog);
  const [screen, setScreen] = useState<Screen>(() => (prog.run ? { at: 'play' } : { at: 'map' }));
  const [attempt, setAttempt] = useState(0);
  const ghostsOn = ghost !== null;
  const size = useSize();

  useEffect(() => {
    for (const k of KINDS) { img(sprite(TOWERS[k].crew)); img(sprite(TOWERS[k].crew, 'cheer')); for (const sp of TOWERS[k].specs) img(sprite(sp.crew)); }
    for (const h of HEROES) for (const p of ['idle', 'side', 'hold', 'cheer']) img(sprite(h, p));
  }, []);

  const persist = useCallback((p: Save) => { progRef.current = p; setProg(p); onSave(p); }, [onSave]);

  const start = (m: number) => {
    sfx('tap');
    setAttempt((a) => a + 1);
    persist({ ...progRef.current, run: newState(m) });
    setScreen({ at: 'play' });
  };

  const finish = (s: State) => {
    const p = progRef.current;
    const st = stars(s);
    const best = s.score > p.best[s.map];
    const g = mapGhost(s.map);
    const beat = ghostsOn && s.over === 'won' && s.score > g.target;
    const next: Save = {
      ...p,
      stars: p.stars.map((v, i) => (i === s.map ? Math.max(v, st) : v)),
      best: p.best.map((v, i) => (i === s.map ? Math.max(v, s.score) : v)),
      unlocked: s.over === 'won' ? Math.max(p.unlocked, Math.min(MAPS.length, s.map + 2)) : p.unlocked,
      tut: p.tut || s.map > 0 || s.wave > 1,
      run: null,
    };
    persist(next);
    onScore(s.score);
    if (s.over === 'won') {
      onAchieve('ship');
      if (st === 3) onAchieve('flawless');
      if (next.stars.every((v) => v > 0)) onAchieve('all');
    }
    if (s.bossDown > 0) onAchieve('gc');
    if (s.early >= 5) onAchieve('early');
    if (beat) onGhostBeaten?.(g.name);
    setScreen({ at: 'result', state: s, stars: st, best, beat });
  };

  if (screen.at === 'map' || (screen.at === 'play' && !prog.run)) {
    return <WorldMap prog={prog} size={size} ghostsOn={ghostsOn} onPick={(m) => { sfx('tap'); setScreen({ at: 'brief', map: m }); }} onHero={(h) => { sfx('tap'); persist({ ...progRef.current, hero: h }); }} />;
  }
  if (screen.at === 'brief') {
    return <Briefing map={screen.map} size={size} ghost={ghostsOn ? mapGhost(screen.map) : null} best={prog.best[screen.map]} onBack={() => setScreen({ at: 'map' })} onStart={() => start(screen.map)} />;
  }
  if (screen.at === 'result') {
    const s = screen.state;
    return (
      <Results s={s} st={screen.stars} best={screen.best} beat={screen.beat} ghost={ghostsOn ? mapGhost(s.map) : null} size={size}
        hasNext={s.over === 'won' && s.map + 1 < MAPS.length}
        onNext={() => setScreen({ at: 'brief', map: s.map + 1 })}
        onRetry={() => start(s.map)}
        onMap={() => setScreen({ at: 'map' })} />
    );
  }
  return (
    <Siege
      key={attempt}
      initial={prog.run!}
      size={size}
      paused={paused}
      hero={prog.hero}
      tutorial={!prog.tut && prog.run!.map === 0}
      ghost={ghostsOn ? mapGhost(prog.run!.map) : null}
      onAchieve={onAchieve}
      onTutorialDone={() => persist({ ...progRef.current, tut: true })}
      onCheckpoint={(s) => { progRef.current = { ...progRef.current, run: s }; onSave(progRef.current); }}
      onQuit={() => { persist({ ...progRef.current, run: null }); setScreen({ at: 'map' }); }}
      onRestart={() => start(prog.run!.map)}
      onFinish={finish}
    />
  );
}

// ---------------------------------------------------------------- small bits

function Pix({ tower, bug, level, spec, size }: { tower?: Kind; bug?: BugKind; level?: number; spec?: string | null; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) icon(ref.current, { tower, bug, level, spec }, size); }, [tower, bug, level, spec, size]);
  return <canvas ref={ref} className="game-bugsiege-pix" />;
}
const Stars = ({ n, size = 14, pop = false }: { n: number; size?: number; pop?: boolean }) => (
  <span className="game-bugsiege-stars">
    {[0, 1, 2].map((i) => <i key={i} className={`${i < n ? 'on' : ''}${pop ? ' pop' : ''}`} style={{ width: size, height: size, animationDelay: `${300 + i * 350}ms` }} />)}
  </span>
);
const Coin = () => <i className="game-bugsiege-coin" />;
const Heart = () => <i className="game-bugsiege-heart" />;
const Skull = () => <i className="game-bugsiege-skull"><b /><b /></i>;

// ---------------------------------------------------------------- world map

const NODE: Array<[number, number]> = [[0.1, 0.72], [0.26, 0.38], [0.42, 0.7], [0.58, 0.34], [0.74, 0.66], [0.9, 0.3]];
const THEME_BG: Record<string, string> = { meadow: '#5a9a42', autumn: '#c8841e', swamp: '#3f6f5a', desert: '#e4c27d', snow: '#dde8f0', night: '#2a3a55' };

function WorldMap({ prog, size, ghostsOn, onPick, onHero }: { prog: Save; size: { w: number; h: number }; ghostsOn: boolean; onPick: (m: number) => void; onHero: (h: string) => void }) {
  const total = prog.stars.reduce((a, b) => a + b, 0);
  const w = size.w, h = size.h;
  return (
    <div className="game-bugsiege-world" style={{ width: w, height: h }}>
      <div className="game-bugsiege-worldtop">
        <b>Bug Siege</b>
        <span className="game-bugsiege-total"><Stars n={1} size={12} /> {total}/{MAPS.length * 3}</span>
        <span className="game-bugsiege-spacer" />
        <span className="game-bugsiege-herolabel">Hero</span>
        {HEROES.map((hn) => (
          <button key={hn} className={`game-bugsiege-heropick${prog.hero === hn ? ' on' : ''}`} onClick={() => onHero(hn)} aria-label={`Hero ${cap(hn)}`}>
            <img src={sprite(hn)} alt="" />
          </button>
        ))}
      </div>
      <svg className="game-bugsiege-trail" viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <polyline points={NODE.map(([x, y]) => `${x * w},${y * h}`).join(' ')} fill="none" stroke="#3a2a1a" strokeWidth="10" strokeLinejoin="round" />
        <polyline points={NODE.map(([x, y]) => `${x * w},${y * h}`).join(' ')} fill="none" stroke="#d2ad72" strokeWidth="6" strokeDasharray="10 6" strokeLinejoin="round" />
      </svg>
      {MAPS.map((m, i) => {
        const locked = i >= prog.unlocked;
        const [x, y] = NODE[i];
        const g = mapGhost(i);
        return (
          <button key={m.id} className={`game-bugsiege-node${locked ? ' locked' : ''}${i === prog.unlocked - 1 && prog.stars[i] === 0 ? ' fresh' : ''}`}
            style={{ left: x * w, top: y * h, ['--bg' as string]: THEME_BG[m.theme] }}
            disabled={locked} onClick={() => onPick(i)}>
            <span className="game-bugsiege-nodeflag">{locked ? <i className="game-bugsiege-lock" /> : i + 1}</span>
            <span className="game-bugsiege-nodename">{m.name}</span>
            {!locked && <Stars n={prog.stars[i]} size={11} />}
            {!locked && ghostsOn && prog.best[i] <= g.target && <img className="game-bugsiege-nodeghost" src={sprite(g.sprite)} alt="" title={`${g.name}'s ghost`} />}
            {(i + 1) % 3 === 0 && !locked && <span className="game-bugsiege-bosstag">Boss</span>}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- briefing

function Briefing({ map, size, ghost, best, onBack, onStart }: { map: number; size: { w: number; h: number }; ghost: Ghost | null; best: number; onBack: () => void; onStart: () => void }) {
  const m = MAPS[map];
  return (
    <div className="game-bugsiege-panelwrap" style={{ width: size.w, height: size.h, ['--bg' as string]: THEME_BG[m.theme] }}>
      <div className="game-bugsiege-panel">
        <div className="game-bugsiege-paneltop">
          <span className="game-bugsiege-mapno">Map {map + 1}</span>
          <h2>{m.name}</h2>
          <span className="game-bugsiege-spacer" />
          <span className="game-bugsiege-dim">{totalWaves(map)} waves</span>
        </div>
        <p className="game-bugsiege-story">{m.story}</p>
        <div className="game-bugsiege-coming">
          {mapBugs(map).map((k) => (
            <div key={k} className={`game-bugsiege-bugcard${BUGS[k].boss ? ' boss' : ''}`}>
              <Pix bug={k} size={34} />
              <b>{BUGS[k].name}</b>
              <small>{BUGS[k].role}</small>
            </div>
          ))}
        </div>
        <div className="game-bugsiege-panelbottom">
          <button className="game-bugsiege-btn" onClick={onBack}>Map</button>
          {ghost && (
            <span className="game-bugsiege-ghostline">
              <img className="game-bugsiege-ghostimg" src={sprite(ghost.sprite)} alt="" />
              {ghost.name}'s ghost scored {ghost.target.toLocaleString()}
            </span>
          )}
          {best > 0 && <span className="game-bugsiege-dim">Your best {best.toLocaleString()}</span>}
          <span className="game-bugsiege-spacer" />
          <button className="game-bugsiege-btn go" onClick={onStart}>Defend</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- results

function Results({ s, st, best, beat, ghost, size, hasNext, onNext, onRetry, onMap }: {
  s: State; st: number; best: boolean; beat: boolean; ghost: Ghost | null; size: { w: number; h: number }; hasNext: boolean;
  onNext: () => void; onRetry: () => void; onMap: () => void;
}) {
  const won = s.over === 'won';
  return (
    <div className="game-bugsiege-panelwrap" style={{ width: size.w, height: size.h, ['--bg' as string]: THEME_BG[MAPS[s.map].theme] }}>
      <div className="game-bugsiege-panel result">
        <img className="game-bugsiege-resultbird" src={sprite(won ? 'pip' : 'pip', won ? 'cheer' : 'sit')} alt="" />
        <h2>{won ? (st === 3 ? 'Flawless!' : 'Map held!') : 'The repo fell'}</h2>
        {won ? <Stars n={st} size={34} pop /> : <p className="game-bugsiege-dim">Wave {s.wave} of {totalWaves(s)}. Try more Frost Beacons on the bends.</p>}
        <div className="game-bugsiege-resultrow">
          <span><Heart /> {s.lives} left</span>
          <span>{s.kills} bugs</span>
          <span className="game-bugsiege-score">{s.score.toLocaleString()}{best ? ' best!' : ''}</span>
        </div>
        {ghost && (
          <p className={`game-bugsiege-ghostline${beat ? ' beat' : ''}`}>
            <img className="game-bugsiege-ghostimg" src={sprite(ghost.sprite)} alt="" />
            {beat ? `You beat ${ghost.name}'s ghost (${ghost.target.toLocaleString()})` : `${ghost.name}'s ghost: ${ghost.target.toLocaleString()}`}
          </p>
        )}
        {won && st < 3 && <p className="game-bugsiege-dim">3 stars: lose at most 2 lives.</p>}
        <div className="game-bugsiege-panelbottom">
          <button className="game-bugsiege-btn" onClick={onMap}>Map</button>
          <button className="game-bugsiege-btn" onClick={onRetry}>Retry</button>
          {hasNext && <button className="game-bugsiege-btn go" onClick={onNext}>Next map</button>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the siege

interface Hud { coins: number; lives: number; wave: number; nextIn: number; canCall: boolean; bonus: number; ability: number; heroDead: number; score: number; heroLevel: number }
const hudOf = (s: State): Hud => ({
  coins: s.coins, lives: s.lives, wave: s.wave, nextIn: s.nextIn, canCall: canCall(s), bonus: earlyBonus(s),
  ability: s.hero.ability, heroDead: s.hero.dead, score: s.score, heroLevel: s.hero.level,
});

function Siege({ initial, size, paused, hero, tutorial, ghost, onAchieve, onTutorialDone, onCheckpoint, onQuit, onRestart, onFinish }: {
  initial: State; size: { w: number; h: number }; paused: boolean; hero: string; tutorial: boolean; ghost: Ghost | null;
  onAchieve: (id: string) => void; onTutorialDone: () => void; onCheckpoint: (s: State) => void; onQuit: () => void; onRestart: () => void; onFinish: (s: State) => void;
}) {
  const sRef = useRef<State>(revive(initial) ?? newState(0));
  const s = sRef.current;
  const fxRef = useRef<Fx>(newFx());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState<Hud>(() => hudOf(s));
  const [sel, setSel] = useState(-1);
  const [speed, setSpeed] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [banner, setBanner] = useState<{ text: string; key: number } | null>(null);
  const [tut, setTut] = useState(tutorial ? 0 : -1);
  const [heroTarget, setHeroTarget] = useState<[number, number] | null>(null);
  const halted = paused || menuOpen;
  const reduced = useMemo(reducedMotion, []);
  const view: View = useMemo(() => makeView(size.w, size.h, Math.min(3, window.devicePixelRatio || 1)), [size.w, size.h]);
  const viewRef = useRef(view); viewRef.current = view;
  const selRef = useRef(sel); selRef.current = sel;
  const tutRef = useRef(tut); tutRef.current = tut;
  const heroTargetRef = useRef(heroTarget); heroTargetRef.current = heroTarget;
  const tutSpot = useMemo(() => order(s.map)[0], [s.map]);
  const finished = useRef(false);

  useEffect(() => { if (paused) { onCheckpoint(strip(sRef.current)); setMenuOpen(true); } }, [paused]); // eslint-disable-line react-hooks/exhaustive-deps

  // sound + haptics, throttled so a big wave can't spam
  const last = useRef({ hit: 0, leak: 0, snipe: 0, kill: 0 });
  const react = useCallback((evs: State['events']) => {
    const now = performance.now(), L = last.current;
    for (const e of evs) {
      switch (e.t) {
        case 'build': case 'upgrade': sfx('tap'); ticks(1); break;
        case 'sell': sfx('coin'); break;
        case 'kill': if (now - L.kill > 90) { L.kill = now; sfx('hit'); } break;
        case 'snipe': if (now - L.snipe > 250) { L.snipe = now; sfx('whoosh'); } break;
        case 'boom': if (now - L.hit > 160) { L.hit = now; sfx('bounce'); } break;
        case 'leak': sfx('crash'); if (now - L.leak > 1500) { L.leak = now; buzz('fail'); } break;
        case 'bossdown': sfx('win'); ticks(6); break;
        case 'wave': setBanner({ text: e.early ? `Wave ${e.n}  +${e.early} early` : `Wave ${e.n}`, key: now }); if (e.early) sfx('coin'); else sfx('whoosh'); onCheckpoint(strip(sRef.current)); break;
        case 'levelup': sfx('score'); if (e.level >= 5) onAchieve('hero'); break;
        case 'ability': sfx('crash'); ticks(3); break;
        case 'split': setBanner({ text: 'The Leak splits!', key: now + 1 }); break;
        case 'won': buzz('pass'); sfx('win'); break;
        case 'lost': buzz('fail'); sfx('lose'); break;
        default: break;
      }
    }
  }, [onAchieve, onCheckpoint]);

  const cb = useRef({ react, onCheckpoint, onFinish });
  cb.current = { react, onCheckpoint, onFinish };
  // the fixed-step loop
  useEffect(() => {
    const { react, onCheckpoint, onFinish } = { react: (e: State['events']) => cb.current.react(e), onCheckpoint: (x: State) => cb.current.onCheckpoint(x), onFinish: (x: State) => cb.current.onFinish(x) };
    const cv = canvasRef.current!;
    const ctx = cv.getContext('2d')!;
    let raf = 0, prev = performance.now(), acc = 0, hudT = 0, saveT = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - prev) / 1000); prev = now;
      const st = sRef.current;
      if (!halted && !st.over) {
        acc += dt * speed;
        while (acc >= DT) { step(st); acc -= DT; }
        if (st.events.length) { applyEvents(fxRef.current, st.events, reduced); react(st.events); st.events.length = 0; }
        saveT += dt;
        if (saveT > 6) { saveT = 0; onCheckpoint(strip(st)); }
      }
      tickFx(fxRef.current, halted ? 0 : dt);
      if (st.over && !finished.current) {
        if (st.events.length) { applyEvents(fxRef.current, st.events, reduced); react(st.events); st.events.length = 0; }
        finished.current = true;
        setTimeout(() => onFinish(strip(st)), st.over === 'won' ? 1600 : 1200);
      }
      const ht = heroTargetRef.current;
      draw(ctx, st, viewRef.current, fxRef.current, { selected: selRef.current, heroCrew: hero, tutorialSpot: tutRef.current === 0 ? tutSpot : -1, heroTarget: ht, reduced }, now / 1000);
      hudT += dt;
      if (hudT > 0.1) { hudT = 0; setHud(hudOf(st)); if (ht && Math.hypot(st.hero.x - ht[0], st.hero.y - ht[1]) < 0.1) setHeroTarget(null); }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [halted, speed, hero, reduced, tutSpot]);

  useEffect(() => {
    const cv = canvasRef.current!;
    cv.width = Math.round(view.w * view.dpr); cv.height = Math.round(view.h * view.dpr);
  }, [view]);

  useEffect(() => () => { if (!sRef.current.over) onCheckpoint(strip(sRef.current)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // tutorial steps: 0 tap the pad, 1 pick a tower, 2 start the wave, 3 move the hero, 4 special, then done
  const advance = (from: number) => {
    if (tutRef.current !== from) return;
    const n = from + 1;
    setTut(n > 4 ? -1 : n);
    if (n > 4) onTutorialDone();
  };
  useEffect(() => {
    if (tut === 3) { const id = setTimeout(() => advance(3), 9000); return () => clearTimeout(id); }
    if (tut === 4) { const id = setTimeout(() => advance(4), 7000); return () => clearTimeout(id); }
    return undefined;
  }, [tut]); // eslint-disable-line react-hooks/exhaustive-deps

  const tap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (halted || s.over) return;
    const r = e.currentTarget.getBoundingClientRect();
    const [wx, wy] = toWorld(view, e.clientX - r.left, e.clientY - r.top);
    const spots = MAPS[s.map].spots;
    let hit = -1, bd = 0.95;
    spots.forEach(([x, y], i) => { const d = Math.hypot(x - wx, (y - wy) * 1.2 - 0.15); if (d < bd) { bd = d; hit = i; } });
    // a tap on a tower's body (drawn above the pad) counts too
    if (hit < 0) for (const t of s.towers) { const [x, y] = spotPos(s.map, t.spot); if (Math.abs(wx - x) < 0.6 && wy < y + 0.3 && wy > y - 1.9) hit = t.spot; }
    if (hit >= 0) {
      sfx('tap');
      setSel(hit === sel ? -1 : hit);
      if (hit !== sel) advance(0);
      return;
    }
    if (sel >= 0) { setSel(-1); return; }
    moveHero(s, wx, wy);
    setHeroTarget([wx, wy]);
    sfx('tap');
    advance(3);
  };

  const doBuild = (k: Kind) => { if (build(s, sel, k)) { setSel(-1); setHud(hudOf(s)); advance(1); drain(); } };
  const doUpgrade = () => { if (upgrade(s, sel)) { setSel(-1); setHud(hudOf(s)); drain(); } };
  const doSpec = (w: 0 | 1) => { if (specialize(s, sel, w)) { onAchieve('spec'); setSel(-1); setHud(hudOf(s)); drain(); } };
  const doSell = () => { if (sell(s, sel)) { setSel(-1); setHud(hudOf(s)); drain(); } };
  const doCall = () => { if (!halted && callWave(s)) { setHud(hudOf(s)); advance(2); drain(); } };
  const doAbility = () => { if (!halted && heroSpecial(s)) { setHud(hudOf(s)); advance(4); drain(); } };
  const drain = () => { if (s.events.length) { applyEvents(fxRef.current, s.events, reduced); react(s.events); s.events.length = 0; } };

  const U = unitPx(view);
  const m = MAPS[s.map];
  const clampX = (x: number, pad: number) => Math.max(pad, Math.min(view.w - pad, x));
  const clampY = (y: number, pad: number) => Math.max(pad, Math.min(view.h - pad, y));

  // the next-wave skull sits on each road's entrance
  const entrances = m.paths.map((p) => {
    const [x0, y0] = p[0], [x1, y1] = p[1];
    const a = Math.atan2(y1 - y0, x1 - x0);
    const [sx, sy] = toScreen(view, x0 + Math.cos(a) * 1.6, y0 + Math.sin(a) * 1.6);
    return [clampX(sx, 26), clampY(sy, 70)] as [number, number];
  });
  const coming = preview(s.map, s.wave);
  const selTower = sel >= 0 ? towerAt(s, sel) : null;
  const [selX, selY] = sel >= 0 ? toScreen(view, ...spotPos(s.map, sel)) : [0, 0];
  const R = Math.max(46, Math.min(62, U * 1.9));
  const specRing = !!selTower && selTower.level === 3;
  const ringX = clampX(selX, R + (specRing ? 56 : 30)), ringY = clampY(selY - U * 0.3, R + (specRing ? 44 : 26));
  const ghostPace = ghost ? Math.round((ghost.target * hud.wave) / totalWaves(s)) : 0;
  const hs = s.hero;
  const [heroSX, heroSY] = toScreen(view, hs.x, hs.y);

  return (
    <div className="game-bugsiege-root" style={{ width: view.w, height: view.h }}>
      <canvas ref={canvasRef} style={{ width: view.w, height: view.h }} onPointerDown={tap} />

      <div className="game-bugsiege-hud">
        <span className={`game-bugsiege-pill${hud.lives <= 5 ? ' low' : ''}`} title="Repo health"><Heart /> {hud.lives}</span>
        <span className="game-bugsiege-pill" title="Coins"><Coin /> {hud.coins}</span>
        <span className="game-bugsiege-pill" title="Wave"><Skull /> {hud.wave}/{totalWaves(s)}</span>
      </div>
      <div className="game-bugsiege-hud right">
        {ghost && (
          <span className={`game-bugsiege-ghost${hud.score > ghost.target ? ' beaten' : ''}`} title={`${ghost.name}'s ghost scored ${ghost.target}`}>
            <span className="game-bugsiege-ghostbar">
              <i style={{ width: `${Math.min(100, (hud.score / Math.max(1, ghost.target)) * 100)}%` }} />
              <img className="game-bugsiege-ghostface" src={sprite(ghost.sprite)} alt="" style={{ left: `${Math.min(100, (ghostPace / Math.max(1, ghost.target)) * 100)}%` }} />
            </span>
            <small>{hud.score.toLocaleString()} / {ghost.target.toLocaleString()}</small>
          </span>
        )}
        <button className={`game-bugsiege-round${speed === 2 ? ' on' : ''}`} onClick={() => { setSpeed(speed === 2 ? 1 : 2); sfx('tap'); }} aria-label="Speed">
          <i className="game-bugsiege-ff" /><i className="game-bugsiege-ff" />
        </button>
        <button className="game-bugsiege-round" onClick={() => { onCheckpoint(strip(s)); setMenuOpen(true); setSel(-1); }} aria-label="Pause">
          <i className="game-bugsiege-bar" /><i className="game-bugsiege-bar" />
        </button>
      </div>

      {hud.canCall && entrances.map(([x, y], i) => (
        <div key={i} className="game-bugsiege-callwrap" style={{ left: x, top: y }}>
          <button className={`game-bugsiege-call${hud.wave === 0 ? ' first' : ''}`} onClick={doCall} aria-label={hud.wave === 0 ? 'Start wave' : 'Call next wave early'}
            style={hud.wave > 0 ? { ['--p' as string]: `${Math.max(0, hud.nextIn) / 20 * 360}deg` } : undefined}>
            <Skull />
          </button>
          {i === 0 && (
            <div className="game-bugsiege-coming-chip">
              <b>{hud.wave === 0 ? 'Start Wave' : hud.bonus > 0 ? <>Early <Coin />+{hud.bonus}</> : 'Next wave'}</b>
              <span>{coming.map((c) => <span key={c.kind} className="game-bugsiege-cm"><Pix bug={c.kind} size={18} />{c.n}</span>)}</span>
            </div>
          )}
        </div>
      ))}

      <button className={`game-bugsiege-ability${hud.ability > 0 || hud.heroDead > 0 ? ' cooling' : ' ready'}`} onClick={doAbility} aria-label="Hero special"
        style={{ ['--p' as string]: `${(hud.heroDead > 0 ? 1 : hud.ability / ABILITY_CD) * 360}deg` }}>
        <img src={sprite(hero, hud.heroDead > 0 ? 'sleep' : 'cheer')} alt="" />
        <span className="game-bugsiege-lv">{hud.heroLevel}</span>
        {hud.ability > 0 && <span className="game-bugsiege-cd">{Math.ceil(hud.ability)}</span>}
      </button>

      {sel >= 0 && !halted && (
        <div className="game-bugsiege-ring" style={{ left: ringX, top: ringY, ['--r' as string]: `${R}px` }}>
          <i className="game-bugsiege-ringbg" />
          {!selTower && KINDS.map((k, i) => {
            const a = -Math.PI / 2 + (i * Math.PI) / 2;
            const c = buildCost(k), ok = hud.coins >= c;
            return (
              <button key={k} className={`game-bugsiege-opt${ok ? '' : ' poor'}${tut === 1 && k === 'pecker' ? ' tut' : ''}`} disabled={!ok}
                style={{ transform: `translate(${Math.cos(a) * R}px, ${Math.sin(a) * R}px)`, animationDelay: `${i * 30}ms` }} onClick={() => doBuild(k)} aria-label={`${TOWERS[k].name} ${c}`}>
                <Pix tower={k} size={34} />
                <span className="game-bugsiege-price"><Coin />{c}</span>
                <span className="game-bugsiege-optname below">{SHORT[k]}</span>
              </button>
            );
          })}
          {selTower && (() => {
            const def = TOWERS[selTower.kind];
            const uc = upgradeCost(selTower);
            const specName = selTower.spec ? def.specs.find((x) => x.id === selTower.spec)!.name : null;
            return (
              <>
                <span className="game-bugsiege-ringlabel" style={specRing ? { top: R * 0.3 } : undefined}>{specName ?? def.name} <small>Lv {selTower.level}</small></span>
                {uc !== null && (
                  <button className={`game-bugsiege-opt${hud.coins >= uc ? '' : ' poor'}`} disabled={hud.coins < uc} style={{ transform: `translate(0px, ${-R}px)` }} onClick={doUpgrade} aria-label={`Upgrade ${uc}`}>
                    <Pix tower={selTower.kind} level={selTower.level + 1} size={34} />
                    <span className="game-bugsiege-price"><Coin />{uc}</span>
                    <span className="game-bugsiege-optname">Level {selTower.level + 1}</span>
                  </button>
                )}
                {selTower.level === 3 && def.specs.map((sp, i) => (
                  <button key={sp.id} className={`game-bugsiege-opt spec${hud.coins >= sp.cost ? '' : ' poor'}`} disabled={hud.coins < sp.cost}
                    style={{ transform: `translate(${(i ? 1 : -1) * Math.max(R, 58)}px, ${-R * 0.6}px)` }} onClick={() => doSpec(i as 0 | 1)} aria-label={`${sp.name} ${sp.cost}`}>
                    <Pix tower={selTower.kind} level={4} spec={sp.id} size={34} />
                    <span className="game-bugsiege-price"><Coin />{sp.cost}</span>
                    <span className="game-bugsiege-optname">{sp.name}<em>{sp.blurb}</em></span>
                  </button>
                ))}
                {selTower.level === 4 && <span className="game-bugsiege-maxed" style={{ transform: `translate(0px, ${-R}px)` }}>Max</span>}
                <button className="game-bugsiege-opt sell" style={{ transform: `translate(0px, ${R}px)` }} onClick={doSell} aria-label={`Sell for ${sellValue(selTower)}`}>
                  <span className="game-bugsiege-sellicon"><Coin /></span>
                  <span className="game-bugsiege-price">+{sellValue(selTower)}</span>
                  {!specRing && <span className="game-bugsiege-optname">Sell</span>}
                </button>
              </>
            );
          })()}
        </div>
      )}

      {tut >= 0 && !halted && <Tutorial step={tut} view={view} spot={toScreen(view, ...spotPos(s.map, tutSpot))} ring={[ringX, ringY - R]} call={entrances[0]} hero={[heroSX, heroSY - U]} heroName={cap(hero)} />}

      {banner && <div key={banner.key} className="game-bugsiege-banner">{banner.text}</div>}

      {menuOpen && !s.over && (
        <div className="game-bugsiege-pause">
          <div className="game-bugsiege-panel small">
            <h2>Paused</h2>
            <p className="game-bugsiege-dim">{m.name}, wave {s.wave} of {totalWaves(s)}. Your run is saved.</p>
            <div className="game-bugsiege-panelbottom">
              <button className="game-bugsiege-btn" onClick={onQuit}>Quit to map</button>
              <button className="game-bugsiege-btn" onClick={onRestart}>Restart</button>
              <button className="game-bugsiege-btn go" onClick={() => { if (!paused) setMenuOpen(false); }} disabled={paused}>Resume</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Tutorial({ step, spot, ring, call, hero, heroName }: { step: number; view: View; spot: [number, number]; ring: [number, number]; call: [number, number]; hero: [number, number]; heroName: string }) {
  const at: [number, number] | null = step === 0 ? [spot[0], spot[1] - 18] : step === 1 ? ring : step === 2 ? [call[0], call[1] - 22] : step === 3 ? hero : null;
  const text = ['Tap the glowing spot to build', 'Tap the Pecker to build it', 'Tap Start Wave when you are ready', `Tap the road to move ${heroName}. ${heroName} fights bugs up close`, `Tap ${heroName}'s portrait for a special attack`][step];
  return (
    <>
      {at && <i className="game-bugsiege-arrow" style={{ left: at[0], top: at[1] }} />}
      <div className="game-bugsiege-hint">{text}</div>
      {step === 4 && <i className="game-bugsiege-arrow side" />}
    </>
  );
}

