import { useEffect, useRef, useState } from 'react';
import type { GameMeta, GameProps, Ghost } from '../types';
import { sprite } from '../types';
import { sfx } from '../../economy/sound';
import { buzz, ticks } from '../../haptics';
import { N, fresh, ghostPace, ghostScore, hasPower, speed, step, upgrade, type Mode, type P, type Power, type State } from './logic';
import './style.css';

/** Snake, Roost style: Pip leads a conga line, and every seed he picks up
 *  brings another crew member into the line (they hop in). Wave 3 added
 *  power seeds (slow-mo, ghost-through, double), a wrap-around mode, combos
 *  for quick seeds, and ghosts racing your line. */
export const meta: GameMeta = {
  id: 'snake',
  name: 'Conga',
  blurb: 'Pip leads the line. Every seed brings another friend.',
  host: 'pip',
  pack: 'classic',
  safeCorner: 'bl',
  ghostScore,
  inProgress: (s: any) => !!s && !!s.body,
  achievements: [
    { id: 'first', name: 'First seed', says: 'Pick up a seed.' },
    { id: 'ten', name: 'Party of ten', says: 'Get ten in the line.' },
    { id: 'full-crew', name: 'Whole crew', says: 'Score 25 in one run.' },
    { id: 'fifty', name: 'Parade', says: 'Score 50 in one run.' },
    { id: 'power', name: 'Power seed', says: 'Pick up a glowing seed.' },
    { id: 'combo', name: 'On a roll', says: 'Build a combo of 5 quick seeds.' },
    { id: 'wrap', name: 'Round the world', says: 'Score 20 in wrap-around mode.' },
  ],
};

const CREW = ['ollie', 'bram', 'wren', 'moss', 'fig', 'nell', 'juno', 'rue', 'bly', 'tuck', 'otto'];
const POWER_NAME: Record<Power, string> = { slow: 'Slow-mo', phase: 'Ghost-through', double: 'Double seeds' };
const POWER_COLOR: Record<Power, string> = { slow: '#5aa8e8', phase: '#c9b6ff', double: '#f2c14e' };
type Burst = { id: number; x: number; y: number; color: string; n: number };
let burstId = 0;

