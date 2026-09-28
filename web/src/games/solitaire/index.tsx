import { useCallback, useEffect, useRef, useState } from 'react';
import type { Ghost, GameMeta, GameProps } from '../types';
import { dayNumber, fmtScore } from '../types';
import { sfx } from '../../economy/sound';
import { buzz, ticks } from '../../haptics';
import {
  SUITS, allFaceUp, autoComplete, bestTarget, dailySeed, deal, drawStock, ghostSecs, hint, isWon, move, pick,
  type From, type State, type To,
} from './logic';
import { autoHome, bestTargetF, dealFree, hintF, isWonF, moveF, pickF, type FFrom, type FState, type FTo } from './freecell';
import { CardBack, CardFace, Cascade, GhostBar, useCardDrag, useFlight } from './ui';
import './style.css';

/** Klondike and FreeCell, Roost style: the court cards are the crew, the
 *  backs are a woven nest, and a win sends the deck bouncing down the screen.
 *  Tap a card to send it to its best spot, or drag it where you want it.
 *  Wave 3: FreeCell, a daily deal, hints, card flight, the win cascade and a
 *  ghost pacing you card by card. */
export const meta: GameMeta = {
  id: 'solitaire',
  name: 'Solitaire',
  blurb: 'Klondike or FreeCell with the crew. Tap a card and it finds its perch.',
  host: 'ollie',
  pack: 'classic',
  lowerIsBetter: true,
  scoreKind: 'time',
  safeCorner: 'br',
  ghostScore: ghostSecs,
  achievements: [
    { id: 'first-win', name: 'Home to roost', says: 'Win a game.' },
    { id: 'quick', name: 'Early bird', says: 'Win in under 3 minutes.' },
    { id: 'no-undo', name: 'No take-backs', says: 'Win without using undo.' },
    { id: 'draw3', name: 'Three at a time', says: 'Win on Draw 3.' },
    { id: 'lean', name: 'Light packer', says: 'Win Klondike in 110 moves or fewer.' },
    { id: 'freecell', name: 'Free as a bird', says: 'Win a game of FreeCell.' },
    { id: 'daily', name: 'Deal of the day', says: "Win today's daily deal." },
  ],
};

type Save = (State & { variant?: 'klondike' }) | FState;
type Variant = 'klondike' | 'freecell';
const isFree = (s: Save | null): s is FState => !!s && (s as FState).variant === 'freecell';

interface ViewProps<S> {
  init: S;
  onSave: (s: S | null) => void;
  onWin: (s: S) => void;
  onDeal: (v: Variant, daily?: boolean, draw?: 1 | 3) => void;
  paused: boolean;
  best: number | undefined;
  ghost?: Ghost | null;
}

export function Game({ save, onSave, onScore, onAchieve, paused, best, ghost }: GameProps<Save>) {
  const [mode, setMode] = useState<{ v: Variant; init: Save; k: number }>(() => ({
    v: isFree(save) ? 'freecell' : 'klondike',
    init: save ?? deal(Date.now() % 2 ** 31, 1),
    k: 0,
  }));

  const onDeal = useCallback((v: Variant, daily = false, draw: 1 | 3 = 1) => {
    onSave(null);
    const day = dayNumber();
    const seed = daily ? dailySeed(day) : Date.now() % 2 ** 31;
    const init: Save = v === 'freecell' ? dealFree(seed) : deal(seed, draw);
    if (daily) init.daily = day;
    setMode((m) => ({ v, init, k: m.k + 1 }));
    sfx('whoosh');
  }, [onSave]);

  const onWin = useCallback((n: Save) => {
    buzz('pass'); sfx('win');
    onScore(n.secs);
    onSave(null);
    onAchieve('first-win');
    if (n.secs < 180) onAchieve('quick');
    if (n.undos === 0) onAchieve('no-undo');
    if (isFree(n)) onAchieve('freecell');
    else {
      if (n.draw === 3) onAchieve('draw3');
      if (n.moves <= 110) onAchieve('lean');
    }
    if (n.daily !== undefined && n.daily === dayNumber()) onAchieve('daily');
  }, [onScore, onSave, onAchieve]);

  const common = { onDeal, paused, best, ghost };
  return mode.v === 'freecell'
    ? <FreeCell key={mode.k} init={mode.init as FState} onSave={onSave as (s: FState | null) => void} onWin={onWin} {...common} />
    : <Klondike key={mode.k} init={mode.init as State} onSave={onSave as (s: State | null) => void} onWin={onWin} {...common} />;
}

