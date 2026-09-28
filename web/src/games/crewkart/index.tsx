import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameMeta, GameProps } from '../types';
import { sprite } from '../types';
import { sfx } from '../../economy/sound';
import { buzz, ticks } from '../../haptics';
import {
  CUP_POINTS, DT, HW, LAPS, N, TRACKS, V, buildTrack, ghostProg, ghostTime, linePoint, newRace, place, standings, step,
  steerFromDrag, steerFromTilt, wrapAng, type ItemKind, type Race,
} from './logic';
import { chaseCam, project, type Cam7 } from './mode7';
import { KART_COLOR, THEMES, drawItemIcon, drawMinimap, driverImg, fmtT, hash, ordinal } from './render';
import { drawBoxBB, drawFog, drawGround, drawKartRear, drawProp, drawSky, texture } from './scene';
import './style.css';

/** Crew Kart: a behind-the-kart racer in the style of SNES Mode 7. The track
 *  is a flat textured plane rolled out in perspective, rivals and boxes are
 *  scaled billboards. Gas is always on; drag one thumb (or tilt) to steer,
 *  hold DRIFT through a bend and let go for a mini-turbo. Score = your
 *  finishing time (every track is the same length, so times compare). The
 *  Crew Cup runs all four; the cup and any race in flight ride in the save. */
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
interface Save { driver: string; track: string; cup: Cup | null; race: Race | null; bests?: Record<string, number>; tut?: boolean; tilt?: boolean }
type Mode = 'menu' | 'race' | 'resume' | 'result';

const IH = 180; // internal rows; width follows the screen's aspect
const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const SPARK = (charge: number) => (charge >= 1.5 ? ['#ff9a2e', '#ffd36a'] : charge >= 0.6 ? ['#4aa3ff', '#bfe6ff'] : ['#e8e8e8', '#a0a0a0']);

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

/** Trackside props, fixed per track. */
const propsCache = new Map<string, Array<{ x: number; y: number; v: number }>>();
function propsFor(id: string) {
  let p = propsCache.get(id);
  if (p) return p;
  const tr = buildTrack(id);
  p = [];
  for (let i = 0; i < N; i += 9) {
    for (const side of [-1, 1]) {
      if (hash(i, side, 31) < 0.35) continue;
      const lat = side * (HW + 26 + hash(i, side, 32) * 50);
      const s = tr.s[i], t = tr.t[i];
      const x = s.x - t.y * lat, y = s.y + t.x * lat;
      // Keep props off every stretch of road, not just this one.
      let clear = true;
      for (let j = 0; j < N; j += 3) if (Math.hypot(tr.s[j].x - x, tr.s[j].y - y) < HW + 20) { clear = false; break; }
      if (clear) p.push({ x, y, v: hash(i, side, 33) });
    }
  }
  propsCache.set(id, p);
  return p;
}

interface Part { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string; s: number }
type Sprite = { z: number; draw: () => void };

