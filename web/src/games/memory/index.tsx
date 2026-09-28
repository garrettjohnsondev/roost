import { useEffect, useState } from 'react';
import type { Ghost, GameMeta, GameProps } from '../types';
import { sprite } from '../types';
import { sfx } from '../../economy/sound';
import { buzz, ticks } from '../../haptics';
import {
  COMBO_FOR_PEEK, colsFor, deal, done, face, flip, ghostMoves, ghostPairs, settle, spendPeek, tick, timeUp, TIME_FOR,
  type Size, type State,
} from './logic';
import './style.css';

/** Memory, Roost style: the crew is hiding behind the cards. Find the pairs.
 *  Wave 3: bigger boards (with lookalike poses), a timed mode, combos that
 *  earn a peek, and a ghost pacing you pair by pair. */
export const meta: GameMeta = {
  id: 'memory',
  name: 'Crew Match',
  blurb: 'The crew is hiding behind the cards. Find the pairs.',
  host: 'fig',
  pack: 'quick',
  lowerIsBetter: true,
  scoreKind: 'points',
  safeCorner: 'br',
  ghostScore: ghostMoves,
  achievements: [
    { id: 'first', name: 'Reunited', says: 'Clear a board.' },
    { id: 'perfect', name: 'Perfect memory', says: 'Clear 4x4 without a single miss.' },
    { id: 'quick16', name: 'Sharp eyes', says: 'Clear 4x4 in 12 moves or fewer.' },
    { id: 'quick20', name: 'Big table', says: 'Clear 4x5 in 16 moves or fewer.' },
    { id: 'huge', name: 'Full house', says: 'Clear the 5x6 board, lookalikes and all.' },
    { id: 'combo5', name: 'On a roll', says: 'Match five pairs in a row.' },
    { id: 'beat-clock', name: 'Beat the clock', says: 'Clear a board in timed mode.' },
  ],
};

const LABEL: Record<Size, string> = { 16: '4x4', 20: '4x5', 24: '4x6', 30: '5x6' };

