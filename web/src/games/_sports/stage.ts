import { useEffect, useRef, useState } from 'react';
import { sprite } from '../types';
import { readFlick, type Flick, type Pt } from './flick';

/** The canvas side of the sports pack: a DPR-scaled canvas, a rAF loop that
 *  fully stops while paused or unmounted, flick capture, and crew sprites. */

export function useStageSize(aspect = 1.45) {
  const calc = () => {
    const w = Math.min(window.innerWidth - 16, 440);
    const h = Math.min(Math.round(w * aspect), window.innerHeight - 170);
    return { w, h: Math.max(320, h) };
  };
  const [size, setSize] = useState(calc);
  useEffect(() => {
    const r = () => setSize(calc());
    window.addEventListener('resize', r);
    return () => window.removeEventListener('resize', r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return size;
}

/** For sideways games: fill the window, minus the arcade header (~36px),
 *  a HUD line and a little margin. Upright (the "play anyway" case) it keeps a
 *  wide letterbox so the field still reads side-on. */
export function useWideStageSize(reserve = 36 + 34 + 12) {
  const calc = () => {
    const w = Math.max(280, window.innerWidth - 20);
    const room = window.innerHeight - reserve;
    const h = window.innerWidth > window.innerHeight ? room : Math.min(room, Math.round(w * 0.62));
    return { w, h: Math.max(200, h) };
  };
  const [size, setSize] = useState(calc);
  useEffect(() => {
    const r = () => setSize(calc());
    window.addEventListener('resize', r);
    window.addEventListener('orientationchange', r);
    return () => { window.removeEventListener('resize', r); window.removeEventListener('orientationchange', r); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return size;
}

export type Frame = (ctx: CanvasRenderingContext2D, w: number, h: number, dt: number, now: number) => void;

/** Runs `frame` every animation frame while `running`. dt is in seconds and
 *  capped, so coming back from a pause never teleports anything. */
export function useLoop(canvas: React.RefObject<HTMLCanvasElement>, size: { w: number; h: number }, running: boolean, frame: Frame) {
  const f = useRef(frame);
  f.current = frame;
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const paint = (dt: number, now: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      f.current(ctx, size.w, size.h, dt, now);
    };
    paint(0, performance.now());
    if (!running) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      paint(dt, now);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [canvas, size.w, size.h, running]);
}

/** Pointer handlers that turn a touch (or mouse drag) into a Flick. `onTap`
 *  gets taps too short to be a flick, with the point in canvas px. */
export function useFlick(onFlick: (f: Flick, start: Pt) => void, onTap?: (x: number, y: number) => void) {
  const cb = useRef({ onFlick, onTap });
  cb.current = { onFlick, onTap };
  const trail = useRef<Pt[]>([]);
  const at = (e: React.PointerEvent<HTMLCanvasElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp };
  };
  return {
    onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      trail.current = [at(e)];
    },
    onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (trail.current.length) trail.current.push(at(e));
    },
    onPointerUp: (e: React.PointerEvent<HTMLCanvasElement>) => {
      const pts = trail.current;
      if (!pts.length) return;
      pts.push(at(e));
      trail.current = [];
      const f = readFlick(pts);
      if (f) cb.current.onFlick(f, pts[0]);
      else cb.current.onTap?.(pts[0].x, pts[0].y);
    },
    onPointerCancel: () => { trail.current = []; },
  };
}

const cache = new Map<string, HTMLImageElement>();
export function crewImg(name: string, pose = 'idle'): HTMLImageElement {
  const src = sprite(name, pose);
  let img = cache.get(src);
  if (!img) {
    img = new Image();
    img.src = src;
    cache.set(src, img);
  }
  return img;
}

/** Draws a crew member standing on (x, footY), `size` px tall, optionally
 *  tipped over by `rot` radians around their middle (for dives). */
export function drawCrew(ctx: CanvasRenderingContext2D, name: string, pose: string, x: number, footY: number, size: number, flip = false, rot = 0) {
  const img = crewImg(name, pose);
  if (!img.complete || !img.naturalWidth) return;
  ctx.save();
  ctx.translate(Math.round(x), Math.round(footY - size / 2));
  if (rot) ctx.rotate(rot);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(img, Math.round(-size / 2), Math.round(-size / 2), Math.round(size), Math.round(size));
  ctx.restore();
}

export const CREW = ['pip', 'ollie', 'bram', 'wren', 'moss', 'fig', 'nell', 'juno', 'rue', 'bly', 'tuck', 'otto'];
export const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

/** Reads a CSS variable off the page so the canvas follows the theme. */
export function cssVar(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
