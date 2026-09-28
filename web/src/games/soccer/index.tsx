import { useMemo, useRef, useState } from 'react';
import type { GameMeta, GameProps } from '../types';
import { sprite } from '../types';
import { project, type Cam } from '../_sports/flick';
import { useStageSize, useLoop, useFlick, drawCrew, CREW, pick } from '../_sports/stage';
import { shoot, shotAt, keeperDive, resolve, isTopCorner, SPOT, HALF_W, BAR_H, SHOTS, type Shot, type Dive, type Result } from './logic';
import './style.css';

export const meta: GameMeta = {
  id: 'soccer',
  name: 'Penalty Kicks',
  blurb: 'Flick past the keeper. He learns your habits.',
  host: 'fig',
  pack: 'sports',
  achievements: [
    { id: 'first', name: 'Back of the net', says: 'Score a penalty.' },
    { id: 'corner', name: 'Top bins', says: 'Score in a top corner.' },
    { id: 'bender', name: 'Bend it', says: 'Score with a big curve.' },
    { id: 'perfect', name: 'Ice cold', says: 'Score all ten in a round.' },
  ],
};

interface Save { shot: number; goals: number; history: number[] }
const fresh = (): Save => ({ shot: 0, goals: 0, history: [] });

const SAYS: Record<Result, string> = { goal: 'GOAL!', saved: 'Saved!', post: 'Off the post', wide: 'Wide', over: 'Over the bar' };

interface Kick { shot: Shot; dive: Dive; result: Result; t: number; settled: boolean }

