import { useMemo, useRef, useState } from 'react';
import type { GameMeta, GameProps } from '../types';
import { sprite } from '../types';
import { sfx } from '../../economy/sound';
import { buzz } from '../../haptics';
import { project, type Cam } from '../_sports/flick';
import { useStageSize, useLoop, useFlick, drawCrew, CREW, pick } from '../_sports/stage';
import { ghostAt, isClutch, makeTicks } from '../_sports/pace';
import {
  feel, burst, stepParticles, drawParticles, kickShake, shakeOffset, drawCrowd, drawGhost, popText, tag, reducedMotion,
  CONFETTI, type Particle, type Shake,
} from '../_sports/juice';
import {
  shoot, shotAt, keeperDive, resolve, isTopCorner, wallFor, targetFor, onTarget, pointsFor, ghostScore,
  SPOT, HALF_W, BAR_H, SHOTS, WALL_Z, WALL_H, TARGET_R, type Shot, type Dive, type Result, type Wall, type Target,
} from './logic';
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
    { id: 'wall', name: 'Over the wall', says: 'Score a free kick past the wall.' },
    { id: 'target', name: 'Picked out', says: 'Hit three targets in one round.' },
    { id: 'clutch', name: 'Nerves of steel', says: 'Score the clutch last shot.' },
  ],
  ghostScore,
  safeCorner: 'br',
};

interface Save { shot: number; goals: number; history: number[]; points: number; streak: number; targets: number; wall: Wall | null; target: Target }
const fresh = (): Save => ({ shot: 0, goals: 0, history: [], points: 0, streak: 0, targets: 0, wall: null, target: targetFor(Math.random(), Math.random()) });

const SAYS: Record<Result, string> = { goal: 'GOAL!', saved: 'Saved!', post: 'Off the post', wide: 'Wide', over: 'Over the bar', blocked: 'Blocked by the wall' };

interface Kick { shot: Shot; dive: Dive; result: Result; t: number; settled: boolean; hitTarget: boolean; pts: number; landed: boolean }

