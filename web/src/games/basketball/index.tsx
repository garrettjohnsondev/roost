import { useMemo, useRef, useState } from 'react';
import type { GameMeta, GameProps } from '../types';
import { sprite } from '../types';
import { project, type Cam } from '../_sports/flick';
import { useStageSize, useLoop, useFlick, drawCrew, CREW, pick } from '../_sports/stage';
import {
  launch, step, hoopX, hoopMotion, pointsFor,
  HOOP_Z, RIM_Y, RIM_R, BALL_R, BOARD_Z, BOARD_HALF, BOARD_LOW, BOARD_HIGH, ROUND_SECONDS, type Ball,
} from './logic';
import './style.css';

export const meta: GameMeta = {
  id: 'basketball',
  name: 'Hoops',
  blurb: 'Sixty seconds. Flick it up. Swishes are worth three.',
  host: 'juno',
  pack: 'sports',
  achievements: [
    { id: 'first', name: 'Buckets', says: 'Make a shot.' },
    { id: 'swish3', name: 'Nothing but net', says: 'Three swishes in a row.' },
    { id: 'moving', name: 'Moving target', says: 'Score on the moving hoop.' },
    { id: 'forty', name: 'Heating up', says: 'Score 40 in one round.' },
  ],
};

interface Save { left: number; score: number; makes: number; shots: number; swishRun: number }
const fresh = (): Save => ({ left: ROUND_SECONDS, score: 0, makes: 0, shots: 0, swishRun: 0 });

interface Flying { b: Ball; counted: boolean; pop: number }

