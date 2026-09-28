import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Ghost } from '../types';
import { sprite } from '../types';
import { RANKS, SUITS, isRed, rankOf, suitOf, type Card } from './logic';

/** Shared pieces for both deals: the card face, card flight, dragging, the
 *  win cascade and the ghost's pace bar. */

export const FACES: Record<number, string[]> = { 11: ['pip', 'moss', 'rue', 'bly'], 12: ['wren', 'nell', 'juno', 'fig'], 13: ['ollie', 'bram', 'otto', 'tuck'] };
const courtPose = (r: number) => (r === 13 ? 'hold' : r === 12 ? 'look1' : 'idle');

export const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function CardFace({ c, w, h, style, dim, shake, glow, onDown, origin, drag }: {
  c: Card; w: number; h: number; style?: React.CSSProperties; dim?: boolean; shake?: boolean; glow?: boolean;
  onDown?: (e: React.PointerEvent) => void; origin?: string; drag?: boolean;
}) {
  const r = rankOf(c), su = suitOf(c);
  const cls = `game-solitaire-card game-solitaire-face${isRed(c) ? ' game-solitaire-red' : ''}${shake ? ' game-solitaire-shake' : ''}${glow ? ' game-solitaire-glow' : ''}`;
  return (
    <div
      className={cls}
      data-card={drag ? undefined : c}
      data-drag-card={drag ? c : undefined}
      data-origin={origin}
      style={{ width: w, height: h, ...style, opacity: dim ? 0.25 : undefined }}
      onPointerDown={onDown}
    >
      <span className="game-solitaire-corner">{RANKS[r]}<i>{SUITS[su]}</i></span>
      {r > 10
        ? <img className="game-solitaire-court" src={sprite(FACES[r][su], courtPose(r))} alt="" draggable={false} />
        : <span className="game-solitaire-pip">{SUITS[su]}</span>}
    </div>
  );
}

export function CardBack({ w, h, style, stock }: { w: number; h: number; style?: React.CSSProperties; stock?: boolean }) {
  return <div className="game-solitaire-card game-solitaire-back" data-stock={stock ? '1' : undefined} style={{ width: w, height: h, ...style }} />;
}

/** Card flight (FLIP): after each render, any card that moved glides from
 *  where it was. New cards with data-origin fly in from that element. */
export function useFlight(root: RefObject<HTMLElement>) {
  const prev = useRef(new Map<string, DOMRect>());
  const flying = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const still = reducedMotion();
    const next = new Map<string, DOMRect>();
    el.querySelectorAll<HTMLElement>('[data-card]').forEach((n) => {
      const id = n.dataset.card!;
      const land = flying.current.get(id);
      if (land) { next.set(id, land); return; }
      const r = n.getBoundingClientRect();
      next.set(id, r);
      let p = prev.current.get(id);
      if (!p && n.dataset.origin) p = el.querySelector(`[data-${n.dataset.origin}]`)?.getBoundingClientRect();
      if (still || !p || (Math.abs(p.left - r.left) < 2 && Math.abs(p.top - r.top) < 2)) return;
      flying.current.set(id, r);
      n.style.transition = 'none';
      n.style.transform = `translate(${p.left - r.left}px, ${p.top - r.top}px)`;
      n.style.zIndex = '30';
      void n.offsetWidth;
      n.style.transition = 'transform 210ms cubic-bezier(0.2, 0.8, 0.3, 1)';
      n.style.transform = '';
      const done = () => { n.style.zIndex = ''; n.style.transition = ''; flying.current.delete(id); };
      n.addEventListener('transitionend', done, { once: true });
      setTimeout(done, 400);
    });
    prev.current = next;
  });
  /** Seed where dragged cards were dropped, so they settle from there. */
  return (els: Iterable<HTMLElement>) => { for (const n of els) prev.current.set(n.dataset.dragCard!, n.getBoundingClientRect()); };
}

export type Drag<F> = { from: F; cards: Card[]; x: number; y: number; ox: number; oy: number };

/** Press to pick up, drag past 8px to carry, release over a [data-drop]
 *  target; a press without a drag is a tap. */
export function useCardDrag<F>(opts: {
  enabled: boolean;
  pick: (f: F) => Card[] | null;
  tap: (f: F) => void;
  drop: (f: F, target: string | null) => void;
  seed: (els: Iterable<HTMLElement>) => void;
}) {
  const [drag, setDrag] = useState<Drag<F> | null>(null);
  const press = useRef<{ from: F; x: number; y: number; ox: number; oy: number } | null>(null);
  const down = (from: F) => (e: React.PointerEvent) => {
    if (!opts.enabled || !opts.pick(from)) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    press.current = { from, x: e.clientX, y: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top };
  };
  useEffect(() => {
    const mv = (e: PointerEvent) => {
      const p = press.current;
      if (!p) return;
      if (!drag && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 8) return;
      setDrag({ from: p.from, cards: opts.pick(p.from) ?? [], x: e.clientX, y: e.clientY, ox: p.ox, oy: p.oy });
    };
    const up = (e: PointerEvent) => {
      const p = press.current;
      press.current = null;
      if (!p) return;
      if (drag) {
        opts.seed(document.querySelectorAll<HTMLElement>('[data-drag-card]'));
        setDrag(null);
        const t = (document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-drop]') as HTMLElement | null)?.dataset.drop ?? null;
        opts.drop(p.from, t);
      } else opts.tap(p.from);
    };
    const cancel = () => { press.current = null; setDrag(null); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); };
  });
  return { drag, down, cancel: () => { press.current = null; setDrag(null); } };
}

