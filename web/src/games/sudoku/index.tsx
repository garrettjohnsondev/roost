import { useEffect, useState } from 'react';
import type { GameMeta, GameProps, Ghost } from '../types';
import { dayNumber, seeded, sprite } from '../types';
import { sfx } from '../../economy/sound';
import { buzz, ticks } from '../../haptics';
import {
  bumpStreak, candidates, completedUnits, conflicts, generate, ghostScore, hintCell, isSolved, liveStreak, onD1, onD2, diagPeers as peersD, peers as peersC,
  type Grid, type Level, type Streak, type Variant,
} from './logic';
import './style.css';

/** Sudoku: one daily puzzle (the same for everyone), plus fresh ones on
 *  demand. Wave 3: hints (three a puzzle, +30s each), a diagonal (X)
 *  variant, auto-notes, and a streak for solving the daily day after day. */
export const meta: GameMeta = {
  id: 'sudoku',
  name: 'Sudoku',
  blurb: "Wren's daily grid. Same puzzle for everyone today.",
  host: 'wren',
  pack: 'quick',
  lowerIsBetter: true,
  scoreKind: 'time',
  safeCorner: 'bl',
  ghostScore,
  inProgress: (s: any) => !!s && (!!s.run || !!s.givens),
  achievements: [
    { id: 'solved', name: 'Filled in', says: 'Solve a puzzle.' },
    { id: 'daily', name: 'Daily bird', says: "Solve today's puzzle." },
    { id: 'clean', name: 'Clean sheet', says: 'Solve with no mistakes.' },
    { id: 'quick', name: 'Five-minute grid', says: 'Solve a Medium in under 5 minutes.' },
    { id: 'diagonal', name: 'Cross-stitch', says: 'Solve a diagonal (X) puzzle.' },
    { id: 'streak3', name: 'Three mornings', says: 'Solve the daily three days running.' },
    { id: 'streak7', name: 'Week of grids', says: 'Solve the daily seven days running.' },
    { id: 'nohelp', name: 'All by myself', says: 'Solve a Medium with no hints and no auto-notes.' },
  ],
};

const CHEERS = ['wren', 'pip', 'juno', 'fig', 'otto', 'nell'];
const HINTS = 3;
const HINT_COST = 30;

interface Run {
  givens: Grid; solution: Grid; grid: Grid; notes: number[];
  secs: number; day: number | null; level: Level; mistakes: number;
  variant?: Variant; hints?: number; helped?: boolean;
}
interface Save { run: Run | null; streak: Streak | null }
type Fx = { id: number; cell: number; kind: 'put' | 'wrong' | 'hint'; sweep: Map<number, number> };
let fxId = 0;

const make = (level: Level, day: number | null, variant: Variant = 'classic'): Run => {
  const p = generate(day !== null ? seeded(day * 7919 + 17) : Math.random, level, variant === 'diagonal');
  return { ...p, grid: p.givens.slice(), notes: Array(81).fill(0), secs: 0, day, level, mistakes: 0, variant, hints: 0, helped: false };
};

const fromSave = (sv: any): Save => (!sv ? { run: null, streak: null } : sv.givens ? { run: sv as Run, streak: null } : sv as Save);