export function Game({ save, onSave, onScore, onAchieve, paused, best, ghost }: GameProps<Save>) {
  const [s, setS] = useState<Save>(() => (save ? { ...fresh(), ...save } : fresh()));
  const [screen, setScreen] = useState<'intro' | 'play' | 'done'>(save ? 'play' : 'intro');
  const size = useStageSize();
  const canvas = useRef<HTMLCanvasElement>(null);
  const kick = useRef<Kick | null>(null);
  const parts = useRef<Particle[]>([]);
  const shake = useRef<Shake>({ t: 0, mag: 0 });
  const excite = useRef(0);
  const ripple = useRef<{ x: number; y: number; t: number } | null>(null);
  const keeper = useMemo(() => pick(CREW), []);
  const wallCrew = useMemo(() => [0, 1, 2, 3].map(() => pick(CREW.filter((n) => n !== keeper))), [keeper]);
  const clutch = isClutch(s.shot, SHOTS);

  const settle = (k: Kick) => {
    const goal = k.result === 'goal';
    const shot = s.shot + 1;
    const next: Save = {
      shot, goals: s.goals + (goal ? 1 : 0), history: [...s.history, k.shot.x].slice(-10),
      points: s.points + k.pts, streak: goal ? s.streak + 1 : 0, targets: s.targets + (k.hitTarget ? 1 : 0),
      wall: wallFor(shot, Math.random()), target: targetFor(Math.random(), Math.random()),
    };
    if (goal) onAchieve('first');
    if (goal && isTopCorner(k.shot)) onAchieve('corner');
    if (goal && Math.abs(k.shot.curve) >= 0.2) onAchieve('bender');
    if (goal && s.wall) onAchieve('wall');
    if (goal && clutch) onAchieve('clutch');
    if (next.targets >= 3) onAchieve('target');
    kick.current = null;
    ripple.current = null;
    setS(next);
    if (next.shot >= SHOTS) {
      if (next.goals === SHOTS) onAchieve('perfect');
      const good = next.goals >= 6 && (!ghost || next.points > ghost.target);
      buzz(good ? 'pass' : 'fail');
      sfx(good ? 'win' : 'lose');
      onScore(next.points);
      onSave(null);
      setScreen('done');
    } else onSave(next);
  };

  const flick = useFlick((f) => {
    if (screen !== 'play' || paused || kick.current || f.dy > -20) return;
    const shot = shoot(f);
    const dive = keeperDive(shot, s.shot, s.history, Math.random(), Math.random(), Math.random());
    const result = resolve(shot, dive, s.wall);
    const hitTarget = result === 'goal' && onTarget(shot, s.target);
    kick.current = { shot, dive, result, t: 0, settled: false, hitTarget, pts: pointsFor(result === 'goal', hitTarget, clutch), landed: false };
    feel(1);
    sfx('whoosh');
  });

  useLoop(canvas, size, !paused, (ctx, w, h, dt, now) => {
    const c: Cam = { z: -4, y: 1.5, focal: w * 1.25, cx: w / 2, horizon: h * 0.4 };
    const k = kick.current;
    if (k) {
      k.t += dt;
      const arrive = k.result === 'blocked' ? k.shot.time * (WALL_Z / SPOT) : k.shot.time;
      if (!k.landed && k.t >= arrive) {
        k.landed = true;
        const at = project(c, k.shot.x, k.shot.y, SPOT);
        if (k.result === 'goal') {
          feel(makeTicks(2, s.streak + 1) + (clutch ? 1 : 0), 45, true);
          sfx(k.hitTarget || clutch ? 'coin' : 'score');
          excite.current = 2;
          ripple.current = { x: k.shot.x, y: k.shot.y, t: 0 };
          burst(parts.current, at.x, at.y, k.hitTarget ? 50 : 30, CONFETTI, 170);
        } else if (k.result === 'post') {
          feel(1, 20, true);
          sfx('hit');
          kickShake(shake.current, 5);
          burst(parts.current, at.x, at.y, 8, ['#fff', '#ddd'], 90, 200, 2);
        } else if (k.result === 'saved' || k.result === 'blocked') {
          feel(1, 30, true);
          sfx('bounce');
          kickShake(shake.current, 2);
        } else sfx('lose');
      }
      if (!k.settled && k.t > k.shot.time + 1.5) { k.settled = true; settle(k); }
    }
    if (ripple.current) ripple.current.t += dt;
    excite.current = Math.max(0, excite.current - dt);
    stepParticles(parts.current, dt);

    const [sx, sy] = shakeOffset(shake.current, dt);
    ctx.save();
    ctx.translate(sx, sy);
    // Stands and the crowd
    ctx.fillStyle = '#20242e';
    ctx.fillRect(-10, -10, w + 20, c.horizon + 10);
    ctx.fillStyle = '#2a2f3a';
    ctx.fillRect(-10, c.horizon * 0.25, w + 20, c.horizon * 0.75);
    const waving = excite.current > 0.3 ? (2 - excite.current) / 1.7 : -1;
    drawCrowd(ctx, 0, c.horizon * 0.28, w, c.horizon * 0.62, Math.min(1, excite.current), now, waving, 7);
    // Ad boards
    ctx.fillStyle = '#12151c';
    ctx.fillRect(-10, c.horizon - 12, w + 20, 12);
    ctx.fillStyle = clutch && screen === 'play' ? '#ffd84a' : '#6fb3ff';
    ctx.font = 'bold 9px ui-monospace, monospace';
    ctx.textAlign = 'left';
    const scroll = reducedMotion() ? 0 : (now / 40) % 120;
    for (let x = -scroll; x < w; x += 120) ctx.fillText(clutch && screen === 'play' ? 'CLUTCH  x2' : 'ROOST  FC', x, c.horizon - 3);

    ctx.fillStyle = '#3f8a43';
    ctx.fillRect(-10, c.horizon, w + 20, h - c.horizon + 10);
    for (let z = -4; z < 20; z += 2.5) {
      const a = project(c, 0, 0, z), b = project(c, 0, 0, z + 1.25);
      ctx.fillStyle = '#448f48';
      ctx.fillRect(-10, b.y, w + 20, a.y - b.y);
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

    // Net, bulging where the ball hit it
    const back = SPOT + 1.8;
    const rp = ripple.current;
    const bulge = (x: number, y: number) => {
      if (!rp) return 0;
      const d = Math.hypot(x - rp.x, y - rp.y);
      const amp = Math.max(0, 1 - rp.t / 1.2) * (reducedMotion() ? 0.5 : 1);
      return Math.max(0, 1 - d / 1.4) * 0.9 * amp * (1 + 0.3 * Math.sin(rp.t * 18));
    };
    ctx.strokeStyle = 'rgba(255,255,255,.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -HALF_W; x <= HALF_W + 0.01; x += 0.5) {
      for (let y = BAR_H; y > 0.01; y -= 0.3) {
        const t0 = y / BAR_H, t1 = Math.max(0, y - 0.3) / BAR_H;
        const z0 = back - (back - SPOT) * t0 + bulge(x, y), z1 = back - (back - SPOT) * t1 + bulge(x, y - 0.3);
        const a = project(c, x, y, z0), b = project(c, x, Math.max(0, y - 0.3), z1);
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      }
    }
    for (let y = 0; y <= BAR_H; y += 0.4) {
      const t = y / BAR_H;
      for (let x = -HALF_W; x < HALF_W - 0.01; x += 0.5) {
        const a = project(c, x, y, back - (back - SPOT) * t + bulge(x, y)), b = project(c, x + 0.5, y, back - (back - SPOT) * t + bulge(x + 0.5, y));
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      }
    }
    ctx.stroke();
    const gl = project(c, -HALF_W, 0, SPOT), gr = project(c, HALF_W, 0, SPOT);
    const tl = project(c, -HALF_W, BAR_H, SPOT), tr = project(c, HALF_W, BAR_H, SPOT);
    ctx.lineWidth = Math.max(3, gl.s * 0.12);
    ctx.strokeStyle = '#9a9a92';
    ctx.beginPath(); ctx.moveTo(gl.x + 1, gl.y); ctx.lineTo(tl.x + 1, tl.y + 1); ctx.lineTo(tr.x + 1, tr.y + 1); ctx.lineTo(gr.x + 1, gr.y); ctx.stroke();
    ctx.strokeStyle = '#f4f4f0';
    ctx.beginPath(); ctx.moveTo(gl.x, gl.y); ctx.lineTo(tl.x, tl.y); ctx.lineTo(tr.x, tr.y); ctx.lineTo(gr.x, gr.y); ctx.stroke();

    // Target in the corner
    if (screen === 'play' && (!k || k.t < k.shot.time + 0.6)) {
      const tp = project(c, s.target.x, s.target.y, SPOT - 0.02);
      const pulse = 1 + (reducedMotion() ? 0 : Math.sin(now / 180) * 0.08);
      const hit = k?.hitTarget && k.landed;
      ctx.strokeStyle = hit ? '#fff' : '#ffd84a';
      ctx.lineWidth = 2;
      for (const f of [1, 0.6, 0.25]) {
        ctx.beginPath(); ctx.arc(tp.x, tp.y, TARGET_R * tp.s * f * pulse, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,216,74,.18)';
      ctx.beginPath(); ctx.arc(tp.x, tp.y, TARGET_R * tp.s * pulse, 0, Math.PI * 2); ctx.fill();
    }

    // Keeper: sways while waiting, then dives
    const kp = project(c, 0, 0, SPOT - 0.3);
    const tall = kp.s * 1.9;
    let kx = Math.sin(now / 380) * 0.35, ky = 0, rot = 0, pose = 'idle';
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

    // Ball position
    let bx = 0, by = 0.11, bz = 0;
    if (k) {
      const u = k.t / k.shot.time;
      const p = shotAt(k.shot, u);
      bx = p.x; by = p.y; bz = p.z;
      const wallU = WALL_Z / SPOT;
      if (k.result === 'blocked' && u > wallU) {
        const w0 = shotAt(k.shot, wallU), after = k.t - k.shot.time * wallU;
        bx = w0.x + after * 1.5; bz = WALL_Z - 0.3 - after * 4; by = Math.max(0.11, w0.y + after * 2.5 - after * after * 7);
      } else if (u > 1) {
        const after = Math.min(1.2, (k.t - k.shot.time));
        if (k.result === 'goal') { bz = SPOT + Math.min(1.6, after * 6); by = Math.max(0.11, k.shot.y - after * 3); }
        else if (k.result === 'saved' || k.result === 'post') { bz = SPOT - after * 5; bx = k.shot.x + Math.sign(k.shot.x || 1) * after * 3; by = Math.max(0.11, k.shot.y + after * 2 - after * after * 6); }
        else { bz = SPOT + after * 12; bx = k.shot.x * (1 + after * 0.6); by = k.shot.y + after * 1.5; }
      }
      if (k.result === 'saved' && u > 1 && k.t < k.shot.time + 0.9) { bx = kx; by = Math.max(0.3, ky + 0.8); bz = SPOT - 0.5; }
    }
    const drawBall = () => {
      const g = project(c, bx, 0, bz), b = project(c, bx, by, bz);
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.beginPath(); ctx.ellipse(g.x, g.y, g.s * 0.12, g.s * 0.04, 0, 0, Math.PI * 2); ctx.fill();
      const rad = Math.max(2, b.s * 0.11);
      ctx.fillStyle = '#fafafa';
      ctx.beginPath(); ctx.arc(b.x, b.y, rad, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d8d8d8';
      ctx.beginPath(); ctx.arc(b.x + rad * 0.25, b.y + rad * 0.25, rad * 0.7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fafafa';
      ctx.beginPath(); ctx.arc(b.x - rad * 0.15, b.y - rad * 0.15, rad * 0.7, 0, Math.PI * 2); ctx.fill();
      // Panels spin with the curve
      ctx.fillStyle = '#222';
      const r = Math.max(1, b.s * 0.04), spin = k ? k.t * (18 + Math.abs(k.shot.curve) * 40) * (k.shot.curve < 0 ? -1 : 1) : 0;
      for (let i = 0; i < 3; i++) {
        const a = spin + (i * Math.PI * 2) / 3;
        ctx.fillRect(b.x + Math.cos(a) * b.s * 0.05 - r / 2, b.y + Math.sin(a) * b.s * 0.05 - r / 2, r, r);
      }
    };

    // The wall of crew (ball behind it is drawn first)
    const wall = s.wall;
    if (wall && bz >= WALL_Z) drawBall();
    if (wall) {
      const jump = k && k.t > 0.05 && k.t < 0.7 ? Math.sin(Math.min(1, (k.t - 0.05) / 0.6) * Math.PI) * 0.4 : 0;
      for (let i = 0; i < 4; i++) {
        const x = wall.x0 + 0.25 + i * 0.5;
        const p = project(c, x, jump, WALL_Z);
        drawCrew(ctx, wallCrew[i], k?.result === 'blocked' && k.landed ? 'cheer' : 'hold', p.x, p.y, WALL_H * p.s * 1.05);
      }
    }
    if (!wall || bz < WALL_Z) drawBall();

    drawParticles(ctx, parts.current);
    ctx.restore();

    // Ghost in the stands' front row, left
    if (ghost && screen !== 'intro') {
      drawGhost(ctx, ghost, 22, c.horizon + 44, 32, now, ghostAt(ghost.target, SHOTS, s.shot / SHOTS, ghost.name.length + SHOTS), s.points);
    }
    if (screen === 'play') {
      let ty = 8;
      if (clutch) { tag(ctx, 'CLUTCH SHOT x2', w - 8, ty, 12, '#ffd84a', '#1a1a1a', 'right'); ty += 22; }
      if (wall) { tag(ctx, 'FREE KICK', w - 8, ty, 11, 'rgba(20,30,50,.75)', '#dfe8ff', 'right'); ty += 22; }
      if (s.streak >= 2) tag(ctx, `${s.streak} IN A ROW`, w - 8, ty, 11, '#e8622c', '#fff', 'right');
    }

    // Words
    if (k && k.landed) {
      const age = k.t - (k.result === 'blocked' ? k.shot.time * (WALL_Z / SPOT) : k.shot.time);
      popText(ctx, SAYS[k.result], w / 2, h * 0.14, w * (k.result === 'blocked' ? 0.06 : 0.085), k.result === 'goal' ? '#fff' : '#ffd9d4', age, 1.5);
      if (k.pts) popText(ctx, `+${k.pts}${k.hitTarget ? '  target!' : ''}`, w / 2, h * 0.14 + w * 0.085, w * 0.045, '#ffe27a', Math.max(0, age - 0.2), 1.3);
    } else if (!k && screen === 'play' && s.shot === 0) {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.font = `${Math.round(w * 0.04)}px ui-monospace, monospace`;
      ctx.fillText('Flick at the goal. Curve it round him.', w / 2, h - 16);
    }
  });

  const restart = () => { kick.current = null; ripple.current = null; parts.current = []; setS(fresh()); setScreen('play'); };

  return (
    <div className="game-soccer">
      <div className="game-score game-soccer-hud">
        <span>Points <b>{s.points}</b></span>
        <span>Goals {s.goals}</span>
        <span className="game-soccer-shots">
          {Array.from({ length: SHOTS }, (_, i) => <i key={i} className={`${i < s.shot ? 'on' : ''}${i === SHOTS - 1 ? ' clutch' : ''}`} />)}
        </span>
      </div>
      <div className="game-soccer-field" style={{ width: size.w, height: size.h }}>
        <canvas ref={canvas} style={{ width: size.w, height: size.h }} {...flick} />
        {screen !== 'play' && (
          <div className="game-overlay">
            {screen === 'done' ? <>
              <img src={sprite(keeper, s.goals >= 7 ? 'sit' : 'cheer')} alt="" />
              <p>{s.goals}/{SHOTS} scored, {s.points} points. {best !== undefined && s.points >= best && s.points > 0 ? 'Best yet!' : ''}</p>
              {ghost && <p className="game-soccer-ghost">{s.points > ghost.target ? `You beat ${ghost.name}'s ghost (${ghost.target}).` : `${ghost.name}'s ghost had ${ghost.target}.`}</p>}
              <button className="chip" onClick={restart}>Shoot again</button>
            </> : <>
              <img src={sprite(keeper, 'idle')} alt="" />
              <p>Flick toward the goal. Harder goes higher.<br />Bend your swipe to curve it. The keeper learns.<br />Hit the glowing target for a bonus. Free kicks have a wall.<br />The last shot counts double.</p>
              <button className="chip" onClick={() => setScreen('play')}>Kick off</button>
            </>}
          </div>
        )}
      </div>
    </div>
  );
}
