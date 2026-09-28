import { useMemo, useRef, useState } from 'react';
import type { GameMeta, GameProps } from '../types';
import { sprite } from '../types';
import { sfx } from '../../economy/sound';
import { buzz } from '../../haptics';
import { project, type Cam } from '../_sports/flick';
import { useStageSize, useLoop, useFlick, drawCrew, CREW, pick } from '../_sports/stage';
import { ghostAt, isClutch, streakMult, makeTicks } from '../_sports/pace';
import {
  feel, burst, stepParticles, drawParticles, kickShake, shakeOffset, drawCrowd, drawGhost, popText, tag, drawRain,
  CONFETTI, type Particle, type Shake,
} from '../_sports/juice';
import {
  kick, step, judge, windFor, windMph, windNow, weatherFor, metres, pointsFor, nextYards, centred, ghostScore,
  BAR, HALF, ATTEMPTS, START_YARDS, type Ball, type Outcome, type Weather,
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
    { id: 'clutch', name: 'Ice in the veins', says: 'Make the clutch last kick.' },
    { id: 'rain', name: 'Mudder', says: 'Make one in the rain from 40 or more.' },
    { id: 'hot', name: 'On fire', says: 'Make five in a row for the x3.' },
  ],
  ghostScore,
  safeCorner: 'br',
};

interface Save { attempt: number; score: number; makes: number; yards: number; wind: number; streak: number; weather: Weather }
const fresh = (): Save => ({ attempt: 0, score: 0, makes: 0, yards: START_YARDS, wind: windFor(START_YARDS, Math.random()), streak: 0, weather: 'clear' });

const SAYS: Record<Outcome, string> = { good: "IT'S GOOD!", doink: 'DOINK!', short: 'Short', 'wide-left': 'Wide left', 'wide-right': 'Wide right' };

interface Result { o: Outcome; t: number; settled: boolean; x: number; pts: number }

