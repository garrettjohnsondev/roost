import { useEffect, useState } from 'react';
import type { GameMeta, GameProps } from '../types';
import { sprite } from '../types';
import { deal, done, flip, settle, type Size, type State } from './logic';
import './style.css';

/** Memory, Roost style: the crew is hiding behind the cards. Find the pairs. */
export const meta: GameMeta = {
  id: 'memory',
  name: 'Crew Match',
  blurb: 'The crew is hiding behind the cards. Find the pairs.',
  host: 'fig',
  pack: 'quick',
  lowerIsBetter: true,
  scoreKind: 'points',
  achievements: [
    { id: 'first', name: 'Reunited', says: 'Clear a board.' },
    { id: 'perfect', name: 'Perfect memory', says: 'Clear 4x4 without a single miss.' },
    { id: 'quick16', name: 'Sharp eyes', says: 'Clear 4x4 in 12 moves or fewer.' },
    { id: 'quick20', name: 'Big table', says: 'Clear 4x5 in 16 moves or fewer.' },
  ],
};

export function Game({ save, onSave, onScore, onAchieve, paused, best }: GameProps<State>) {
  const [s, setS] = useState<State | null>(save ? settle(save) : null);
  const [fresh, setFresh] = useState<number[]>([]);
  const finished = !!s && done(s);

  // A miss shows for a moment, then the cards turn back (held while paused).
  useEffect(() => {
    if (!s || s.open.length !== 2 || paused) return;
    const t = setTimeout(() => setS((c) => (c ? settle(c) : c)), 800);
    return () => clearTimeout(t);
  }, [s, paused]);

  const tap = (i: number) => {
    if (!s || paused || finished) return;
    const n = flip(s, i);
    if (n === s) return;
    const newly = n.matched.map((m, k) => (m && !s.matched[k] ? k : -1)).filter((k) => k >= 0);
    if (newly.length) setFresh(newly);
    setS(n);
    if (done(n)) {
      onScore(n.moves); onSave(null);
      onAchieve('first');
      if (n.size === 16 && n.misses === 0) onAchieve('perfect');
      if (n.size === 16 && n.moves <= 12) onAchieve('quick16');
      if (n.size === 20 && n.moves <= 16) onAchieve('quick20');
    } else onSave(settle(n));
  };

  const start = (size: Size) => { const n = deal(size, Math.random); setFresh([]); setS(n); onSave(n); };
  const cols = 4;
  const rows = s ? s.size / cols : 4;
  const w = Math.floor(Math.min(window.innerWidth - 32, 360) / cols) - 6;
  const h = Math.min(Math.floor(w * 1.15), Math.floor((window.innerHeight - 230) / rows) - 6);

  return (
    <div className="game-memory">
      <div className="game-score">Moves: <b>{s?.moves ?? 0}</b>{best !== undefined && <span> · best {best}</span>}</div>
      <div className="game-memory-wrap">
        <div className="game-memory-grid" style={{ gridTemplateColumns: `repeat(${cols}, ${w}px)` }}>
          {(s?.cards ?? Array(16).fill('')).map((c, i) => {
            const up = !!s && (s.matched[i] || s.open.includes(i));
            return (
              <button key={i} className={`game-memory-card${up ? ' game-memory-up' : ''}${s?.matched[i] ? ' game-memory-done' : ''}`} style={{ width: w, height: h }} onClick={() => tap(i)} aria-label={up ? c : 'card'}>
                {up && <img src={sprite(c, s!.matched[i] && fresh.includes(i) ? 'cheer' : s!.matched[i] ? 'sit' : 'idle')} alt="" />}
              </button>
            );
          })}
        </div>
        {(!s || finished) && (
          <div className="game-overlay">
            <img src={sprite('fig', finished ? 'cheer' : 'peek')} alt="" />
            <p>{finished ? `All pairs in ${s!.moves} moves${s!.misses === 0 ? ', no misses!' : '.'}` : 'Flip two cards. Find the matching crew.'}</p>
            <div className="game-memory-row">
              <button className="chip" onClick={() => start(16)}>4x4</button>
              <button className="chip" onClick={() => start(20)}>4x5</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
