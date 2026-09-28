import { useEffect, useRef, useState } from 'react';
import type { GameMeta, GameProps } from '../types';
import { sprite } from '../types';
import { WIDTH, base, drop, slide, type Block } from './logic';
import './style.css';

/** Stack: perch planks slide across; tap to drop. Whatever hangs over is
 *  sliced off; a perfect drop keeps the full plank. A crew member rides the top. */
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
  ],
};

const RIDERS = ['bram', 'pip', 'wren', 'moss', 'fig', 'nell', 'juno', 'rue', 'bly', 'tuck', 'otto', 'ollie'];
const BH = 22;
interface Save { tower: Block[]; combo: number }
interface Cut { id: number; x: number; w: number; level: number }

export function Game({ save, onSave, onScore, onAchieve, paused, best }: GameProps<Save>) {
  const [s, setS] = useState<Save>(() => save ?? { tower: [base()], combo: 0 });
  const [started, setStarted] = useState(!!save);
  const [over, setOver] = useState(false);
  const [x, setX] = useState(-75);
  const [flash, setFlash] = useState(0);
  const [cuts, setCuts] = useState<Cut[]>([]);
  const mv = useRef<{ x: number; dir: 1 | -1 }>({ x: -75, dir: 1 });
  const top = s.tower[s.tower.length - 1];
  const height = s.tower.length - 1;

  const stageW = Math.min(window.innerWidth - 24, 380);
  const stageH = Math.min(Math.max(window.innerHeight - 230, 360), 560);
  const k = stageW / WIDTH;

  useEffect(() => {
    if (paused || over || !started) return;
    let raf = 0, last = performance.now();
    const step = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      mv.current = slide(mv.current.x, mv.current.dir, top.w, dt, height);
      setX(mv.current.x);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [paused, over, started, top.w, height]);

  const tap = () => {
    if (paused || over) return;
    if (!started) { setStarted(true); return; }
    const r = drop(top, mv.current.x, top.w);
    if (r.cut) { const c = { id: Date.now(), ...r.cut, level: s.tower.length }; setCuts((cs) => [...cs.slice(-3), c]); }
    if (!r.block) {
      setOver(true);
      onScore(height);
      onSave(null);
      return;
    }
    const next: Save = { tower: [...s.tower, r.block], combo: r.perfect ? s.combo + 1 : 0 };
    if (r.perfect) setFlash((f) => f + 1);
    const h = next.tower.length - 1;
    if (h >= 10) onAchieve('ten');
    if (h >= 25) onAchieve('twenty-five');
    if (h >= 50) onAchieve('fifty');
    if (next.combo >= 5) onAchieve('perfect-5');
    const fromRight = h % 2 === 1;
    mv.current = { x: fromRight ? WIDTH - r.block.w * 0.5 : -r.block.w * 0.5, dir: fromRight ? -1 : 1 };
    setX(mv.current.x);
    setS(next);
    onSave(next);
  };

  const restart = () => {
    mv.current = { x: -75, dir: 1 };
    setX(-75); setCuts([]); setOver(false); setStarted(true);
    setS({ tower: [base()], combo: 0 });
  };

  const ground = 40;
  const cam = Math.max(0, (s.tower.length + 1) * BH - stageH * 0.55);
  const yOf = (level: number) => ground + level * BH - cam;
  const rider = RIDERS[Math.floor(height / 10) % RIDERS.length];
  const hue = (i: number) => `hsl(${(28 + i * 9) % 360} 45% ${48 + (i % 2) * 6}%)`;

  return (
    <div className="game-stack-wrap">
      <div className="game-score">Height: <b>{height}</b>{best !== undefined && <span> · best {best}</span>}{s.combo >= 2 && <span> · perfect ×{s.combo}</span>}</div>
      <div className="game-stack-stage" style={{ width: stageW, height: stageH }} onPointerDown={tap}>
        <div className="game-stack-sky" style={{ opacity: Math.min(1, height / 60) }} />
        {cam < ground && <div className="game-stack-ground" style={{ height: ground - cam }} />}
        {s.tower.map((b, i) => {
          const y = yOf(i);
          if (y < -BH || y > stageH) return null;
          return <div key={i} className="game-stack-block" style={{ left: b.x * k, width: b.w * k, bottom: y, height: BH, background: hue(i) }} />;
        })}
        {flash > 0 && <div key={flash} className="game-stack-flash" style={{ left: top.x * k - 6, width: top.w * k + 12, bottom: yOf(height) - 3, height: BH + 6 }} />}
        {cuts.map((c) => <div key={c.id} className="game-stack-cut" style={{ left: c.x * k, width: c.w * k, bottom: yOf(c.level), height: BH, background: hue(c.level) }} />)}
        {started && !over && <div className="game-stack-block game-stack-moving" style={{ left: x * k, width: top.w * k, bottom: yOf(s.tower.length), height: BH, background: hue(s.tower.length) }} />}
        <img className="game-stack-rider" src={sprite(rider, over ? 'sleep' : flash && s.combo > 0 ? 'cheer' : 'sit')} alt="" style={{ left: (top.x + top.w / 2) * k - 18, bottom: yOf(height) + BH - 4 }} />
        {(!started || over) && (
          <div className="game-overlay" onPointerDown={(e) => e.stopPropagation()}>
            {over ? <>
              <img src={sprite(rider, 'think')} alt="" />
              <p>A perch {height} high. {best !== undefined && height >= best ? 'Best yet!' : 'Again?'}</p>
              <button className="chip" onClick={restart}>Build again</button>
            </> : <>
              <img src={sprite('bram', 'cheer')} alt="" />
              <p>Tap anywhere to drop the plank. Line it up exactly to keep it whole.</p>
              <button className="chip" onClick={() => setStarted(true)}>Start</button>
            </>}
          </div>
        )}
      </div>
    </div>
  );
}
