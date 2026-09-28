import { useEffect, useRef, useState } from 'react';
import type { GameMeta, GameProps } from '../types';
import { sprite } from '../types';
import { canMove, maxTile, move, newBoard, spawn, who, type Board, type Dir } from './logic';
import './style.css';

/** 2048 with eggs: two eggs crack, two cracked eggs hatch Pip, and on up the
 *  crew until Ollie shows up at 2048. The number sits small in the corner. */
export const meta: GameMeta = {
  id: 'hatch',
  name: 'Hatch',
  blurb: 'Slide eggs together. Hatch the whole crew, up to Ollie at 2048.',
  host: 'ollie',
  pack: 'quick',
  achievements: [
    { id: 'chick', name: 'It hatched', says: 'Make a 16 (the first crew member).' },
    { id: 'bly', name: 'Halfway', says: 'Make a 256.' },
    { id: 'ollie', name: 'Hello, Ollie', says: 'Make 2048.' },
    { id: 'no-undo', name: 'No takebacks', says: 'Make 1024 without using undo.' },
  ],
};

interface Save { board: Board; score: number; prev: { board: Board; score: number } | null; undoUsed: boolean }
const fresh = (): Save => ({ board: newBoard(), score: 0, prev: null, undoUsed: false });

export function Game({ save, onSave, onScore, onAchieve, paused, best }: GameProps<Save>) {
  const [s, setS] = useState<Save>(() => save ?? fresh());
  const [over, setOver] = useState(false);
  const [pop, setPop] = useState<number>(-1);

  const go = (d: Dir) => {
    if (paused || over) return;
    const r = move(s.board, d);
    if (!r.moved) return;
    const board = spawn(r.board);
    const next: Save = { board, score: s.score + r.gained, prev: s.undoUsed ? null : { board: s.board, score: s.score }, undoUsed: s.undoUsed };
    const top = maxTile(board);
    if (top > maxTile(s.board)) setPop(top);
    if (top >= 4) onAchieve('chick');
    if (top >= 8) onAchieve('bly');
    if (top >= 11) onAchieve('ollie');
    if (top >= 10 && !s.undoUsed) onAchieve('no-undo');
    setS(next);
    if (!canMove(board)) {
      setOver(true);
      onScore(next.score);
      onSave(null);
    } else onSave(next);
  };
  const undo = () => {
    if (!s.prev || s.undoUsed || over) return;
    const next: Save = { board: s.prev.board, score: s.prev.score, prev: null, undoUsed: true };
    setS(next);
    onSave(next);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const m: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
      if (m[e.key]) { e.preventDefault(); go(m[e.key]); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const touch = useRef<{ x: number; y: number } | null>(null);
  const restart = () => { const f = fresh(); setS(f); setOver(false); setPop(-1); onSave(f); };
  const size = Math.min(window.innerWidth - 24, 380);
  const cell = (size - 10 * 5) / 4;

  return (
    <div className="game-hatch-wrap">
      <div className="game-score">Score: <b>{s.score}</b>{best !== undefined && <span> · best {best}</span>}</div>
      <div
        className="game-hatch-board"
        style={{ width: size, height: size }}
        onTouchStart={(e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
        onTouchEnd={(e) => {
          const t0 = touch.current; touch.current = null;
          if (!t0) return;
          const dx = e.changedTouches[0].clientX - t0.x, dy = e.changedTouches[0].clientY - t0.y;
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;
          go(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
        }}
      >
        {s.board.map((v, i) => (
          <div key={i} className={`game-hatch-cell${v ? ` game-hatch-t${Math.min(v, 12)}` : ''}${v && v === pop ? ' game-hatch-pop' : ''}`} style={{ width: cell, height: cell }}>
            {v === 1 && <span className="game-hatch-egg" />}
            {v === 2 && <span className="game-hatch-egg game-hatch-cracked" />}
            {v >= 3 && <img src={sprite(who(v), v >= 11 ? 'cheer' : 'idle')} alt={who(v)} />}
            {v > 0 && <span className="game-hatch-num">{2 ** v}</span>}
          </div>
        ))}
        {over && (
          <div className="game-overlay">
            <img src={sprite(who(Math.max(3, maxTile(s.board))), 'think')} alt="" />
            <p>No moves left. {s.score} points{best !== undefined && s.score >= best ? ', best yet!' : '.'}</p>
            <button className="chip" onClick={restart}>New nest</button>
          </div>
        )}
      </div>
      <div className="game-hatch-bar">
        <button className="chip" onClick={undo} disabled={!s.prev || s.undoUsed || over}>{s.undoUsed ? 'Undo used' : 'Undo (1)'}</button>
        <button className="chip" onClick={() => { if (over || confirm('Start a new nest?')) { if (!over) onScore(s.score); restart(); } }}>New</button>
      </div>
      <p className="game-hatch-hint">Swipe to slide. Two alike hatch into the next one.</p>
    </div>
  );
}