export function Game({ save, onSave, onScore, onAchieve, paused, best }: GameProps<Save>) {
  const [s, setS] = useState<Save>(() => save ?? fresh());
  const [screen, setScreen] = useState<'intro' | 'play' | 'done'>(save ? 'play' : 'intro');
  const size = useStageSize();
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ ...s });
  const balls = useRef<Flying[]>([]);
  const clock = useRef(0); // seconds the hoop has been moving
  const ready = useRef(0); // until the next ball is in hand
  const cheer = useRef(0);
  const ended = useRef(false);
  const text = useRef<{ say: string; t: number } | null>(null);
  const friend = useMemo(() => pick(CREW), []);

  const flick = useFlick((f) => {
    if (screen !== 'play' || paused || f.dy > -20 || ready.current > 0 || live.current.left <= 0) return;
    balls.current.push({ b: launch(f), counted: false, pop: 0 });
    live.current.shots++;
    ready.current = 0.35;
  });

  const end = () => {
    const final = { ...live.current, left: 0 };
    if (final.score >= 40) onAchieve('forty');
    onScore(final.score);
    onSave(null);
    setS(final);
    setScreen('done');
  };

  useLoop(canvas, size, !paused, (ctx, w, h, dt) => {
    const L = live.current;
    const hx = hoopX(L.score, clock.current);
    if (screen === 'play') {
      if (hoopMotion(L.score).amp > 0) clock.current += dt;
      ready.current = Math.max(0, ready.current - dt);
      cheer.current = Math.max(0, cheer.current - dt);
      const was = Math.ceil(L.left);
      let dirty = false;
      L.left = Math.max(0, L.left - dt);
      for (const f of balls.current) {
        for (let i = 0; i < 4; i++) f.b = step(f.b, dt / 4, hx);
        if (f.b.scored && !f.counted) {
          f.counted = true;
          const swish = !f.b.touched;
          L.score += pointsFor(swish);
          L.makes++;
          L.swishRun = swish ? L.swishRun + 1 : 0;
          onAchieve('first');
          if (L.swishRun >= 3) onAchieve('swish3');
          if (hoopMotion(L.score - pointsFor(swish)).amp > 0) onAchieve('moving');
          text.current = { say: swish ? 'SWISH! +3' : '+2', t: 0.9 };
          cheer.current = 0.8;
          dirty = true;
        }
        if (f.b.done && !f.counted) { f.counted = true; L.swishRun = 0; }
        if (f.b.done) f.pop += dt;
      }
      balls.current = balls.current.filter((f) => f.pop < 0.4);
      if (text.current) { text.current.t -= dt; if (text.current.t <= 0) text.current = null; }
      if (Math.ceil(L.left) !== was || dirty) {
        setS({ ...L });
        onSave({ ...L });
      }
      if (L.left <= 0 && !ended.current && balls.current.every((f) => f.b.done)) { ended.current = true; end(); }
    }

    // Gym
    const c: Cam = { z: -2.2, y: 1.6, focal: w * 1.05, cx: w / 2, horizon: h * 0.6 };
    ctx.fillStyle = '#3a3346';
    ctx.fillRect(0, 0, w, c.horizon);
    ctx.fillStyle = '#463d55';
    for (let i = 0; i < 6; i++) ctx.fillRect(0, (c.horizon / 6) * i, w, 2);
    const floor = ctx.createLinearGradient(0, c.horizon, 0, h);
    floor.addColorStop(0, '#9c6a3a');
    floor.addColorStop(1, '#c8904f');
    ctx.fillStyle = floor;
    ctx.fillRect(0, c.horizon, w, h - c.horizon);
    // Wall meets floor at the baseline behind the hoop
    const wall = project(c, 0, 0, BOARD_Z + 1.2);
    ctx.fillStyle = '#3a3346';
    ctx.fillRect(0, c.horizon, w, wall.y - c.horizon);
    // Key
    const key = [[-1.8, HOOP_Z + 1], [1.8, HOOP_Z + 1], [1.8, HOOP_Z - 4.8], [-1.8, HOOP_Z - 4.8]].map(([x, z]) => project(c, x, 0, z));
    ctx.strokeStyle = 'rgba(255,255,255,.7)';
    ctx.lineWidth = 2;
    ctx.beginPath(); key.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();

    // Friend under the basket
    drawCrew(ctx, friend, cheer.current > 0 ? 'cheer' : L.left <= 0 ? 'sit' : 'look2', project(c, -2.3, 0, HOOP_Z).x, project(c, -2.3, 0, HOOP_Z).y, project(c, 0, 0, HOOP_Z).s * 1.3);

    // Backboard and pole
    const pole = project(c, hx, 0, BOARD_Z + 0.9), poleTop = project(c, hx, BOARD_LOW, BOARD_Z + 0.9);
    ctx.fillStyle = '#555';
    ctx.fillRect(pole.x - 3, poleTop.y, 6, pole.y - poleTop.y);
    const b1 = project(c, hx - BOARD_HALF, BOARD_HIGH, BOARD_Z), b2 = project(c, hx + BOARD_HALF, BOARD_LOW, BOARD_Z);
    ctx.fillStyle = 'rgba(235,240,245,.92)';
    ctx.fillRect(b1.x, b1.y, b2.x - b1.x, b2.y - b1.y);
    ctx.strokeStyle = '#d8453b';
    ctx.lineWidth = 2;
    ctx.strokeRect(b1.x + 1, b1.y + 1, b2.x - b1.x - 2, b2.y - b1.y - 2);
    const q1 = project(c, hx - 0.3, RIM_Y + 0.45, BOARD_Z), q2 = project(c, hx + 0.3, RIM_Y, BOARD_Z);
    ctx.strokeRect(q1.x, q1.y, q2.x - q1.x, q2.y - q1.y);

    const drawRim = (front: boolean) => {
      const ctr = project(c, hx, RIM_Y, HOOP_Z);
      const rx = RIM_R * ctr.s, ry = RIM_R * ctr.s * 0.28;
      ctx.strokeStyle = '#e8622c';
      ctx.lineWidth = Math.max(2, ctr.s * 0.03);
      ctx.beginPath();
      ctx.ellipse(ctr.x, ctr.y, rx, ry, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
      ctx.stroke();
      if (front) {
        ctx.strokeStyle = 'rgba(255,255,255,.75)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= 6; i++) {
          const a = (i / 6) * Math.PI;
          const x = ctr.x + Math.cos(a) * rx, y = ctr.y + Math.sin(a) * ry;
          ctx.moveTo(x, y); ctx.lineTo(ctr.x + Math.cos(a) * rx * 0.6, ctr.y + ctr.s * 0.4);
        }
        ctx.stroke();
      }
    };
    const drawBall = (b: Ball, alpha = 1) => {
      const p = project(c, b.x, b.y, b.z), g = project(c, b.x, 0, b.z);
      ctx.globalAlpha = alpha * 0.3;
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(g.x, g.y, p.s * BALL_R, p.s * BALL_R * 0.3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#e07b2c';
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(2, p.s * BALL_R), 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#5a2d10';
      ctx.lineWidth = Math.max(1, p.s * 0.012);
      ctx.beginPath();
      ctx.moveTo(p.x - p.s * BALL_R, p.y); ctx.lineTo(p.x + p.s * BALL_R, p.y);
      ctx.moveTo(p.x, p.y - p.s * BALL_R); ctx.lineTo(p.x, p.y + p.s * BALL_R);
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    // Balls behind the rim, then the rim, then balls in front of it
    const flying = [...balls.current].sort((a, b) => b.b.z - a.b.z);
    const behind = (f: Flying) => f.b.z > HOOP_Z || (f.b.y < RIM_Y && Math.abs(f.b.z - HOOP_Z) < RIM_R);
    drawRim(false);
    flying.filter(behind).forEach((f) => drawBall(f.b, 1 - f.pop / 0.4));
    drawRim(true);
    flying.filter((f) => !behind(f)).forEach((f) => drawBall(f.b, 1 - f.pop / 0.4));
    if (screen === 'play' && ready.current === 0 && L.left > 0) drawBall({ x: 0, y: 1, z: 0 } as Ball);

    ctx.textAlign = 'center';
    if (text.current) {
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(w * 0.08)}px ui-monospace, monospace`;
      ctx.fillText(text.current.say, w / 2, h * 0.14);
    } else if (screen === 'play' && L.shots === 0) {
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.font = `${Math.round(w * 0.04)}px ui-monospace, monospace`;
      ctx.fillText('Flick up, not too hard', w / 2, h - 16);
    }
  });

  const restart = () => {
    const f = fresh();
    live.current = { ...f };
    balls.current = [];
    clock.current = 0;
    ended.current = false;
    setS(f);
    setScreen('play');
  };

  return (
    <div className="game-basketball">
      <div className="game-score game-basketball-hud">
        <span>Points <b>{s.score}</b></span>
        <span className={s.left <= 10 && screen === 'play' ? 'game-basketball-hurry' : ''}>{Math.ceil(s.left)}s</span>
        {hoopMotion(s.score).amp > 0 && <span>Moving hoop!</span>}
      </div>
      <div className="game-basketball-court" style={{ width: size.w, height: size.h }}>
        <canvas ref={canvas} style={{ width: size.w, height: size.h }} {...flick} />
        {screen !== 'play' && (
          <div className="game-overlay">
            {screen === 'done' ? <>
              <img src={sprite(friend, s.score >= 20 ? 'dance' : 'cheer')} alt="" />
              <p>{s.score} points, {s.makes}/{s.shots} shots. {best !== undefined && s.score >= best && s.score > 0 ? 'Best yet!' : ''}</p>
              <button className="chip" onClick={restart}>Shoot again</button>
            </> : <>
              <img src={sprite(friend, 'hold')} alt="" />
              <p>Flick up to shoot. Sixty seconds.<br />Swish for 3. Score enough and the hoop starts moving.</p>
              <button className="chip" onClick={restart}>Tip off</button>
            </>}
          </div>
        )}
      </div>
    </div>
  );
}
