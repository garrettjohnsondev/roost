import { useEffect, useRef, useState } from 'react';
import type { Ghost, GameMeta, GameProps } from '../types';
import { dayNumber, sprite } from '../types';
import { sfx } from '../../economy/sound';
import { buzz, ticks } from '../../haptics';
import {
  N, aiShot, allSunk, burstCells, dailyBoard, fire, fireMany, ghostShots, idx, isHoriz, isSunk, moveNest, nestAt,
  newBoard, nextStreak, rotateNest, sonar, xy, type Board, type Level, type ShotResult,
} from './logic';
import './style.css';

/** Battleship, Roost style: nests hidden on a pond. Find the crew's nests
 *  before they find yours. Moss is gentle, Wren is sharp, Ollie does the math.
 *  Wave 3: drag your nests into place, a sonar ping, bursts earned by hit
 *  streaks, a daily pond, and ghosts whose shot count you race. */
export const meta: GameMeta = {
  id: 'battleship',
  name: 'Nests',
  blurb: 'Find the hidden nests on the pond before a crewmate finds yours.',
  host: 'wren',
  pack: 'classic',
  lowerIsBetter: true,
  scoreKind: 'points',
  safeCorner: 'br',
  ghostScore: ghostShots,
  achievements: [
    { id: 'first-win', name: 'Nest finder', says: 'Win a match.' },
    { id: 'beat-ollie', name: 'Outthought', says: 'Beat Ollie on hard.' },
    { id: 'sharpshooter', name: 'Sharpshooter', says: 'Win in 30 shots or fewer.' },
    { id: 'untouched', name: 'Untouched', says: 'Win with none of your nests found.' },
    { id: 'burst', name: 'On a roll', says: 'Earn a burst with three hits in a row.' },
    { id: 'daily', name: 'Pond of the day', says: "Win today's daily pond." },
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
  /** Wave 3 (older saves lack these). */
  sonar?: number;
  bursts?: number;
  streak?: number;
  pings?: Record<number, number>;
  daily?: number;
}

type FxKind = 'miss' | 'hit' | 'sunk' | 'ping';
interface Fx { id: number; cell: number; kind: FxKind; on: 'foe' | 'me' }
let fxId = 0;

export function Game({ save, onSave, onScore, onAchieve, paused, best, ghost }: GameProps<Save>) {
  const [s, setS] = useState<Save | null>(save);
  const [over, setOver] = useState<null | 'won' | 'lost'>(null);
  const [pose, setPose] = useState('idle');
  const [line, setLine] = useState('');
  const [arm, setArm] = useState<null | 'sonar' | 'burst'>(null);
  const [fx, setFx] = useState<Fx[]>([]);
  const [shake, setShake] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const cell = Math.floor(Math.min(window.innerWidth - 32, 360) / N);

  const commit = (n: Save) => { setS(n); onSave(n); };
  const addFx = (items: Array<Omit<Fx, 'id'>>) => {
    const made = items.map((f) => ({ ...f, id: ++fxId }));
    setFx((cur) => [...cur, ...made]);
    setTimeout(() => setFx((cur) => cur.filter((f) => !made.includes(f))), 900);
  };
  const quake = () => { setShake(true); setTimeout(() => setShake(false), 420); };
  const feel = (results: ShotResult[]) => {
    if (results.some((r) => r.kind === 'sunk')) { ticks(5); sfx('crash'); quake(); }
    else if (results.some((r) => r.kind === 'hit')) { ticks(2); sfx('hit'); }
    else sfx('bounce');
  };

  const start = (level: Level, daily = false) => {
    setOver(null); setPose('idle'); setLine(''); setArm(null); setSel(null);
    const day = dayNumber();
    commit({
      phase: 'place', level, me: newBoard(Math.random), foe: daily ? dailyBoard(day) : newBoard(Math.random),
      shots: 0, turn: 'me', sonar: 1, bursts: 0, streak: 0, pings: {}, daily: daily ? day : undefined,
    });
    sfx('tap');
  };

  const tap = (i: number) => {
    if (!s || s.phase !== 'play' || s.turn !== 'me' || over || paused) return;
    const shots = s.shots + 1;
    if (arm === 'sonar' && (s.sonar ?? 0) > 0) {
      const n = sonar(s.foe, i);
      setArm(null);
      addFx([{ cell: i, kind: 'ping', on: 'foe' }]);
      sfx('whoosh'); ticks(1);
      setPose('think');
      setLine(n ? `Sonar: ${n} nest cell${n === 1 ? '' : 's'} nearby.` : 'Sonar: nothing nearby.');
      commit({ ...s, shots, sonar: (s.sonar ?? 0) - 1, pings: { ...(s.pings ?? {}), [i]: n }, turn: 'foe' });
      return;
    }
    const cells = arm === 'burst' && (s.bursts ?? 0) > 0 ? burstCells(i) : [i];
    if (cells.length === 1 && s.foe.shots[i] !== 0) return;
    const { board, results } = fireMany(s.foe, cells);
    if (!results.length) return;
    const usedBurst = cells.length > 1;
    setArm(null);
    addFx(results.map((r) => ({ cell: r.cell, kind: r.kind as FxKind, on: 'foe' as const })));
    feel(results);
    const hit = results.some((r) => r.kind !== 'miss');
    const st = nextStreak(s.streak ?? 0, hit);
    const bursts = (s.bursts ?? 0) - (usedBurst ? 1 : 0) + (st.earned ? 1 : 0);
    if (st.earned) onAchieve('burst');
    if (allSunk(board)) {
      setS({ ...s, foe: board, shots });
      setOver('won'); setPose('sit'); setLine('You found every nest!');
      buzz('pass'); sfx('win');
      onScore(shots); onSave(null);
      onAchieve('first-win');
      if (s.level === 'hard') onAchieve('beat-ollie');
      if (shots <= 30) onAchieve('sharpshooter');
      if (!s.me.shots.some((m) => m === 2)) onAchieve('untouched');
      if (s.daily !== undefined) onAchieve('daily');
      return;
    }
    const sunk = results.some((r) => r.kind === 'sunk');
    setPose(hit ? 'look1' : 'peek');
    setLine(st.earned ? 'Three in a row: you earned a burst!' : sunk ? 'You found a nest!' : hit ? (usedBurst ? 'Burst hit!' : 'A hit!') : 'Splash.');
    commit({ ...s, foe: board, shots, turn: 'foe', streak: st.streak, bursts });
  };

  // The crewmate's turn: waits while paused.
  useEffect(() => {
    if (!s || s.phase !== 'play' || s.turn !== 'foe' || over || paused) return;
    const t = setTimeout(() => {
      const i = aiShot(s.me, s.level, Math.random);
      const r = fire(s.me, i);
      const who = FOES[s.level].label;
      addFx([{ cell: i, kind: r.result.kind as FxKind, on: 'me' }]);
      feel([r.result]);
      if (allSunk(r.board)) {
        setS({ ...s, me: r.board });
        setOver('lost'); setPose('dance'); setLine(`${who} found all your nests.`);
        buzz('fail'); sfx('lose');
        onSave(null);
        return;
      }
      setPose(r.result.kind === 'miss' ? 'think' : 'cheer');
      setLine(r.result.kind === 'miss' ? `${who} missed.` : r.result.kind === 'sunk' ? `${who} found one of your nests!` : `${who} hit!`);
      commit({ ...s, me: r.board, turn: 'me' });
    }, 750);
    return () => clearTimeout(t);
  });

  // ---- Placement: drag a nest to move it, tap it to turn it. ----
  const placeRef = useRef<HTMLDivElement>(null);
  const grab = useRef<{ k: number; off: number; moved: boolean; last: number } | null>(null);
  const cellAt = (x: number, y: number) => {
    const el = placeRef.current;
    if (!el) return -1;
    const r = el.getBoundingClientRect();
    const gx = Math.floor((x - r.left - 2) / cell), gy = Math.floor((y - r.top - 2) / cell);
    return gx < 0 || gy < 0 || gx >= N || gy >= N ? -1 : idx(gx, gy);
  };
  const placeDown = (e: React.PointerEvent) => {
    if (!s || s.phase !== 'place') return;
    const i = cellAt(e.clientX, e.clientY);
    const k = i >= 0 ? nestAt(s.me, i) : -1;
    if (k < 0) { setSel(null); return; }
    grab.current = { k, off: s.me.nests[k].cells.indexOf(i), moved: false, last: i };
    setSel(k);
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* */ }
  };
  const placeMove = (e: React.PointerEvent) => {
    const g = grab.current;
    if (!g || !s) return;
    const i = cellAt(e.clientX, e.clientY);
    if (i < 0 || i === g.last) return;
    g.last = i;
    const n = s.me.nests[g.k];
    const h = isHoriz(n);
    const [x, y] = xy(i);
    const b = moveNest(s.me, g.k, h ? x - g.off : x, h ? y : y - g.off, h);
    if (b) { g.moved = true; setS({ ...s, me: b }); sfx('tap'); }
  };
  const placeUp = () => {
    const g = grab.current;
    grab.current = null;
    if (!g || !s) return;
    if (!g.moved) { turn(g.k); return; }
    onSave(s);
  };
  const turn = (k: number) => {
    if (!s) return;
    const b = rotateNest(s.me, k);
    if (b) { commit({ ...s, me: b }); sfx('bounce'); ticks(1); }
    else setLine("That one can't turn there.");
  };

  const foe = s ? FOES[s.level] : FOES.normal;

  if (!s) {
    return (
      <div className="game-battleship-root">
        <div className="game-battleship-pick">
          <img className="game-battleship-hero" src={sprite('wren', 'look1')} alt="" />
          <p>Pick who you're playing. Tap their pond to find their nests.</p>
          {(Object.keys(FOES) as Level[]).map((l) => (
            <button key={l} className="game-battleship-foe" onClick={() => start(l)}>
              <img src={sprite(FOES[l].name, 'idle')} alt="" />
              <span><b>{FOES[l].label}</b><small>{l}</small></span>
            </button>
          ))}
          <button className="game-battleship-foe game-battleship-daily" onClick={() => start('normal', true)}>
            <img src={sprite('wren', 'peek')} alt="" />
            <span><b>Daily pond</b><small>Wren hides today's nests, the same for everyone</small></span>
          </button>
          {ghost && <GhostTrack ghost={ghost} shots={0} />}
          {best !== undefined && <p className="game-battleship-dim">Best: {best} shots</p>}
        </div>
      </div>
    );
  }

  const small = Math.floor(cell * 0.45);
  const left = s.foe.nests.filter((_, k) => !isSunk(s.foe, k)).length;
  return (
    <div className={`game-battleship-root${shake ? ' game-battleship-shake' : ''}`}>
      <div className="game-battleship-top">
        <img className="game-battleship-face" src={sprite(foe.name, pose)} alt={foe.label} />
        <div className="game-battleship-talk">
          <div className="game-score">Shots: <b>{s.shots}</b>{best !== undefined && <span> · best {best}</span>}{s.daily !== undefined && <span> · daily</span>}</div>
          <div className="game-battleship-dim">{s.phase === 'place' ? line || 'Drag a nest to move it. Tap it to turn it.' : line || (s.turn === 'me' ? 'Your shot.' : `${foe.label} is aiming...`)}</div>
        </div>
        {s.phase === 'play' && <Grid board={s.me} size={small} mine fx={fx.filter((f) => f.on === 'me')} />}
      </div>

      {ghost && <GhostTrack ghost={ghost} shots={s.shots} />}

      {s.phase === 'place' ? (
        <div className="game-battleship-place">
          <div ref={placeRef} className="game-battleship-drag" onPointerDown={placeDown} onPointerMove={placeMove} onPointerUp={placeUp} onPointerCancel={placeUp}>
            <Grid board={s.me} size={cell} mine sel={sel} />
          </div>
          <div className="game-battleship-row">
            <button className="chip" onClick={() => { setSel(null); commit({ ...s, me: newBoard(Math.random) }); sfx('whoosh'); }}>Shuffle</button>
            <button className="chip" disabled={sel === null} onClick={() => sel !== null && turn(sel)}>Turn</button>
            <button className="chip" onClick={() => { setSel(null); setLine(''); commit({ ...s, phase: 'play' }); sfx('score'); }}>Ready</button>
          </div>
        </div>
      ) : (
        <div className="game-battleship-wrap">
          <Grid board={s.foe} size={cell} onTap={tap} reveal={!!over} fx={fx.filter((f) => f.on === 'foe')} pings={s.pings} aim={arm} />
          {over && (
            <div className="game-overlay">
              <img src={sprite(foe.name, over === 'won' ? 'sit' : 'cheer')} alt="" />
              <p>{over === 'won' ? `You won in ${s.shots} shots.` : `${foe.label} wins this one.`}</p>
              {over === 'won' && ghost && <p className="game-battleship-dim">{s.shots < ghost.target ? `You beat ${ghost.name}'s ghost (${ghost.target}).` : `${ghost.name}'s ghost took ${ghost.target}.`}</p>}
              <button className="chip" onClick={() => { setOver(null); setPose('idle'); setLine(''); setS(null); }}>Play again</button>
            </div>
          )}
        </div>
      )}
      {s.phase === 'play' && !over && (
        <div className="game-battleship-specials">
          <button className={`game-battleship-special${arm === 'sonar' ? ' game-battleship-armed' : ''}`} disabled={!s.sonar || s.turn !== 'me'} onClick={() => { setArm(arm === 'sonar' ? null : 'sonar'); sfx('tap'); }}>
            <span className="game-battleship-icon-sonar" />Sonar <b>{s.sonar ?? 0}</b>
          </button>
          <button className={`game-battleship-special${arm === 'burst' ? ' game-battleship-armed' : ''}`} disabled={!s.bursts || s.turn !== 'me'} onClick={() => { setArm(arm === 'burst' ? null : 'burst'); sfx('tap'); }}>
            <span className="game-battleship-icon-burst" />Burst <b>{s.bursts ?? 0}</b>
          </button>
          <span className="game-battleship-streak" aria-label={`streak ${s.streak ?? 0} of 3`}>
            {[0, 1, 2].map((k) => <i key={k} className={k < (s.streak ?? 0) ? 'on' : ''} />)}
          </span>
        </div>
      )}
      {s.phase === 'play' && <div className="game-battleship-dim">Nests left: {left}{arm && ` · ${arm === 'sonar' ? 'tap a spot to ping the 3x3 around it' : 'tap to hit three in a row'}`}</div>}
    </div>
  );
}