const key = (f: object) => JSON.stringify(f);
const homeCount = (found: number[][]) => found.reduce((a, f) => a + f.length, 0);
const mm = (n: number) => fmtScore(meta, n);

/** Bar, ghost and tools shared by both deals. */
function Header({ s, best, ghost, label }: { s: { secs: number; moves: number; daily?: number; found: number[][] }; best?: number; ghost?: Ghost | null; label: string }) {
  return (
    <>
      <div className="game-solitaire-bar">
        <span className="game-solitaire-clock">{mm(s.secs)}</span>
        <span>{s.moves} moves</span>
        <span className="game-solitaire-dim">{label}{s.daily !== undefined ? ' · daily' : ''}</span>
        {best !== undefined && <span className="game-solitaire-dim">best {mm(best)}</span>}
      </div>
      {ghost && <GhostBar ghost={ghost} secs={s.secs} home={homeCount(s.found)} />}
    </>
  );
}

function WinPanel({ s, best, ghost, again, root, cw, ch }: { s: { secs: number; moves: number }; best?: number; ghost?: Ghost | null; again: () => void; root: React.RefObject<HTMLDivElement>; cw: number; ch: number }) {
  return (
    <>
      <Cascade root={root} w={cw} h={ch} />
      <div className="game-solitaire-win">
        <p>Home to roost in {mm(s.secs)}, {s.moves} moves.{best !== undefined && s.secs <= best ? ' Best yet!' : ''}</p>
        {ghost && <p className="game-solitaire-dim">{s.secs < ghost.target ? `You beat ${ghost.name}'s ghost (${mm(ghost.target)}).` : `${ghost.name}'s ghost won in ${mm(ghost.target)}.`}</p>}
        <button className="chip" onClick={again}>Deal again</button>
      </div>
    </>
  );
}

/** The clock runs from the first move until the win, never while paused. */
function useClock<S extends { secs: number; moves: number }>(set: (f: (x: S) => S) => void, on: boolean) {
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set((x) => ({ ...x, secs: x.secs + 1 })), 1000);
    return () => clearInterval(t);
  }, [on, set]);
}

function feel(before: number[][], after: number[][]) {
  if (homeCount(after) > homeCount(before)) { sfx('score'); ticks(1); } else sfx('tap');
}

// ---------------------------------------------------------------- Klondike

function parseK(d: string | null): To | null {
  if (!d) return null;
  const [k, n] = d.split(':');
  return k === 'f' ? { kind: 'found', suit: +n } : k === 't' ? { kind: 'tab', col: +n } : null;
}

