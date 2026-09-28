import { useMemo, useRef, useState } from 'react';
import type { GameMeta, GameProps } from '../types';
import { sprite } from '../types';
import { project, type Cam } from '../_sports/flick';
import { useStageSize, useLoop, useFlick, drawCrew, CREW, pick } from '../_sports/stage';
import {
  kick, step, judge, windFor, windMph, metres, pointsFor, nextYards,
  BAR, HALF, ATTEMPTS, START_YARDS, type Ball, type Outcome,
} from './logic';
import './style.css';

export const meta: GameMeta = {
  id: 'fieldgoal',
  name: 'Field Goal',
  blurb: 'Flick it through the uprights. Mind the wind.',
  host: 'bram',
  pack: 'sports',
  achievements: [
    { id: 'first', name: 'It is good', says: 'Make a field goal.' },
    { id: 'fifty', name: 'Big leg', says: 'Make one from 50 yards or more.' },
    { id: 'doink', name: 'Doink', says: 'Hit the upright.' },
    { id: 'perfect', name: 'Automatic', says: 'Make all ten in a round.' },
  ],
};

interface Save { attempt: number; score: number; makes: number; yards: number; wind: number }
const fresh = (): Save => ({ attempt: 0, score: 0, makes: 0, yards: START_YARDS, wind: windFor(START_YARDS, Math.random()) });

const SAYS: Record<Outcome, string> = { good: "IT'S GOOD!", doink: 'DOINK!', short: 'Short', 'wide-left': 'Wide left', 'wide-right': 'Wide right' };

