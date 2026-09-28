import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameMeta, GameProps } from '../types';
import { sprite } from '../types';
import { sfx } from '../../economy/sound';
import { buzz, ticks } from '../../haptics';
import { WIDTH, PERFECT, applyPower, base, drop, ghostScore, grow, powerFor, skyPhase, slide, sway, windy, type Block, type Buffs, type Power } from './logic';
import './style.css';

/** Stack: perch planks slide across; tap to drop. Whatever hangs over is
 *  sliced off; a perfect drop keeps the full plank. A crew member rides the top.
 *  Wave 3: windy levels that sway the tower, power-up planks, perfect streaks
 *  that grow the plank back, and a sky that runs from day to space. */
export const meta: GameMeta = {
  id: 'stack',
  name: 'Stack',
  blurb: 'Tap to drop the plank. Build the tallest perch in the yard.',
  host: 'bram',
  pack: 'quick',
  achievements: [
    { id: 'ten', name: 'Treehouse', says: 'Stack 10 planks.' },
    { id: 'twenty-five', name: 'Lookout', says: 'Stack 25 planks.' },
    { id: 'fifty', name: 'Above the clouds', says: 'Stack 50 planks.' },
    { id: 'perfect-5', name: 'Steady wing', says: 'Five perfect drops in a row.' },
    { id: 'space', name: 'Orbit', says: 'Stack 70 planks and reach the stars.' },
    { id: 'windy-perfect', name: 'Into the wind', says: 'Land a perfect drop on a windy level.' },
    { id: 'power-3', name: 'Tool belt', says: 'Catch three power-up planks in one tower.' },
  ],
  ghostScore,
  safeCorner: 'tr',
};

const RIDERS = ['bram', 'pip', 'wren', 'moss', 'fig', 'nell', 'juno', 'rue', 'bly', 'tuck', 'otto', 'ollie'];
const BH = 22;
const POWER_LABEL: Record<Power, string> = { grow: 'WIDE', slow: 'SLOW', magnet: 'MAGNET' };
const POWER_SAYS: Record<Power, string> = { grow: 'Wider plank!', slow: 'Slow planks x5', magnet: 'Magnet x3' };
interface Save { tower: Block[]; combo: number; buffs?: Buffs; powers?: number }
interface Cut { id: number; x: number; w: number; level: number }
interface Spark { id: number; x: number; y: number; dx: number; dy: number }
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
let uid = 1;