export function Game({ save, onSave, onScore, onAchieve, paused, best, ghost }: GameProps<State>) {
  const [s, setS] = useState<State>(() => (save ? upgrade(save) : fresh()));
  const [over, setOver] = useState(false);
  const [started, setStarted] = useState(!!save);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const queued = useRef<P[]>([]);
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => { const r = () => setW(window.innerWidth); window.addEventListener('resize', r); return () => window.removeEventListener('resize', r); }, []);
  const cell = Math.floor(Math.min(w - 24, 420) / N);

  const turn = (d: P) => {
    if (over) return;
    setStarted(true);
    const last = queued.current.at(-1) ?? s.dir;
    if (last[0] === -d[0] && last[1] === -d[1]) return;
    if (last[0] === d[0] && last[1] === d[1]) return;
    if (queued.current.length < 3) { queued.current.push(d); sfx('tap'); }
  };

  const burst = (at: P, color: string, n: number) => {
    const b = { id: ++burstId, x: at[0] * cell + cell / 2, y: at[1] * cell + cell / 2, color, n };
    setBursts((xs) => [...xs.slice(-5), b]);
    setTimeout(() => setBursts((xs) => xs.filter((x) => x.id !== b.id)), 650);
  };

  useEffect(() => {
    if (paused || over || !started) return;
    const t = setTimeout(() => {
      const dir = queued.current.shift() ?? s.dir;
      const r = step(s, dir);
      if (r.dead) {
        setOver(true); setShake(true); setTimeout(() => setShake(false), 450);
        sfx('crash'); buzz('fail');
        onScore(s.score);
        onSave(null);
        return;
      }
      const next = r.state;
      if (r.ate) {
        burst(r.state.body[0], r.gained > 1 ? '#f2c14e' : '#e8b04a', 6 + r.gained * 2);
        sfx(r.gained > 1 ? 'coin' : 'score');
        ticks(Math.min(4, r.gained));
        if (next.score >= 1) onAchieve('first');
        if (next.body.length >= 10) onAchieve('ten');
        if (next.score >= 25) onAchieve('full-crew');
        if (next.score >= 50) onAchieve('fifty');
        if (next.combo >= 5) onAchieve('combo');
        if (next.mode === 'wrap' && next.score >= 20) onAchieve('wrap');
        if (next.combo >= 3) { setFlash(`Combo x${next.combo}`); setTimeout(() => setFlash(null), 700); }
      }
      if (r.powered) {
        burst(next.body[0], POWER_COLOR[r.powered], 14);
        sfx('whoosh'); ticks(3, 60);
        onAchieve('power');
        setFlash(POWER_NAME[r.powered]); setTimeout(() => setFlash(null), 900);
      }
      setS(next);
      onSave(next);
    }, speed(s));
    return () => clearTimeout(t);
  }, [s, paused, over, started, onSave, onScore, onAchieve]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const m: Record<string, P> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
      if (m[e.key]) { e.preventDefault(); turn(m[e.key]); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const touch = useRef<{ x: number; y: number } | null>(null);
  const begin = (mode: Mode) => { queued.current = []; setS(fresh(mode)); setOver(false); setStarted(true); sfx('whoosh'); };
  const menu = () => { queued.current = []; setS(fresh()); setOver(false); setStarted(false); };

  const act = s.active && s.tick < s.active.until ? s.active : null;
  const actLeft = act ? (act.until - s.tick) / 45 : 0;
  const phase = hasPower(s, 'phase');
  const hopIdx = s.body.length - 1;

  return (
    <div className={`game-snake-wrap${shake ? ' game-snake-shake' : ''}`}>
      <div className="game-score">
        Score <b>{s.score}</b> · line {s.body.length}
        {s.combo >= 2 && <span className="game-snake-combo"> · combo x{s.combo}</span>}
        {best !== undefined && <span> · best {best}</span>}
      </div>
      {ghost && <GhostRace ghost={ghost} you={s.score} ghostNow={started ? ghostPace(ghost.target, s.tick) : 0} width={cell * N} />}
      <div className="game-snake-power" style={{ width: cell * N, visibility: act ? 'visible' : 'hidden' }}>
        {act && <>
          <span style={{ color: POWER_COLOR[act.kind] }}>{POWER_NAME[act.kind]}</span>
          <span className="game-snake-power-bar"><span style={{ width: `${Math.max(0, Math.min(1, actLeft)) * 100}%`, background: POWER_COLOR[act.kind] }} /></span>
        </>}
      </div>
      <div
        className={`game-snake-board${s.mode === 'wrap' ? ' wrap' : ''}${act ? ` pw-${act.kind}` : ''}`}
        style={{ width: cell * N, height: cell * N, ['--cell' as string]: `${cell}px` }}
        onTouchStart={(e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
        onTouchMove={(e) => {
          // Turn mid-swipe as soon as the finger has clearly moved: snappier than waiting for lift.
          const t0 = touch.current;
          if (!t0) return;
          const dx = e.touches[0].clientX - t0.x, dy = e.touches[0].clientY - t0.y;
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
          turn(Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)]);
          touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }}
        onTouchEnd={() => { touch.current = null; }}
      >
        <span className="game-snake-seed" style={{ left: s.seed[0] * cell, top: s.seed[1] * cell, width: cell, height: cell }}><i /></span>
        {s.power && (
          <span
            className={`game-snake-pseed${s.power.until - s.tick < 15 ? ' fading' : ''}`}
            style={{ left: s.power.at[0] * cell, top: s.power.at[1] * cell, width: cell, height: cell, ['--pc' as string]: POWER_COLOR[s.power.kind] }}
          ><i /></span>
        )}
        {s.body.map((b, i) => (
          <img
            key={i}
            src={sprite(i === 0 ? 'pip' : CREW[(i - 1) % CREW.length], i === 0 ? 'side' : i === hopIdx && started ? 'cheer' : 'idle')}
            alt=""
            className={`game-snake-part${i === hopIdx && i > 2 ? ' hop' : ''}${i === 0 ? ' head' : ''}`}
            style={{
              left: b[0] * cell, top: b[1] * cell, width: cell, height: cell,
              transform: i === 0 && s.dir[0] < 0 ? 'scaleX(-1)' : undefined,
              opacity: phase && i > 0 ? 0.5 : undefined,
              zIndex: s.body.length - i,
            }}
          />
        ))}
        {bursts.map((b) => (
          <span key={b.id} className="game-snake-burst" style={{ left: b.x, top: b.y }}>
            {Array.from({ length: b.n }, (_, k) => {
              const a = (k / b.n) * Math.PI * 2, d = cell * (0.9 + (k % 3) * 0.35);
              return <i key={k} style={{ background: b.color, ['--dx' as string]: `${Math.cos(a) * d}px`, ['--dy' as string]: `${Math.sin(a) * d}px` }} />;
            })}
          </span>
        ))}
        {flash && <div className="game-snake-flash" key={flash + s.tick}>{flash}</div>}
        {(!started || over) && (
          <div className="game-overlay">
            {over ? <>
              <img src={sprite('pip', 'think')} alt="" />
              <p>Scored {s.score} with a line of {s.body.length}. {ghost ? (s.score > ghost.target ? `You beat ${ghost.name}'s ghost!` : `${ghost.name}'s ghost got ${ghost.target}.`) : best !== undefined && s.score >= best ? 'Best yet!' : 'Again?'}</p>
              <div className="game-snake-row">
                <button className="chip" onClick={() => begin(s.mode)}>Play again</button>
                <button className="chip" onClick={menu}>Modes</button>
              </div>
            </> : <>
              <img src={sprite('pip', 'cheer')} alt="" />
              <p>Swipe to steer Pip. Grab seeds quick for combos; glowing seeds are powers.</p>
              <button className="chip" onClick={() => begin('classic')}>Classic</button>
              <button className="chip" onClick={() => begin('wrap')}>Wrap-around (walls loop, a bit faster)</button>
            </>}
          </div>
        )}
      </div>
      <div className="game-snake-legend">
        {(['slow', 'phase', 'double'] as Power[]).map((k) => <span key={k}><i style={{ background: POWER_COLOR[k] }} />{POWER_NAME[k]}</span>)}
      </div>
      <div className="game-snake-dpad">
        <button onClick={() => turn([0, -1])} aria-label="Up"><Arrow r={0} /></button>
        <div>
          <button onClick={() => turn([-1, 0])} aria-label="Left"><Arrow r={270} /></button>
          <button onClick={() => turn([1, 0])} aria-label="Right"><Arrow r={90} /></button>
        </div>
        <button onClick={() => turn([0, 1])} aria-label="Down"><Arrow r={180} /></button>
      </div>
    </div>
  );
}

function Arrow({ r }: { r: number }) {
  return (
    <svg width="18" height="18" viewBox="0 0 6 6" style={{ transform: `rotate(${r}deg)` }} shapeRendering="crispEdges" aria-hidden="true">
      <path d="M2 1h2v1h1v1h1v1H0V3h1V2h1z" fill="currentColor" />
    </svg>
  );
}

/** The ghost's see-through bird riding a track at its live score, next to yours. */
function GhostRace({ ghost, you, ghostNow, width }: { ghost: Ghost; you: number; ghostNow: number; width: number }) {
  const top = Math.max(ghost.target, you, 1) * 1.08;
  const pct = (n: number) => `${Math.min(100, (n / top) * 100)}%`;
  return (
    <div className="game-snake-race" style={{ width }}>
      <span className="game-snake-race-line" style={{ left: pct(ghost.target) }} title={`${ghost.name}'s final score`} />
      <span className="game-snake-race-you" style={{ left: pct(you) }}><img src={sprite('pip', 'side')} alt="" /></span>
      <span className="game-snake-race-ghost" style={{ left: pct(ghostNow) }}>
        <img src={sprite(ghost.sprite, 'idle')} alt="" />
        <b>{ghostNow}</b>
      </span>
      <span className="game-snake-race-label">{ghost.name}'s ghost: {ghost.target}</span>
    </div>
  );
}
