import { useMemo, useRef, useState } from 'react';
import type { GameMeta, GameProps } from '../types';
import { sprite } from '../types';
import { sfx } from '../../economy/sound';
import { buzz } from '../../haptics';
import { project, type Cam } from '../_sports/flick';
import { useStageSize, useLoop, useFlick, drawCrew, CREW, pick } from '../_sports/stage';
import { ghostAt, makeTicks } from '../_sports/pace';
import {
  feel, burst, stepParticles, drawParticles, kickShake, shakeOffset, drawCrowd, drawGhost, popText, tag, reducedMotion,
  CONFETTI, type Particle, type Shake,
} from '../_sports/juice';
import {
  launch, step, hoopX, hoopMotion, pointsFor, isMoney, onFire, isClutchTime, multiplier, ghostScore,
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
    { id: 'fire', name: "He's on fire", says: 'Catch fire: three makes in a row.' },
    { id: 'money', name: 'Money', says: 'Sink a gold money ball.' },
    { id: 'buzzer', name: 'Buzzer beater', says: 'Score with the clock at zero.' },
  ],
  ghostScore,
  safeCorner: 'br',
};

interface Save { left: number; score: number; makes: number; shots: number; swishRun: number; makeRun: number }
const fresh = (): Save => ({ left: ROUND_SECONDS, score: 0, makes: 0, shots: 0, swishRun: 0, makeRun: 0 });

interface Flying { b: Ball; counted: boolean; pop: number; money: boolean; fire: boolean; hits: number; spin: number }