export function Game({ save, onSave, onScore, onAchieve, paused, best, ghost }: GameProps<Save>) {
  const [s, setS] = useState<Save>(() => save ?? { tower: [base()], combo: 0 });
  const [started, setStarted] = useState(!!save);
  const [over, setOver] = useState(false);
  const [x, setX] = useState(-75);
  const [off, setOff] = useState(0);
  const [flash, setFlash] = useState(0);
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [sparks, setSparks] = useState<Spark[]>([]);
  const [callout, setCallout] = useState<{ id: number; text: string } | null>(null);
  const mv = useRef<{ x: number; dir: 1 | -1 }>({ x: -75, dir: 1 });
  const offRef = useRef(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const top = s.tower[s.tower.length - 1];
  const height = s.tower.length - 1;
  const buffs = s.buffs ?? { slow: 0, magnet: 0 };
  const power = powerFor(s.tower.length);
  const isWindy = windy(height);

  const stageW = Math.min(window.innerWidth - 24, 380);
  const stageH = Math.min(Math.max(window.innerHeight - 230, 360), 560);
  const k = stageW / WIDTH;

  useEffect(() => {
    if (paused || over || !started) return;
    let raf = 0, last = performance.now();
    const step = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      mv.current = slide(mv.current.x, mv.current.dir, top.w, dt, height, buffs.slow > 0 ? 0.6 : 1);
      setX(mv.current.x);
      const target = reduced() ? sway(height, t / 1000) * 0.6 : sway(height, t / 1000);
      offRef.current += (target - offRef.current) * Math.min(1, dt * 5);
      setOff(offRef.current);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [paused, over, started, top.w, height, buffs.slow]);

  useEffect(() => {
    if (!callout) return;
    const t = setTimeout(() => setCallout(null), 1000);
    return () => clearTimeout(t);
  }, [callout]);

  const shakeStage = (a: number) => {
    if (reduced()) return;
    stageRef.current?.animate?.([
      { transform: 'none' }, { transform: `translate(${-a}px, ${a / 2}px)` }, { transform: `translate(${a}px, ${-a / 2}px)` }, { transform: 'none' },
    ], { duration: 240, easing: 'ease-out' });
  };

  const tap = () => {
    if (paused || over) return;
    if (!started) { setStarted(true); sfx('tap'); return; }
    const sw = offRef.current;
    const r = drop(top, mv.current.x - sw, top.w, buffs.magnet > 0 ? 18 : PERFECT);
    if (r.cut) { const c = { id: uid++, x: r.cut.x + sw, w: r.cut.w, level: s.tower.length }; setCuts((cs) => [...cs.slice(-3), c]); }
    if (!r.block) {
      setOver(true);
      onScore(height);
      onSave(null);
      buzz('fail'); sfx('crash'); shakeStage(6);
      return;
    }
    const combo = r.perfect ? s.combo + 1 : 0;
    let block = r.perfect ? grow(r.block, combo) : r.block;
    let nb: Buffs = { slow: Math.max(0, buffs.slow - 1), magnet: Math.max(0, buffs.magnet - 1) };
    let powers = s.powers ?? 0;
    if (power) {
      const p = applyPower(power, block, nb);
      block = p.block; nb = p.buffs; powers++;
      setCallout({ id: uid++, text: POWER_SAYS[power] });
      ticks(3); sfx('coin');
      if (powers >= 3) onAchieve('power-3');
    } else if (r.perfect) {
      ticks(2); sfx('score');
      if (combo >= 3) setCallout({ id: uid++, text: block.w > r.block.w ? `Perfect x${combo}, grows!` : `Perfect x${combo}` });
    } else {
      ticks(1); sfx('hit');
      if ((r.cut?.w ?? 0) > top.w * 0.4) shakeStage(3);
    }
    if (r.perfect) {
      setFlash((f) => f + 1);
      if (isWindy) onAchieve('windy-perfect');
      if (!reduced()) {
        const cx = (block.x + block.w / 2) * k;
        const add = Array.from({ length: 10 }, (_, i) => {
          const a = Math.PI * (i / 9);
          return { id: uid++, x: cx, y: 0, dx: Math.cos(a) * (block.w * k * 0.6 + 10), dy: Math.sin(a) * 30 + 10 };
        });
        setSparks(add);
        setTimeout(() => setSparks((sp) => sp.filter((p) => !add.includes(p))), 650);
      }
    }
    const next: Save = { tower: [...s.tower, block], combo, buffs: nb, powers };
    const h = next.tower.length - 1;
    if (h >= 10) onAchieve('ten');
    if (h >= 25) onAchieve('twenty-five');
    if (h >= 50) onAchieve('fifty');
    if (h >= 70) onAchieve('space');
    if (next.combo >= 5) onAchieve('perfect-5');
    if (ghost && h === ghost.target + 1) { setCallout({ id: uid++, text: `Past ${ghost.name}'s ghost!` }); sfx('win'); buzz('pass'); }
    const fromRight = h % 2 === 1;
    mv.current = { x: fromRight ? WIDTH - block.w * 0.5 : -block.w * 0.5, dir: fromRight ? -1 : 1 };
    setX(mv.current.x);
    setS(next);
    onSave(next);
  };

  const restart = () => {
    mv.current = { x: -75, dir: 1 };
    offRef.current = 0;
    setX(-75); setOff(0); setCuts([]); setSparks([]); setOver(false); setStarted(true);
    setS({ tower: [base()], combo: 0 });
    sfx('whoosh');
  };

  const ground = 40;
  const cam = Math.max(0, (s.tower.length + 1) * BH - stageH * 0.55);
  const yOf = (level: number) => ground + level * BH - cam;
  const rider = RIDERS[Math.floor(height / 10) % RIDERS.length];
  const hue = (i: number) => `hsl(${(28 + i * 9) % 360} 45% ${48 + (i % 2) * 6}%)`;
  const sky = skyPhase(height);
  const stars = useMemo(() => Array.from({ length: 40 }, (_, i) => ({ x: (i * 97.3) % 100, y: (i * 53.7) % 100, big: i % 7 === 0 })), []);
  const clouds = useMemo(() => [{ at: 4, x: 10, w: 90 }, { at: 9, x: 60, w: 70 }, { at: 15, x: 25, w: 110 }, { at: 22, x: 70, w: 80 }, { at: 31, x: 5, w: 100 }, { at: 44, x: 50, w: 90 }], []);
  const shift = off * k;

  // The ghost's height line: in view, or pinned to the top edge when it's above.
  const gY = ghost ? yOf(ghost.target) + BH : 0;
  const gPinned = ghost && gY > stageH - 30;
  const gPassed = ghost && height > ghost.target;

  return (
    <div className="game-stack-wrap">
      <div className="game-score">Height: <b>{height}</b>{best !== undefined && <span> · best {best}</span>}{s.combo >= 2 && <span> · perfect x{s.combo}</span>}</div>
      <div className="game-stack-buffs">
        {isWindy && <span className="game-stack-buff game-stack-wind">Windy</span>}
        {buffs.slow > 0 && <span className="game-stack-buff">Slow {buffs.slow}</span>}
        {buffs.magnet > 0 && <span className="game-stack-buff">Magnet {buffs.magnet}</span>}
      </div>
      <div ref={stageRef} className="game-stack-stage" style={{ width: stageW, height: stageH }} onPointerDown={tap}>
        <div className="game-stack-layer game-stack-day" style={{ opacity: sky.day }} />
        <div className="game-stack-layer game-stack-dusk" style={{ opacity: sky.dusk }} />
        <div className="game-stack-layer game-stack-night" style={{ opacity: sky.night }} />
        <div className="game-stack-layer game-stack-space" style={{ opacity: sky.space }} />
        {sky.night + sky.space > 0.05 && stars.map((st, i) => (
          <span key={i} className={`game-stack-star${st.big ? ' game-stack-big' : ''}`} style={{ left: `${st.x}%`, top: `${st.y}%`, opacity: Math.min(1, sky.night + sky.space), animationDelay: `${(i % 5) * 0.4}s` }} />
        ))}
        {sky.day + sky.dusk > 0.3 && <div className="game-stack-sun" style={{ bottom: stageH * 0.55 - height * 6, opacity: sky.day + sky.dusk * 0.8, background: sky.dusk > sky.day ? '#f08a4b' : '#ffe27a' }} />}
        {clouds.map((c, i) => {
          const y = ground + c.at * BH - cam * 0.7;
          if (y < -30 || y > stageH) return null;
          return <div key={i} className="game-stack-cloud" style={{ left: `${c.x}%`, width: c.w, bottom: y, opacity: 0.85 - sky.night * 0.6 }} />;
        })}
        {cam < ground && <div className="game-stack-ground" style={{ height: ground - cam }} />}
        <div className="game-stack-tower" style={{ transform: `translateX(${shift}px)` }}>
          {s.tower.map((b, i) => {
            const y = yOf(i);
            if (y < -BH || y > stageH) return null;
            return <div key={i} className={`game-stack-block${i > 0 && i === height ? ' game-stack-land' : ''}`} style={{ left: b.x * k, width: b.w * k, bottom: y, height: BH, background: hue(i) }} />;
          })}
          {flash > 0 && <div key={flash} className="game-stack-flash" style={{ left: top.x * k - 6, width: top.w * k + 12, bottom: yOf(height) - 3, height: BH + 6 }} />}
          {sparks.map((p) => <span key={p.id} className="game-stack-spark" style={{ left: p.x, bottom: yOf(height) + BH / 2, ['--dx' as string]: `${p.dx}px`, ['--dy' as string]: `${-p.dy}px` }} />)}
          <img className="game-stack-rider" src={sprite(rider, over ? 'sleep' : flash && s.combo > 0 ? 'cheer' : 'sit')} alt="" style={{ left: (top.x + top.w / 2) * k - 18, bottom: yOf(height) + BH - 4 }} />
        </div>
        {cuts.map((c) => <div key={c.id} className="game-stack-cut" style={{ left: c.x * k, width: c.w * k, bottom: yOf(c.level), height: BH, background: hue(c.level) }} />)}
        {started && !over && (
          <div className={`game-stack-block game-stack-moving${power ? ` game-stack-power game-stack-p-${power}` : ''}`} style={{ left: x * k, width: top.w * k, bottom: yOf(s.tower.length), height: BH, background: power ? undefined : hue(s.tower.length) }}>
            {power && <span>{POWER_LABEL[power]}</span>}
          </div>
        )}
        {ghost && (
          <div className={`game-stack-ghost${gPassed ? ' game-stack-passed' : ''}`} style={{ bottom: gPinned ? stageH - 30 : Math.max(-10, gY) }}>
            <span className="game-stack-ghost-line" />
            <img src={sprite(ghost.sprite, gPassed ? 'sleep' : 'look2')} alt="" />
            <span className="game-stack-ghost-tag">{gPinned ? `${ghost.name} ${ghost.target}, ${ghost.target - height} up` : gPassed ? `${ghost.name} ${ghost.target}, passed` : `${ghost.name} ${ghost.target}`}</span>
          </div>
        )}
        {callout && <div key={callout.id} className="game-stack-callout">{callout.text}</div>}
        {(!started || over) && (
          <div className="game-overlay" onPointerDown={(e) => e.stopPropagation()}>
            {over ? <>
              <img src={sprite(rider, 'think')} alt="" />
              <p>A perch {height} high. {best !== undefined && height >= best ? 'Best yet!' : 'Again?'}</p>
              {ghost && <p className="game-stack-verdict">{height > ghost.target ? `You built past ${ghost.name}'s ghost.` : `${ghost.name}'s ghost reached ${ghost.target}.`}</p>}
              <button className="chip" onClick={restart}>Build again</button>
            </> : <>
              <img src={sprite('bram', 'cheer')} alt="" />
              <p>Tap anywhere to drop the plank. Line it up exactly to keep it whole.</p>
              <p className="game-stack-verdict">Three perfects in a row grow it back. Catch WIDE, SLOW and MAGNET planks. Hold steady when the wind picks up.</p>
              <button className="chip" onClick={() => setStarted(true)}>Start</button>
            </>}
          </div>
        )}
      </div>
    </div>
  );
}
