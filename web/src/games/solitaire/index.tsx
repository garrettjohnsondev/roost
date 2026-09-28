import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameMeta, GameProps } from '../types';
import { fmtScore, sprite } from '../types';
import {
  RANKS, SUITS, allFaceUp, autoComplete, bestTarget, deal, drawStock, isRed, isWon, move, pick, rankOf, suitOf,
  type Card, type From, type State, type To,
} from './logic';
import './style.css';

/** Klondike, Roost style: the court cards are the crew, the backs are a
 *  woven nest, and a win sends everyone bouncing. Tap a card to send it
 *  to its best spot, or drag it where you want it. */
export const meta: GameMeta = {
  id: 'solitaire',
  name: 'Solitaire',
  blurb: 'Klondike with the crew. Tap a card and it finds its perch.',
  host: 'ollie',
  pack: 'classic',
  lowerIsBetter: true,
  scoreKind: 'time',
  achievements: [
    { id: 'first-win', name: 'Home to roost', says: 'Win a game.' },
    { id: 'quick', name: 'Early bird', says: 'Win in under 3 minutes.' },
    { id: 'no-undo', name: 'No take-backs', says: 'Win without using undo.' },
    { id: 'draw3', name: 'Three at a time', says: 'Win on Draw 3.' },
    { id: 'lean', name: 'Light packer', says: 'Win in 110 moves or fewer.' },
  ],
};

const FACES: Record<number, string[]> = { 11: ['pip', 'moss', 'rue', 'bly'], 12: ['wren', 'nell', 'juno', 'fig'], 13: ['ollie', 'bram', 'otto', 'tuck'] };
const CHEER = ['pip', 'ollie', 'bram', 'wren', 'moss', 'fig', 'nell', 'juno', 'rue', 'bly', 'tuck', 'otto'];

type Drag = { from: From; cards: Card[]; x: number; y: number; ox: number; oy: number };

function parseDrop(el: Element | null): To | null {
  const d = (el?.closest('[data-drop]') as HTMLElement | null)?.dataset.drop;
  if (!d) return null;
  const [k, n] = d.split(':');
  return k === 'f' ? { kind: 'found', suit: +n } : { kind: 'tab', col: +n };
}
const sameFrom = (a: From | undefined, b: From) => !!a && JSON.stringify(a) === JSON.stringify(b);

