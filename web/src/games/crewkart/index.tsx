import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameMeta, GameProps } from '../types';
import { sprite } from '../types';
import { sfx } from '../../economy/sound';
import { buzz, ticks } from '../../haptics';
import {
  CUP_POINTS, DT, LAPS, N, TRACKS, V, buildTrack, ghostProg, ghostTime, linePoint, newRace, place, standings, step,
  type ItemKind, type Race,
} from './logic';
import {
  KART_COLOR, PX, THEMES, drawBox, drawItemIcon, drawKart, drawMinimap, driverImg, fmtT, ordinal, toScreen, trackBitmap,
  type Cam, type Particle,
} from './render';
import './style.css';

/** Crew Kart: a top-down kart racer, three laps against three crew karts as
 *  quick as their models. Score = your finishing time on the race you just
 *  ran (every track is scaled to the same length, so times compare across
 *  them). The Crew Cup runs all four for points; its progress, and any race
 *  in flight, ride along in the save. */
export const meta: GameMeta = {
  id: 'crewkart',
  name: 'Crew Kart',
  blurb: 'Three laps, four tracks, one thumb. Drift for the boost.',
  host: 'ollie',
  pack: 'stretch',
  lowerIsBetter: true,
  scoreKind: 'time',
  orientation: 'landscape',
  safeCorner: 'tr',
  achievements: [
    { id: 'win', name: 'Chequered', says: 'Win a race.' },
    { id: 'cup', name: 'Crew Cup', says: 'Win the four-track cup.' },
    { id: 'drift', name: 'Orange sparks', says: 'Charge a drift to a big boost.' },
    { id: 'clean', name: 'Clean line', says: 'Finish a race without touching a wall.' },
    { id: 'shell', name: 'Seed sniper', says: 'Hit two karts with seed shells in one race.' },
  ],
  inProgress: (s: Save) => !!s?.race || !!s?.cup,
  ghostScore: ghostTime,
};

const DRIVERS = ['pip', 'ollie', 'bram', 'wren', 'moss', 'fig', 'nell', 'juno', 'rue', 'bly', 'tuck', 'otto'];
interface Cup { i: number; pts: Record<string, number> }
interface Save { driver: string; track: string; cup: Cup | null; race: Race | null; bests?: Record<string, number> }
type Mode = 'menu' | 'race' | 'resume' | 'result';

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function useViewport() {
  const get = () => ({ w: window.innerWidth, h: Math.max(200, window.innerHeight - 36) });
  const [vp, setVp] = useState(get);
  useEffect(() => {
    const f = () => setVp(get());
    window.addEventListener('resize', f);
    window.addEventListener('orientationchange', f);
    return () => { window.removeEventListener('resize', f); window.removeEventListener('orientationchange', f); };
  }, []);
  return vp;
}