export function Game({ save, onSave, onScore, onAchieve, paused, best, ghost }: GameProps<State>) {
  const [s, setS] = useState<State | null>(save ? settle(save) : null);
  const [fresh, setFresh] = useState<number[]>([]);
  const [missed, setMissed] = useState<number[]>([]);
  const [peek, setPeek] = useState(false);
  const [pop, setPop] = useState<{ id: number; text: string } | null>(null);
  const [timed, setTimed] = useState(!!save?.timed);
  const [dealt, setDealt] = useState(0);
  const lost = !!s && timeUp(s);
  const finished = !!s && done(s);

  // A miss shows for a moment, then the cards turn back (held while paused).
  useEffect(() => {
    if (!s || s.open.length !== 2 || paused) return;
    const t = setTimeout(() => { setS((c) => (c ? settle(c) : c)); setMissed([]); }, 800);
    return () => clearTimeout(t);
  }, [s, paused]);

  // Timed mode: the clock runs from the first flip, never while paused.
  const running = !!s?.timed && !finished && !lost && (s.moves > 0 || s.open.length > 0);
  useEffect(() => {
    if (!running || paused) return;
    const t = setInterval(() => setS((c) => (c ? tick(c, 0.25) : c)), 250);
    return () => clearInterval(t);
  }, [running, paused]);
  const secLeft = Math.ceil(s?.left ?? 0);
  useEffect(() => { if (running && secLeft <= 5 && secLeft > 0) ticks(1); }, [running, secLeft]);
  useEffect(() => { if (lost) { buzz('fail'); sfx('lose'); onSave(null); } }, [lost]); // eslint-disable-line react-hooks/exhaustive-deps

  const flash = (text: string) => { const id = Date.now(); setPop({ id, text }); setTimeout(() => setPop((p) => (p?.id === id ? null : p)), 900); };

  const tap = (i: number) => {
    if (!s || paused || finished || lost || peek) return;
    const n = flip(s, i);
    if (n === s) return;
    if (n.open.length !== 2) setMissed([]);
    const newly = n.matched.map((m, k) => (m && !s.matched[k] ? k : -1)).filter((k) => k >= 0);
    if (newly.length) {
      setFresh(newly);
      const combo = n.combo ?? 0;
      if ((n.peeks ?? 0) > (s.peeks ?? 0)) { ticks(3); sfx('coin'); flash(`Combo x${combo}! +1 peek`); }
      else { ticks(2); sfx('score'); if (combo >= 2) flash(`Combo x${combo}`); }
      if (combo >= 5) onAchieve('combo5');
    } else if (n.open.length === 2) {
      setMissed(n.open); sfx('bounce');
    } else { sfx('tap'); ticks(1); }
    setS(n);
    if (done(n)) {
      buzz('pass'); sfx('win');
      onScore(n.moves); onSave(null);
      onAchieve('first');
      if (n.size === 16 && n.misses === 0) onAchieve('perfect');
      if (n.size === 16 && n.moves <= 12) onAchieve('quick16');
      if (n.size === 20 && n.moves <= 16) onAchieve('quick20');
      if (n.size === 30) onAchieve('huge');
      if (n.timed) onAchieve('beat-clock');
    } else onSave(settle(n));
  };

  const doPeek = () => {
    if (!s || peek || finished || lost || paused) return;
    const n = spendPeek(settle(s));
    if (!n) return;
    setS(n); onSave(n); setPeek(true); setMissed([]);
    sfx('whoosh'); ticks(1);
    setTimeout(() => setPeek(false), 900);
  };

  const start = (size: Size) => {
    const n = deal(size, Math.random, timed);
    setFresh([]); setMissed([]); setPeek(false); setS(n); onSave(n); setDealt((d) => d + 1);
    sfx('whoosh');
  };

  const size = s?.size ?? 16;
  const cols = colsFor(size);
  const rows = size / cols;
  const w = Math.floor(Math.min(window.innerWidth - 32, 360) / cols) - 6;
  const h = Math.max(40, Math.min(Math.floor(w * 1.15), Math.floor((window.innerHeight - 300) / rows) - 6));
  const pairs = size / 2;
  const found = s ? s.matched.filter(Boolean).length / 2 : 0;
  const left = s?.left ?? 0;

  return (
    <div className="game-memory-root">
      <div className="game-memory-hud">
        <div className="game-score">Moves: <b>{s?.moves ?? 0}</b>{best !== undefined && <span> · best {best}</span>}</div>
        {s && !finished && !lost && (
          <button className="game-memory-peek" disabled={!s.peeks || peek} onClick={doPeek} title={`A combo of ${COMBO_FOR_PEEK} earns a peek`}>
            <span className="game-memory-eye" />Peek <b>{s.peeks ?? 0}</b>
          </button>
        )}
      </div>
      {s?.timed && (
        <div className={`game-memory-clock${left <= 5 ? ' game-memory-hurry' : ''}`}>
          <i style={{ width: `${Math.min(100, (left / TIME_FOR[s.size]) * 100)}%` }} />
          <span>{Math.ceil(left)}s</span>
        </div>
      )}
      {ghost && s && <GhostPace ghost={ghost} pairs={pairs} found={found} moves={s.moves} size={s.size} />}
      <div className="game-memory-wrap">
        <div key={dealt} className={`game-memory-grid${peek ? ' game-memory-peeking' : ''}`} style={{ gridTemplateColumns: `repeat(${cols}, ${w}px)` }}>
          {(s?.cards ?? Array(16).fill('')).map((c, i) => {
            const up = !!s && (s.matched[i] || s.open.includes(i) || peek);
            const matched = !!s?.matched[i];
            const f = face(c || 'fig');
            const pose = matched && fresh.includes(i) ? 'cheer' : matched ? 'sit' : f.pose;
            const cls = [
              'game-memory-card', up ? 'game-memory-up' : '', matched ? 'game-memory-done' : '',
              matched && fresh.includes(i) ? 'game-memory-fresh' : '', missed.includes(i) ? 'game-memory-miss' : '',
            ].join(' ');
            return (
              <button key={i} className={cls} style={{ width: w, height: h, ['--i' as string]: i }} onClick={() => tap(i)} aria-label={up ? c : 'card'}>
                <span className="game-memory-inner">
                  <span className="game-memory-back" />
                  <span className="game-memory-front">
                    {s && c && <img src={sprite(f.name, pose)} alt="" draggable={false} />}
                    {f.pose !== 'idle' && s && <em className="game-memory-tag">z</em>}
                  </span>
                </span>
                {matched && fresh.includes(i) && <span className="game-memory-spark"><i /><i /><i /><i /><i /></span>}
              </button>
            );
          })}
        </div>
        {pop && <div key={pop.id} className="game-memory-pop">{pop.text}</div>}
        {(!s || finished || lost) && (
          <div className="game-overlay">
            <img src={sprite('fig', finished ? 'cheer' : lost ? 'sleep' : 'peek')} alt="" />
            <p>
              {finished
                ? `All pairs in ${s!.moves} moves${s!.misses === 0 ? ', no misses!' : '.'}${(s!.bestCombo ?? 0) >= 2 ? ` Best combo x${s!.bestCombo}.` : ''}`
                : lost ? `Out of time with ${found} of ${pairs} pairs.` : 'Flip two cards. Find the matching crew.'}
            </p>
            {finished && ghost && s!.size === 16 && (
              <p className="game-memory-dim">{s!.moves < ghost.target ? `You beat ${ghost.name}'s ghost (${ghost.target}).` : `${ghost.name}'s ghost took ${ghost.target}.`}</p>
            )}
            <div className="game-memory-row">
              {([16, 20, 24, 30] as Size[]).map((z) => <button key={z} className="chip" onClick={() => start(z)}>{LABEL[z]}</button>)}
            </div>
            <label className="game-memory-timed">
              <input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} /> Timed ({TIME_FOR[16]}s on 4x4, +2s a match)
            </label>
            {ghost && <p className="game-memory-dim">{ghost.name}'s ghost races on 4x4.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

/** The ghost's pace: its pairs found by your move count, drawn see-through
 *  above your own row of pairs. Ghosts race on 4x4 only. */
function GhostPace({ ghost, pairs, found, moves, size }: { ghost: Ghost; pairs: number; found: number; moves: number; size: Size }) {
  if (size !== 16) return <div className="game-memory-dim">{ghost.name}'s ghost races on 4x4.</div>;
  const g = ghostPairs(ghost.target, pairs, moves);
  return (
    <div className="game-memory-track" title={`${ghost.name}'s ghost clears 4x4 in ${ghost.target} moves`}>
      {Array.from({ length: pairs }, (_, k) => (
        <span key={k} className={`game-memory-slot${k < found ? ' game-memory-mine' : ''}${k < g ? ' game-memory-theirs' : ''}`} />
      ))}
      <span className="game-memory-ghost" style={{ left: `calc(${(Math.max(g, 0.5) / pairs) * 100}% - 14px)` }}>
        <img src={sprite(ghost.sprite, 'idle')} alt={`${ghost.name}'s ghost`} />
      </span>
      <span className="game-memory-track-say">{found > g ? 'Ahead of' : found === g ? 'Level with' : 'Behind'} {ghost.name} · beat {ghost.target} moves</span>
    </div>
  );
}