export function Game({ save, onSave, onScore, onAchieve, paused, best }: GameProps<State>) {
  const [s, setS] = useState<State>(() => save ?? deal(Date.now() % 2 ** 31, 1));
  const [hist, setHist] = useState<State[]>([]);
  const [won, setWon] = useState(false);
  const [auto, setAuto] = useState<State[] | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [shake, setShake] = useState<string | null>(null);
  const press = useRef<{ from: From; x: number; y: number; ox: number; oy: number } | null>(null);

  const [vw, vh] = [Math.min(window.innerWidth, 480), window.innerHeight];
  const gap = 4;
  const cw = Math.floor((vw - 12 - gap * 6) / 7);
  const ch = Math.round(cw * 1.42);
  const avail = Math.max(260, vh - 250 - ch);

  const finish = useCallback((n: State) => {
    setWon(true);
    onScore(n.secs);
    onSave(null);
    onAchieve('first-win');
    if (n.secs < 180) onAchieve('quick');
    if (n.undos === 0) onAchieve('no-undo');
    if (n.draw === 3) onAchieve('draw3');
    if (n.moves <= 110) onAchieve('lean');
  }, [onScore, onSave, onAchieve]);

  const commit = useCallback((n: State | null) => {
    if (!n) return false;
    setHist((h) => [...h, s]);
    setS(n);
    if (isWon(n)) finish(n);
    else onSave(n);
    return true;
  }, [s, finish, onSave]);

  // The clock runs from the first move until the win, and never while paused.
  useEffect(() => {
    if (paused || won || s.moves === 0) return;
    const t = setInterval(() => setS((x) => ({ ...x, secs: x.secs + 1 })), 1000);
    return () => clearInterval(t);
  }, [paused, won, s.moves]);

  // Auto-complete plays out one step at a time so you can watch it.
  useEffect(() => {
    if (!auto || paused) return;
    const t = setTimeout(() => {
      const [next, ...rest] = auto;
      const n = { ...next, secs: s.secs };
      setS(n);
      if (isWon(n)) { setAuto(null); finish(n); } else setAuto(rest);
    }, 70);
    return () => clearTimeout(t);
  }, [auto, paused, s.secs, finish]);

  const newGame = (draw: 1 | 3 = s.draw) => {
    onSave(null);
    setS(deal(Date.now() % 2 ** 31, draw));
    setHist([]); setWon(false); setAuto(null); setDrag(null);
  };
  const undo = () => {
    if (!hist.length || auto || won) return;
    const prev = { ...hist[hist.length - 1], secs: s.secs, undos: s.undos + 1 };
    setHist((h) => h.slice(0, -1));
    setS(prev);
    onSave(prev);
  };

  const tap = (from: From) => {
    const to = bestTarget(s, from);
    if (!to || !commit(move(s, from, to))) {
      setShake(JSON.stringify(from));
      setTimeout(() => setShake(null), 300);
    }
  };

  const down = (from: From) => (e: React.PointerEvent) => {
    if (auto || won || !pick(s, from)) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    press.current = { from, x: e.clientX, y: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top };
  };

  useEffect(() => {
    const mv = (e: PointerEvent) => {
      const p = press.current;
      if (!p) return;
      if (!drag && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 8) return;
      setDrag({ from: p.from, cards: pick(s, p.from) ?? [], x: e.clientX, y: e.clientY, ox: p.ox, oy: p.oy });
    };
    const up = (e: PointerEvent) => {
      const p = press.current;
      press.current = null;
      if (!p) return;
      if (drag) {
        setDrag(null);
        const to = parseDrop(document.elementFromPoint(e.clientX, e.clientY));
        if (to) commit(move(s, p.from, to));
      } else tap(p.from);
    };
    const cancel = () => { press.current = null; setDrag(null); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); };
  });

  const canAuto = !won && !auto && allFaceUp(s) && !!autoComplete(s);
  const dragging = (from: From) => drag && sameFrom(drag.from, from);

  const face = (c: Card, props: { from?: From; style?: React.CSSProperties; dim?: boolean } = {}) => {
    const r = rankOf(c), su = suitOf(c);
    const cls = `game-solitaire-card game-solitaire-face${isRed(c) ? ' game-solitaire-red' : ''}${props.from && shake === JSON.stringify(props.from) ? ' game-solitaire-shake' : ''}`;
    return (
      <div
        key={c}
        className={cls}
        style={{ width: cw, height: ch, ...props.style, opacity: props.dim ? 0.25 : undefined }}
        onPointerDown={props.from ? down(props.from) : undefined}
      >
        <span className="game-solitaire-corner">{RANKS[r]}<i>{SUITS[su]}</i></span>
        {r > 10
          ? <img className="game-solitaire-court" src={sprite(FACES[r][su], r === 13 ? 'hold' : r === 12 ? 'look1' : 'idle')} alt="" draggable={false} />
          : <span className="game-solitaire-pip">{SUITS[su]}</span>}
      </div>
    );
  };
  const back = (key: string | number, style?: React.CSSProperties) => (
    <div key={key} className="game-solitaire-card game-solitaire-back" style={{ width: cw, height: ch, ...style }} />
  );

  const wasteShown = s.waste.slice(s.draw === 3 ? -3 : -1);
  const fan = Math.round(cw * 0.28);

  return (
    <div className="game-solitaire" style={{ width: vw - 12 }}>
      <div className="game-solitaire-bar">
        <span>{fmtScore(meta, s.secs)}</span>
        <span>{s.moves} moves</span>
        {best !== undefined && <span className="game-solitaire-dim">best {fmtScore(meta, best)}</span>}
      </div>

      <div className="game-solitaire-top" style={{ gap }}>
        <div className="game-solitaire-slot" style={{ width: cw, height: ch }} onClick={() => !auto && !won && commit(drawStock(s))}>
          {s.stock.length ? back('stock') : <span className="game-solitaire-recycle">{s.waste.length ? '↻' : ''}</span>}
        </div>
        <div className="game-solitaire-waste" style={{ width: cw + fan * 2, height: ch }}>
          {wasteShown.map((c, i) => {
            const top = i === wasteShown.length - 1;
            const from: From = { kind: 'waste' };
            return face(c, { from: top ? from : undefined, dim: top && !!dragging(from), style: { position: 'absolute', left: i * fan, top: 0 } });
          })}
        </div>
        {s.found.map((f, su) => {
          const from: From = { kind: 'found', suit: su };
          return (
            <div key={su} className="game-solitaire-slot" data-drop={`f:${su}`} style={{ width: cw, height: ch }}>
              <span className={`game-solitaire-ghost${su % 2 ? ' game-solitaire-red' : ''}`}>{SUITS[su]}</span>
              {f.length > 1 && face(f[f.length - 2], { style: { position: 'absolute', inset: 0 } })}
              {f.length > 0 && face(f[f.length - 1], { from, dim: !!dragging(from), style: { position: 'absolute', inset: 0 } })}
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
            <div key={ci} className="game-solitaire-col" data-drop={`t:${ci}`} style={{ width: cw, height: Math.max(height, avail) }}>
              <div className="game-solitaire-slot game-solitaire-empty" style={{ width: cw, height: ch }} />
              {col.cards.map((c, i) => {
                const top = y;
                y += i < col.hidden ? dOff : uOff;
                if (i < col.hidden) return back(c, { position: 'absolute', top, left: 0 });
                return face(c, { from: { kind: 'tab', col: ci, idx: i }, dim: i >= lifting, style: { position: 'absolute', top, left: 0 } });
              })}
            </div>
          );
        })}
      </div>

      <div className="game-solitaire-tools">
        <button className="chip" onClick={undo} disabled={!hist.length || !!auto || won}>Undo</button>
        <button className="chip" onClick={() => newGame(s.draw === 1 ? 3 : 1)} title="Switch and deal again">Draw {s.draw}</button>
        {canAuto
          ? <button className="chip game-solitaire-go" onClick={() => setAuto(autoComplete(s))}>Finish</button>
          : <button className="chip" onClick={() => newGame()}>New game</button>}
      </div>

      {drag && (
        <div className="game-solitaire-drag" style={{ left: drag.x - drag.ox, top: drag.y - drag.oy }}>
          {drag.cards.map((c, i) => face(c, { style: { position: 'absolute', top: i * Math.round(ch * 0.3), left: 0 } }))}
        </div>
      )}

      {won && (
        <div className="game-overlay game-solitaire-win">
          <div className="game-solitaire-cascade">
            {CHEER.map((n, i) => (
              <span key={n} className="game-solitaire-flyer" style={{ ['--i' as string]: i, left: `${(i * 8) % 90}%` }}>
                <img src={sprite(n, i % 2 ? 'dance' : 'cheer')} alt="" />
              </span>
            ))}
          </div>
          <p>Home to roost in {fmtScore(meta, s.secs)}, {s.moves} moves.{best !== undefined && s.secs <= best ? ' Best yet!' : ''}</p>
          <button className="chip" onClick={() => newGame()}>Deal again</button>
        </div>
      )}
    </div>
  );
}