export function Game({ save, onSave, onScore, onAchieve, paused, best, ghost }: GameProps<Save>) {
  const [prog, setProg] = useState<Save>(() => ({
    driver: save?.driver ?? 'pip', track: save?.track ?? 'garden', cup: save?.cup ?? null, race: null, bests: save?.bests ?? {}, tut: save?.tut ?? false, tilt: save?.tilt ?? false,
  }));
  const [mode, setMode] = useState<Mode>(save?.race && !save.race.done ? 'resume' : 'menu');
  const race = useRef<Race | null>(save?.race && !save.race.done ? save.race : null);
  const [result, setResult] = useState<{ time: number; place: number; order: Array<{ name: string; t: number | null }>; laps: number[]; cupDone?: boolean } | null>(null);
  const [tutOn, setTutOn] = useState(false);
  const [tiltNote, setTiltNote] = useState('');
  const vp = useViewport();
  const IW = Math.max(240, Math.min(420, Math.round((IH * vp.w) / vp.h)));
  const canvas = useRef<HTMLCanvasElement>(null);
  const hud = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ id: number; x0: number; y0: number; x: number } | null>(null);
  const keys = useRef({ L: false, R: false, D: false });
  const driftBtn = useRef(false);
  const useNow = useRef(false);
  const tilt = useRef<number | null>(null);
  const steerShown = useRef(0);
  const fx = useRef({ parts: [] as Part[], shake: 0, roulette: 0, banner: '', bannerT: 0, flash: 0, lastCount: 99 });
  const camA = useRef(0);
  const progRef = useRef(prog);
  progRef.current = prog;

  const persist = useCallback((p: Save, r: Race | null) => onSave({ ...p, race: r }), [onSave]);

  const start = (trackId: string, cup: Cup | null) => {
    const r = newRace(trackId, progRef.current.driver, (Date.now() & 0xffff) + 1);
    race.current = r;
    camA.current = r.karts[0].ang;
    fx.current = { ...fx.current, parts: [], banner: '', bannerT: 0, lastCount: 99, roulette: 0 };
    const next = { ...progRef.current, track: trackId, cup };
    setProg(next);
    persist(next, r);
    setResult(null);
    setTutOn(!next.tut);
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

  // Size the canvases: the game at a small internal resolution (scaled up
  // pixelated), the HUD at full resolution.
  useEffect(() => {
    const c = canvas.current, h = hud.current;
    if (c) { c.width = IW; c.height = IH; }
    if (h) { const dpr = Math.min(2, window.devicePixelRatio || 1); h.width = Math.round(vp.w * dpr); h.height = Math.round(vp.h * dpr); }
  }, [vp, mode, IW]);

  // Tilt steering.
  useEffect(() => {
    if (!prog.tilt) { tilt.current = null; return; }
    const on = (e: DeviceOrientationEvent) => {
      const ang = (screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) as number;
      const b = e.beta ?? 0, gm = e.gamma ?? 0;
      tilt.current = ang === 90 ? b : ang === 270 || ang === -90 ? -b : gm;
    };
    window.addEventListener('deviceorientation', on);
    return () => window.removeEventListener('deviceorientation', on);
  }, [prog.tilt]);

  // The loop: fixed steps, drawn every frame, stopped when paused.
  useEffect(() => {
    if (paused || mode !== 'race' || !race.current) return;
    const c = canvas.current!, hc = hud.current!;
    const g = c.getContext('2d')!, hg = hc.getContext('2d')!;
    const W = IW, H = IH;
    const img = g.createImageData(W, H);
    const buf = new Uint32Array(img.data.buffer);
    let raf = 0, last = performance.now(), acc = 0, saveT = 0, scored = false;
    const calm = reduced();
    const f = fx.current;
    const r0 = race.current;
    const tr = buildTrack(r0.track);
    const tex = texture(r0.track);
    const props = propsFor(r0.track);
    let cam: Cam7 = chaseCam(W, H, r0.karts[0].x, r0.karts[0].y, camA.current);
    const burstAt = (wx: number, wy: number, n: number, colors: string[], sp = 60) => {
      const p = project(cam, wx, wy, 6);
      if (p.z <= 0) return;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = sp * (0.4 + Math.random());
        f.parts.push({ x: p.sx, y: p.sy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, life: 0.5 + Math.random() * 0.3, max: 0.8, c: colors[i % colors.length], s: 2 });
      }
    };
    const onEvent = (r: Race, e: string) => {
      const [kind, who, extra] = e.split(':');
      const me = who === '0';
      const k = r.karts.find((q) => String(q.id) === who);
      if (kind === 'bump' && me) { sfx('bounce'); ticks(1); f.shake = Math.max(f.shake, 3); if (k) burstAt(k.x, k.y, 6, ['#d8cfc0', '#a89f90']); }
      else if (kind === 'hit') {
        if (k) burstAt(k.x, k.y, 14, ['#ffffff', '#f7e06a', '#c9954a'], 90);
        if (me) { sfx('crash'); ticks(3); f.shake = 7; f.banner = extra === 'oil' ? 'Oil!' : 'Shelled!'; f.bannerT = 1; }
        else sfx('hit');
        if (r.karts[0].hits >= 2) onAchieve('shell');
      } else if (kind === 'block' && k) { burstAt(k.x, k.y, 10, ['#6ec8ff', '#bfe6ff']); if (me) sfx('bounce'); }
      else if (kind === 'boost' && me) {
        sfx('whoosh');
        if (extra !== 'feather') {
          ticks(2); f.flash = extra === 'big' ? 0.3 : 0.15;
          f.banner = extra === 'big' ? 'TURBO!' : 'Mini-turbo'; f.bannerT = 0.7;
        }
        if (extra === 'big') onAchieve('drift');
      } else if (kind === 'box' && k) burstAt(k.x, k.y, 10, ['#ff6b6b', '#f7e06a', '#46e08a', '#4aa3ff'], 80);
      else if (kind === 'item' && me) { sfx('coin'); f.roulette = 0.6; }
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

    const readSteer = () => {
      if (keys.current.L || keys.current.R) return (keys.current.R ? 1 : 0) - (keys.current.L ? 1 : 0);
      const d = drag.current;
      if (d) return steerFromDrag(d.x - d.x0, Math.max(60, vp.w * 0.16));
      if (tilt.current !== null) return steerFromTilt(tilt.current);
      return 0;
    };

    const draw = (r: Race, frameDt: number) => {
      const me = r.karts[0];
      // Camera: chases the kart's travel direction, so drifts show the kart
      // turned against the road.
      if (me.spin <= 0) camA.current += wrapAng(me.mv - camA.current) * Math.min(1, frameDt * 6);
      cam = chaseCam(W, H, me.x, me.y, camA.current);
      // Ground, then sky over the top rows, then haze.
      drawGround(buf, cam, tex);
      const top = Math.floor(cam.hor) + 1;
      g.putImageData(img, 0, 0, 0, top, W, H - top);
      drawSky(g, r.track, cam, r.t);
      drawFog(g, r.track, cam);
      // Billboards, far to near.
      const list: Sprite[] = [];
      const near = (p: { z: number; sx: number }) => p.z > 6 && p.z < 1500 && p.sx > -60 && p.sx < W + 60;
      for (const q of props) {
        const p = project(cam, q.x, q.y);
        if (near(p)) list.push({ z: p.z, draw: () => drawProp(g, r.track, p.sx, p.sy, p.s * 0.9, q.v, r.t) });
      }
      for (const b of r.boxes) {
        if (b.down > 0) continue;
        const s = tr.s[b.i], t = tr.t[b.i];
        const p = project(cam, s.x - t.y * b.lat, s.y + t.x * b.lat);
        if (near(p)) list.push({ z: p.z, draw: () => drawBoxBB(g, p.sx, p.sy, p.s * 0.9, r.t + b.lat * 0.01) });
      }
      for (const o of r.oils) {
        const p = project(cam, o.x, o.y);
        if (near(p)) list.push({ z: p.z + 1000, draw: () => {
          const w = Math.max(2, Math.round(26 * p.s)), h = Math.max(1, Math.round(26 * p.s * (cam.h / p.z)));
          g.fillStyle = '#1c1c24'; g.fillRect(Math.round(p.sx - w / 2), Math.round(p.sy - h / 2), w, h);
          g.fillStyle = '#5a4aa8'; g.fillRect(Math.round(p.sx - w / 4), Math.round(p.sy - h / 3), Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 4)));
        } });
      }
      for (const s of r.shells) {
        const p = project(cam, s.x, s.y);
        if (near(p)) list.push({ z: p.z, draw: () => {
          const u = p.s * 0.8, w = Math.max(2, Math.round(10 * u)), h = Math.max(2, Math.round(8 * u));
          g.fillStyle = '#c9954a'; g.fillRect(Math.round(p.sx - w / 2), Math.round(p.sy - h), w, h);
          g.fillStyle = '#8b5a2c'; g.fillRect(Math.round(p.sx - 1), Math.round(p.sy - h), Math.max(1, Math.round(u * 1.5)), h);
        } });
      }
      if (ghost) {
        const gpr = ghostProg(r.t, ghost.target);
        const gp = linePoint(tr, gpr < 0 ? N - 2 : gpr);
        const p = project(cam, gp.x, gp.y);
        if (near(p)) list.push({ z: p.z, draw: () => {
          g.save();
          g.globalAlpha = 0.4;
          g.shadowColor = 'rgba(255,255,255,0.95)'; g.shadowBlur = 6;
          drawKartRear(g, p.sx, p.sy, p.s * 0.75, '#ffffff', driverImg(ghost.sprite), Math.sin(wrapAng(gp.ang - cam.a)) * 2, calm ? 0 : 1 + Math.sin(r.t * 4) * 1.5);
          g.restore();
          if (p.s > 0.5) {
            g.save(); g.globalAlpha = 0.75; g.fillStyle = '#fff'; g.font = '8px ui-monospace, monospace'; g.textAlign = 'center';
            g.fillText(ghost.name, Math.round(p.sx), Math.round(p.sy - 30 * p.s)); g.restore();
          }
        } });
      }
      const steer = steerShown.current;
      for (const k of r.karts) {
        const p = project(cam, k.x, k.y);
        if (!near(p)) continue;
        const mine = k.id === 0;
        const yaw = mine ? Math.sin(wrapAng(k.ang - cam.a)) * 2.5 + steer * 0.5 : Math.sin(wrapAng(k.ang - cam.a)) * 2;
        const pose = k.spin > 0 ? 'look1' : k.finish !== null && mine ? 'cheer' : 'idle';
        const hop = calm ? 0 : k.boost > 0 ? Math.abs(Math.sin(r.t * 30)) * 0.8 : k.drift ? Math.abs(Math.sin(r.t * 14)) * 0.6 : 0;
        list.push({ z: p.z, draw: () => {
          const u = p.s * 0.75;
          if (k.shield > 0) {
            g.fillStyle = `rgba(110,200,255,${0.25 + 0.15 * Math.sin(r.t * 12)})`;
            g.fillRect(Math.round(p.sx - 16 * u), Math.round(p.sy - 32 * u), Math.round(32 * u), Math.round(32 * u));
          }
          drawKartRear(g, p.sx, p.sy, u, KART_COLOR[k.name] ?? '#ccc', driverImg(k.name, pose), yaw, hop);
          if (k.boost > 0) {
            g.fillStyle = Math.random() < 0.5 ? '#f7e06a' : '#f28c28';
            const fl = (2 + Math.random() * 3) * u;
            g.fillRect(Math.round(p.sx - 5.5 * u), Math.round(p.sy - 4 * u), Math.max(1, Math.round(2 * u)), Math.round(fl));
            g.fillRect(Math.round(p.sx + 3.5 * u), Math.round(p.sy - 4 * u), Math.max(1, Math.round(2 * u)), Math.round(fl));
          }
          if (k.drift && Math.random() < 0.9) {
            const cols = SPARK(k.charge);
            for (const side of [-9, 9]) {
              f.parts.push({ x: p.sx + side * u, y: p.sy - u, vx: (Math.random() - 0.5) * 50 - k.drift * 25, vy: -20 - Math.random() * 40, life: 0.22, max: 0.22, c: cols[Math.random() < 0.5 ? 0 : 1], s: Math.max(2, Math.round(u * 2.2)) });
            }
          }
        } });
      }
      list.sort((a, b) => b.z - a.z);
      for (const s of list) s.draw();
      for (const p of f.parts) {
        g.globalAlpha = Math.max(0, p.life / p.max);
        g.fillStyle = p.c;
        g.fillRect(Math.round(p.x - p.s / 2), Math.round(p.y - p.s / 2), p.s, p.s);
      }
      g.globalAlpha = 1;
      if (f.flash > 0) { g.fillStyle = `rgba(255,220,140,${f.flash})`; g.fillRect(0, 0, W, H); f.flash = Math.max(0, f.flash - frameDt); }
      // Shake the whole picture (not with reduced motion).
      f.shake = Math.max(0, f.shake - frameDt * 25);
      c.style.transform = !calm && f.shake > 0.2 ? `translate(${((Math.random() - 0.5) * f.shake).toFixed(1)}px,${((Math.random() - 0.5) * f.shake).toFixed(1)}px)` : '';
      drawHud(r, frameDt);
    };

    const drawHud = (r: Race, frameDt: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = vp.w, h = vp.h;
      hg.setTransform(dpr, 0, 0, dpr, 0, 0);
      hg.clearRect(0, 0, w, h);
      hg.imageSmoothingEnabled = false;
      const me = r.karts[0];
      const pl = place(r);
      hg.textAlign = 'left';
      hg.fillStyle = 'rgba(10,12,20,0.55)';
      hg.fillRect(8, 8, 118, ghost ? 96 : 76);
      hg.fillStyle = pl === 1 ? '#f7e06a' : '#ffffff';
      hg.font = 'bold 30px ui-monospace, monospace';
      hg.fillText(ordinal(pl), 16, 40);
      const ow = hg.measureText(ordinal(pl)).width;
      hg.font = 'bold 13px ui-monospace, monospace';
      hg.fillStyle = '#ffffff';
      hg.fillText('/4', 20 + ow, 40);
      hg.fillText(`Lap ${Math.max(1, Math.min(LAPS, me.lapsDone))}/${LAPS}`, 16, 58);
      hg.fillText(fmtT(Math.max(0, me.finish ?? r.t)), 16, 75);
      if (ghost && r.t > 0) {
        const at = (Math.max(0, me.prog) / (LAPS * N)) * ghost.target;
        const gap = (me.finish ?? r.t) - at;
        hg.fillStyle = gap <= 0 ? '#7fe08a' : '#ff9a8a';
        hg.fillText(`${ghost.name} ${gap <= 0 ? '-' : '+'}${Math.abs(gap).toFixed(1)}`, 16, 94);
      }
      // Minimap, clear of the crew corner (top right).
      const mw = Math.min(120, w * 0.15), mh = mw * 0.75;
      let gpt: { x: number; y: number } | null = null;
      if (ghost) { const gpr = ghostProg(r.t, ghost.target); gpt = linePoint(tr, gpr < 0 ? N - 2 : gpr); }
      drawMinimap(hg, tr, r, gpt, w - mw - 60, 12, mw, mh);
      // Speed bar under the minimap.
      hg.fillStyle = 'rgba(10,12,20,0.55)'; hg.fillRect(w - mw - 64, 18 + mh, mw + 8, 8);
      hg.fillStyle = me.boost > 0 ? '#f28c28' : '#7fe08a';
      hg.fillRect(w - mw - 62, 20 + mh, Math.min(1, me.spd / (V * 1.45)) * (mw + 4), 4);
      // Buttons: DRIFT (bottom right, with its charge ring) and ITEM.
      const db = btnRects(w, h);
      const held = driftBtn.current || keys.current.D;
      const cols = SPARK(me.charge);
      hg.fillStyle = held ? 'rgba(255,255,255,0.32)' : 'rgba(10,12,20,0.5)';
      hg.fillRect(db.drift.x, db.drift.y, db.drift.s, db.drift.s);
      hg.strokeStyle = me.drift ? cols[0] : 'rgba(255,255,255,0.75)';
      hg.lineWidth = 3;
      hg.strokeRect(db.drift.x + 1.5, db.drift.y + 1.5, db.drift.s - 3, db.drift.s - 3);
      if (me.drift) {
        const cf = Math.min(1, me.charge / 1.5);
        hg.fillStyle = cols[0];
        hg.fillRect(db.drift.x + 6, db.drift.y + db.drift.s - 12, (db.drift.s - 12) * cf, 5);
      }
      hg.fillStyle = '#ffffff'; hg.textAlign = 'center'; hg.font = 'bold 15px ui-monospace, monospace';
      hg.fillText('DRIFT', db.drift.x + db.drift.s / 2, db.drift.y + db.drift.s / 2 + 5);
      f.roulette = Math.max(0, f.roulette - frameDt);
      const shown: ItemKind | null = f.roulette > 0 ? (['feather', 'shell', 'oil', 'shield'] as ItemKind[])[Math.floor(f.roulette * 20) % 4] : me.item;
      hg.fillStyle = 'rgba(10,12,20,0.5)';
      hg.fillRect(db.item.x, db.item.y, db.item.s, db.item.s);
      hg.strokeStyle = me.item ? '#f7e06a' : 'rgba(255,255,255,0.4)';
      hg.lineWidth = 2;
      hg.strokeRect(db.item.x + 1, db.item.y + 1, db.item.s - 2, db.item.s - 2);
      if (shown) drawItemIcon(hg, shown, db.item.x + 8, db.item.y + 6, db.item.s - 16);
      else { hg.fillStyle = 'rgba(255,255,255,0.5)'; hg.font = 'bold 11px ui-monospace, monospace'; hg.fillText('ITEM', db.item.x + db.item.s / 2, db.item.y + db.item.s / 2 + 4); }
      // Steering indicator: a wheel at the bottom centre that turns with you,
      // and the thumb's anchor and offset while dragging.
      const st = steerShown.current;
      const wr = 20, wx = 16 + wr + 8, wy = h - wr - 24;
      hg.save();
      hg.translate(wx, wy); hg.rotate(st * 1.6);
      hg.strokeStyle = 'rgba(255,255,255,0.8)'; hg.lineWidth = 4;
      hg.beginPath(); hg.arc(0, 0, wr, 0, Math.PI * 2); hg.stroke();
      hg.fillStyle = 'rgba(255,255,255,0.8)';
      hg.fillRect(-wr, -2, wr * 2, 4); hg.fillRect(-2, 0, 4, wr);
      hg.fillStyle = '#f7e06a'; hg.fillRect(-3, -wr - 3, 6, 6);
      hg.restore();
      const d = drag.current;
      if (d) {
        const span = Math.max(60, vp.w * 0.16);
        const dx = Math.max(-span, Math.min(span, d.x - d.x0));
        hg.strokeStyle = 'rgba(255,255,255,0.45)'; hg.lineWidth = 2;
        hg.beginPath(); hg.arc(d.x0, d.y0, 22, 0, Math.PI * 2); hg.stroke();
        hg.fillStyle = 'rgba(255,255,255,0.25)'; hg.fillRect(d.x0 - span, d.y0 - 2, span * 2, 4);
        hg.fillStyle = 'rgba(247,224,106,0.9)'; hg.fillRect(Math.min(d.x0, d.x0 + dx), d.y0 - 2, Math.abs(dx), 4);
        hg.beginPath(); hg.arc(d.x0 + dx, d.y0, 12, 0, Math.PI * 2); hg.fill();
      }
      // Countdown and banners.
      hg.textAlign = 'center';
      if (r.t < 0.8) {
        const n = Math.ceil(-r.t);
        const txt = r.t < 0 ? String(n) : 'GO!';
        const frac = r.t < 0 ? 1 - (-r.t - (n - 1)) : r.t / 0.8;
        hg.font = `bold ${Math.round(64 + 30 * (1 - frac))}px ui-monospace, monospace`;
        hg.lineWidth = 6; hg.strokeStyle = '#111'; hg.fillStyle = r.t < 0 ? '#ffffff' : '#7fe08a';
        hg.strokeText(txt, w / 2, h * 0.56); hg.fillText(txt, w / 2, h * 0.56);
      }
      if (f.bannerT > 0) {
        f.bannerT -= frameDt;
        hg.font = 'bold 28px ui-monospace, monospace';
        hg.lineWidth = 5; hg.strokeStyle = '#111'; hg.fillStyle = '#f7e06a';
        hg.strokeText(f.banner, w / 2, h * 0.5); hg.fillText(f.banner, w / 2, h * 0.5);
      }
    };

    const tick = (now: number) => {
      const frameDt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += frameDt;
      const r = race.current!;
      let steps = 0;
      const steer = readSteer();
      steerShown.current += (steer - steerShown.current) * Math.min(1, frameDt * 18);
      while (acc >= DT && steps < 6) {
        acc -= DT; steps++;
        const input = { steer, drift: driftBtn.current || keys.current.D, use: useNow.current };
        useNow.current = false;
        const before = r.t;
        r.events = [];
        step(r, input);
        if (before < 0 && Math.ceil(-r.t) !== f.lastCount) {
          f.lastCount = Math.ceil(-r.t);
          if (r.t < 0) sfx('tap'); else { sfx('score'); ticks(1); }
        }
        for (const e of r.events) onEvent(r, e);
      }
      if (acc > DT * 6) acc = 0;
      for (const p of f.parts) { p.x += p.vx * frameDt; p.y += p.vy * frameDt; p.vx *= 0.9; p.vy = p.vy * 0.9 + 60 * frameDt; p.life -= frameDt; }
      f.parts = f.parts.filter((p) => p.life > 0).slice(-240);
      draw(r, frameDt);
      if (r.t > 6 && !progRef.current.tut) {
        const next = { ...progRef.current, tut: true };
        setProg(next); progRef.current = next; setTutOn(false);
      }
      saveT += frameDt;
      if (saveT > 2 && !r.done) { saveT = 0; persist(progRef.current, r); }
      if (r.done) { finishRace(r); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, mode, vp, IW, ghost, onAchieve, onScore, persist, finishRace]);

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
    if (mode !== 'race' || drag.current) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const box = e.currentTarget.getBoundingClientRect();
    drag.current = { id: e.pointerId, x0: e.clientX - box.left, y0: e.clientY - box.top, x: e.clientX - box.left };
  };
  const move = (e: React.PointerEvent) => { if (drag.current?.id === e.pointerId) drag.current.x = e.clientX - e.currentTarget.getBoundingClientRect().left; };
  const up = (e: React.PointerEvent) => { if (drag.current?.id === e.pointerId) drag.current = null; };

  const choose = (d: string) => { const next = { ...prog, driver: d }; setProg(next); persist(next, null); sfx('tap'); };
  const pickTrack = (t: string) => { const next = { ...prog, track: t }; setProg(next); persist(next, null); sfx('tap'); };
  const setTilt = async (on: boolean) => {
    setTiltNote('');
    if (on) {
      const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
      if (!DOE) { setTiltNote('No tilt sensor here; drag it is.'); return; }
      if (typeof DOE.requestPermission === 'function') {
        try {
          if ((await DOE.requestPermission()) !== 'granted') { setTiltNote('Tilt was not allowed; drag it is.'); return; }
        } catch { setTiltNote('Tilt was not allowed; drag it is.'); return; }
      }
    }
    const next = { ...prog, tilt: on }; setProg(next); persist(next, null); sfx('tap');
  };
  const cup = prog.cup;
  const cupTable = (pts: Record<string, number>) => Object.entries(pts).sort((a, b) => b[1] - a[1]);
  const br = btnRects(vp.w, vp.h);

  return (
    <div className="game-crewkart-root" style={{ width: vp.w, height: vp.h }}>
      <div className="game-crewkart-stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}>
        <canvas ref={canvas} className="game-crewkart-view" style={{ width: vp.w, height: vp.h }} />
        <canvas ref={hud} className="game-crewkart-hud" style={{ width: vp.w, height: vp.h }} />
        {mode === 'race' && (
          <>
            <button
              className="game-crewkart-btn"
              style={{ left: br.drift.x, top: br.drift.y, width: br.drift.s, height: br.drift.s }}
              aria-label="Drift"
              onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); driftBtn.current = true; }}
              onPointerUp={(e) => { e.stopPropagation(); driftBtn.current = false; }}
              onPointerCancel={() => { driftBtn.current = false; }}
              onLostPointerCapture={() => { driftBtn.current = false; }}
            />
            <button
              className="game-crewkart-btn"
              style={{ left: br.item.x, top: br.item.y, width: br.item.s, height: br.item.s }}
              aria-label="Use item"
              onPointerDown={(e) => { e.stopPropagation(); useNow.current = true; }}
            />
          </>
        )}
        {mode === 'race' && tutOn && (
          <div className="game-crewkart-tut">
            <div className="game-crewkart-tut-drag"><span /></div>
            <p>{prog.tilt ? 'Tilt to steer' : 'Drag to steer'} · hold DRIFT on turns</p>
            <small>Gas is always on. Let go of DRIFT for a mini-turbo.</small>
          </div>
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
              <h3 className="game-crewkart-gap">Steering</h3>
              <div className="game-crewkart-go">
                <button className={`chip${!prog.tilt ? ' game-crewkart-on' : ''}`} onClick={() => setTilt(false)}>Drag</button>
                <button className={`chip${prog.tilt ? ' game-crewkart-on' : ''}`} onClick={() => setTilt(true)}>Tilt</button>
              </div>
              {tiltNote && <p className="game-crewkart-dim">{tiltNote}</p>}
            </div>
            <div>
              <h3>Track</h3>
              <div className="game-crewkart-tracks">
                {TRACKS.map((t, i) => (
                  <button key={t.id} className={`game-crewkart-track${t.id === prog.track ? ' on' : ''}`} onClick={() => pickTrack(t.id)}>
                    <span className="game-crewkart-swatch" style={{ background: THEMES[t.id].road, borderColor: THEMES[t.id].kerb[1] }} />
                    <span>{t.name}{i === 0 ? ' (easy)' : ''}</span>
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
          <p className="game-crewkart-dim">Gas is always on. {prog.tilt ? 'Tilt the phone' : 'Drag a thumb left or right'} to steer; hold DRIFT through a bend and let go for a turbo. ITEM uses what you picked up.{best !== undefined ? ` Best ${fmtT(best)}.` : ''}</p>
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
                  <img src={sprite(o.name, 'idle')} alt="" /> {cap(o.name)} <span>{o.t !== null ? fmtT(o.t) : '-'}</span> {prog.cup || result.cupDone ? <small>+{CUP_POINTS[i]}</small> : null}
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

/** DRIFT sits bottom right (the crew face lives top right), ITEM beside it. */
function btnRects(w: number, h: number) {
  const s = Math.round(Math.min(92, Math.max(70, h * 0.24)));
  const drift = { x: w - s - 18, y: h - s - 16, s };
  const is = Math.round(s * 0.72);
  const item = { x: drift.x - is - 14, y: h - is - 16, s: is };
  return { drift, item };
}