export function Game({ save, onSave, onScore, onAchieve, paused, best, ghost }: GameProps<Save>) {
  const init = fromSave(save);
  const [s, setS] = useState<Run | null>(init.run);
  const [streak, setStreak] = useState<Streak | null>(init.streak);
  const [sel, setSel] = useState<number | null>(null);
  const [pencil, setPencil] = useState(false);
  const [done, setDone] = useState(false);
  const [fx, setFx] = useState<Fx | null>(null);
  const today = dayNumber();
  const diag = s?.variant === 'diagonal';

  useEffect(() => {
    if (paused || done || !s) return;
    const t = setInterval(() => setS((c) => (c ? { ...c, secs: c.secs + 1 } : c)), 1000);
    return () => clearInterval(t);
  }, [paused, done, !!s]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (s && !done) onSave({ run: s, streak }); }, [s, done, streak, onSave]);

  const begin = (level: Level, day: number | null, variant: Variant = 'classic') => {
    setS(make(level, day, variant)); setSel(null); setDone(false); setPencil(false); setFx(null); sfx('whoosh');
  };
  const toMenu = () => { onSave({ run: null, streak }); setS(null); setDone(false); setFx(null); };

  const effect = (cell: number, kind: Fx['kind'], units: number[][] = []) => {
    const sweep = new Map<number, number>();
    for (const u of units) u.forEach((j, k) => sweep.set(j, Math.min(sweep.get(j) ?? 99, k)));
    const f = { id: ++fxId, cell, kind, sweep };
    setFx(f);
    setTimeout(() => setFx((c) => (c?.id === f.id ? null : c)), 800);
  };

  const solved = (next: Run) => {
    setDone(true);
    onScore(next.secs);
    sfx('win'); buzz('pass');
    onAchieve('solved');
    let st = streak;
    if (next.day === today) {
      onAchieve('daily');
      st = bumpStreak(streak, today);
      setStreak(st);
      if (st.count >= 3) onAchieve('streak3');
      if (st.count >= 7) onAchieve('streak7');
    }
    onSave({ run: null, streak: st });
    if (!next.mistakes) onAchieve('clean');
    if (next.variant === 'diagonal') onAchieve('diagonal');
    if (next.level === 'medium' && next.secs < 300) onAchieve('quick');
    if (next.level === 'medium' && !next.hints && !next.helped) onAchieve('nohelp');
  };

  /** Write `d` into the selected cell (or clear it with 0). */
  const put = (d: number, at: number | null = sel, hint = false) => {
    if (!s || at === null || done || s.givens[at]) return;
    const grid = s.grid.slice(), notes = s.notes.slice();
    let mistakes = s.mistakes;
    if (pencil && d && !hint) {
      if (grid[at]) return;
      notes[at] ^= 1 << d;
      sfx('tap');
      setS({ ...s, notes });
      return;
    }
    grid[at] = !hint && grid[at] === d ? 0 : d;
    notes[at] = 0;
    const wrong = !!grid[at] && grid[at] !== s.solution[at];
    if (wrong) mistakes++;
    let units: number[][] = [];
    if (grid[at] && !wrong) {
      for (const j of (diag ? peersD : peersC)[at]) notes[j] &= ~(1 << d);
      units = completedUnits(grid, s.solution, at, diag);
    }
    const next: Run = { ...s, grid, notes, mistakes, hints: (s.hints ?? 0) + (hint ? 1 : 0), secs: s.secs + (hint ? HINT_COST : 0) };
    setS(next);
    if (!grid[at]) { sfx('tap'); return; }
    effect(at, hint ? 'hint' : wrong ? 'wrong' : 'put', units);
    if (isSolved(grid, s.solution)) return solved(next);
    if (wrong) { sfx('hit'); ticks(2, 80); }
    else if (units.length) { sfx('score'); ticks(Math.min(12, units.length * 3)); }
    else { sfx(hint ? 'coin' : 'tap'); ticks(1); }
  };

  const hint = () => {
    if (!s || done || (s.hints ?? 0) >= HINTS) return;
    const i = hintCell(s.grid, s.solution, sel, diag);
    if (i < 0) return;
    setSel(i);
    put(s.solution[i], i, true);
  };

  const autoNotes = () => {
    if (!s || done) return;
    const c = candidates(s.grid, diag);
    sfx('whoosh'); ticks(3, 40);
    setS({ ...s, notes: c, helped: true });
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (/^[1-9]$/.test(e.key)) put(+e.key);
      else if (e.key === 'Backspace' || e.key === '0') put(0);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const live = liveStreak(streak, today);
  const doneToday = streak?.last === today;

  if (!s) {
    return (
      <div className="game-sudoku">
        <div className="game-sudoku-start">
          <img className="game-sudoku-host" src={sprite('wren', 'think')} alt="" />
          <p>Fill every row, column and box with 1 to 9.</p>
          <button className="chip game-sudoku-daily" onClick={() => begin('medium', today)}>
            Today's puzzle{doneToday ? ' · solved' : ''}
          </button>
          <div className="game-sudoku-streak" aria-label={`Daily streak ${live}`}>
            {Array.from({ length: 7 }, (_, k) => <i key={k} className={k < Math.min(7, live) ? 'on' : ''} />)}
            <span>{live ? `${live}-day streak` : 'Start a streak'}{streak && streak.best > 1 ? ` · best ${streak.best}` : ''}</span>
          </div>
          <button className="chip" onClick={() => begin('easy', null)}>New puzzle · Easy</button>
          <button className="chip" onClick={() => begin('medium', null)}>New puzzle · Medium</button>
          <button className="chip" onClick={() => begin('medium', null, 'diagonal')}>Diagonal (X) · the long diagonals count too</button>
        </div>
      </div>
    );
  }

  const bad = conflicts(s.grid, diag);
  const cell = Math.floor(Math.min(window.innerWidth - 28, 400) / 9);
  const selV = sel !== null ? s.grid[sel] : 0;
  const fmt = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  const counts = Array(10).fill(0);
  s.grid.forEach((v, i) => { if (v === s.solution[i]) counts[v]++; });
  const cheer = CHEERS[(s.day ?? s.givens.reduce((a, v, i) => a + v * i, 0)) % CHEERS.length];
  const empties = s.givens.filter((v) => !v).length;
  const filled = s.grid.filter((v, i) => !s.givens[i] && v === s.solution[i]).length;
  const hintsLeft = HINTS - (s.hints ?? 0);

  return (
    <div className="game-sudoku">
      <div className="game-sudoku-bar">
        <span>{s.day !== null ? 'Daily' : diag ? 'Diagonal' : s.level === 'easy' ? 'Easy' : 'Medium'}</span>
        <span>Slips <b>{s.mistakes}</b></span>
        <span><b>{fmt(s.secs)}</b>{best !== undefined && <> · best {fmt(best)}</>}</span>
      </div>
      {ghost && <GhostRace ghost={ghost} secs={s.secs} you={filled / Math.max(1, empties)} width={cell * 9 + 4} fmt={fmt} />}
      <div className={`game-sudoku-board${done ? ' solved' : ''}`} style={{ gridTemplateColumns: `repeat(9, ${cell}px)`, gridAutoRows: `${cell}px` }}>
        {s.grid.map((v, i) => {
          const r = Math.floor(i / 9), c = i % 9;
          const given = !!s.givens[i];
          const wrong = !given && v && (v !== s.solution[i] || bad.has(i));
          const related = sel !== null && (Math.floor(sel / 9) === r || sel % 9 === c ||
            (Math.floor(Math.floor(sel / 9) / 3) === Math.floor(r / 3) && Math.floor((sel % 9) / 3) === Math.floor(c / 3)) ||
            (diag && ((onD1(sel) && onD1(i)) || (onD2(sel) && onD2(i)))));
          const sw = fx?.sweep.get(i);
          const cls = ['game-sudoku-cell',
            given && 'given', wrong && 'wrong', related && 'rel', sel === i && 'sel', selV && v === selV && 'same',
            diag && (onD1(i) || onD2(i)) && 'dg',
            c % 3 === 2 && c < 8 && 'br', r % 3 === 2 && r < 8 && 'bb',
            fx?.cell === i && `fx-${fx.kind}`, sw !== undefined && 'sweep'].filter(Boolean).join(' ');
          return (
            <button
              key={fx?.cell === i || sw !== undefined ? `${i}-${fx?.id}` : i}
              className={cls}
              style={{ fontSize: cell * 0.55, ['--d' as string]: `${(sw ?? 0) * 40}ms`, ['--w' as string]: `${(r + c) * 30}ms` }}
              onClick={() => { setSel(i); sfx('tap'); }}
            >
              {v ? v : s.notes[i] ? (
                <span className="game-sudoku-notes">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => <span key={d} className={selV === d ? 'hl' : ''}>{s.notes[i] & (1 << d) ? d : ''}</span>)}
                </span>
              ) : null}
            </button>
          );
        })}
        {done && (
          <div className="game-overlay game-sudoku-end">
            <img className="game-sudoku-jump" src={sprite(cheer, 'cheer')} alt="" />
            <p>Solved in {fmt(s.secs)}{s.mistakes ? ` with ${s.mistakes} slip${s.mistakes > 1 ? 's' : ''}` : ', not a single slip'}!</p>
            {s.day === today && streak && <p className="game-sudoku-dim">Daily streak: {streak.count} day{streak.count > 1 ? 's' : ''}</p>}
            {ghost && <p className="game-sudoku-dim">{s.secs < ghost.target ? `Faster than ${ghost.name}'s ghost (${fmt(ghost.target)})!` : `${ghost.name}'s ghost did it in ${fmt(ghost.target)}.`}</p>}
            <button className="chip" onClick={() => begin(s.level === 'easy' ? 'easy' : 'medium', null, s.variant)}>New puzzle</button>
            <button className="chip" onClick={toMenu}>Menu</button>
          </div>
        )}
      </div>
      <div className="game-sudoku-pad">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <button key={d} disabled={counts[d] >= 9} className={pencil ? 'pencil' : ''} onClick={() => put(d)}>
            {d}<small>{9 - counts[d] || ''}</small>
          </button>
        ))}
      </div>
      <div className="game-sudoku-row">
        <button className={pencil ? 'on' : ''} onClick={() => { setPencil((p) => !p); sfx('tap'); }}><PencilIcon />Notes</button>
        <button onClick={autoNotes}><GridIcon />Auto</button>
        <button disabled={hintsLeft <= 0} onClick={hint}><BulbIcon />Hint {hintsLeft}</button>
        <button onClick={() => put(0)}><EraseIcon />Erase</button>
        <button onClick={toMenu}>Menu</button>
      </div>
    </div>
  );
}

