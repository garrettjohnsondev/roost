import { useEffect, useRef, useState } from 'react';
import type { GameMeta, GameProps } from '../types';
import { sprite } from '../types';
import { SIZES, chord, countAround, dig, flagsLeft, newBoard, toggleFlag, won, type Board, type Size } from './logic';
import './style.css';

/** Minesweeper, Roost style: the crew is napping under the dirt. Dig around
 *  them without waking anyone. Only Medium runs count toward the best time. */
export const meta: GameMeta = {
  id: 'minesweeper',
  name: 'Minesweeper',
  blurb: 'The crew is napping in the dirt. Dig around them. Best = Medium.',
  host: 'moss',
  pack: 'classic',
  lowerIsBetter: true,
  scoreKind: 'time',
  achievements: [
    { id: 'easy', name: 'Light sleepers', says: 'Clear an Easy field.' },
    { id: 'medium', name: 'Quiet shovel', says: 'Clear a Medium field.' },
    { id: 'hard', name: 'Nap guardian', says: 'Clear a Hard field.' },
    { id: 'fast', name: 'Quick hands', says: 'Clear Medium in under 90 seconds.' },
    { id: 'noflag', name: 'No flags needed', says: 'Clear any field without placing a flag.' },
  ],
};

const SLEEPERS = ['pip', 'ollie', 'bram', 'wren', 'moss', 'fig', 'nell', 'juno', 'rue', 'bly', 'tuck', 'otto'];
const NUM_COLORS = ['', '#3b7dd8', '#3a9a4a', '#d0463b', '#6b4bb8', '#9a3a2a', '#2a8a8a', 'var(--text)', 'var(--text-dim)'];

interface Save { board: Board; secs: number; flagged: boolean }
type Phase = 'pick' | 'play' | 'won' | 'lost';

