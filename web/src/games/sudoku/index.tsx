import { useEffect, useState } from 'react';
import type { GameMeta, GameProps } from '../types';
import { dayNumber, seeded, sprite } from '../types';
import { conflicts, generate, isSolved, type Grid, type Level } from './logic';
import './style.css';

/** Sudoku: one daily puzzle (the same for everyone), plus fresh ones on demand. */
export const meta: GameMeta = {
  id: 'sudoku',
  name: 'Sudoku',
  blurb: "Wren's daily grid. Same puzzle for everyone today.",
  host: 'wren',
  pack: 'quick',
  lowerIsBetter: true,
  scoreKind: 'time',
  achievements: [
    { id: 'solved', name: 'Filled in', says: 'Solve a puzzle.' },
    { id: 'daily', name: 'Daily bird', says: "Solve today's puzzle." },
    { id: 'clean', name: 'Clean sheet', says: 'Solve with no mistakes.' },
    { id: 'quick', name: 'Five-minute grid', says: 'Solve a Medium in under 5 minutes.' },
  ],
};

const CHEERS = ['wren', 'pip', 'juno', 'fig', 'otto', 'nell'];

interface Save {
  givens: Grid; solution: Grid; grid: Grid; notes: number[];
  secs: number; day: number | null; level: Level; mistakes: number;
}

const make = (level: Level, day: number | null): Save => {
  const p = generate(day !== null ? seeded(day * 7919 + 17) : Math.random, level);
  return { ...p, grid: p.givens.slice(), notes: Array(81).fill(0), secs: 0, day, level, mistakes: 0 };
};

export function Game({ save, onSave, onScore, onAchieve, paused, best }: GameProps<Save>) {
  const [s, setS] = useState<Save | null>(save);
  const [sel, setSel] = useState<number | null>(null);
  const [pencil, setPencil] = useState(false);
  const [done, setDone] = useState(false);
  const today = dayNumber();

  useEffect(() => {
    if (paused || done || !s) return;
    const t = setInterval(() => setS((c) => (c ? { ...c, secs: c.secs + 1 } : c)), 1000);
    return () => clearInterval(t);
  }, [paused, done, !!s]);

  useEffect(() => { if (s && !done) onSave(s); }, [s, done, onSave]);

  const begin = (level: Level, day: number | null) => { setS(make(level, day)); setSel(null); setDone(false); setPencil(false); };

  const put = (d: number) => {
    if (!s || sel === null || done || s.givens[sel]) return;
    const grid = s.grid.slice(), notes = s.notes.slice();
    let mistakes = s.mistakes;
    if (pencil && d) {
      if (grid[sel]) return;
      notes[sel] ^= 1 << d;
    } else {
      grid[sel] = grid[sel] === d ? 0 : d;
      notes[sel] = 0;
      if (grid[sel] && grid[sel] !== s.solution[sel]) mistakes++;
      if (grid[sel] === s.solution[sel]) {
        const row = Math.floor(sel / 9), col = sel % 9, bx = Math.floor(row / 3) * 3 + Math.floor(col / 3);
        for (let j = 0; j < 81; j++) {
          const r = Math.floor(j / 9), c = j % 9;
          if (r === row || c === col || Math.floor(r / 3) * 3 + Math.floor(c / 3) === bx) notes[j] &= ~(1 << d);
        }
      }
    }
    const next = { ...s, grid, notes, mistakes };
    setS(next);
    if (isSolved(grid, s.solution)) {
      setDone(true); onSave(null); onScore(next.secs);
      onAchieve('solved');
      if (next.day === today) onAchieve('daily');
      if (!next.mistakes) onAchieve('clean');
      if (next.level === 'medium' && next.secs < 300) onAchieve('quick');
    }
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (/^[1-9]$/.test(e.key)) put(+e.key);
      else if (e.key === 'Backspace' || e.key === '0') put(0);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  if (!s) {
    return (
      <div className="game-sudoku">
        <div className="game-sudoku-start">
          <img src={sprite('wren', 'think')} alt="" />
          <p>Fill every row, column and box with 1 to 9.</p>
          <button className="chip" onClick={() => begin('medium', today)}>Today's puzzle</button>
          <button className="chip" onClick={() => begin('easy', null)}>New puzzle · Easy</button>
          <button className="chip" onClick={() => begin('medium', null)}>New puzzle · Medium</button>
        </div>
      </div>
    );
  }

  const bad = conflicts(s.grid);
  const cell = Math.floor(Math.min(window.innerWidth - 28, 400) / 9);
  const selV = sel !== null ? s.grid[sel] : 0;
  const fmt = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  const counts = Array(10).fill(0);
  s.grid.forEach((v) => counts[v]++);
  const cheer = CHEERS[(s.day ?? s.givens.reduce((a, v, i) => a + v * i, 0)) % CHEERS.length];

  return (
    <div className="game-sudoku">
      <div className="game-sudoku-bar">
        <span>{s.day !== null ? 'Daily' : s.level === 'easy' ? 'Easy' : 'Medium'}</span>
        <span>Mistakes <b>{s.mistakes}</b></span>
        <span><b>{fmt(s.secs)}</b>{best !== undefined && <> · best {fmt(best)}</>}</span>
      </div>
      <div className="game-sudoku-board" style={{ gridTemplateColumns: `repeat(9, ${cell}px)`, gridAutoRows: `${cell}px` }}>
        {s.grid.map((v, i) => {
          const r = Math.floor(i / 9), c = i % 9;
          const given = !!s.givens[i];
          const wrong = !given && v && (v !== s.solution[i] || bad.has(i));
          const related = sel !== null && (Math.floor(sel / 9) === r || sel % 9 === c ||
            (Math.floor(Math.floor(sel / 9) / 3) === Math.floor(r / 3) && Math.floor((sel % 9) / 3) === Math.floor(c / 3)));
          const cls = ['game-sudoku-cell',
            given && 'given', wrong && 'wrong', related && 'rel', sel === i && 'sel', selV && v === selV && 'same',
            c % 3 === 2 && c < 8 && 'br', r % 3 === 2 && r < 8 && 'bb'].filter(Boolean).join(' ');
          return (
            <button key={i} className={cls} style={{ fontSize: cell * 0.55 }} onClick={() => setSel(i)}>
              {v ? v : s.notes[i] ? (
                <span className="game-sudoku-notes">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => <span key={d}>{s.notes[i] & (1 << d) ? d : ''}</span>)}
                </span>
              ) : null}
            </button>
          );
        })}
        {done && (
          <div className="game-overlay">
            <img src={sprite(cheer, 'cheer')} alt="" />
            <p>Solved in {fmt(s.secs)}{s.mistakes ? ` with ${s.mistakes} slip${s.mistakes > 1 ? 's' : ''}` : ', not a single slip'}!</p>
            <button className="chip" onClick={() => begin('medium', null)}>New puzzle</button>
            <button className="chip" onClick={() => { setS(null); setDone(false); }}>Menu</button>
          </div>
        )}
      </div>
      <div className="game-sudoku-pad">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <button key={d} disabled={counts[d] >= 9} onClick={() => put(d)}>{d}</button>
        ))}
      </div>
      <div className="game-sudoku-row">
        <button className={pencil ? 'on' : ''} onClick={() => setPencil((p) => !p)}>✎ Notes {pencil ? 'on' : 'off'}</button>
        <button onClick={() => put(0)}>Erase</button>
        <button onClick={() => { onSave(null); setS(null); setDone(false); }}>Menu</button>
      </div>
    </div>
  );
}
