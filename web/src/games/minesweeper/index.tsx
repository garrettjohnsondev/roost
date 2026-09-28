import { useEffect, useRef, useState } from 'react';
import type { GameMeta, GameProps, Ghost } from '../types';
import { dayNumber, sprite } from '../types';
import { sfx } from '../../economy/sound';
import { buzz, ticks } from '../../haptics';
import {
  SIZES, chordSmart, countAround, dailyBoard, dig, flagsLeft, ghostScore, newBoard, newlyOpened, sonar, toggleFlag, won,
  type Board, type Size,
} from './logic';
import './style.css';

/** Minesweeper, Roost style: the crew is napping under the dirt. Dig around
 *  them without waking anyone. Only Medium runs (including the daily field)
 *  count toward the best time. Wave 3: a daily seeded field, one sonar ping
 *  per game, smart chording (tap a number to flag or dig around it), and
 *  dig-chain dirt. */
export const meta: GameMeta = {
  id: 'minesweeper',
  name: 'Minesweeper',
  blurb: 'The crew is napping in the dirt. Dig around them. Best = Medium.',
  host: 'moss',
  pack: 'classic',
  lowerIsBetter: true,
  scoreKind: 'time',
  safeCorner: 'bl',
  ghostScore,
  achievements: [
    { id: 'easy', name: 'Light sleepers', says: 'Clear an Easy field.' },
    { id: 'medium', name: 'Quiet shovel', says: 'Clear a Medium field.' },
    { id: 'hard', name: 'Nap guardian', says: 'Clear a Hard field.' },
    { id: 'fast', name: 'Quick hands', says: 'Clear Medium in under 90 seconds.' },
    { id: 'noflag', name: 'No flags needed', says: 'Clear any field without placing a flag.' },
    { id: 'daily', name: 'Morning dig', says: "Clear today's field." },
    { id: 'nosonar', name: 'By ear', says: 'Clear Hard without the sonar.' },
    { id: 'chain', name: 'Landslide', says: 'Open 30 tiles with one dig.' },
  ],
};

const SLEEPERS = ['pip', 'ollie', 'bram', 'wren', 'moss', 'fig', 'nell', 'juno', 'rue', 'bly', 'tuck', 'otto'];
const NUM_COLORS = ['', '#3b7dd8', '#3a9a4a', '#d0463b', '#6b4bb8', '#9a3a2a', '#2a8a8a', 'var(--text)', 'var(--text-dim)'];
const SONAR_COST = 10;

interface Save { board: Board; secs: number; flagged: boolean; sonar?: boolean }
type Phase = 'pick' | 'play' | 'won' | 'lost';
type Chain = { id: number; origin: number; cells: Set<number>; dirt: number[] };
let chainId = 0;

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const name = (i: number) => { const n = SLEEPERS[i % SLEEPERS.length]; return n[0].toUpperCase() + n.slice(1); };