export function Game({ save, onSave, onScore, onAchieve, paused, best }: GameProps<Save>) {
  const [s, setS] = useState<Save | null>(save);
  const [phase, setPhase] = useState<Phase>(save ? 'play' : 'pick');
  const [flagMode, setFlagMode] = useState(false);
  const [woke, setWoke] = useState<number | null>(null);
  const press = useRef<{ t: ReturnType<typeof setTimeout>; fired: boolean } | null>(null);

  const started = !!s && s.board.mines.length > 0;
  useEffect(() => {
    if (paused || phase !== 'play' || !started) return;
    const t = setInterval(() => setS((cur) => (cur ? { ...cur, secs: cur.secs + 1 } : cur)), 1000);
    return () => clearInterval(t);
  }, [paused, phase, started]);

  useEffect(() => { if (s && phase === 'play' && started) onSave(s); }, [s, phase, started, onSave]);

  const start = (size: Size) => { setS({ board: newBoard(size), secs: 0, flagged: false }); setPhase('play'); setWoke(null); setFlagMode(false); };

  const finish = (next: Save, boom: boolean, at: number) => {
    setS(next);
    if (boom) {
      setWoke(at); setPhase('lost'); onSave(null);
      navigator.vibrate?.(80);
      return;
    }
    if (won(next.board)) {
      setPhase('won'); onSave(null);
      const size = next.board.size;
      onAchieve(size);
      if (!next.flagged) onAchieve('noflag');
      if (size === 'medium') {
        onScore(next.secs);
        if (next.secs < 90) onAchieve('fast');
      }
    }
  };

  const flag = (i: number) => {
    if (!s || phase !== 'play' || s.board.open[i]) return;
    navigator.vibrate?.(15);
    setS({ ...s, board: toggleFlag(s.board, i), flagged: true });
  };

  const tap = (i: number) => {
    if (!s || phase !== 'play') return;
    if (flagMode && !s.board.open[i]) return flag(i);
    const r = s.board.open[i] ? chord(s.board, i) : dig(s.board, i);
    const at = r.boom ? r.board.mines.find((m) => r.board.open[m]) ?? i : i;
    finish({ ...s, board: r.board }, r.boom, at);
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
          <img src={sprite('moss', 'sleep')} alt="" />
          <p>The crew is napping under the dirt. Dig every safe tile without waking anyone.</p>
          {(Object.keys(SIZES) as Size[]).map((k) => (
            <button key={k} className="chip" onClick={() => start(k)}>
              {SIZES[k].label} · {SIZES[k].cols}×{SIZES[k].rows} · {SIZES[k].mines} nappers
            </button>
          ))}
          <p className="game-minesweeper-note">Tap to dig, hold to flag. Only Medium times count for your best.</p>
        </div>
      </div>
    );
  }

  const b = s.board;
  const cell = Math.floor(Math.min(window.innerWidth - 24, 420) / b.cols);
  const maxH = Math.floor((window.innerHeight - 230) / b.rows);
  const size = Math.max(20, Math.min(cell, maxH, 44));
  const mm = Math.floor(s.secs / 60), ss = String(s.secs % 60).padStart(2, '0');

  return (
    <div className="game-minesweeper">
      <div className="game-minesweeper-bar">
        <span>{SIZES[b.size].label}</span>
        <span>Nappers <b>{flagsLeft(b)}</b></span>
        <span><b>{mm}:{ss}</b>{b.size === 'medium' && best !== undefined && <> · best {Math.floor(best / 60)}:{String(best % 60).padStart(2, '0')}</>}</span>
      </div>
      <div
        className="game-minesweeper-board"
        style={{ gridTemplateColumns: `repeat(${b.cols}, ${size}px)`, gridAutoRows: `${size}px` }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {b.open.map((open, i) => {
          const mine = (phase !== 'play') && b.mines.includes(i);
          const n = open && !mine ? countAround(b, i) : 0;
          const cls = `game-minesweeper-cell${open ? ' open' : ''}${woke === i ? ' woke' : ''}`;
          return (
            <button
              key={i}
              className={cls}
              style={{ fontSize: size * 0.55 }}
              onPointerDown={() => down(i)}
              onPointerUp={() => up(i)}
              onPointerLeave={cancel}
              onPointerCancel={cancel}
            >
              {mine ? (
                <img src={sprite(SLEEPERS[i % SLEEPERS.length], woke === i ? 'think' : 'sleep')} alt="" />
              ) : b.flag[i] ? (
                <span className="game-minesweeper-flag">⚑</span>
              ) : n ? <span style={{ color: NUM_COLORS[n] }}>{n}</span> : null}
            </button>
          );
        })}
        {(phase === 'won' || phase === 'lost') && (
          <div className="game-overlay">
            {phase === 'won' ? <>
              <img src={sprite('moss', 'cheer')} alt="" />
              <p>Cleared in {mm}:{ss} and nobody stirred.{b.size !== 'medium' && ' (Only Medium counts for best.)'}</p>
            </> : <>
              <img src={sprite(SLEEPERS[(woke ?? 0) % SLEEPERS.length], 'think')} alt="" />
              <p>You woke {SLEEPERS[(woke ?? 0) % SLEEPERS.length][0].toUpperCase() + SLEEPERS[(woke ?? 0) % SLEEPERS.length].slice(1)}. Grumpy.</p>
            </>}
            <div className="game-minesweeper-row">
              <button className="chip" onClick={() => start(b.size)}>Again</button>
              <button className="chip" onClick={() => { setS(null); setPhase('pick'); }}>Sizes</button>
            </div>
          </div>
        )}
      </div>
      <div className="game-minesweeper-row">
        <button className={`game-minesweeper-mode${flagMode ? ' on' : ''}`} onClick={() => setFlagMode((f) => !f)}>
          {flagMode ? '⚑ Flagging' : '⛏ Digging'}
        </button>
        <button className="game-minesweeper-mode" onClick={() => { onSave(null); setS(null); setPhase('pick'); }}>New</button>
      </div>
    </div>
  );
}
