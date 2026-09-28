import { useEffect, useRef, useState } from 'react';
import type { GameMeta, GameProps } from '../types';
import { sprite } from '../types';
import { sfx } from '../../economy/sound';
import { buzz, ticks } from '../../haptics';
import {
  canMove, comboBonus, ghostPace, ghostScore, isGold, maxTile, mergeTicks, move, newBoard, rank, sizeOf, spawn, who,
  type Board, type Dir,
} from './logic';
import './style.css';

/** 2048 with eggs: two eggs crack, two cracked eggs hatch Pip, and on up the
 *  crew until Ollie shows up at 2048. The number sits small in the corner.
 *  Wave 3: a roomy 5x5 nest, golden eggs (triple points), merge chains, and
 *  tiles that actually slide. */
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
    { id: 'gold', name: 'Golden goose', says: 'Merge a golden egg.' },
    { id: 'chain-8', name: 'Chain reaction', says: 'Merge on eight moves in a row.' },
    { id: 'big-nest', name: 'Big nest', says: 'Make a 512 on the 5x5 board.' },
  ],
  ghostScore,
  safeCorner: 'br',
};

interface Save {
  board: Board; score: number; prev: { board: Board; score: number } | null; undoUsed: boolean;
  chain?: number; moves?: number;
}
const GOLD_CHANCE = 0.05;
const fresh = (size = 4): Save => ({ board: newBoard(Math.random, size), score: 0, prev: null, undoUsed: false, chain: 0, moves: 0 });

interface Tile { id: number; v: number; i: number; dead?: boolean; born?: boolean }
interface Bit { id: number; x: number; y: number; dx: number; dy: number; c: string }
let nextId = 1;
const tilesFrom = (b: Board): Tile[] => b.flatMap((v, i) => (v ? [{ id: nextId++, v, i }] : []));
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const SHARDS = ['#f4ecd8', '#d9c9a3', '#e8b04a', '#fff3b0'];

