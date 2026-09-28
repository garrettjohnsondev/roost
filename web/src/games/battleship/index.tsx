import { useEffect, useState } from 'react';
import type { GameMeta, GameProps } from '../types';
import { sprite } from '../types';
import { N, aiShot, allSunk, fire, isSunk, nestAt, newBoard, type Board, type Level } from './logic';
import './style.css';

/** Battleship, Roost style: nests hidden on a pond. Find the crew's nests
 *  before they find yours. Moss is gentle, Wren is sharp, Ollie does the math. */
export const meta: GameMeta = {
  id: 'battleship',
  name: 'Nests',
  blurb: 'Find the hidden nests on the pond before a crewmate finds yours.',
  host: 'wren',
  pack: 'classic',
  lowerIsBetter: true,
  scoreKind: 'points',
  achievements: [
    { id: 'first-win', name: 'Nest finder', says: 'Win a match.' },
    { id: 'beat-ollie', name: 'Outthought', says: 'Beat Ollie on hard.' },
    { id: 'sharpshooter', name: 'Sharpshooter', says: 'Win in 30 shots or fewer.' },
    { id: 'untouched', name: 'Untouched', says: 'Win with none of your nests found.' },
  ],
};

const FOES: Record<Level, { name: string; label: string }> = {
  easy: { name: 'moss', label: 'Moss' },
  normal: { name: 'wren', label: 'Wren' },
  hard: { name: 'ollie', label: 'Ollie' },
};

interface Save {
  phase: 'place' | 'play';
  level: Level;
  me: Board;
  foe: Board;
  shots: number;
  turn: 'me' | 'foe';
}

export function Game({ save, onSave, onScore, onAchieve, paused, best }: GameProps<Save>) {
  const [s, setS] = useState<Save | null>(save);
  const [over, setOver] = useState<null | 'won' | 'lost'>(null);
  const [pose, setPose] = useState('idle');
  const [line, setLine] = useState('');
  const cell = Math.floor(Math.min(window.innerWidth - 32, 360) / N);

  const commit = (n: Save) => { setS(n); onSave(n); };

  const start = (level: Level) => commit({ phase: 'place', level, me: newBoard(Math.random), foe: newBoard(Math.random), shots: 0, turn: 'me' });

  const tap = (i: number) => {
    if (!s || s.phase !== 'play' || s.turn !== 'me' || over || paused) return;
    const r = fire(s.foe, i);
    if (r.result.kind === 'repeat') return;
    const shots = s.shots + 1;
    if (allSunk(r.board)) {
      setS({ ...s, foe: r.board, shots });
      setOver('won'); setPose('sit'); setLine('You found every nest!');
      onScore(shots); onSave(null);
      onAchieve('first-win');
      if (s.level === 'hard') onAchieve('beat-ollie');
      if (shots <= 30) onAchieve('sharpshooter');
      if (!s.me.shots.some((m) => m === 2)) onAchieve('untouched');
      return;
    }
    setPose(r.result.kind === 'miss' ? 'peek' : 'look1');
    setLine(r.result.kind === 'miss' ? 'Splash.' : r.result.kind === 'sunk' ? 'You found a nest!' : 'A hit!');
    commit({ ...s, foe: r.board, shots, turn: 'foe' });
  };

  // The crewmate's turn: waits while paused.
  useEffect(() => {
    if (!s || s.phase !== 'play' || s.turn !== 'foe' || over || paused) return;
    const t = setTimeout(() => {
      const i = aiShot(s.me, s.level, Math.random);
      const r = fire(s.me, i);
      const who = FOES[s.level].label;
      if (allSunk(r.board)) {
        setS({ ...s, me: r.board });
        setOver('lost'); setPose('dance'); setLine(`${who} found all your nests.`);
        onSave(null);
        return;
      }
      setPose(r.result.kind === 'miss' ? 'think' : 'cheer');
      setLine(r.result.kind === 'miss' ? `${who} missed.` : r.result.kind === 'sunk' ? `${who} found one of your nests!` : `${who} hit!`);
      commit({ ...s, me: r.board, turn: 'me' });
    }, 750);
    return () => clearTimeout(t);
  });

  const foe = s ? FOES[s.level] : FOES.normal;

  if (!s) {
    return (
      <div className="game-battleship">
        <div className="game-battleship-pick">
          <p>Pick who you're playing. Tap their pond to find their nests.</p>
          {(Object.keys(FOES) as Level[]).map((l) => (
            <button key={l} className="game-battleship-foe" onClick={() => start(l)}>
              <img src={sprite(FOES[l].name, 'idle')} alt="" />
              <span><b>{FOES[l].label}</b><small>{l}</small></span>
            </button>
          ))}
          {best !== undefined && <p className="game-battleship-dim">Best: {best} shots</p>}
        </div>
      </div>
    );
  }

  const small = Math.floor(cell * 0.45);
  return (
    <div className="game-battleship">
      <div className="game-battleship-top">
        <img className="game-battleship-face" src={sprite(foe.name, pose)} alt={foe.label} />
        <div className="game-battleship-talk">
          <div className="game-score">Shots: <b>{s.shots}</b>{best !== undefined && <span> · best {best}</span>}</div>
          <div className="game-battleship-dim">{s.phase === 'place' ? 'Your nests (shuffle until you like them)' : line || (s.turn === 'me' ? 'Your shot.' : `${foe.label} is aiming...`)}</div>
        </div>
        {s.phase === 'play' && <Grid board={s.me} size={small} mine />}
      </div>

      {s.phase === 'place' ? (
        <div className="game-battleship-place">
          <Grid board={s.me} size={cell} mine />
          <div className="game-battleship-row">
            <button className="chip" onClick={() => commit({ ...s, me: newBoard(Math.random) })}>Shuffle</button>
            <button className="chip" onClick={() => commit({ ...s, phase: 'play' })}>Ready</button>
          </div>
        </div>
      ) : (
        <div className="game-battleship-wrap">
          <Grid board={s.foe} size={cell} onTap={tap} reveal={!!over} />
          {over && (
            <div className="game-overlay">
              <img src={sprite(foe.name, over === 'won' ? 'sit' : 'cheer')} alt="" />
              <p>{over === 'won' ? `You won in ${s.shots} shots.` : `${foe.label} wins this one.`}</p>
              <button className="chip" onClick={() => { setOver(null); setPose('idle'); setLine(''); setS(null); }}>Play again</button>
            </div>
          )}
        </div>
      )}
      {s.phase === 'play' && <div className="game-battleship-dim">Nests left: {s.foe.nests.filter((_, k) => !isSunk(s.foe, k)).length}</div>}
    </div>
  );
}

function Grid({ board, size, mine, onTap, reveal }: { board: Board; size: number; mine?: boolean; onTap?: (i: number) => void; reveal?: boolean }) {
  return (
    <div className={`game-battleship-grid${mine ? ' game-battleship-mine' : ''}`} style={{ gridTemplateColumns: `repeat(${N}, ${size}px)` }}>
      {board.shots.map((m, i) => {
        const k = nestAt(board, i);
        const sunk = k >= 0 && isSunk(board, k);
        const show = (mine || reveal || sunk) && k >= 0;
        const cls = ['game-battleship-cell', show ? 'game-battleship-nest' : '', m === 1 ? 'game-battleship-miss' : '', m === 2 ? 'game-battleship-hit' : '', sunk ? 'game-battleship-sunk' : ''].join(' ');
        return <button key={i} className={cls} style={{ width: size, height: size }} disabled={!onTap || m !== 0} onClick={() => onTap?.(i)} aria-label={`cell ${i}`} />;
      })}
    </div>
  );
}