function Klondike({ init, onSave, onWin, onDeal, paused, best, ghost }: ViewProps<State>) {
  const [s, setS] = useState<State>(init);
  const [hist, setHist] = useState<State[]>([]);
  const [won, setWon] = useState(false);
  const [auto, setAuto] = useState<State[] | null>(null);
  const [shake, setShake] = useState<string | null>(null);
  const [hl, setHl] = useState<{ from: string; to: string } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const seed = useFlight(root);

  const [vw, vh] = [Math.min(window.innerWidth, 480), window.innerHeight];
  const gap = 4;
  const cw = Math.floor((vw - 12 - gap * 6) / 7);
  const ch = Math.round(cw * 1.42);
  const avail = Math.max(240, vh - 300 - ch - (ghost ? 34 : 0));

  const win = (n: State) => { setWon(true); onWin(n); };
  const commit = (n: State | null) => {
    if (!n) return false;
    setHist((h) => [...h, s]);
    setS(n); setHl(null);
    feel(s.found, n.found);
    if (isWon(n)) win(n); else onSave(n);
    return true;
  };

  useClock(setS, !paused && !won && s.moves > 0);

  // Auto-complete plays out one step at a time so you can watch it fly.
  useEffect(() => {
    if (!auto || paused) return;
    const t = setTimeout(() => {
      const [next, ...rest] = auto;
      const n = { ...next, secs: s.secs };
      setS(n);
      if (isWon(n)) { setAuto(null); win(n); } else setAuto(rest);
      sfx('tap');
    }, 110);
    return () => clearTimeout(t);
  }, [auto, paused, s.secs]); // eslint-disable-line react-hooks/exhaustive-deps

  const undo = () => {
    if (!hist.length || auto || won) return;
    const prev = { ...hist[hist.length - 1], secs: s.secs, undos: s.undos + 1 };
    setHist((h) => h.slice(0, -1));
    setS(prev); onSave(prev); setHl(null);
    sfx('whoosh');
  };

  const tap = (from: From) => {
    const to = bestTarget(s, from);
    if (!to || !commit(move(s, from, to))) {
      setShake(key(from));
      setTimeout(() => setShake(null), 300);
    }
  };
  const { drag, down } = useCardDrag<From>({
    enabled: !auto && !won && !paused,
    pick: (f) => pick(s, f),
    tap,
    drop: (f, t) => { const to = parseK(t); if (to) commit(move(s, f, to)); },
    seed,
  });

  const showHint = () => {
    const h = hint(s);
    if (!h) { setHl({ from: '', to: '' }); setTimeout(() => setHl(null), 1600); return; }
    if (h === 'draw') setHl({ from: '', to: 'stock' });
    else setHl({ from: key(h.from), to: h.to.kind === 'found' ? `f:${h.to.suit}` : `t:${h.to.col}` });
    sfx('tap');
    setTimeout(() => setHl(null), 1600);
  };

  const canAuto = !won && !auto && allFaceUp(s) && !!autoComplete(s);
  const dragging = (from: From) => !!drag && key(drag.from) === key(from);
  const wasteShown = s.waste.slice(s.draw === 3 ? -3 : -1);
  const fan = Math.round(cw * 0.28);
  const face = (c: number, from: From | undefined, style: React.CSSProperties, extra: { dim?: boolean; origin?: string } = {}) => (
    <CardFace key={c} c={c} w={cw} h={ch} style={style} dim={extra.dim} origin={extra.origin}
      shake={!!from && shake === key(from)} glow={!!from && hl?.from === key(from)} onDown={from ? down(from) : undefined} />
  );
  const slotGlow = (d: string) => (hl?.to === d ? ' game-solitaire-target' : '');

  return (
    <div ref={root} className="game-solitaire-root" style={{ width: vw - 12 }}>
      <Header s={s} best={best} ghost={ghost} label={`Klondike draw ${s.draw}`} />

      <div className="game-solitaire-top" style={{ gap }}>
        <div className={`game-solitaire-slot${slotGlow('stock')}`} data-stock="1" style={{ width: cw, height: ch }}
          onClick={() => { if (!auto && !won && !paused && commit(drawStock(s))) sfx('whoosh'); }}>
          {s.stock.length ? <CardBack w={cw} h={ch} /> : <span className="game-solitaire-recycle" />}
          {s.stock.length > 0 && <span className="game-solitaire-count">{s.stock.length}</span>}
        </div>
        <div className="game-solitaire-waste" style={{ width: cw + fan * 2, height: ch }}>
          {wasteShown.map((c, i) => {
            const top = i === wasteShown.length - 1;
            const from: From = { kind: 'waste' };
            return face(c, top ? from : undefined, { position: 'absolute', left: i * fan, top: 0 }, { dim: top && dragging(from), origin: 'stock' });
          })}
        </div>
        {s.found.map((f, su) => {
          const from: From = { kind: 'found', suit: su };
          return (
            <div key={su} className={`game-solitaire-slot${slotGlow(`f:${su}`)}`} data-drop={`f:${su}`} style={{ width: cw, height: ch }}>
              <span className={`game-solitaire-suit${su % 2 ? ' game-solitaire-red' : ''}`}>{SUITS[su]}</span>
              {f.length > 1 && face(f[f.length - 2], undefined, { position: 'absolute', inset: 0 })}
              {f.length > 0 && face(f[f.length - 1], from, { position: 'absolute', inset: 0 }, { dim: dragging(from) })}
            </div>
          );
        })}
      </div>

      <div className="game-solitaire-tab" style={{ gap }}>
        {s.tab.map((col, ci) => {
          const downs = col.hidden, ups = col.cards.length - col.hidden;
          const dOff = Math.max(4, Math.round(ch * 0.1));
          const uOff = Math.max(12, Math.min(Math.round(ch * 0.33), Math.floor((avail - downs * dOff - ch) / Math.max(1, ups - 1))));
          let y = 0;
          const height = Math.max(ch, downs * dOff + Math.max(0, ups - 1) * uOff + ch);
          const lifting = drag && drag.from.kind === 'tab' && drag.from.col === ci ? drag.from.idx : 99;
          return (
            <div key={ci} className={`game-solitaire-col${slotGlow(`t:${ci}`)}`} data-drop={`t:${ci}`} style={{ width: cw, height: Math.max(height, avail) }}>
              <div className="game-solitaire-slot game-solitaire-empty" style={{ width: cw, height: ch }} />
              {col.cards.map((c, i) => {
                const top = y;
                y += i < col.hidden ? dOff : uOff;
                if (i < col.hidden) return <CardBack key={c} w={cw} h={ch} style={{ position: 'absolute', top, left: 0 }} />;
                return face(c, { kind: 'tab', col: ci, idx: i }, { position: 'absolute', top, left: 0 }, { dim: i >= lifting });
              })}
            </div>
          );
        })}
      </div>

      <div className="game-solitaire-tools">
        <button className="chip" onClick={undo} disabled={!hist.length || !!auto || won}>Undo</button>
        <button className="chip" onClick={showHint} disabled={!!auto || won}>{hl && !hl.from && !hl.to ? 'No moves' : 'Hint'}</button>
        <button className="chip" onClick={() => onDeal('klondike', false, s.draw === 1 ? 3 : 1)} title="Switch and deal again">Draw {s.draw === 1 ? 3 : 1}</button>
        <button className="chip" onClick={() => onDeal('klondike', true)}>Daily</button>
        <button className="chip" onClick={() => onDeal('freecell')}>FreeCell</button>
        {canAuto
          ? <button className="chip game-solitaire-go" onClick={() => setAuto(autoComplete(s))}>Finish</button>
          : <button className="chip" onClick={() => onDeal('klondike', false, s.draw)}>New</button>}
      </div>

      {drag && (
        <div className="game-solitaire-drag" style={{ left: drag.x - drag.ox, top: drag.y - drag.oy }}>
          {drag.cards.map((c, i) => <CardFace key={c} c={c} w={cw} h={ch} drag style={{ position: 'absolute', top: i * Math.round(ch * 0.3), left: 0 }} />)}
        </div>
      )}

      {won && <WinPanel s={s} best={best} ghost={ghost} root={root} cw={cw} ch={ch} again={() => onDeal('klondike', false, s.draw)} />}
    </div>
  );
}