export function Game({ save, onSave, onScore, onAchieve, paused, best }: GameProps<Save>) {
  const [s, setS] = useState<Save>(() => save ?? fresh());
  const [screen, setScreen] = useState<'intro' | 'play' | 'done'>(save ? 'play' : 'intro');
  const size = useStageSize();
  const canvas = useRef<HTMLCanvasElement>(null);
  const kick = useRef<Kick | null>(null);
  const keeper = useMemo(() => pick(CREW), []);

  const settle = (k: Kick) => {
    const goal = k.result === 'goal';
    const next: Save = { shot: s.shot + 1, goals: s.goals + (goal ? 1 : 0), history: [...s.history, k.shot.x].slice(-10) };
    if (goal) onAchieve('first');
    if (goal && isTopCorner(k.shot)) onAchieve('corner');
    if (goal && Math.abs(k.shot.curve) >= 0.2) onAchieve('bender');
    kick.current = null;
    setS(next);
    if (next.shot >= SHOTS) {
      if (next.goals === SHOTS) onAchieve('perfect');
      onScore(next.goals);
      onSave(null);
      setScreen('done');
    } else onSave(next);
  };

  const flick = useFlick((f) => {
    if (screen !== 'play' || paused || kick.current || f.dy > -20) return;
    const shot = shoot(f);
    const dive = keeperDive(shot, s.shot, s.history, Math.random(), Math.random(), Math.random());
    kick.current = { shot, dive, result: resolve(shot, dive), t: 0, settled: false };
  });

  useLoop(canvas, size, !paused, (ctx, w, h, dt) => {
    const c: Cam = { z: -4, y: 1.5, focal: w * 1.25, cx: w / 2, horizon: h * 0.4 };
    const k = kick.current;
    if (k) {
      k.t += dt;
      if (!k.settled && k.t > k.shot.time + 1.4) { k.settled = true; settle(k); }
    }

    // Pitch and stands
    ctx.fillStyle = '#2a2f3a';
    ctx.fillRect(0, 0, w, c.horizon);
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = ['#c95a4a', '#e0c35a', '#5a86c9', '#d9d4c7'][i % 4];
      ctx.fillRect(((i * 53) % w), c.horizon * 0.35 + ((i * 29) % Math.round(c.horizon * 0.5)), 3, 3);
    }
    ctx.fillStyle = '#3f8a43';
    ctx.fillRect(0, c.horizon, w, h - c.horizon);
    for (let z = -4; z < 20; z += 2.5) {
      const a = project(c, 0, 0, z), b = project(c, 0, 0, z + 1.25);
      ctx.fillStyle = '#448f48';
      ctx.fillRect(0, b.y, w, a.y - b.y);
    }
    const line = (x0: number, z0: number, x1: number, z1: number) => {
      const a = project(c, x0, 0, z0), b = project(c, x1, 0, z1);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    };
    ctx.strokeStyle = 'rgba(255,255,255,.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    line(-20, SPOT, 20, SPOT);
    line(-9.16, SPOT, -9.16, SPOT - 5.5); line(9.16, SPOT, 9.16, SPOT - 5.5); line(-9.16, SPOT - 5.5, 9.16, SPOT - 5.5);
    ctx.stroke();
    const spot = project(c, 0, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(spot.x, spot.y, spot.s * 0.12, spot.s * 0.04, 0, 0, Math.PI * 2); ctx.fill();

    // Net and goal frame
    const back = SPOT + 1.8;
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -HALF_W; x <= HALF_W + 0.01; x += 0.5) {
      const a = project(c, x, BAR_H, SPOT), b = project(c, x, 0, back);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    for (let y = 0; y <= BAR_H; y += 0.4) {
      const t = y / BAR_H;
      const a = project(c, -HALF_W, y, back - (back - SPOT) * t), b = project(c, HALF_W, y, back - (back - SPOT) * t);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    const gl = project(c, -HALF_W, 0, SPOT), gr = project(c, HALF_W, 0, SPOT);
    const tl = project(c, -HALF_W, BAR_H, SPOT), tr = project(c, HALF_W, BAR_H, SPOT);
    ctx.strokeStyle = '#f4f4f0';
    ctx.lineWidth = Math.max(3, gl.s * 0.12);
    ctx.beginPath(); ctx.moveTo(gl.x, gl.y); ctx.lineTo(tl.x, tl.y); ctx.lineTo(tr.x, tr.y); ctx.lineTo(gr.x, gr.y); ctx.stroke();

    // Keeper: sways while waiting, then dives
    const kp = project(c, 0, 0, SPOT - 0.3);
    const tall = kp.s * 1.9;
    let kx = Math.sin(performance.now() / 380) * 0.35, ky = 0, rot = 0, pose = 'idle';
    if (k) {
      const react = Math.min(1, Math.max(0, (k.t - 0.08) / Math.max(0.25, k.shot.time)));
      const e = 1 - (1 - react) * (1 - react);
      kx = k.dive.x * e;
      ky = Math.max(0, k.dive.y - 0.9) * e;
      rot = Math.abs(k.dive.x) > 0.6 ? Math.sign(k.dive.x) * (Math.PI / 2.4) * e : 0;
      pose = k.t > k.shot.time ? (k.result === 'saved' ? 'hold' : k.result === 'goal' ? 'sit' : 'cheer') : 'side';
      if (k.t > k.shot.time + 0.5 && k.result !== 'saved') { rot *= 0.4; ky = 0; }
    }
    const kpos = project(c, kx, ky, SPOT - 0.3);
    drawCrew(ctx, keeper, pose, kpos.x, kpos.y, tall, k ? k.dive.x < 0 : false, rot);

    // Ball
    let bx = 0, by = 0.11, bz = 0;
    if (k) {
      const u = k.t / k.shot.time;
      const p = shotAt(k.shot, u);
      bx = p.x; by = p.y; bz = p.z;
      if (u > 1) {
        const after = Math.min(1.2, (k.t - k.shot.time));
        if (k.result === 'goal') { bz = SPOT + Math.min(1.6, after * 6); by = Math.max(0.11, k.shot.y - after * 3); }
        else if (k.result === 'saved' || k.result === 'post') { bz = SPOT - after * 5; bx = k.shot.x + Math.sign(k.shot.x || 1) * after * 3; by = Math.max(0.11, k.shot.y + after * 2 - after * after * 6); }
        else { bz = SPOT + after * 12; bx = k.shot.x * (1 + after * 0.6); by = k.shot.y + after * 1.5; }
      }
      if (k.result === 'saved' && u > 1 && k.t < k.shot.time + 0.9) { bx = kx; by = Math.max(0.3, ky + 0.8); bz = SPOT - 0.5; }
    }
    const g = project(c, bx, 0, bz), b = project(c, bx, by, bz);
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath(); ctx.ellipse(g.x, g.y, g.s * 0.12, g.s * 0.04, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fafafa';
    ctx.beginPath(); ctx.arc(b.x, b.y, Math.max(2, b.s * 0.11), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#222';
    const r = Math.max(1, b.s * 0.04), spin = k ? k.t * 18 : 0;
    for (let i = 0; i < 3; i++) {
      const a = spin + (i * Math.PI * 2) / 3;
      ctx.fillRect(b.x + Math.cos(a) * b.s * 0.05 - r / 2, b.y + Math.sin(a) * b.s * 0.05 - r / 2, r, r);
    }

    // Words
    ctx.textAlign = 'center';
    if (k && k.t > k.shot.time + 0.1) {
      ctx.fillStyle = k.result === 'goal' ? '#fff' : '#ffd9d4';
      ctx.font = `bold ${Math.round(w * 0.085)}px ui-monospace, monospace`;
      ctx.fillText(SAYS[k.result], w / 2, h * 0.14);
    } else if (!k && screen === 'play' && s.shot === 0) {
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.font = `${Math.round(w * 0.04)}px ui-monospace, monospace`;
      ctx.fillText('Flick at the goal. Curve it round him.', w / 2, h - 16);
    }
  });

  const restart = () => { kick.current = null; setS(fresh()); setScreen('play'); };

  return (
    <div className="game-soccer">
      <div className="game-score game-soccer-hud">
        <span>Goals <b>{s.goals}</b></span>
        <span className="game-soccer-shots">
          {Array.from({ length: SHOTS }, (_, i) => <i key={i} className={i < s.shot ? 'on' : ''} />)}
        </span>
      </div>
      <div className="game-soccer-field" style={{ width: size.w, height: size.h }}>
        <canvas ref={canvas} style={{ width: size.w, height: size.h }} {...flick} />
        {screen !== 'play' && (
          <div className="game-overlay">
            {screen === 'done' ? <>
              <img src={sprite(keeper, s.goals >= 7 ? 'sit' : 'cheer')} alt="" />
              <p>{s.goals}/{SHOTS} scored. {best !== undefined && s.goals >= best && s.goals > 0 ? 'Best yet!' : ''}</p>
              <button className="chip" onClick={restart}>Shoot again</button>
            </> : <>
              <img src={sprite(keeper, 'idle')} alt="" />
              <p>Flick toward the goal. Harder goes higher.<br />Bend your swipe to curve it. The keeper learns.</p>
              <button className="chip" onClick={() => setScreen('play')}>Kick off</button>
            </>}
          </div>
        )}
      </div>
    </div>
  );
}