export function Game({ save, onSave, onScore, onAchieve, paused, best, ghost }: GameProps<Save>) {
  const [s, setS] = useState<Save | null>(save);
  const [phase, setPhase] = useState<Phase>(save ? 'play' : 'pick');
  const [flagMode, setFlagMode] = useState(false);
  const [woke, setWoke] = useState<number | null>(null);
  const [chain, setChain] = useState<Chain | null>(null);
  const [ping, setPing] = useState<number | null>(null);
  const [shake, setShake] = useState(false);
  const press = useRef<{ t: ReturnType<typeof setTimeout>; fired: boolean } | null>(null);
  const today = dayNumber();

  const started = !!s && s.board.mines.length > 0 && s.board.open.some(Boolean);
  useEffect(() => {
    if (paused || phase !== 'play' || !started) return;
    const t = setInterval(() => setS((cur) => (cur ? { ...cur, secs: cur.secs + 1 } : cur)), 1000);
    return () => clearInterval(t);
  }, [paused, phase, started]);

  useEffect(() => { if (s && phase === 'play' && started) onSave(s); }, [s, phase, started, onSave]);

  const reset = () => { setWoke(null); setFlagMode(false); setChain(null); setPing(null); };
  const start = (size: Size) => { setS({ board: newBoard(size), secs: 0, flagged: false }); setPhase('play'); reset(); sfx('tap'); };
  const startDaily = () => { setS({ board: dailyBoard(today), secs: 0, flagged: false }); setPhase('play'); reset(); sfx('tap'); };

  const animate = (before: Board, after: Board, origin: number) => {
    const opened = newlyOpened(before, after);
    if (!opened.length) return 0;
    const c: Chain = { id: ++chainId, origin, cells: new Set(opened), dirt: opened.slice(0, 36) };
    setChain(c);
    setTimeout(() => setChain((cur) => (cur?.id === c.id ? null : cur)), 900);
    return opened.length;
  };

  const finish = (prev: Save, next: Save, boom: boolean, at: number) => {
    const n = animate(prev.board, next.board, at);
    setS(next);
    if (boom) {
      setWoke(at); setPhase('lost'); onSave(null);
      sfx('crash'); buzz('fail');
      if (!reduced()) { setShake(true); setTimeout(() => setShake(false), 450); }
      return;
    }
    if (n >= 30) onAchieve('chain');
    if (won(next.board)) {
      setPhase('won'); onSave(null);
      sfx('win'); buzz('pass');
      const b = next.board;
      onAchieve(b.size);
      if (!next.flagged) onAchieve('noflag');
      if (b.size === 'hard' && !next.sonar) onAchieve('nosonar');
      if (b.daily === today) onAchieve('daily');
      if (b.size === 'medium') {
        onScore(next.secs);
        if (next.secs < 90) onAchieve('fast');
      }
      return;
    }
    if (n > 1) { sfx('whoosh'); ticks(Math.min(12, Math.ceil(n / 5))); } else if (n === 1) { sfx('tap'); ticks(1); }
  };

  const flag = (i: number) => {
    if (!s || phase !== 'play' || s.board.open[i]) return;
    sfx('tap'); ticks(1);
    setS({ ...s, board: toggleFlag(s.board, i), flagged: true });
  };

  const tap = (i: number) => {
    if (!s || phase !== 'play') return;
    if (flagMode && !s.board.open[i]) return flag(i);
    if (s.board.open[i]) {
      const r = chordSmart(s.board, i);
      if (r.flagged.length) {
        sfx('bounce'); ticks(r.flagged.length, 60);
        setS({ ...s, board: r.board, flagged: true });
        return;
      }
      if (r.board === s.board) return;
      const at = r.boom ? r.board.mines.find((m) => r.board.open[m]) ?? i : i;
      return finish(s, { ...s, board: r.board }, r.boom, at);
    }
    const r = dig(s.board, i);
    finish(s, { ...s, board: r.board }, r.boom, i);
  };

  const fireSonar = () => {
    if (!s || phase !== 'play' || s.sonar || !started) return;
    const i = sonar(s.board);
    if (i < 0) return;
    setPing(i);
    setTimeout(() => setPing((p) => (p === i ? null : p)), 1100);
    sfx('score'); ticks(2, 120);
    const r = dig(s.board, i);
    finish(s, { ...s, board: r.board, secs: s.secs + SONAR_COST, sonar: true }, false, i);
  };

  const down = (i: number) => {
    const p = { fired: false, t: setTimeout(() => { p.fired = true; flag(i); }, 380) };
    press.current = p;
  };
  const up = (i: number) => {
    const p = press.current; press.current = null;
    if (!p) return;
    clearTimeout(p.t);
    if (!p.fired) tap(i);
  };
  const cancel = () => { if (press.current) clearTimeout(press.current.t); press.current = null; };

  if (!s || phase === 'pick') {
    return (
      <div className="game-minesweeper">
        <div className="game-minesweeper-pick">
          <img className="game-minesweeper-snooze" src={sprite('moss', 'sleep')} alt="" />
          <p>The crew is napping under the dirt. Dig every safe tile without waking anyone.</p>
          <button className="chip game-minesweeper-daily" onClick={startDaily}>
            Today's field · Medium · same for everyone
          </button>
          {(Object.keys(SIZES) as Size[]).map((k) => (
            <button key={k} className="chip" onClick={() => start(k)}>
              {SIZES[k].label} · {SIZES[k].cols}×{SIZES[k].rows} · {SIZES[k].mines} nappers
            </button>
          ))}
          <p className="game-minesweeper-note">Tap to dig, hold to flag. Tap a number to flag the nappers it must mean, or dig around it once they're flagged. One sonar ping per field (+{SONAR_COST}s). Only Medium times count.</p>
        </div>
      </div>
    );
  }

  const b = s.board;
  const cell = Math.floor(Math.min(window.innerWidth - 24, 420) / b.cols);
  const maxH = Math.floor((window.innerHeight - (ghost && b.size === 'medium' ? 290 : 250)) / b.rows);
  const size = Math.max(20, Math.min(cell, maxH, 44));
  const mm = Math.floor(s.secs / 60), ss = String(s.secs % 60).padStart(2, '0');
  const fmt = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  const safeTotal = b.cols * b.rows - SIZES[b.size].mines;
  const dug = b.open.filter(Boolean).length - (phase === 'lost' ? 1 : 0);
  const col = (i: number) => i % b.cols, row = (i: number) => Math.floor(i / b.cols);
  const dist = (i: number) => (chain ? Math.hypot(col(i) - col(chain.origin), row(i) - row(chain.origin)) : 0);

  return (
    <div className={`game-minesweeper${shake ? ' game-minesweeper-shake' : ''}`}>
      <div className="game-minesweeper-bar">
        <span>{b.daily !== undefined ? 'Daily' : SIZES[b.size].label}</span>
        <span>Nappers <b>{flagsLeft(b)}</b></span>
        <span><b>{mm}:{ss}</b>{b.size === 'medium' && best !== undefined && <> · best {fmt(best)}</>}</span>
      </div>
      {ghost && b.size === 'medium' && <GhostRace ghost={ghost} secs={s.secs} you={dug / safeTotal} width={size * b.cols + b.cols + 3} fmt={fmt} />}
      <div
        className="game-minesweeper-board"
        style={{ gridTemplateColumns: `repeat(${b.cols}, ${size}px)`, gridAutoRows: `${size}px` }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {b.open.map((open, i) => {
          const mine = (phase !== 'play') && b.mines.includes(i);
          const n = open && !mine ? countAround(b, i) : 0;
          const pop = chain?.cells.has(i);
          const cls = `game-minesweeper-cell${open ? ' open' : ''}${woke === i ? ' woke' : ''}${pop ? ' pop' : ''}${ping === i ? ' ping' : ''}${!open && b.start === i && !started ? ' start' : ''}${mine && phase === 'lost' ? ' reveal' : ''}${(row(i) + col(i)) % 2 ? ' alt' : ''}`;
          return (
            <button
              key={i}
              className={cls}
              style={{ fontSize: size * 0.58, ['--d' as string]: `${Math.min(600, dist(i) * 35)}ms` }}
              onPointerDown={() => down(i)}
              onPointerUp={() => up(i)}
              onPointerLeave={cancel}
              onPointerCancel={cancel}
            >
              {mine ? (
                <img src={sprite(SLEEPERS[i % SLEEPERS.length], woke === i ? 'think' : phase === 'won' ? 'cheer' : 'sleep')} alt="" />
              ) : b.flag[i] ? (
                <FlagIcon />
              ) : n ? <span className="game-minesweeper-num" style={{ color: NUM_COLORS[n] }}>{n}</span> : null}
            </button>
          );
        })}
        {chain && (
          <div className="game-minesweeper-dirt" key={chain.id}>
            {chain.dirt.map((i, k) => (
              <i
                key={i}
                style={{
                  left: col(i) * (size + 1) + size / 2, top: row(i) * (size + 1) + size / 2,
                  ['--dx' as string]: `${((k * 37) % 21) - 10}px`, ['--d' as string]: `${Math.min(600, dist(i) * 35)}ms`,
                }}
              />
            ))}
          </div>
        )}
        {(phase === 'won' || phase === 'lost') && (
          <div className="game-overlay game-minesweeper-end">
            {phase === 'won' ? <>
              <img className="game-minesweeper-jump" src={sprite('moss', 'cheer')} alt="" />
              <p>Cleared in {mm}:{ss} and nobody stirred.{b.size !== 'medium' && ' (Only Medium counts for best.)'}</p>
              {ghost && b.size === 'medium' && <p className="game-minesweeper-note">{s.secs < ghost.target ? `Faster than ${ghost.name}'s ghost (${fmt(ghost.target)})!` : `${ghost.name}'s ghost did it in ${fmt(ghost.target)}.`}</p>}
            </> : <>
              <img src={sprite(SLEEPERS[(woke ?? 0) % SLEEPERS.length], 'think')} alt="" />
              <p>You woke {name(woke ?? 0)}. Grumpy.</p>
            </>}
            <div className="game-minesweeper-row">
              <button className="chip" onClick={() => (b.daily !== undefined ? startDaily() : start(b.size))}>Again</button>
              <button className="chip" onClick={() => { setS(null); setPhase('pick'); }}>Fields</button>
            </div>
          </div>
        )}
      </div>
      <div className="game-minesweeper-row">
        <button className={`game-minesweeper-mode${flagMode ? ' on' : ''}`} onClick={() => { setFlagMode((f) => !f); sfx('tap'); }}>
          {flagMode ? <><FlagIcon /> Flagging</> : <><ShovelIcon /> Digging</>}
        </button>
        <button className="game-minesweeper-mode" disabled={!!s.sonar || !started || phase !== 'play'} onClick={fireSonar}>
          <SonarIcon /> {s.sonar ? 'Used' : `Sonar +${SONAR_COST}s`}
        </button>
        <button className="game-minesweeper-mode small" onClick={() => { onSave(null); setS(null); setPhase('pick'); }}>New</button>
      </div>
    </div>
  );
}

function FlagIcon() {
  return (
    <svg className="game-minesweeper-flag" viewBox="0 0 8 8" width="0.9em" height="0.9em" shapeRendering="crispEdges" aria-hidden="true">
      <path d="M2 1h1v6H2z" fill="#3b2414" /><path d="M3 1h3v1h1v1H6v1H3z" fill="#d0463b" /><path d="M1 7h4v1H1z" fill="#3b2414" />
    </svg>
  );
}
function ShovelIcon() {
  return (
    <svg viewBox="0 0 8 8" width="16" height="16" shapeRendering="crispEdges" aria-hidden="true">
      <path d="M6 0h1v1h1v1H7v1H6V2H5V1h1z" fill="currentColor" /><path d="M4 2h1v1h1v1H5v1H4V4H3V3h1z" fill="currentColor" /><path d="M1 4h2v1h1v2H3v1H1V7H0V5h1z" fill="currentColor" />
    </svg>
  );
}
function SonarIcon() {
  return (
    <svg viewBox="0 0 8 8" width="16" height="16" shapeRendering="crispEdges" aria-hidden="true">
      <path d="M3 3h2v2H3z" fill="currentColor" /><path d="M2 1h4v1H2zM1 2h1v4H1zM6 2h1v4H6zM2 6h4v1H2z" fill="currentColor" opacity=".55" />
    </svg>
  );
}

/** The ghost floats along a track at the pace it would clear the field; your
 *  shovel moves with how much you've dug. */
function GhostRace({ ghost, secs, you, width, fmt }: { ghost: Ghost; secs: number; you: number; width: number; fmt: (n: number) => string }) {
  const g = Math.min(1, secs / Math.max(1, ghost.target));
  return (
    <div className="game-minesweeper-race" style={{ width }}>
      <span className="game-minesweeper-race-fill" style={{ width: `${you * 100}%` }} />
      <span className="game-minesweeper-race-you" style={{ left: `${you * 100}%` }}><ShovelIcon /></span>
      <span className="game-minesweeper-race-ghost" style={{ left: `${g * 100}%` }}><img src={sprite(ghost.sprite, 'idle')} alt="" /></span>
      <span className="game-minesweeper-race-label">{ghost.name} clears in {fmt(ghost.target)}</span>
    </div>
  );
}