/** The classic win: cards leap off the foundations one by one and bounce
 *  down the screen, leaving a trail. Drawn on a canvas; skipped for
 *  reduced motion. */
export function Cascade({ root, w, h }: { root: RefObject<HTMLElement>; w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const host = root.current;
    if (!cv || !host || reducedMotion()) return;
    const W = (cv.width = window.innerWidth), H = (cv.height = window.innerHeight);
    const g = cv.getContext('2d');
    if (!g) return;
    const slots = [0, 1, 2, 3].map((su) => host.querySelector(`[data-drop="f:${su}"]`)?.getBoundingClientRect() ?? new DOMRect(W - (4 - su) * (w + 4), 60, w, h));
    const imgs: Record<string, HTMLImageElement> = {};
    for (const r of [11, 12, 13]) for (let su = 0; su < 4; su++) {
      const im = new Image();
      im.src = sprite(FACES[r][su], courtPose(r));
      imgs[`${r}:${su}`] = im;
    }
    const drawCard = (c: Card, x: number, y: number) => {
      const r = rankOf(c), su = suitOf(c);
      g.fillStyle = '#fdfbf5';
      g.strokeStyle = '#0006';
      g.lineWidth = 1;
      g.beginPath();
      g.roundRect(x, y, w, h, 4);
      g.fill();
      g.stroke();
      g.fillStyle = isRed(c) ? '#c8323a' : '#1b1b1f';
      g.font = '700 14px system-ui, sans-serif';
      g.textBaseline = 'top';
      g.fillText(`${RANKS[r]}${SUITS[su]}`, x + 3, y + 3);
      const im = imgs[`${r}:${su}`];
      if (im && im.complete && im.naturalWidth) { g.imageSmoothingEnabled = false; g.drawImage(im, x + w * 0.26, y + h - w * 0.74, w * 0.72, w * 0.72); }
      else if (r <= 10) { g.font = `${Math.round(w * 0.45)}px system-ui, sans-serif`; g.fillText(SUITS[su], x + w * 0.5, y + h * 0.45); }
    };
    // King to ace, suit by suit, like the old one.
    const order: Card[] = [];
    for (let r = 13; r >= 1; r--) for (let su = 0; su < 4; su++) order.push(su * 13 + r - 1);
    let k = 0;
    let cur: { c: Card; x: number; y: number; vx: number; vy: number } | null = null;
    let raf = 0;
    const launch = () => {
      if (k >= order.length) return null;
      const c = order[k++];
      const s = slots[suitOf(c)];
      const dir = Math.random() < 0.5 ? -1 : 1;
      return { c, x: s.left, y: s.top, vx: dir * (2 + Math.random() * 4), vy: -(Math.random() * 6) };
    };
    const frame = () => {
      for (let step = 0; step < 2; step++) {
        cur ??= launch();
        if (!cur) return;
        cur.vy += 0.6;
        cur.x += cur.vx;
        cur.y += cur.vy;
        if (cur.y + h > H) { cur.y = H - h; cur.vy = -cur.vy * 0.78; }
        drawCard(cur.c, cur.x, cur.y);
        if (cur.x + w < 0 || cur.x > W) cur = null;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [root, w, h]);
  return <canvas ref={ref} className="game-solitaire-cascade" aria-hidden="true" />;
}

/** The ghost's pace: cards home by now at its speed, drawn see-through over
 *  a bar of 52 with your own cards home beneath it. */
export function GhostBar({ ghost, secs, home }: { ghost: Ghost; secs: number; home: number }) {
  const theirs = Math.min(52, Math.floor((52 * secs) / Math.max(1, ghost.target)));
  const mm = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  return (
    <div className="game-solitaire-track" title={`${ghost.name}'s ghost wins in ${mm(ghost.target)}`}>
      <div className="game-solitaire-track-bar">
        <i className="game-solitaire-track-you" style={{ width: `${(home / 52) * 100}%` }} />
        <i className="game-solitaire-track-them" style={{ width: `${(theirs / 52) * 100}%` }} />
      </div>
      <span className="game-solitaire-ghost" style={{ left: `calc(${(theirs / 52) * 100}% - 14px)` }}>
        <img src={sprite(ghost.sprite, 'idle')} alt={`${ghost.name}'s ghost`} />
      </span>
      <span className="game-solitaire-track-say">{ghost.name}: {theirs} home · you: {home} · beat {mm(ghost.target)}</span>
    </div>
  );
}