function GhostTrack({ ghost, shots }: { ghost: Ghost; shots: number }) {
  const max = Math.max(ghost.target + 8, shots + 4);
  const ahead = shots < ghost.target;
  return (
    <div className="game-battleship-track" title={`${ghost.name}'s ghost found every nest in ${ghost.target} shots`}>
      <div className="game-battleship-track-line" />
      <div className="game-battleship-track-you" style={{ left: `${(shots / max) * 100}%` }} />
      <div className="game-battleship-ghost" style={{ left: `${(ghost.target / max) * 100}%` }}>
        <img src={sprite(ghost.sprite, 'idle')} alt={`${ghost.name}'s ghost`} />
        <b>{ghost.target}</b>
      </div>
      <span className="game-battleship-track-say">
        {ahead ? `Beat ${ghost.name}'s ghost: win in ${ghost.target - 1} shots or fewer` : `${ghost.name}'s ghost was done by now`}
      </span>
    </div>
  );
}

function Grid({ board, size, mine, onTap, reveal, fx = [], pings, aim, sel }: {
  board: Board; size: number; mine?: boolean; onTap?: (i: number) => void; reveal?: boolean;
  fx?: Fx[]; pings?: Record<number, number>; aim?: string | null; sel?: number | null;
}) {
  return (
    <div className={`game-battleship-grid${mine ? ' game-battleship-mine' : ''}${aim ? ` game-battleship-aim-${aim}` : ''}`} style={{ gridTemplateColumns: `repeat(${N}, ${size}px)` }}>
      {board.shots.map((m, i) => {
        const k = nestAt(board, i);
        const sunk = k >= 0 && isSunk(board, k);
        const show = (mine || reveal || sunk) && k >= 0;
        const n = show ? board.nests[k] : null;
        const h = n ? isHoriz(n) : true;
        const pos = n ? n.cells.indexOf(i) : -1;
        const end = n ? (pos === 0 ? ' game-battleship-head' : pos === n.cells.length - 1 ? ' game-battleship-tail' : '') : '';
        const cls = [
          'game-battleship-cell', show ? `game-battleship-nest ${h ? 'game-battleship-h' : 'game-battleship-v'}${end}` : '',
          m === 1 ? 'game-battleship-miss' : '', m === 2 ? 'game-battleship-hit' : '', sunk ? 'game-battleship-sunk' : '',
          sel !== undefined && sel !== null && k === sel ? 'game-battleship-sel' : '',
        ].join(' ');
        const ping = pings?.[i];
        return (
          <button key={i} className={cls} style={{ width: size, height: size }} disabled={!onTap || (m !== 0 && aim !== 'burst' && aim !== 'sonar')} onClick={() => onTap?.(i)} aria-label={`cell ${i}`}>
            {ping !== undefined && m === 0 && <span className="game-battleship-ping">{ping}</span>}
            {fx.filter((f) => f.cell === i).map((f) => (
              <span key={f.id} className={`game-battleship-fx game-battleship-fx-${f.kind}`}><i /><i /><i /><i /></span>
            ))}
          </button>
        );
      })}
    </div>
  );
}