const Px = ({ d }: { d: string }) => (
  <svg viewBox="0 0 8 8" width="14" height="14" shapeRendering="crispEdges" aria-hidden="true"><path d={d} fill="currentColor" /></svg>
);
const PencilIcon = () => <Px d="M6 0h1v1h1v1H7v1H6v1H5v1H4v1H3v1H1V6h1V5h1V4h1V3h1V2h1zM0 7h1v1H0z" />;
const GridIcon = () => <Px d="M0 0h3v3H0zM5 0h3v3H5zM0 5h3v3H0zM5 5h3v3H5z" />;
const BulbIcon = () => <Px d="M2 0h4v1h1v3H6v1H5v1H3V5H2V4H1V1h1zM3 7h2v1H3z" />;
const EraseIcon = () => <Px d="M4 1h2v1h1v1h1v1H7v1H6v1H5v1H1V6H0V5h1V4h1V3h1V2h1z" />;

/** The ghost floats along a track at its solving pace; your pip moves with the cells you've filled. */
function GhostRace({ ghost, secs, you, width, fmt }: { ghost: Ghost; secs: number; you: number; width: number; fmt: (n: number) => string }) {
  const g = Math.min(1, secs / Math.max(1, ghost.target));
  return (
    <div className="game-sudoku-race" style={{ width }}>
      <span className="game-sudoku-race-fill" style={{ width: `${you * 100}%` }} />
      <span className="game-sudoku-race-you" style={{ left: `${you * 100}%` }}><img src={sprite('wren', 'idle')} alt="" /></span>
      <span className="game-sudoku-race-ghost" style={{ left: `${g * 100}%` }}><img src={sprite(ghost.sprite, 'idle')} alt="" /></span>
      <span className="game-sudoku-race-label">{ghost.name} solves in {fmt(ghost.target)}</span>
    </div>
  );
}