export function Game({ save, onSave, onScore, onAchieve, paused, best, ghost }: GameProps<Save>) {
  const [s, setS] = useState<Save>(() => (save ? { ...fresh(), ...save } : fresh()));
  const [screen, setScreen] = useState<'intro' | 'play' | 'done'>(save ? 'play' : 'intro');
  const size = useStageSize();
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ ...s });
  const balls = useRef<Flying[]>([]);
  const clock = useRef(0); // seconds the hoop has been moving
  const ready = useRef(0); // until the next ball is in hand
  const cheer = useRef(0);
  const ended = useRef(false);
  const text = useRef<{ say: string; sub: string; t: number; color: string } | null>(null);
  const parts = useRef<Particle[]>([]);
  const shake = useRef<Shake>({ t: 0, mag: 0 });
  const net = useRef({ t: 0, amp: 0 });
  const friend = useMemo(() => pick(CREW), []);

  const flick = useFlick((f) => {
    const L = live.current;
    if (screen !== 'play' || paused || f.dy > -20 || ready.current > 0 || L.left <= 0) return;
    balls.current.push({ b: launch(f), counted: false, pop: 0, money: isMoney(L.shots), fire: onFire(L.makeRun), hits: 0, spin: 0 });
    L.shots++;
    ready.current = 0.35;
    sfx('whoosh');
  });

  const end = () => {
    const final = { ...live.current, left: 0 };
    if (final.score >= 40) onAchieve('forty');
    const good = final.score >= 20 && (!ghost || final.score > ghost.target);
    buzz(good ? 'pass' : 'fail');
    sfx(good ? 'win' : 'lose');
    onScore(final.score);
    onSave(null);
    setS(final);
    setScreen('done');
  };

  useLoop(canvas, size, !paused, (ctx, w, h, dt, now) => {
    const L = live.current;
    const hx = hoopX(L.score, clock.current);
    const c: Cam = { z: -2.2, y: 1.6, focal: w * 1.05, cx: w / 2, horizon: h * 0.6 };
    if (screen === 'play') {
      if (hoopMotion(L.score).amp > 0) clock.current += dt;
      ready.current = Math.max(0, ready.current - dt);
      cheer.current = Math.max(0, cheer.current - dt);
      const was = Math.ceil(L.left);
      let dirty = false;
      L.left = Math.max(0, L.left - dt);
      for (const f of balls.current) {
        for (let i = 0; i < 4; i++) f.b = step(f.b, dt / 4, hx);
        f.spin += dt * (6 + f.b.vz * 2);
        if ((f.b.hits ?? 0) > f.hits) {
          f.hits = f.b.hits ?? 0;
          if (!f.b.scored) { feel(1, 20); sfx('bounce'); }
          if (f.fire) { const p = project(c, f.b.x, f.b.y, f.b.z); burst(parts.current, p.x, p.y, 6, ['#ffb347', '#ff6a2a'], 80, 200, 2); }
        }
        if (f.b.scored && !f.counted) {
          f.counted = true;
          const swish = !f.b.touched;
          const clutch = isClutchTime(L.left) || L.left <= 0;
          const pts = pointsFor(swish, { fire: f.fire, money: f.money, clutch });
          L.score += pts;
          L.makes++;
          L.makeRun++;
          L.swishRun = swish ? L.swishRun + 1 : 0;
          onAchieve('first');
          if (L.swishRun >= 3) onAchieve('swish3');
          if (onFire(L.makeRun)) onAchieve('fire');
          if (f.money) onAchieve('money');
          if (L.left <= 0) onAchieve('buzzer');
          if (hoopMotion(L.score - pts).amp > 0) onAchieve('moving');
          const lit = L.makeRun === 3;
          text.current = {
            say: L.left <= 0 ? 'BUZZER BEATER!' : lit ? 'ON FIRE!' : swish ? 'SWISH!' : 'BUCKET',
            sub: `+${pts}${f.money ? '  money ball' : ''}`,
            t: 0, color: lit || f.fire ? '#ffb347' : f.money ? '#ffe27a' : '#fff',
          };
          feel(makeTicks(swish ? 2 : 1, L.makeRun) + (f.money ? 1 : 0), 45, true);
          sfx(f.money || lit ? 'coin' : 'score');
          cheer.current = 0.8;
          net.current = { t: 0, amp: swish ? 1 : 0.6 };
          const rp = project(c, hx, RIM_Y - 0.3, HOOP_Z);
          burst(parts.current, rp.x, rp.y, f.money ? 40 : swish ? 22 : 12, f.fire ? ['#ffb347', '#ff6a2a', '#ffe27a'] : f.money ? ['#ffe27a', '#f2c230'] : CONFETTI, 120);
          if (f.money || lit) kickShake(shake.current, 3);
          dirty = true;
        }
        if (f.b.done && !f.counted) {
          f.counted = true;
          if (L.makeRun >= 3) text.current = { say: 'Cooled off', sub: '', t: 0, color: '#bcd' };
          L.swishRun = 0; L.makeRun = 0;
          dirty = true;
        }
        if (f.b.done) f.pop += dt;
        if (f.fire && !f.b.done && !reducedMotion() && Math.random() < 0.6) {
          const p = project(c, f.b.x, f.b.y, f.b.z);
          burst(parts.current, p.x, p.y, 1, ['#ffb347', '#ff6a2a', '#ffe27a'], 30, -60, 3);
        }
      }
      balls.current = balls.current.filter((f) => f.pop < 0.4);
      if (text.current) { text.current.t += dt; if (text.current.t > 1.3) text.current = null; }
      if (Math.ceil(L.left) !== was || dirty) {
        setS({ ...L });
        onSave({ ...L });
        if (Math.ceil(L.left) !== was && L.left > 0 && L.left <= 5) sfx('tap');
      }
      if (L.left <= 0 && !ended.current && balls.current.every((f) => f.b.done)) { ended.current = true; end(); }
    }
    net.current.t += dt;
    stepParticles(parts.current, dt);
    const clutchNow = screen === 'play' && isClutchTime(L.left);
    const fireNow = onFire(L.makeRun);

    const [sx, sy] = shakeOffset(shake.current, dt);
    ctx.save();
    ctx.translate(sx, sy);
    // Gym: wall, bleachers with the crowd, banners
    ctx.fillStyle = clutchNow ? '#43304a' : '#3a3346';
    ctx.fillRect(-10, -10, w + 20, c.horizon + 10);
    const wall = project(c, 0, 0, BOARD_Z + 1.2);
    const bleacherTop = c.horizon * 0.42, bleacherBot = wall.y - 4;
    ctx.fillStyle = '#2d2838';
    ctx.fillRect(-10, bleacherTop, w + 20, bleacherBot - bleacherTop);
    for (let y = bleacherTop; y < bleacherBot; y += 7) { ctx.fillStyle = '#3d3650'; ctx.fillRect(-10, y + 6, w + 20, 1); }
    drawCrowd(ctx, 4, bleacherTop + 3, w - 8, bleacherBot - bleacherTop - 6, cheer.current > 0 ? cheer.current + (fireNow ? 0.3 : 0) : clutchNow ? 0.25 : 0, now, -1, 7);
    ctx.fillStyle = '#463d55';
    for (let i = 0; i < 3; i++) ctx.fillRect(0, (bleacherTop / 3) * i, w, 2);
    for (let i = 0; i < 3; i++) {
      const bx = w * (0.15 + i * 0.35);
      ctx.fillStyle = ['#d8453b', '#f2c230', '#5a86c9'][i];
      ctx.beginPath(); ctx.moveTo(bx - 10, 6); ctx.lineTo(bx + 10, 6); ctx.lineTo(bx + 10, 26); ctx.lineTo(bx, 32); ctx.lineTo(bx - 10, 26); ctx.fill();
    }
    // Shot clock
    ctx.fillStyle = '#111';
    ctx.fillRect(w / 2 - 22, bleacherTop - 22, 44, 18);
    ctx.fillStyle = clutchNow ? '#ff5a4a' : '#ffb347';
    ctx.font = 'bold 14px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.ceil(L.left)).padStart(2, '0'), w / 2, bleacherTop - 13);
    ctx.textBaseline = 'alphabetic';

    const floor = ctx.createLinearGradient(0, c.horizon, 0, h);
    floor.addColorStop(0, '#9c6a3a');
    floor.addColorStop(1, '#c8904f');
    ctx.fillStyle = floor;
    ctx.fillRect(-10, c.horizon, w + 20, h - c.horizon + 10);
    // Floorboards
    ctx.strokeStyle = 'rgba(80,45,20,.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -6; x <= 6; x += 0.5) { const a = project(c, x, 0, -2), b = project(c, x, 0, BOARD_Z + 1.2); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    ctx.stroke();
    ctx.fillStyle = clutchNow ? '#43304a' : '#3a3346';
    ctx.fillRect(-10, c.horizon, w + 20, wall.y - c.horizon);
    // Key, painted when you're on fire
    const key = [[-1.8, HOOP_Z + 1], [1.8, HOOP_Z + 1], [1.8, HOOP_Z - 4.8], [-1.8, HOOP_Z - 4.8]].map(([x, z]) => project(c, x, 0, z));
    ctx.fillStyle = fireNow ? 'rgba(232,98,44,.28)' : 'rgba(90,134,201,.18)';
    ctx.beginPath(); key.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.7)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Friend under the basket
    const fp = project(c, -2.3, 0, HOOP_Z);
    drawCrew(ctx, friend, cheer.current > 0 ? 'cheer' : L.left <= 0 ? 'sit' : 'look2', fp.x, fp.y, project(c, 0, 0, HOOP_Z).s * 1.3);

    // Backboard and pole
    const pole = project(c, hx, 0, BOARD_Z + 0.9), poleTop = project(c, hx, BOARD_LOW, BOARD_Z + 0.9);
    ctx.fillStyle = '#555';
    ctx.fillRect(pole.x - 3, poleTop.y, 6, pole.y - poleTop.y);
    const b1 = project(c, hx - BOARD_HALF, BOARD_HIGH, BOARD_Z), b2 = project(c, hx + BOARD_HALF, BOARD_LOW, BOARD_Z);
    ctx.fillStyle = 'rgba(235,240,245,.92)';
    ctx.fillRect(b1.x, b1.y, b2.x - b1.x, b2.y - b1.y);
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.fillRect(b1.x + 3, b1.y + 3, (b2.x - b1.x) * 0.3, 2);
    ctx.strokeStyle = fireNow ? '#ff8a2a' : '#d8453b';
    ctx.lineWidth = 2;
    ctx.strokeRect(b1.x + 1, b1.y + 1, b2.x - b1.x - 2, b2.y - b1.y - 2);
    const q1 = project(c, hx - 0.3, RIM_Y + 0.45, BOARD_Z), q2 = project(c, hx + 0.3, RIM_Y, BOARD_Z);
    ctx.strokeRect(q1.x, q1.y, q2.x - q1.x, q2.y - q1.y);

    const drawRim = (front: boolean) => {
      const ctr = project(c, hx, RIM_Y, HOOP_Z);
      const rx = RIM_R * ctr.s, ry = RIM_R * ctr.s * 0.28;
      if (front) {
        // Net: sways and stretches after a make
        const n = net.current;
        const amp = n.amp * Math.max(0, 1 - n.t / 0.8) * (reducedMotion() ? 0.4 : 1);
        const stretch = 1 + amp * 0.35 * Math.max(0, Math.sin(Math.min(1, n.t / 0.25) * Math.PI));
        const sway = amp * Math.sin(n.t * 22) * rx * 0.12;
        const drop = ctr.s * 0.4 * stretch;
        ctx.strokeStyle = 'rgba(255,255,255,.8)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= 8; i++) {
          const a = (i / 8) * Math.PI;
          const x = ctr.x + Math.cos(a) * rx, y = ctr.y + Math.sin(a) * ry;
          ctx.moveTo(x, y); ctx.lineTo(ctr.x + Math.cos(a) * rx * 0.6 + sway, ctr.y + drop);
        }
        for (const k of [0.35, 0.7]) {
          ctx.moveTo(ctr.x - rx * (1 - 0.4 * k) + sway * k, ctr.y + drop * k);
          ctx.lineTo(ctr.x + rx * (1 - 0.4 * k) + sway * k, ctr.y + drop * k);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = fireNow ? '#ff8a2a' : '#e8622c';
      ctx.lineWidth = Math.max(2, ctr.s * 0.03);
      ctx.beginPath();
      ctx.ellipse(ctr.x, ctr.y, rx, ry, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
      ctx.stroke();
    };
    const drawBall = (b: Ball, alpha = 1, money = false, spin = 0) => {
      const p = project(c, b.x, b.y, b.z), g = project(c, b.x, 0, b.z);
      ctx.globalAlpha = alpha * 0.3;
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(g.x, g.y, p.s * BALL_R, p.s * BALL_R * 0.3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = alpha;
      const r = Math.max(2, p.s * BALL_R);
      ctx.fillStyle = money ? '#f2c230' : '#e07b2c';
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = money ? '#ffe27a' : '#f09a4c';
      ctx.beginPath(); ctx.arc(p.x - r * 0.3, p.y - r * 0.3, r * 0.45, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(spin);
      ctx.strokeStyle = money ? '#7a5a10' : '#5a2d10';
      ctx.lineWidth = Math.max(1, p.s * 0.012);
      ctx.beginPath();
      ctx.moveTo(-r, 0); ctx.lineTo(r, 0);
      ctx.moveTo(0, -r); ctx.lineTo(0, r);
      ctx.moveTo(-r * 0.7, -r * 0.7); ctx.quadraticCurveTo(0, 0, -r * 0.7, r * 0.7);
      ctx.moveTo(r * 0.7, -r * 0.7); ctx.quadraticCurveTo(0, 0, r * 0.7, r * 0.7);
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
    };

    // Balls behind the rim, then the rim, then balls in front of it
    const flying = [...balls.current].sort((a, b) => b.b.z - a.b.z);
    const behind = (f: Flying) => f.b.z > HOOP_Z || (f.b.y < RIM_Y && Math.abs(f.b.z - HOOP_Z) < RIM_R);
    drawRim(false);
    flying.filter(behind).forEach((f) => drawBall(f.b, 1 - f.pop / 0.4, f.money, f.spin));
    drawRim(true);
    flying.filter((f) => !behind(f)).forEach((f) => drawBall(f.b, 1 - f.pop / 0.4, f.money, f.spin));
    if (screen === 'play' && ready.current === 0 && L.left > 0) {
      const money = isMoney(L.shots);
      if (fireNow && !reducedMotion()) {
        const hp = project(c, 0, 1, 0);
        ctx.fillStyle = 'rgba(255,140,40,.35)';
        ctx.beginPath(); ctx.arc(hp.x, hp.y, hp.s * BALL_R * (1.6 + Math.sin(now / 80) * 0.15), 0, Math.PI * 2); ctx.fill();
      }
      drawBall({ x: 0, y: 1, z: 0 } as Ball, 1, money, 0);
    }
    drawParticles(ctx, parts.current);
    ctx.restore();

    // Ghost, top left, racing the same clock
    if (ghost && screen !== 'intro') {
      drawGhost(ctx, ghost, 22, 52, 32, now, ghostAt(ghost.target, ROUND_SECONDS, (ROUND_SECONDS - L.left) / ROUND_SECONDS, ghost.name.length + 3), L.score);
    }
    if (screen === 'play') {
      let ty = 40;
      const mult = multiplier(fireNow, clutchNow);
      if (clutchNow) { tag(ctx, 'CLUTCH x2', w - 8, ty, 12, '#ff5a4a', '#fff', 'right'); ty += 22; }
      if (fireNow) { tag(ctx, `ON FIRE x${mult}`, w - 8, ty, 12, '#ff8a2a', '#fff', 'right'); ty += 22; }
      if (isMoney(L.shots)) tag(ctx, 'MONEY BALL +2', w - 8, ty, 11, '#f2c230', '#1a1a1a', 'right');
    }

    const tx = text.current;
    if (tx) {
      popText(ctx, tx.say, w / 2, h * 0.14 + 30, w * 0.08, tx.color, tx.t, 1.3);
      if (tx.sub) popText(ctx, tx.sub, w / 2, h * 0.14 + 30 + w * 0.08, w * 0.045, '#ffe27a', Math.max(0, tx.t - 0.15), 1.15);
    } else if (screen === 'play' && L.shots === 0) {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.font = `${Math.round(w * 0.04)}px ui-monospace, monospace`;
      ctx.fillText('Flick up, not too hard', w / 2, h - 16);
    }
  });

  const restart = () => {
    const f = fresh();
    live.current = { ...f };
    balls.current = [];
    parts.current = [];
    clock.current = 0;
    ended.current = false;
    text.current = null;
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
              {ghost && <p className="game-basketball-ghost">{s.score > ghost.target ? `You beat ${ghost.name}'s ghost (${ghost.target}).` : `${ghost.name}'s ghost had ${ghost.target}.`}</p>}
              <button className="chip" onClick={restart}>Shoot again</button>
            </> : <>
              <img src={sprite(friend, 'hold')} alt="" />
              <p>Flick up to shoot. Sixty seconds.<br />Swish for 3. Three in a row and you're on fire: double points.<br />Every fifth ball is a gold money ball. The last ten seconds count double.</p>
              <button className="chip" onClick={restart}>Tip off</button>
            </>}
          </div>
        )}
      </div>
    </div>
  );
}