export function Game({ save, onSave, onScore, onAchieve, paused, best, ghost }: GameProps<Save>) {
  const [s, setS] = useState<Save>(() => save ?? fresh());
  const [tiles, setTiles] = useState<Tile[]>(() => tilesFrom(s.board));
  const [over, setOver] = useState(false);
  const [bits, setBits] = useState<Bit[]>([]);
  const boardRef = useRef<HTMLDivElement>(null);
  const [callout, setCallout] = useState<{ id: number; text: string } | null>(null);
  const size = sizeOf(s.board);
  const chain = s.chain ?? 0;
  const moves = s.moves ?? 0;

  const W = Math.min(window.innerWidth - 24, 380);
  const gap = size === 5 ? 7 : 10;
  const cell = (W - gap * (size + 1)) / size;
  const pos = (i: number) => ({ x: gap + (i % size) * (cell + gap), y: gap + Math.floor(i / size) * (cell + gap) });

  const burst = (at: number[], gold: boolean) => {
    if (reduced() || !at.length) return;
    const add: Bit[] = [];
    for (const i of at.slice(0, 4)) {
      const p = pos(i);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + Math.random() * 0.6;
        const r = cell * (0.45 + Math.random() * 0.3);
        add.push({ id: nextId++, x: p.x + cell / 2, y: p.y + cell / 2, dx: Math.cos(a) * r, dy: Math.sin(a) * r, c: gold ? '#f2c230' : SHARDS[k % SHARDS.length] });
      }
    }
    setBits((b) => [...b.slice(-40), ...add]);
    const ids = new Set(add.map((b) => b.id));
    setTimeout(() => setBits((b) => b.filter((x) => !ids.has(x.id))), 600);
  };

  const shakeBoard = (n: number) => {
    if (reduced()) return;
    const a = Math.min(6, 2 + n);
    boardRef.current?.animate?.([
      { transform: 'translate(0, 0)' }, { transform: `translate(${-a}px, ${a / 2}px)` }, { transform: `translate(${a}px, ${-a / 2}px)` },
      { transform: `translate(${-a / 2}px, 0)` }, { transform: 'translate(0, 0)' },
    ], { duration: 260, easing: 'ease-out' });
  };

  const go = (d: Dir) => {
    if (paused || over) return;
    const r = move(s.board, d);
    if (!r.moved) return;
    const board = spawn(r.board, Math.random, GOLD_CHANCE);
    const born = board.findIndex((v, i) => v !== r.board[i]);
    const nextChain = r.merges > 0 ? chain + 1 : 0;
    const bonus = comboBonus(r.gained, nextChain);
    const next: Save = {
      board, score: s.score + r.gained + bonus, prev: s.undoUsed ? null : { board: s.board, score: s.score },
      undoUsed: s.undoUsed, chain: nextChain, moves: moves + 1,
    };

    // Tiles: slide every tile to where it went; swallowed ones slide in, then vanish.
    const moved: Tile[] = [];
    for (const t of tiles) {
      if (t.dead) continue;
      const m = r.moves.find((x) => x.from === t.i);
      if (!m) continue;
      moved.push(m.absorbed ? { ...t, i: m.to, dead: true, born: false } : { ...t, i: m.to, v: r.board[m.to], born: false });
    }
    if (born >= 0) moved.push({ id: nextId++, v: board[born], i: born, born: true });
    setTiles(moved);
    setTimeout(() => setTiles((ts) => ts.filter((t) => !t.dead)), 140);

    const top = maxTile(board);
    const newTop = top > maxTile(s.board) ? top : 0;
    if (r.merges > 0) {
      burst(r.mergedAt, r.golds > 0);
      ticks(mergeTicks(r.merges, newTop));
      sfx(r.golds ? 'coin' : r.merges >= 3 ? 'score' : 'bounce');
      if (r.merges >= 3 || newTop >= 7) shakeBoard(r.merges);
      if (r.golds) { onAchieve('gold'); setCallout({ id: nextId++, text: `Golden! +${r.gained}` }); }
      else if (bonus) setCallout({ id: nextId++, text: `Chain x${nextChain} +${bonus}` });
      else if (newTop >= 3) setCallout({ id: nextId++, text: `${who(newTop)[0].toUpperCase()}${who(newTop).slice(1)} hatched!` });
    } else sfx('tap');
    if (top >= 4) onAchieve('chick');
    if (top >= 8) onAchieve('bly');
    if (top >= 11) { onAchieve('ollie'); if (newTop === 11) { buzz('pass'); sfx('win'); } }
    if (top >= 10 && !s.undoUsed) onAchieve('no-undo');
    if (size === 5 && top >= 9) onAchieve('big-nest');
    if (nextChain >= 8) onAchieve('chain-8');
    setS(next);
    if (!canMove(board)) {
      setOver(true);
      onScore(next.score);
      onSave(null);
      buzz('fail'); sfx('lose');
    } else onSave(next);
  };
  const undo = () => {
    if (!s.prev || s.undoUsed || over) return;
    const next: Save = { board: s.prev.board, score: s.prev.score, prev: null, undoUsed: true, chain: 0, moves };
    setS(next); setTiles(tilesFrom(next.board));
    onSave(next); sfx('whoosh');
  };

  useEffect(() => {
    if (!callout) return;
    const t = setTimeout(() => setCallout(null), 900);
    return () => clearTimeout(t);
  }, [callout]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const m: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
      if (m[e.key]) { e.preventDefault(); go(m[e.key]); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const touch = useRef<{ x: number; y: number } | null>(null);
  const restart = (n = size) => { const f = fresh(n); setS(f); setTiles(tilesFrom(f.board)); setOver(false); onSave(f); sfx('whoosh'); };
  const newNest = (n = size) => {
    const started = s.score > 0 && !over;
    if (started && !confirm('Start a new nest? This one counts as finished.')) return;
    if (started) onScore(s.score);
    restart(n);
  };

  const gPace = ghost ? ghostPace(ghost.target, moves) : 0;
  const gAhead = ghost && s.score > gPace;

  return (
    <div className="game-hatch-wrap">
      <div className="game-hatch-top">
        <div className="game-score">Score: <b>{s.score}</b>{best !== undefined && <span> · best {best}</span>}</div>
        {chain >= 2 && <span className="game-hatch-chain" key={chain}>chain x{chain}</span>}
      </div>
      {ghost && (
        <div className="game-hatch-ghost">
          <img src={sprite(ghost.sprite, gAhead ? 'look1' : 'idle')} alt="" className="game-hatch-ghost-img" />
          <div className="game-hatch-ghost-track">
            <div className="game-hatch-ghost-fill" style={{ width: `${Math.min(100, (gPace / ghost.target) * 100)}%` }} />
            <div className="game-hatch-you" style={{ left: `${Math.min(100, (s.score / ghost.target) * 100)}%` }} />
          </div>
          <span className="game-hatch-ghost-num">{ghost.name} {gPace}<small>/{ghost.target}</small></span>
        </div>
      )}
      <div
        ref={boardRef}
        className={`game-hatch-board game-hatch-n${size}`}
        style={{ width: W, height: W }}
        onTouchStart={(e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
        onTouchEnd={(e) => {
          const t0 = touch.current; touch.current = null;
          if (!t0) return;
          const dx = e.changedTouches[0].clientX - t0.x, dy = e.changedTouches[0].clientY - t0.y;
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;
          go(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
        }}
      >
        {s.board.map((_, i) => { const p = pos(i); return <div key={`c${i}`} className="game-hatch-slot" style={{ left: p.x, top: p.y, width: cell, height: cell }} />; })}
        {tiles.map((t) => {
          const p = pos(t.i);
          const r = rank(t.v);
          return (
            <div
              key={t.id}
              className={`game-hatch-tile${t.dead ? ' game-hatch-dead' : ''}${t.born ? ' game-hatch-born' : ''}`}
              style={{ width: cell, height: cell, transform: `translate(${p.x}px, ${p.y}px)` }}
            >
              <div key={t.v} className={`game-hatch-cell game-hatch-t${Math.min(r, 12)}${isGold(t.v) ? ' game-hatch-golden' : ''}${!t.born && r >= 2 ? ' game-hatch-pop' : ''}`}>
                {r === 1 && <span className="game-hatch-egg" />}
                {r === 2 && <span className="game-hatch-egg game-hatch-cracked" />}
                {r >= 3 && <img src={sprite(who(r), r >= 11 ? 'cheer' : 'idle')} alt={who(r)} />}
                <span className="game-hatch-num">{2 ** r}</span>
              </div>
            </div>
          );
        })}
        {bits.map((b) => (
          <span key={b.id} className="game-hatch-bit" style={{ left: b.x, top: b.y, background: b.c, ['--dx' as string]: `${b.dx}px`, ['--dy' as string]: `${b.dy}px` }} />
        ))}
        {callout && <div key={callout.id} className="game-hatch-callout">{callout.text}</div>}
        {over && (
          <div className="game-overlay">
            <img src={sprite(who(Math.max(3, maxTile(s.board))), 'think')} alt="" />
            <p>No moves left. {s.score} points{best !== undefined && s.score >= best ? ', best yet!' : '.'}</p>
            {ghost && <p className="game-hatch-verdict">{s.score > ghost.target ? `You out-hatched ${ghost.name}'s ghost!` : `${ghost.name}'s ghost made ${ghost.target}.`}</p>}
            <button className="chip" onClick={() => restart()}>New nest</button>
          </div>
        )}
      </div>
      <div className="game-hatch-bar">
        <button className="chip" onClick={undo} disabled={!s.prev || s.undoUsed || over}>{s.undoUsed ? 'Undo used' : 'Undo (1)'}</button>
        <button className="chip" onClick={() => newNest()}>New</button>
        <button className="chip" onClick={() => newNest(size === 4 ? 5 : 4)}>{size === 4 ? 'Try 5x5' : 'Back to 4x4'}</button>
      </div>
      <p className="game-hatch-hint">Swipe to slide. Two alike hatch the next one. Golden eggs pay triple; merge on every move to build a chain.</p>
    </div>
  );
}