export function Game({ save, onSave, onScore, onAchieve, paused, best }: GameProps<Save>) {
  const [s, setS] = useState<Save>(() => save ?? fresh());
  const [phase, setPhase] = useState<'intro' | 'aim' | 'flight' | 'done'>(save ? 'aim' : 'intro');
  const size = useStageSize();
  const canvas = useRef<HTMLCanvasElement>(null);
  const ball = useRef<Ball | null>(null);
  const trail = useRef<Ball[]>([]);
  const result = useRef<{ o: Outcome; t: number; settled: boolean } | null>(null);
  const holder = useMemo(() => pick(CREW.filter((n) => n !== 'pip')), []);

  const finish = (o: Outcome) => {
    const made = o === 'good';
    const attempt = s.attempt + 1;
    const yards = nextYards(s.yards, made);
    const next: Save = { attempt, score: s.score + (made ? pointsFor(s.yards) : 0), makes: s.makes + (made ? 1 : 0), yards, wind: windFor(yards, Math.random()) };
    if (made) onAchieve('first');
    if (made && s.yards >= 50) onAchieve('fifty');
    if (o === 'doink') onAchieve('doink');
    ball.current = null;
    trail.current = [];
    result.current = null;
    setS(next);
    if (attempt >= ATTEMPTS) {
      if (next.makes === ATTEMPTS) onAchieve('perfect');
      onScore(next.score);
      onSave(null);
      setPhase('done');
    } else {
      onSave(next);
      setPhase('aim');
    }
  };

  const flick = useFlick((f) => {
    if (phase !== 'aim' || paused || f.dy > -20) return;
    ball.current = kick(f);
    trail.current = [];
    result.current = null;
    setPhase('flight');
  });

  useLoop(canvas, size, !paused, (ctx, w, h, dt) => {
    const dist = metres(s.yards);
    // Physics
    const b = ball.current;
    if (b && dt > 0) {
      let n = step(b, s.wind, dt);
      if (!result.current) {
        const o = judge(b, n, dist);
        if (o) {
          result.current = { o, t: 0, settled: false };
          if (o === 'doink') n = { ...n, vz: -n.vz * 0.4, vx: -n.vx * 0.5 };
        }
      } else {
        result.current.t += dt;
      }
      if (n.y < 0) n = { ...n, y: 0, vy: Math.abs(n.vy) * 0.35, vz: n.vz * 0.6, vx: n.vx * 0.6 };
      ball.current = n;
      trail.current.push(n);
      if (trail.current.length > 24) trail.current.shift();
      const r = result.current;
      if (r && !r.settled && r.t > 1.3) { r.settled = true; finish(r.o); }
    }

    // Scene
    const cam: Cam = { z: -6, y: 1.6, focal: w * 1.5, cx: w / 2, horizon: h * 0.34 };
    const sky = ctx.createLinearGradient(0, 0, 0, cam.horizon);
    sky.addColorStop(0, '#3b5f8f');
    sky.addColorStop(1, '#a8c6de');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, cam.horizon + 1);
    ctx.fillStyle = '#2f6b33';
    ctx.fillRect(0, cam.horizon, w, h - cam.horizon);
    const band = metres(5);
    for (let k = 0; k * band < dist + 40; k++) {
      const z0 = k * band - 6, z1 = z0 + band;
      const a = project(cam, -40, 0, Math.max(z0, -5)), c = project(cam, -40, 0, z1);
      ctx.fillStyle = k % 2 ? '#357738' : '#2f6b33';
      ctx.fillRect(0, c.y, w, a.y - c.y + 1);
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.fillRect(0, c.y, w, Math.max(1, c.s * 0.1));
    }
    // End zone behind the posts
    const ez = project(cam, 0, 0, dist), ez2 = project(cam, 0, 0, dist + 10);
    ctx.fillStyle = '#6b3a2a';
    ctx.fillRect(0, ez2.y, w, ez.y - ez2.y);

    // Uprights
    const base = project(cam, 0, 0, dist + 1.5), bar = project(cam, 0, BAR, dist);
    const l = project(cam, -HALF, BAR, dist), r = project(cam, HALF, BAR, dist);
    const lt = project(cam, -HALF, BAR + 8, dist), rt = project(cam, HALF, BAR + 8, dist);
    ctx.strokeStyle = '#f2c230';
    ctx.lineCap = 'square';
    ctx.lineWidth = Math.max(2, bar.s * 0.18);
    ctx.beginPath();
    ctx.moveTo(base.x, base.y); ctx.lineTo(bar.x, bar.y);
    ctx.moveTo(l.x, l.y); ctx.lineTo(r.x, r.y);
    ctx.moveTo(l.x, l.y); ctx.lineTo(lt.x, lt.y);
    ctx.moveTo(r.x, r.y); ctx.lineTo(rt.x, rt.y);
    ctx.stroke();
    // Wind pennants on top of the uprights
    for (const t of [lt, rt]) {
      const len = Math.max(6, bar.s * 0.9) * (0.3 + Math.min(1, Math.abs(s.wind) / 3));
      const flap = Math.sin(performance.now() / 120 + t.x) * 2;
      ctx.fillStyle = '#d8453b';
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(t.x + Math.sign(s.wind || 0.01) * len, t.y + 3 + flap);
      ctx.lineTo(t.x, t.y + 7);
      ctx.fill();
    }

    // Holder and the tee spot
    const spot = project(cam, 0, 0, 0);
    const pose = result.current ? (result.current.o === 'good' ? 'cheer' : 'think') : phase === 'flight' ? 'look1' : 'hold';
    drawCrew(ctx, holder, pose, spot.x - spot.s * 0.55, spot.y + spot.s * 0.05, spot.s * 1.0);

    // Ball, its shadow and trail
    const cur = ball.current ?? { x: 0, y: 0.15, z: 0 } as Ball;
    trail.current.forEach((t, i) => {
      const p = project(cam, t.x, t.y, t.z);
      ctx.fillStyle = `rgba(255,255,255,${(i / trail.current.length) * 0.35})`;
      ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
    });
    const sh = project(cam, cur.x, 0, cur.z);
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.beginPath();
    ctx.ellipse(sh.x, sh.y, Math.max(1.5, sh.s * 0.2), Math.max(1, sh.s * 0.07), 0, 0, Math.PI * 2);
    ctx.fill();
    const bp = project(cam, cur.x, cur.y, cur.z);
    const spin = ball.current ? performance.now() / 70 : -0.5;
    ctx.save();
    ctx.translate(bp.x, bp.y);
    ctx.rotate(spin);
    ctx.fillStyle = '#8a4a22';
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.max(2, bp.s * 0.17), Math.max(1.5, bp.s * 0.1), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(-bp.s * 0.05, -0.5, bp.s * 0.1, 1);
    ctx.restore();

    // Words
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.round(w * 0.075)}px ui-monospace, monospace`;
    if (result.current) {
      ctx.fillStyle = result.current.o === 'good' ? '#fff' : '#ffd9d4';
      ctx.fillText(SAYS[result.current.o], w / 2, h * 0.16);
    } else if (phase === 'aim') {
      ctx.font = `${Math.round(w * 0.04)}px ui-monospace, monospace`;
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.fillText('Flick up. Bend it to fight the wind.', w / 2, h - 16);
    }
  });

  const arrow = s.wind === 0 ? '·' : s.wind > 0 ? '→' : '←';
  const restart = () => { const f = fresh(); setS(f); setPhase('aim'); };

  return (
    <div className="game-fieldgoal">
      <div className="game-score game-fieldgoal-hud">
        <span>Points <b>{s.score}</b></span>
        <span>Kick {Math.min(s.attempt + 1, ATTEMPTS)}/{ATTEMPTS}</span>
        <span>{s.yards} yd</span>
        <span className="game-fieldgoal-wind">Wind {arrow} {windMph(s.wind)} mph</span>
      </div>
      <div className="game-fieldgoal-field" style={{ width: size.w, height: size.h }}>
        <canvas ref={canvas} style={{ width: size.w, height: size.h }} {...flick} />
        {(phase === 'intro' || phase === 'done') && (
          <div className="game-overlay">
            {phase === 'done' ? <>
              <img src={sprite(holder, s.makes >= 7 ? 'cheer' : 'think')} alt="" />
              <p>{s.makes}/{ATTEMPTS} good, {s.score} points. {best !== undefined && s.score >= best ? 'Best yet!' : ''}</p>
              <button className="chip" onClick={restart}>Kick again</button>
            </> : <>
              <img src={sprite(holder, 'hold')} alt="" />
              <p>Flick up to kick. Longer kicks score more.<br />Curve your swipe to bend it against the wind.</p>
              <button className="chip" onClick={() => setPhase('aim')}>Start</button>
            </>}
          </div>
        )}
      </div>
    </div>
  );
}