export function Game({ save, onSave, onScore, onAchieve, paused, best, ghost }: GameProps<Save>) {
  const [prog, setProg] = useState<Save>(() => ({
    driver: save?.driver ?? 'pip', track: save?.track ?? 'garden', cup: save?.cup ?? null, race: null, bests: save?.bests ?? {},
  }));
  const [mode, setMode] = useState<Mode>(save?.race && !save.race.done ? 'resume' : 'menu');
  const race = useRef<Race | null>(save?.race && !save.race.done ? save.race : null);
  const [result, setResult] = useState<{ time: number; place: number; order: Array<{ name: string; t: number | null }>; laps: number[]; cupDone?: boolean } | null>(null);
  const vp = useViewport();
  const canvas = useRef<HTMLCanvasElement>(null);
  const held = useRef(new Map<number, 'L' | 'R'>());
  const keys = useRef({ L: false, R: false, D: false });
  const useNow = useRef(false);
  const fx = useRef({ parts: [] as Particle[], shake: 0, squash: 0, roulette: 0, banner: '', bannerT: 0, flash: 0, lastCount: 99 });
  const cam = useRef<Cam>({ x: 0, y: 0, a: 0, z: 1, sx: 0, sy: 0 });
  const progRef = useRef(prog);
  progRef.current = prog;

  const persist = useCallback((p: Save, r: Race | null) => onSave({ ...p, race: r }), [onSave]);

  const start = (trackId: string, cup: Cup | null) => {
    const r = newRace(trackId, progRef.current.driver, (Date.now() & 0xffff) + 1);
    race.current = r;
    const k = r.karts[0];
    cam.current = { ...cam.current, x: k.x, y: k.y, a: k.ang };
    fx.current = { ...fx.current, parts: [], banner: '', bannerT: 0, lastCount: 99, roulette: 0 };
    const next = { ...progRef.current, track: trackId, cup };
    setProg(next);
    persist(next, r);
    setResult(null);
    setMode('race');
  };

  // Pause: keep the race in the save.
  useEffect(() => {
    if (paused && mode === 'race') {
      setMode('resume');
      persist(progRef.current, race.current);
    }
  }, [paused, mode, persist]);

  const finishRace = useCallback((r: Race) => {
    const me = r.karts[0];
    const order = standings(r).map((k) => ({ name: k.name, t: k.finish }));
    const pl = place(r);
    const p = progRef.current;
    let cup = p.cup;
    let cupDone = false;
    if (cup) {
      const pts = { ...cup.pts };
      standings(r).forEach((k, i) => { pts[k.name] = (pts[k.name] ?? 0) + CUP_POINTS[i]; });
      cup = { i: cup.i + 1, pts };
      if (cup.i >= TRACKS.length) {
        cupDone = true;
        const top = Object.entries(pts).sort((a, b) => b[1] - a[1])[0];
        if (top[0] === p.driver) { onAchieve('cup'); sfx('win'); }
      }
    }
    const time = me.finish ?? r.t;
    const bests = { ...(p.bests ?? {}) };
    if (!bests[r.track] || time < bests[r.track]) bests[r.track] = Math.round(time * 10) / 10;
    const next: Save = { ...p, cup: cupDone ? null : cup, race: null, bests };
    setProg(next);
    persist(next, null);
    setResult({ time, place: pl, order, laps: r.laps, cupDone });
    if (cupDone && cup) setCupFinal(cup.pts);
    setMode('result');
  }, [onAchieve, persist]);
  const [cupFinal, setCupFinal] = useState<Record<string, number> | null>(null);

  // Size the canvas.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(vp.w * dpr);
    c.height = Math.round(vp.h * dpr);
  }, [vp, mode]);

  // The loop: fixed steps, drawn every frame, stopped when paused.
  useEffect(() => {
    if (paused || mode !== 'race' || !race.current) return;
    const c = canvas.current!;
    const g = c.getContext('2d')!;
    let raf = 0, last = performance.now(), acc = 0, saveT = 0, scored = false;
    const calm = reduced();
    const f = fx.current;
    const r0 = race.current;
    const tr = buildTrack(r0.track);
    const bmp = trackBitmap(r0.track);
    const theme = THEMES[r0.track] ?? THEMES.garden;
    const burst = (x: number, y: number, n: number, colors: string[], sp = 80, s = 3) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = sp * (0.4 + Math.random());
        f.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.4, max: 0.9, c: colors[i % colors.length], s });
      }
    };
    const onEvent = (r: Race, e: string) => {
      const [kind, who, extra] = e.split(':');
      const me = who === '0';
      const k = r.karts.find((q) => String(q.id) === who);
      if (kind === 'bump' && me) { sfx('bounce'); ticks(1); f.shake = Math.max(f.shake, 4); f.squash = 1; if (k) burst(k.x, k.y, 6, ['#d8cfc0', '#a89f90'], 60); }
      else if (kind === 'hit') {
        if (k) burst(k.x, k.y, 14, ['#ffffff', '#f7e06a', '#c9954a'], 120);
        if (me) { sfx('crash'); ticks(3); f.shake = 10; f.banner = extra === 'oil' ? 'Oil!' : 'Shelled!'; f.bannerT = 1; }
        else sfx('hit');
        if (r.karts[0].hits >= 2) onAchieve('shell');
      } else if (kind === 'block' && k) { burst(k.x, k.y, 10, ['#6ec8ff', '#bfe6ff'], 90); if (me) sfx('bounce'); }
      else if (kind === 'boost' && me) {
        sfx('whoosh');
        if (extra !== 'feather') { ticks(2); f.flash = extra === 'big' ? 0.3 : 0.15; }
        if (extra === 'big') onAchieve('drift');
      } else if (kind === 'box' && k) {
        const p = k;
        burst(p.x, p.y, 10, ['#ff6b6b', '#f7e06a', '#46e08a', '#4aa3ff'], 110);
      } else if (kind === 'item' && me) { sfx('coin'); f.roulette = 0.6; }
      else if (kind === 'use' && me) sfx('tap');
      else if (kind === 'lap' && me) {
        sfx('score');
        f.banner = r.karts[0].lapsDone === LAPS ? 'Final lap!' : `Lap ${r.karts[0].lapsDone}`;
        f.bannerT = 1.4;
      } else if (kind === 'finish' && me && !scored) {
        scored = true;
        const me0 = r.karts[0];
        const t = Math.round((me0.finish ?? r.t) * 10) / 10;
        const pl = place(r);
        onScore(t);
        if (pl === 1) { onAchieve('win'); buzz('pass'); sfx('win'); } else { buzz('fail'); sfx(pl === 4 ? 'lose' : 'score'); }
        if (me0.walls === 0) onAchieve('clean');
        f.banner = `${ordinal(pl)}!`; f.bannerT = 3;
      }
    };

    const draw = (r: Race, frameDt: number) => {
      const dpr = window.devicePixelRatio || 1;
      const w = vp.w, h = vp.h;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.imageSmoothingEnabled = false;
      const me = r.karts[0];
      // Camera: behind the player, turning with them (not while spinning).
      const C = cam.current;
      C.z = Math.max(0.8, Math.min(2, h / 330));
      const lead = 40 * Math.min(1, me.spd / V);
      C.x += (me.x + Math.cos(me.mv) * lead - C.x) * Math.min(1, frameDt * 8);
      C.y += (me.y + Math.sin(me.mv) * lead - C.y) * Math.min(1, frameDt * 8);
      if (me.spin <= 0) {
        let da = me.mv - C.a;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        C.a += da * Math.min(1, frameDt * 4);
      }
      f.shake = Math.max(0, f.shake - frameDt * 30);
      C.sx = calm ? 0 : (Math.random() - 0.5) * f.shake;
      C.sy = calm ? 0 : (Math.random() - 0.5) * f.shake;
      g.fillStyle = theme.sky;
      g.fillRect(0, 0, w, h);
      g.save();
      g.translate(w / 2 + C.sx, h * 0.64 + C.sy);
      g.scale(C.z, C.z);
      g.rotate(-C.a - Math.PI / 2);
      g.translate(-C.x, -C.y);
      g.drawImage(bmp, 0, 0, bmp.width * PX, bmp.height * PX);
      // Boxes, oil, shells.
      for (const b of r.boxes) {
        if (b.down > 0) continue;
        const p = tr.s[b.i], t = tr.t[b.i];
        drawBox(g, p.x - t.y * b.lat, p.y + t.x * b.lat, r.t + b.lat * 0.01);
      }
      for (const o of r.oils) {
        g.fillStyle = '#1c1c24';
        g.fillRect(o.x - 12, o.y - 8, 24, 16); g.fillRect(o.x - 8, o.y - 12, 16, 24);
        g.fillStyle = '#5a4aa8';
        g.fillRect(o.x - 5, o.y - 6, 5, 3);
      }
      for (const s of r.shells) {
        g.fillStyle = 'rgba(201,149,74,0.35)';
        g.fillRect(s.x - Math.cos(s.ang) * 10 - 3, s.y - Math.sin(s.ang) * 10 - 3, 6, 6);
        g.save(); g.translate(s.x, s.y); g.rotate(s.ang);
        g.fillStyle = '#c9954a'; g.fillRect(-6, -4, 12, 8);
        g.fillStyle = '#8b5a2c'; g.fillRect(-6, -1, 12, 2);
        g.restore();
      }
      // Ghost: see-through kart on the racing line.
      let gp: { x: number; y: number; ang: number } | null = null;
      if (ghost) {
        const gpr = ghostProg(r.t, ghost.target);
        gp = linePoint(tr, gpr < 0 ? N - 2 : gpr);
        g.save();
        g.globalAlpha = 0.4;
        g.shadowColor = 'rgba(255,255,255,0.9)';
        g.shadowBlur = 12;
        g.translate(gp.x, gp.y); g.rotate(gp.ang);
        drawKart(g, '#ffffff', 0);
        g.restore();
      }
      // Headlights at night.
      if (r.track === 'city') {
        for (const k of r.karts) {
          g.save(); g.translate(k.x, k.y); g.rotate(k.ang);
          g.fillStyle = 'rgba(255,240,170,0.12)';
          g.beginPath(); g.moveTo(10, -5); g.lineTo(90, -34); g.lineTo(90, 34); g.lineTo(10, 5); g.fill();
          g.restore();
        }
      }
      for (const k of r.karts) {
        g.save(); g.translate(k.x, k.y); g.rotate(k.ang);
        if (k.boost > 0) {
          g.fillStyle = Math.random() < 0.5 ? '#f7e06a' : '#f28c28';
          const fl = 6 + Math.random() * 8;
          g.fillRect(-13 - fl, -3, fl, 6);
        }
        drawKart(g, KART_COLOR[k.name] ?? '#ccc', k.drift ? k.drift * 0.4 : 0);
        g.restore();
        if (k.shield > 0) {
          g.strokeStyle = `rgba(110,200,255,${0.5 + 0.3 * Math.sin(r.t * 12)})`;
          g.lineWidth = 3;
          g.beginPath(); g.arc(k.x, k.y, 18, 0, Math.PI * 2); g.stroke();
        }
        // Drift sparks.
        if (k.drift && Math.random() < 0.8) {
          const col = k.charge >= 1.5 ? '#f28c28' : k.charge >= 0.6 ? '#4aa3ff' : '#dddddd';
          for (const side of [-7, 7]) {
            const bx = k.x - Math.cos(k.ang) * 10 - Math.sin(k.ang) * side, by = k.y - Math.sin(k.ang) * 10 + Math.cos(k.ang) * side;
            f.parts.push({ x: bx, y: by, vx: (Math.random() - 0.5) * 60 - Math.cos(k.ang) * 40, vy: (Math.random() - 0.5) * 60 - Math.sin(k.ang) * 40, life: 0.25, max: 0.25, c: col, s: 3 });
          }
        }
      }
      for (const p of f.parts) {
        g.globalAlpha = Math.max(0, p.life / p.max);
        g.fillStyle = p.c;
        g.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
      }
      g.globalAlpha = 1;
      g.restore();
      // Drivers stay upright on screen.
      f.squash = Math.max(0, f.squash - frameDt * 5);
      const ds = 26 * Math.min(1.3, C.z);
      if (ghost && gp) {
        const s = toScreen(C, w, h, gp.x, gp.y);
        const im = driverImg(ghost.sprite);
        g.save();
        g.globalAlpha = 0.4;
        g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = 10;
        const bob = Math.sin(r.t * 4) * 3;
        if (im.complete && im.naturalWidth) g.drawImage(im, s.x - ds / 2, s.y - ds * 0.9 + bob, ds, ds);
        g.globalAlpha = 0.7; g.shadowBlur = 0;
        g.fillStyle = '#fff'; g.font = 'bold 11px ui-monospace, monospace'; g.textAlign = 'center';
        g.fillText(ghost.name, s.x, s.y - ds + bob - 2);
        g.restore();
      }
      for (const k of [...r.karts].sort((a, b) => toScreen(C, w, h, a.x, a.y).y - toScreen(C, w, h, b.x, b.y).y)) {
        const s = toScreen(C, w, h, k.x, k.y);
        const im = driverImg(k.name, k.spin > 0 ? 'look1' : 'idle');
        const sq = k.id === 0 ? f.squash : 0;
        const bw = ds * (1 + 0.25 * sq), bh = ds * (1 - 0.2 * sq);
        const hop = k.boost > 0 && !calm ? Math.sin(r.t * 30) : 0;
        if (im.complete && im.naturalWidth) g.drawImage(im, s.x - bw / 2, s.y - bh * 0.9 + hop, bw, bh);
        else { g.fillStyle = KART_COLOR[k.name] ?? '#ccc'; g.fillRect(s.x - 6, s.y - 14, 12, 12); }
      }
      if (f.flash > 0) { g.fillStyle = `rgba(255,220,140,${f.flash})`; g.fillRect(0, 0, w, h); f.flash = Math.max(0, f.flash - frameDt); }
      // HUD.
      const pl = place(r);
      g.textAlign = 'left';
      g.fillStyle = 'rgba(10,12,20,0.5)';
      g.fillRect(8, 8, 118, 74);
      g.fillStyle = pl === 1 ? '#f7e06a' : '#ffffff';
      g.font = 'bold 30px ui-monospace, monospace';
      g.fillText(ordinal(pl), 16, 40);
      const ow = g.measureText(ordinal(pl)).width;
      g.font = 'bold 13px ui-monospace, monospace';
      g.fillStyle = '#ffffff';
      g.fillText('/4', 20 + ow, 40);
      g.fillText(`Lap ${Math.max(1, Math.min(LAPS, me.lapsDone))}/${LAPS}`, 16, 58);
      g.fillText(fmtT(Math.max(0, me.finish ?? r.t)), 16, 75);
      if (ghost && r.t > 0) {
        const at = (Math.max(0, me.prog) / (LAPS * N)) * ghost.target;
        const gap = (me.finish ?? r.t) - at;
        g.fillStyle = gap <= 0 ? '#7fe08a' : '#ff9a8a';
        g.fillText(`${ghost.name} ${gap <= 0 ? '-' : '+'}${Math.abs(gap).toFixed(1)}`, 16, 96);
      }
      // Item slot, top middle.
      const ix = w / 2 - 28, iy = 8;
      g.fillStyle = 'rgba(10,12,20,0.55)';
      g.fillRect(ix, iy, 56, 56);
      g.strokeStyle = me.item ? '#f7e06a' : 'rgba(255,255,255,0.4)';
      g.lineWidth = 2;
      g.strokeRect(ix + 1, iy + 1, 54, 54);
      f.roulette = Math.max(0, f.roulette - frameDt);
      const shown: ItemKind | null = f.roulette > 0 ? (['feather', 'shell', 'oil', 'shield'] as ItemKind[])[Math.floor(f.roulette * 20) % 4] : me.item;
      if (shown) drawItemIcon(g, shown, ix + 8, iy + 8, 40);
      // Minimap, clear of the crew corner (top right).
      const mw = Math.min(130, w * 0.16), mh = mw * 0.75;
      drawMinimap(g, tr, r, gp, w - mw - 60, 12, mw, mh);
      // Drift charge meter.
      if (me.drift) {
        const c = Math.min(1, me.charge / 1.5);
        g.fillStyle = 'rgba(10,12,20,0.5)'; g.fillRect(w / 2 - 50, h - 22, 100, 10);
        g.fillStyle = me.charge >= 1.5 ? '#f28c28' : me.charge >= 0.6 ? '#4aa3ff' : '#dddddd';
        g.fillRect(w / 2 - 48, h - 20, 96 * c, 6);
      }
      // Touch halves.
      const L = keys.current.L || [...held.current.values()].includes('L');
      const R = keys.current.R || [...held.current.values()].includes('R');
      g.fillStyle = 'rgba(255,255,255,0.18)';
      if (L) g.fillRect(0, h - 6, w / 2 - 2, 6);
      if (R) g.fillRect(w / 2 + 2, h - 6, w / 2, 6);
      g.textAlign = 'center';
      // Countdown and banners.
      if (r.t < 0.8) {
        const n = Math.ceil(-r.t);
        const txt = r.t < 0 ? String(n) : 'GO!';
        const frac = r.t < 0 ? 1 - (-r.t - (n - 1)) : r.t / 0.8;
        g.font = `bold ${Math.round(64 + 30 * (1 - frac))}px ui-monospace, monospace`;
        g.lineWidth = 6; g.strokeStyle = '#111'; g.fillStyle = r.t < 0 ? '#ffffff' : '#7fe08a';
        g.strokeText(txt, w / 2, h * 0.42); g.fillText(txt, w / 2, h * 0.42);
      }
      if (f.bannerT > 0) {
        f.bannerT -= frameDt;
        g.font = 'bold 30px ui-monospace, monospace';
        g.lineWidth = 5; g.strokeStyle = '#111'; g.fillStyle = '#f7e06a';
        g.strokeText(f.banner, w / 2, h * 0.3); g.fillText(f.banner, w / 2, h * 0.3);
      }
    };

    const tick = (now: number) => {
      const frameDt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += frameDt;
      const r = race.current!;
      let steps = 0;
      while (acc >= DT && steps < 6) {
        acc -= DT; steps++;
        const Lh = keys.current.L || [...held.current.values()].includes('L');
        const Rh = keys.current.R || [...held.current.values()].includes('R');
        const both = (Lh && Rh) || keys.current.D;
        const input = { steer: both && !keys.current.D ? 0 : (Rh ? 1 : 0) - (Lh ? 1 : 0), drift: both, use: useNow.current };
        useNow.current = false;
        const before = r.t;
        r.events = [];
        step(r, input);
        if (before < 0 && Math.ceil(-r.t) !== f.lastCount) {
          f.lastCount = Math.ceil(-r.t);
          if (r.t < 0) { sfx('tap'); } else { sfx('score'); ticks(1); }
        }
        for (const e of r.events) onEvent(r, e);
      }
      if (acc > DT * 6) acc = 0;
      for (const p of f.parts) { p.x += p.vx * frameDt; p.y += p.vy * frameDt; p.vx *= 0.92; p.vy *= 0.92; p.life -= frameDt; }
      f.parts = f.parts.filter((p) => p.life > 0).slice(-300);
      draw(r, frameDt);
      saveT += frameDt;
      if (saveT > 2 && !r.done) { saveT = 0; persist(progRef.current, r); }
      if (r.done) { finishRace(r); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, mode, vp, ghost, onAchieve, onScore, persist, finishRace]);

  // Keyboard for desktop.
  useEffect(() => {
    const set = (e: KeyboardEvent, on: boolean) => {
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'a') keys.current.L = on;
      else if (k === 'ArrowRight' || k === 'd') keys.current.R = on;
      else if (k === 'ArrowDown' || k === 'Shift' || k === 's') keys.current.D = on;
      else if ((k === ' ' || k === 'ArrowUp' || k === 'w') && on) useNow.current = true;
      else return;
      e.preventDefault();
    };
    const dn = (e: KeyboardEvent) => set(e, true), up = (e: KeyboardEvent) => set(e, false);
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); };
  }, []);

  const down = (e: React.PointerEvent) => {
    if (mode === 'resume') { setMode('race'); return; }
    if (mode !== 'race') return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    held.current.set(e.pointerId, e.clientX < vp.w / 2 ? 'L' : 'R');
  };
  const up = (e: React.PointerEvent) => { held.current.delete(e.pointerId); };

  const choose = (d: string) => { const next = { ...prog, driver: d }; setProg(next); persist(next, null); sfx('tap'); };
  const pickTrack = (t: string) => { const next = { ...prog, track: t }; setProg(next); persist(next, null); sfx('tap'); };
  const cup = prog.cup;
  const cupTable = (pts: Record<string, number>) => Object.entries(pts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="game-crewkart-root" style={{ width: vp.w, height: vp.h }}>
      <div className="game-crewkart-stage" onPointerDown={down} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}>
        <canvas ref={canvas} style={{ width: vp.w, height: vp.h }} />
        {mode === 'race' && (
          <button
            className="game-crewkart-item"
            style={{ left: vp.w / 2 - 28 }}
            aria-label="Use item"
            onPointerDown={(e) => { e.stopPropagation(); useNow.current = true; }}
          />
        )}
      </div>
      {mode === 'menu' && (
        <div className="game-overlay game-crewkart-menu">
          <div className="game-crewkart-cols">
            <div>
              <h3>Driver</h3>
              <div className="game-crewkart-drivers">
                {DRIVERS.map((d) => (
                  <button key={d} className={`game-crewkart-driver${d === prog.driver ? ' on' : ''}`} style={{ borderColor: d === prog.driver ? KART_COLOR[d] : undefined }} onClick={() => choose(d)} aria-label={`Drive as ${d}`}>
                    <img src={sprite(d, d === prog.driver ? 'cheer' : 'idle')} alt="" />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <h3>Track</h3>
              <div className="game-crewkart-tracks">
                {TRACKS.map((t) => (
                  <button key={t.id} className={`game-crewkart-track${t.id === prog.track ? ' on' : ''}`} onClick={() => pickTrack(t.id)}>
                    <span className="game-crewkart-swatch" style={{ background: THEMES[t.id].road, borderColor: THEMES[t.id].kerb[1] }} />
                    <span>{t.name}</span>
                    <small>{prog.bests?.[t.id] ? fmtT(prog.bests[t.id]) : 'vs ' + t.crew.map(cap).join(', ')}</small>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="game-crewkart-go">
            <button className="chip" onClick={() => start(prog.track, null)}>Race {TRACKS.find((t) => t.id === prog.track)?.name}</button>
            <button className="chip" onClick={() => start(TRACKS[cup?.i ?? 0].id, cup ?? { i: 0, pts: {} })}>{cup ? `Cup: race ${cup.i + 1}/4` : 'Crew Cup (all 4)'}</button>
          </div>
          <p className="game-crewkart-dim">Hold left or right to steer. Hold both to drift, let go to boost. Tap the box up top for your item.{best !== undefined ? ` Best ${fmtT(best)}.` : ''}</p>
        </div>
      )}
      {mode === 'resume' && (
        <div className="game-overlay" onPointerDown={() => setMode('race')}>
          <img src={sprite(prog.driver, 'peek')} alt="" />
          <p>Paused{race.current ? ` on lap ${Math.max(1, race.current.karts[0].lapsDone)}, ${ordinal(place(race.current))}` : ''}. Tap to drive on.</p>
        </div>
      )}
      {mode === 'result' && result && (
        <div className="game-overlay game-crewkart-menu">
          <div className="game-crewkart-cols">
            <div>
              <img src={sprite(prog.driver, result.place === 1 ? 'dance' : result.place === 4 ? 'sit' : 'cheer')} alt="" />
              <p><b>{ordinal(result.place)}</b> in {fmtT(result.time)}</p>
              <p className="game-crewkart-dim">{result.laps.map((l, i) => `L${i + 1} ${l.toFixed(1)}`).join('  ')}</p>
            </div>
            <ol className="game-crewkart-table">
              {result.order.map((o, i) => (
                <li key={o.name} className={o.name === prog.driver ? 'me' : ''}>
                  <img src={sprite(o.name, 'idle')} alt="" /> {cap(o.name)} <span>{o.t !== null ? fmtT(o.t) : '—'}</span> {prog.cup || result.cupDone ? <small>+{CUP_POINTS[i]}</small> : null}
                </li>
              ))}
            </ol>
            {(cup || cupFinal) && (
              <ol className="game-crewkart-table">
                <li className="head">{result.cupDone ? 'Cup final' : `Cup after ${cup?.i}/4`}</li>
                {cupTable(result.cupDone && cupFinal ? cupFinal : cup!.pts).slice(0, 6).map(([n, p]) => (
                  <li key={n} className={n === prog.driver ? 'me' : ''}>{cap(n)} <span>{p}</span></li>
                ))}
              </ol>
            )}
          </div>
          <div className="game-crewkart-go">
            {cup && !result.cupDone && <button className="chip" onClick={() => start(TRACKS[cup.i].id, cup)}>Next: {TRACKS[cup.i].name}</button>}
            <button className="chip" onClick={() => start(TRACKS.find((t) => t.id === (race.current?.track ?? prog.track))?.id ?? 'garden', null)}>Race again</button>
            <button className="chip" onClick={() => { setCupFinal(null); setMode('menu'); }}>Menu</button>
          </div>
        </div>
      )}
    </div>
  );
}