// ---------------------------------------------------------------- FreeCell

function parseF(d: string | null): FTo | null {
  if (!d) return null;
  const [k, n] = d.split(':');
  return k === 'f' ? { kind: 'found', suit: +n } : k === 't' ? { kind: 'tab', col: +n } : k === 'c' ? { kind: 'cell', i: +n } : null;
}

function FreeCell({ init, onSave, onWin, onDeal, paused, best, ghost }: ViewProps<FState>) {
  const [s, setS] = useState<FState>(init);
  const [hist, setHist] = useState<FState[]>([]);
  const [won, setWon] = useState(false);
  const [auto, setAuto] = useState<FState[] | null>(null);
  const [shake, setShake] = useState<string | null>(null);
  const [hl, setHl] = useState<{ from: string; to: string } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const seed = useFlight(root);

  const [vw, vh] = [Math.min(window.innerWidth, 480), window.innerHeight];
  const gap = 3;
  const cw = Math.floor((vw - 12 - gap * 7) / 8);
  const ch = Math.round(cw * 1.42);
  const avail = Math.max(240, vh - 300 - ch - (ghost ? 34 : 0));

  const win = (n: FState) => { setWon(true); onWin(n); };
  const commit = (n: FState | null) => {
    if (!n) return false;
    setHist((h) => [...h, s]);
    setS(n); setHl(null);
    feel(s.found, n.found);
    const steps = autoHome(n);
    if (steps.length) setAuto(steps);
    else if (isWonF(n)) win(n);
    else onSave(n);
    return true;
  };

  useClock(setS, !paused && !won && s.moves > 0);

  // Safe cards fly home one after another.
  useEffect(() => {
    if (!auto || paused) return;
    const t = setTimeout(() => {
      const [next, ...rest] = auto;
      const n = { ...next, secs: s.secs };
      setS(n);
      if (!rest.length) { setAuto(null); if (isWonF(n)) win(n); else onSave(n); } else setAuto(rest);
      sfx('score');
    }, 120);
    return () => clearTimeout(t);
  }, [auto, paused, s.secs]); // eslint-disable-line react-hooks/exhaustive-deps

  const undo = () => {
    if (!hist.length || auto || won) return;
    const prev = { ...hist[hist.length - 1], secs: s.secs, undos: s.undos + 1 };
    setHist((h) => h.slice(0, -1));
    setS(prev); onSave(prev); setHl(null);
    sfx('whoosh');
  };

  const tap = (from: FFrom) => {
    const to = bestTargetF(s, from);
    if (!to || !commit(moveF(s, from, to))) {
      setShake(key(from));
      setTimeout(() => setShake(null), 300);
    }
  };
  const { drag, down } = useCardDrag<FFrom>({
    enabled: !auto && !won && !paused,
    pick: (f) => pickF(s, f),
    tap,
    drop: (f, t) => { const to = parseF(t); if (to) commit(moveF(s, f, to)); },
    seed,
  });

  const showHint = () => {
    const h = hintF(s);
    if (!h) { setHl({ from: '', to: '' }); setTimeout(() => setHl(null), 1600); return; }
    setHl({ from: key(h.from), to: h.to.kind === 'found' ? `f:${h.to.suit}` : h.to.kind === 'cell' ? `c:${h.to.i}` : `t:${h.to.col}` });
    sfx('tap');
    setTimeout(() => setHl(null), 1600);
  };

  const dragging = (from: FFrom) => !!drag && key(drag.from) === key(from);
  const face = (c: number, from: FFrom | undefined, style: React.CSSProperties, dim?: boolean) => (
    <CardFace key={c} c={c} w={cw} h={ch} style={style} dim={dim}
      shake={!!from && shake === key(from)} glow={!!from && hl?.from === key(from)} onDown={from ? down(from) : undefined} />
  );
  const slotGlow = (d: string) => (hl?.to === d ? ' game-solitaire-target' : '');

  return (
    <div ref={root} className="game-solitaire-root" style={{ width: vw - 12 }}>
      <Header s={s} best={best} ghost={ghost} label="FreeCell" />

      <div className="game-solitaire-top" style={{ gap }}>
        {s.cells.map((c, i) => {
          const from: FFrom = { kind: 'cell', i };
          return (
            <div key={`c${i}`} className={`game-solitaire-slot game-solitaire-cell${slotGlow(`c:${i}`)}`} data-drop={`c:${i}`} style={{ width: cw, height: ch }}>
              {c !== null && face(c, from, { position: 'absolute', inset: 0 }, dragging(from))}
            </div>
          );
        })}
        {s.found.map((f, su) => {
          const from: FFrom = { kind: 'found', suit: su };
          return (
            <div key={su} className={`game-solitaire-slot${slotGlow(`f:${su}`)}`} data-drop={`f:${su}`} style={{ width: cw, height: ch, marginLeft: su === 0 ? 'auto' : undefined }}>
              <span className={`game-solitaire-suit${su % 2 ? ' game-solitaire-red' : ''}`}>{SUITS[su]}</span>
              {f.length > 1 && face(f[f.length - 2], undefined, { position: 'absolute', inset: 0 })}
              {f.length > 0 && face(f[f.length - 1], from, { position: 'absolute', inset: 0 }, dragging(from))}
            </div>
          );
        })}
      </div>

      <div className="game-solitaire-tab" style={{ gap }}>
        {s.tab.map((col, ci) => {
          const uOff = Math.max(12, Math.min(Math.round(ch * 0.33), Math.floor((avail - ch) / Math.max(1, col.length - 1))));
          const height = Math.max(ch, Math.max(0, col.length - 1) * uOff + ch);
          const lifting = drag && drag.from.kind === 'tab' && drag.from.col === ci ? drag.from.idx : 99;
          return (
            <div key={ci} className={`game-solitaire-col${slotGlow(`t:${ci}`)}`} data-drop={`t:${ci}`} style={{ width: cw, height: Math.max(height, avail) }}>
              <div className="game-solitaire-slot game-solitaire-empty" style={{ width: cw, height: ch }} />
              {col.map((c, i) => face(c, { kind: 'tab', col: ci, idx: i }, { position: 'absolute', top: i * uOff, left: 0 }, i >= lifting))}
            </div>
          );
        })}
      </div>

      <div className="game-solitaire-tools">
        <button className="chip" onClick={undo} disabled={!hist.length || !!auto || won}>Undo</button>
        <button className="chip" onClick={showHint} disabled={!!auto || won}>{hl && !hl.from && !hl.to ? 'No moves' : 'Hint'}</button>
        <button className="chip" onClick={() => onDeal('freecell', true)}>Daily</button>
        <button className="chip" onClick={() => onDeal('klondike')}>Klondike</button>
        <button className="chip" onClick={() => onDeal('freecell')}>New</button>
      </div>

      {drag && (
        <div className="game-solitaire-drag" style={{ left: drag.x - drag.ox, top: drag.y - drag.oy }}>
          {drag.cards.map((c, i) => <CardFace key={c} c={c} w={cw} h={ch} drag style={{ position: 'absolute', top: i * Math.round(ch * 0.3), left: 0 }} />)}
        </div>
      )}

      {won && <WinPanel s={s} best={best} ghost={ghost} root={root} cw={cw} ch={ch} again={() => onDeal('freecell')} />}
    </div>
  );
}