export function Game({ save, onSave, onScore, onAchieve, paused, best, ghost }: GameProps<Save>) {
  const [s, setS] = useState<Save>(() => (save ? { ...fresh(), ...save } : fresh()));
  const [phase, setPhase] = useState<'intro' | 'aim' | 'flight' | 'done'>(save ? 'aim' : 'intro');
  const size = useStageSize();
  const canvas = useRef<HTMLCanvasElement>(null);
  const ball = useRef<Ball | null>(null);
  const flightT = useRef(0);
  const trail = useRef<Ball[]>([]);
  const result = useRef<Result | null>(null);
  const parts = useRef<Particle[]>([]);
  const shake = useRef<Shake>({ t: 0, mag: 0 });
  const excite = useRef(0);
  const holderKick = useRef(0);
  const holder = useMemo(() => pick(CREW.filter((n) => n !== 'pip')), []);
  const clutch = isClutch(s.attempt, ATTEMPTS);

  const finish = (r: Result) => {
    const made = r.o === 'good';
    const attempt = s.attempt + 1;
    const yards = nextYards(s.yards, made);
    const streak = made ? s.streak + 1 : 0;
    const next: Save = {
      attempt, score: s.score + r.pts, makes: s.makes + (made ? 1 : 0), yards, streak,
      wind: windFor(yards, Math.random()), weather: weatherFor(attempt, Math.random()),
    };
    if (made) onAchieve('first');
    if (made && s.yards >= 50) onAchieve('fifty');
    if (made && s.weather === 'rain' && s.yards >= 40) onAchieve('rain');
    if (made && clutch) onAchieve('clutch');
    if (streak >= 5) onAchieve('hot');
    if (r.o === 'doink') onAchieve('doink');
    ball.current = null;
    trail.current = [];
    result.current = null;
    setS(next);
    if (attempt >= ATTEMPTS) {
      if (next.makes === ATTEMPTS) onAchieve('perfect');
      const beat = !ghost || next.score > ghost.target;
      buzz(next.makes >= 5 && beat ? 'pass' : 'fail');
      sfx(next.makes >= 5 && beat ? 'win' : 'lose');
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
    ball.current = kick(f, s.weather);
    flightT.current = 0;
    trail.current = [];
    result.current = null;
    holderKick.current = 0.25;
    feel(1);
    sfx('whoosh');
    setPhase('flight');
  });

  useLoop(canvas, size, !paused, (ctx, w, h, dt, now) => {
    const dist = metres(s.yards);
    // Physics
    const b = ball.current;
    if (b && dt > 0) {
      flightT.current += dt;
      let n = step(b, windNow(s.wind, s.weather, flightT.current), dt);
      if (!result.current) {
        const o = judge(b, n, dist);
        if (o) {
          const made = o === 'good';
          const x = b.x + (n.x - b.x) * ((dist - b.z) / Math.max(1e-6, n.z - b.z));
          const middle = made && centred(x) > 0.8;
          const pts = made ? pointsFor(s.yards, s.streak + 1, clutch, middle) : 0;
          result.current = { o, t: 0, settled: false, x, pts };
          if (o === 'doink') {
            n = { ...n, vz: -n.vz * 0.4, vx: -n.vx * 0.5 };
            feel(1, 20, true);
            sfx('hit');
            kickShake(shake.current, 5);
          } else if (made) {
            feel(makeTicks(2, s.streak + 1) + (clutch ? 1 : 0), 45, true);
            sfx(clutch || s.streak + 1 >= 3 ? 'coin' : 'score');
            excite.current = 1.6;
            const bp = project(camFor(w, h), x, BAR + 1.5, dist);
            burst(parts.current, bp.x, bp.y, clutch ? 60 : 30, CONFETTI, 180);
          } else {
            sfx('lose');
          }
        }
      } else {
        result.current.t += dt;
      }
      if (n.y < 0) n = { ...n, y: 0, vy: Math.abs(n.vy) * 0.35, vz: n.vz * 0.6, vx: n.vx * 0.6 };
      ball.current = n;
      trail.current.push(n);
      if (trail.current.length > 24) trail.current.shift();
      const r = result.current;
      if (r && !r.settled && r.t > 1.5) { r.settled = true; finish(r); }
    }
    excite.current = Math.max(0, excite.current - dt);
    holderKick.current = Math.max(0, holderKick.current - dt);
    stepParticles(parts.current, dt);

    // Scene
    const cam = camFor(w, h);
    const [sx, sy] = shakeOffset(shake.current, dt);
    ctx.save();
    ctx.translate(sx, sy);
    const night = s.weather === 'rain';
    const sky = ctx.createLinearGradient(0, 0, 0, cam.horizon);
    sky.addColorStop(0, night ? '#1f2a3a' : '#3b5f8f');
    sky.addColorStop(1, night ? '#56667a' : '#a8c6de');
    ctx.fillStyle = sky;
    ctx.fillRect(-10, -10, w + 20, cam.horizon + 11);
    // Stadium: stands and lights
    const standTop = cam.horizon * 0.35;
    ctx.fillStyle = '#2b2f3c';
    ctx.fillRect(-10, standTop, w + 20, cam.horizon - standTop);
    drawCrowd(ctx, 0, standTop + 4, w, cam.horizon - standTop - 6, Math.min(1, excite.current), now, excite.current > 0.4 ? ((1.6 - excite.current) / 1.2) : -1, 6);
    for (const lx of [w * 0.08, w * 0.92]) {
      ctx.fillStyle = '#555c6a';
      ctx.fillRect(lx - 1, standTop - 34, 2, 34);
      ctx.fillStyle = night ? '#fff7cf' : '#e9e6d6';
      ctx.fillRect(lx - 10, standTop - 42, 20, 9);
      if (night) {
        ctx.fillStyle = 'rgba(255,247,207,.10)';
        ctx.beginPath(); ctx.moveTo(lx - 10, standTop - 33); ctx.lineTo(w / 2 - 60, h); ctx.lineTo(w / 2 + 60, h); ctx.lineTo(lx + 10, standTop - 33); ctx.fill();
      }
    }
    ctx.fillStyle = '#2f6b33';
    ctx.fillRect(-10, cam.horizon, w + 20, h - cam.horizon + 10);
    const band = metres(5);
    for (let k = 0; k * band < dist + 40; k++) {
      const z0 = k * band - 6, z1 = z0 + band;
      const a = project(cam, -40, 0, Math.max(z0, -5)), c = project(cam, -40, 0, z1);
      ctx.fillStyle = k % 2 ? '#357738' : '#2f6b33';
      ctx.fillRect(-10, c.y, w + 20, a.y - c.y + 1);
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.fillRect(-10, c.y, w + 20, Math.max(1, c.s * 0.1));
      // Hash marks, for depth
      for (const hx of [-3, 3]) {
        const hm = project(cam, hx, 0, z1);
        ctx.fillRect(hm.x - hm.s * 0.3, hm.y, hm.s * 0.6, Math.max(1, hm.s * 0.08));
      }
    }
    // End zone behind the posts
    const ez = project(cam, 0, 0, dist), ez2 = project(cam, 0, 0, dist + 10);
    ctx.fillStyle = '#6b3a2a';
    ctx.fillRect(-10, ez2.y, w + 20, ez.y - ez2.y);
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.font = `bold ${Math.max(8, Math.round((ez.y - ez2.y) * 0.8))}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ROOST', w / 2, (ez.y + ez2.y) / 2);
    ctx.textBaseline = 'alphabetic';

    // Uprights (wobble after a doink)
    const r0 = result.current;
    const wob = r0?.o === 'doink' ? Math.sin(r0.t * 40) * Math.max(0, 1 - r0.t) * 0.12 : 0;
    const base = project(cam, 0, 0, dist + 1.5), bar = project(cam, 0, BAR, dist);
    const l = project(cam, -HALF, BAR, dist), r = project(cam, HALF, BAR, dist);
    const lt = project(cam, -HALF + wob, BAR + 8, dist), rt = project(cam, HALF + wob, BAR + 8, dist);
    const posts = () => {
      ctx.beginPath();
      ctx.moveTo(base.x, base.y); ctx.lineTo(bar.x, bar.y);
      ctx.moveTo(l.x, l.y); ctx.lineTo(r.x, r.y);
      ctx.moveTo(l.x, l.y); ctx.lineTo(lt.x, lt.y);
      ctx.moveTo(r.x, r.y); ctx.lineTo(rt.x, rt.y);
      ctx.stroke();
    };
    ctx.lineCap = 'square';
    ctx.lineWidth = Math.max(2, bar.s * 0.18);
    ctx.strokeStyle = '#a07a12';
    ctx.save(); ctx.translate(1, 1); posts(); ctx.restore();
    ctx.strokeStyle = clutch ? '#ffd84a' : '#f2c230';
    posts();
    // Wind pennants on top of the uprights
    const wn = windNow(s.wind, s.weather, phase === 'flight' ? flightT.current : now / 1000);
    for (const t of [lt, rt]) {
      const len = Math.max(6, bar.s * 0.9) * (0.3 + Math.min(1, Math.abs(wn) / 3));
      const flap = Math.sin(now / 120 + t.x) * 2;
      ctx.fillStyle = '#d8453b';
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(t.x + Math.sign(wn || 0.01) * len, t.y + 3 + flap);
      ctx.lineTo(t.x, t.y + 7);
      ctx.fill();
    }

    // Holder and the tee spot
    const spot = project(cam, 0, 0, 0);
    const pose = result.current ? (result.current.o === 'good' ? 'cheer' : 'think') : phase === 'flight' ? 'look1' : 'hold';
    const squash = holderKick.current > 0 ? 1 - holderKick.current * 0.4 : 1;
    drawCrew(ctx, holder, pose, spot.x - spot.s * 0.55, spot.y + spot.s * 0.05, spot.s * squash);

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
    // End over end: the ball's long axis flips, so squash its height with the spin
    const spin = ball.current ? flightT.current * 14 : 0;
    const rx = Math.max(2, bp.s * 0.17), ry = Math.max(1.5, bp.s * 0.1) * (ball.current ? 0.55 + 0.45 * Math.abs(Math.cos(spin)) : 1);
    ctx.save();
    ctx.translate(bp.x, bp.y);
    ctx.rotate(ball.current ? -0.2 + (cur.vx || 0) * 0.02 : -0.5);
    ctx.fillStyle = '#8a4a22';
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b86a38';
    ctx.beginPath();
    ctx.ellipse(-rx * 0.2, -ry * 0.3, rx * 0.5, ry * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    if (Math.cos(spin) > -0.2) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(-rx * 0.3, -0.5, rx * 0.6, 1);
    }
    ctx.restore();

    drawParticles(ctx, parts.current);
    drawRain(ctx, w, h, now, s.weather === 'rain' ? 1 : 0, 0.15 + s.wind * 0.08);
    ctx.restore();

    // Ghost on the left sideline, their score ticking with the kicks
    if (ghost && phase !== 'intro') {
      const gs = ghostAt(ghost.target, ATTEMPTS, s.attempt / ATTEMPTS, ghost.name.length + ATTEMPTS);
      drawGhost(ctx, ghost, 22, cam.horizon + 58, 34, now, gs, s.score);
    }

    // Tags: multiplier, clutch, weather
    let ty = 8;
    const mult = streakMult(s.streak + 1);
    if (phase !== 'done' && phase !== 'intro') {
      if (clutch) { tag(ctx, 'CLUTCH KICK x2', w - 8, ty, 12, '#ffd84a', '#1a1a1a', 'right'); ty += 22; }
      if (mult > 1) { tag(ctx, `STREAK x${mult}`, w - 8, ty, 12, '#e8622c', '#fff', 'right'); ty += 22; }
      if (s.weather !== 'clear') tag(ctx, s.weather === 'rain' ? 'RAIN: heavy ball' : 'GUSTY', w - 8, ty, 11, 'rgba(20,30,50,.75)', '#dfe8ff', 'right');
    }

    // Words
    const res = result.current;
    if (res) {
      popText(ctx, SAYS[res.o], w / 2, h * 0.16, w * 0.08, res.o === 'good' ? '#fff' : '#ffd9d4', res.t, 1.6);
      if (res.pts) popText(ctx, `+${res.pts}${centred(res.x) > 0.8 ? '  down the middle' : ''}`, w / 2, h * 0.16 + w * 0.08, w * 0.042, '#ffe27a', Math.max(0, res.t - 0.2), 1.4);
    } else if (phase === 'aim' && s.attempt === 0) {
      ctx.textAlign = 'center';
      ctx.font = `${Math.round(w * 0.04)}px ui-monospace, monospace`;
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.fillText('Flick up. Bend it to fight the wind.', w / 2, h - 16);
    }
  });

  const arrow = s.wind === 0 ? '·' : s.wind > 0 ? '→' : '←';
  const restart = () => { const f = fresh(); setS(f); parts.current = []; setPhase('aim'); };

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
              {ghost && <p className="game-fieldgoal-ghost">{s.score > ghost.target ? `You beat ${ghost.name}'s ghost (${ghost.target}).` : `${ghost.name}'s ghost had ${ghost.target}.`}</p>}
              <button className="chip" onClick={restart}>Kick again</button>
            </> : <>
              <img src={sprite(holder, 'hold')} alt="" />
              <p>Flick up to kick. Longer kicks score more.<br />Curve your swipe to bend it against the wind.<br />Make three in a row for x2, five for x3.<br />Split the posts for a bonus. The last kick counts double.</p>
              <button className="chip" onClick={() => setPhase('aim')}>Start</button>
            </>}
          </div>
        )}
      </div>
    </div>
  );
}

function camFor(w: number, h: number): Cam {
  return { z: -6, y: 1.6, focal: w * 1.5, cx: w / 2, horizon: h * 0.34 };
}
