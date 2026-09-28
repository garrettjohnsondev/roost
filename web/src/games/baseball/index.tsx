import { useMemo, useRef, useState } from 'react';
import type { GameMeta, GameProps } from '../types';
import { sprite } from '../types';
import { sfx } from '../../economy/sound';
import { buzz } from '../../haptics';
import { lerp } from '../_sports/flick';
import { useWideStageSize, useLoop, drawCrew, CREW, pick } from '../_sports/stage';
import { ghostAt, makeTicks } from '../_sports/pace';
import {
  feel, burst, stepParticles, drawParticles, kickShake, shakeOffset, drawCrowd, drawGhost, popText, tag, reducedMotion,
  CONFETTI, type Particle, type Shake,
} from '../_sports/juice';
import {
  pitchFor, pitchAt, judgeSwing, fence, windFor, isGolden, runsFor, onFire, ghostScore,
  OUTS, MOUND, type Pitch, type Hit,
} from './logic';
import './style.css';

export const meta: GameMeta = {
  id: 'baseball',
  name: 'Home Run Derby',
  blurb: 'Tap to swing. Ten outs. Hit it into the trees.',
  host: 'tuck',
  pack: 'sports',
  achievements: [
    { id: 'first', name: 'Gone', says: 'Hit a home run.' },
    { id: 'moon', name: 'Moonshot', says: 'Hit one 450 feet.' },
    { id: 'streak', name: 'Back to back to back', says: 'Three home runs in a row.' },
    { id: 'ten', name: 'Derby champ', says: 'Ten home runs in one round.' },
    { id: 'gold', name: 'Gold glove, gold bat', says: 'Hit a gold ball out.' },
    { id: 'wind', name: 'Into the teeth', says: 'Homer with the wind blowing in.' },
  ],
  ghostScore,
  orientation: 'landscape',
  safeCorner: 'bl',
};

interface Save { outs: number; homers: number; runs: number; pitches: number; streak: number; longest: number; wind: number }
const fresh = (): Save => ({ outs: 0, homers: 0, runs: 0, pitches: 0, streak: 0, longest: 0, wind: windFor(Math.random()) });

const FT = 3.281; // feet per metre
const VS = 2; // vertical stretch, so pitch heights read on a short landscape screen
const MOUND_FT = MOUND * FT;
const WALL = 400; // the drawn wall; every hit is scaled to its own wall
const SAYS: Record<Hit['kind'], string> = { homer: 'HOME RUN!', fly: 'Fly out', grounder: 'Grounder', foul: 'Foul', miss: 'Strike!' };

interface Play {
  phase: 'windup' | 'pitch' | 'hit';
  t: number;
  wait: number;
  pitch: Pitch | null;
  hit: Hit | null;
  swingAt: number | null;
  settled: boolean;
  golden: boolean;
  cleared: boolean;
}
const windup = (): Play => ({ phase: 'windup', t: 0, wait: 0.9 + Math.random() * 0.8, pitch: null, hit: null, swingAt: null, settled: false, golden: false, cleared: false });

/** Where a hit ball is, in feet (x out from the plate, y up), u in 0..1. */
function flight(hit: Hit, u: number) {
  const scaled = (hit.feet * WALL) / fence(hit.spray);
  const D = hit.kind === 'foul' ? hit.feet * 0.25 : hit.kind === 'homer' ? Math.max(WALL + 15, scaled) : Math.min(WALL - 10, scaled);
  const apex = Math.min(160, (D * Math.tan((Math.max(8, hit.launch) * Math.PI) / 180)) / 4);
  if (hit.kind === 'grounder') return { x: D * u * (1 - 0.3 * u), y: Math.abs(Math.sin(u * Math.PI * 3)) * 5 * (1 - u), D, apex: 6 };
  if (hit.kind === 'foul') return { x: -D * u, y: 3 + Math.max(apex, 60) * 4 * u * (1 - u) * 1.2, D, apex: Math.max(apex, 60) };
  return { x: D * u, y: Math.max(0, 3 + apex * 4 * u * (1 - u) - 3 * u), D, apex };
}
const flightTime = (h: Hit) => (h.kind === 'homer' ? 2.3 : h.kind === 'grounder' ? 1.3 : 1.9);

export function Game({ save, onSave, onScore, onAchieve, paused, best, ghost }: GameProps<Save>) {
  const [s, setS] = useState<Save>(() => (save ? { ...fresh(), ...save } : fresh()));
  const [screen, setScreen] = useState<'intro' | 'play' | 'done'>(save ? 'play' : 'intro');
  const size = useWideStageSize();
  const canvas = useRef<HTMLCanvasElement>(null);
  const play = useRef<Play>(windup());
  const pitcher = useMemo(() => pick(CREW.filter((n) => n !== 'tuck')), []);
  const fielder = useMemo(() => pick(CREW.filter((n) => n !== pitcher)), [pitcher]);
  const view = useRef({ k: 0, ox: 0, ground: 0, sweet: 20 });
  const parts = useRef<Particle[]>([]);
  const shake = useRef<Shake>({ t: 0, mag: 0 });
  const excite = useRef(0);
  const fireworks = useRef(0);
  const fire = onFire(s.streak);

  const settle = (hit: Hit | null, golden: boolean) => {
    const homer = hit?.kind === 'homer';
    const next: Save = {
      ...s,
      outs: s.outs + (hit && !homer ? 1 : 0),
      homers: s.homers + (homer ? 1 : 0),
      runs: s.runs + runsFor(homer, golden),
      pitches: s.pitches + 1,
      streak: homer ? s.streak + 1 : hit ? 0 : s.streak,
      longest: Math.max(s.longest, homer ? hit!.feet : 0),
    };
    if (homer) onAchieve('first');
    if (homer && hit!.feet >= 450) onAchieve('moon');
    if (homer && golden) onAchieve('gold');
    if (homer && s.wind <= -6) onAchieve('wind');
    if (next.streak >= 3) onAchieve('streak');
    if (next.homers >= 10) onAchieve('ten');
    setS(next);
    play.current = windup();
    if (next.outs >= OUTS) {
      const good = next.runs >= 3 && (!ghost || next.runs > ghost.target);
      buzz(good ? 'pass' : 'fail');
      sfx(good ? 'win' : 'lose');
      onScore(next.runs);
      onSave(null);
      setScreen('done');
    } else onSave(next);
  };

  const swing = (_x: number, y: number) => {
    const p = play.current;
    if (screen !== 'play' || paused || p.phase !== 'pitch' || p.swingAt !== null || !p.pitch) return;
    p.swingAt = p.t;
    const v = view.current;
    const ballY = v.ground - p.pitch.y * FT * v.k * VS;
    p.hit = judgeSwing(p.t - p.pitch.time, (ballY - y) / v.sweet, { fire, wind: s.wind });
    sfx('whoosh');
    if (p.hit.kind !== 'miss') {
      p.phase = 'hit';
      p.t = 0;
      feel(1, 45, true);
      sfx('hit');
      const hx = v.ox, hy = ballY;
      burst(parts.current, hx, hy, p.hit.perfect ? 16 : 6, ['#fff', '#f3e3c0'], 110, 250, 2);
      if (p.hit.perfect) kickShake(shake.current, 4, 0.18);
    }
  };
  // Swing the moment the finger lands: waiting for the lift-off would make
  // every swing late.
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    swing(e.clientX - r.left, e.clientY - r.top);
  };

  useLoop(canvas, size, !paused, (ctx, w, h, dt, now) => {
    const p = play.current;
    const G = Math.round(h * 0.8);
    const ox = Math.round(w * 0.14);
    const k0 = (w * 0.6) / MOUND_FT;
    const v = view.current;
    if (!v.k) v.k = k0;
    v.ox = ox; v.ground = G; v.sweet = Math.max(14, h * 0.065);

    if (screen === 'play') {
      p.t += dt;
      if (p.phase === 'windup' && p.t >= p.wait) {
        p.phase = 'pitch';
        p.t = 0;
        p.pitch = pitchFor(s.pitches, Math.random(), Math.random(), Math.random());
        p.golden = isGolden(s.pitches, Math.random());
      }
      if (p.phase === 'pitch' && p.pitch && !p.settled) {
        if (p.hit?.kind === 'miss' && p.t > p.pitch.time + 0.9) { p.settled = true; settle(p.hit, p.golden); }
        else if (!p.hit && p.t > p.pitch.time + 0.7) { p.settled = true; settle(null, p.golden); }
        if (p.hit?.kind === 'miss' && p.t > p.pitch.time && p.t - dt <= p.pitch.time) sfx('tap');
      }
      if (p.phase === 'hit' && p.hit) {
        const u = Math.min(1, p.t / flightTime(p.hit));
        const f = flight(p.hit, u);
        if (p.hit.kind === 'homer' && !p.cleared && f.x >= WALL) {
          p.cleared = true;
          feel(makeTicks(3, s.streak + 1) + (p.golden ? 1 : 0), 45, true);
          sfx(p.golden ? 'coin' : 'score');
          excite.current = 2.2;
          fireworks.current = 1.8;
          kickShake(shake.current, 3);
        }
        if (!p.settled && p.t > flightTime(p.hit) + 0.5) { p.settled = true; settle(p.hit, p.golden); }
      }
    }
    // Camera: close on the pitch, pulled back to follow a hit
    let kT = k0;
    if (p.phase === 'hit' && p.hit) {
      const f = flight(p.hit, 1);
      kT = Math.min(k0, (w * 0.8) / (Math.max(60, p.hit.kind === 'foul' ? 60 : Math.max(f.D, p.hit.kind === 'homer' ? WALL + 40 : 0)) + 30), (G - 30) / (Math.max(10, f.apex) * VS));
    }
    v.k = lerp(v.k, kT, Math.min(1, dt * (kT < v.k ? 2.2 : 4)));
    const k = v.k;
    const X = (ft: number) => ox + ft * k;
    const Y = (ft: number) => G - ft * k * VS;

    excite.current = Math.max(0, excite.current - dt);
    if (fireworks.current > 0) {
      fireworks.current -= dt;
      if (Math.random() < dt * 5) burst(parts.current, w * (0.3 + Math.random() * 0.6), h * (0.1 + Math.random() * 0.25), 24, [pick(CONFETTI), pick(CONFETTI)], 120, 60, 2);
    }
    stepParticles(parts.current, dt);

    const [sx, sy] = shakeOffset(shake.current, dt);
    ctx.save();
    ctx.translate(sx, sy);
    // Sky at dusk, stadium lights
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.5);
    sky.addColorStop(0, '#1d2d4f');
    sky.addColorStop(1, '#d98c5f');
    ctx.fillStyle = sky;
    ctx.fillRect(-10, -10, w + 20, h * 0.5 + 10);
    // Stands across the back, with the crowd
    const standTop = h * 0.3, standBot = h * 0.5;
    ctx.fillStyle = '#2a2d3a';
    ctx.fillRect(-10, standTop - 6, w + 20, standBot - standTop + 6);
    const waving = excite.current > 0.5 ? (2.2 - excite.current) / 1.7 : -1;
    drawCrowd(ctx, 0, standTop, w, standBot - standTop - 2, Math.min(1, excite.current), now, waving, 7);
    for (const lx of [w * 0.25, w * 0.75]) {
      ctx.fillStyle = '#4a4f5c';
      ctx.fillRect(lx - 1, standTop - 50, 2, 44);
      ctx.fillStyle = '#fff7cf';
      ctx.fillRect(lx - 14, standTop - 58, 28, 10);
    }
    // Grass, mowed in stripes that scroll with the zoom
    ctx.fillStyle = '#2d5d2f';
    ctx.fillRect(-10, standBot, w + 20, h - standBot + 10);
    for (let ft = -60; ft < 520; ft += 30) {
      const a = X(ft), b = X(ft + 15);
      if (b < -10 || a > w + 10) continue;
      ctx.fillStyle = '#336a35';
      ctx.fillRect(a, standBot, b - a, G - standBot);
    }
    // Warning track, wall and the trees past it
    const wallX = X(WALL);
    ctx.fillStyle = '#8a6a44';
    ctx.fillRect(X(WALL - 15), G - 2, wallX - X(WALL - 15), 4);
    ctx.fillStyle = '#1e3b24';
    for (let i = 0; i < 12; i++) {
      const tx = wallX + 8 + i * Math.max(10, 18 * k * 2), th = 30 + ((i * 37) % 17);
      if (tx > w + 20) break;
      ctx.beginPath(); ctx.moveTo(tx - 10, G); ctx.lineTo(tx, G - th); ctx.lineTo(tx + 10, G); ctx.fill();
    }
    const wallH = Math.max(12, 10 * k * VS);
    ctx.fillStyle = '#1f4d2a';
    ctx.fillRect(wallX, G - wallH, Math.max(4, 3 * k), wallH);
    ctx.fillStyle = '#f2c230';
    ctx.fillRect(wallX, G - wallH, Math.max(4, 3 * k), 2);
    // Wind flag on the foul pole
    ctx.fillStyle = '#f2c230';
    ctx.fillRect(wallX + 1, G - wallH - 40, 2, 40);
    const flap = reducedMotion() ? 0 : Math.sin(now / 110) * 2;
    ctx.fillStyle = '#d8453b';
    ctx.beginPath();
    const fl = 6 + Math.abs(s.wind) * 1.2;
    ctx.moveTo(wallX + 2, G - wallH - 40);
    ctx.lineTo(wallX + 2 + Math.sign(s.wind || 0.1) * fl, G - wallH - 36 + flap);
    ctx.lineTo(wallX + 2, G - wallH - 31);
    ctx.fill();
    // Distance markers
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    for (let ft = 100; ft <= 400; ft += 100) { const x = X(ft); if (x < w - 10) ctx.fillText(String(ft), x, G + 14); }
    // Dirt: the base path strip and the mound
    ctx.fillStyle = '#9c6b43';
    ctx.fillRect(X(-12), G - 1, X(MOUND_FT + 30) - X(-12), 5);
    ctx.beginPath(); ctx.ellipse(X(MOUND_FT), G, 9 * k, Math.max(2, 1 * k * VS), 0, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6b4a2e';
    ctx.fillRect(-10, G + 4, w + 20, h - G);
    ctx.fillStyle = '#f3f0e6';
    ctx.fillRect(ox - Math.max(3, 0.7 * k), G - 1, Math.max(6, 1.4 * k), 2);
    // Strike zone, faint
    if (screen === 'play' && p.phase !== 'hit') {
      ctx.strokeStyle = fire ? 'rgba(255,160,60,.55)' : 'rgba(255,255,255,.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(ox - 4, Y(3.9), 8, Y(1.6) - Y(3.9));
    }

    // Pitcher on the mound, facing the plate
    const pSize = Math.min(h * 0.3, 8 * k * VS);
    const pose = p.phase === 'windup' ? (p.t > p.wait - 0.35 ? 'side' : 'hold')
      : p.phase === 'hit' ? (p.hit?.kind === 'homer' && p.t > 0.8 ? 'think' : 'look1')
      : p.hit?.kind === 'miss' && p.t > p.pitch!.time ? 'cheer' : 'idle';
    drawCrew(ctx, pitcher, pose, X(MOUND_FT), G - Math.max(1, k * VS), pSize, true);
    // Outfielder, running for a fly
    let fx = 300;
    if (p.phase === 'hit' && p.hit?.kind === 'fly') fx = lerp(300, flight(p.hit, 1).D, Math.min(1, p.t / flightTime(p.hit)));
    if (X(fx) < w + 20) drawCrew(ctx, fielder, p.phase === 'hit' && p.hit?.kind === 'fly' && p.t > flightTime(p.hit) ? 'hold' : p.phase === 'hit' ? 'look2' : 'idle', X(fx), G, Math.max(16, pSize * 0.9 * (k / k0) ** 0.5));

    // Batter (Tuck) and the bat
    const bSize = Math.min(h * 0.36, 9 * k * VS);
    const batterX = ox - Math.max(14, 2.5 * k);
    drawCrew(ctx, 'tuck', p.phase === 'hit' && p.hit?.kind === 'homer' && p.t > 0.4 ? 'cheer' : p.swingAt !== null ? 'side' : 'hold', batterX, G, bSize);
    {
      const since = p.swingAt === null ? -1 : p.phase === 'hit' ? p.t + 0.14 : p.t - p.swingAt;
      const kk = since < 0 ? 0 : Math.min(1, since / 0.14);
      const ang = lerp(-2.2, 0.9, 1 - (1 - kk) * (1 - kk)); // from cocked back to follow-through
      const hx = batterX + bSize * 0.2, hy = G - bSize * 0.45;
      const len = bSize * 0.62;
      ctx.strokeStyle = '#c48b4a';
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(3, bSize * 0.06);
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + Math.cos(ang) * len, hy + Math.sin(ang) * len * 0.8); ctx.stroke();
      if (kk > 0 && kk < 1 && !reducedMotion()) {
        ctx.strokeStyle = 'rgba(255,255,255,.35)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(hx, hy, len * 0.9, -2.2, ang); ctx.stroke();
      }
    }

    // Ball
    const ballAt = (x: number, y: number, trail: boolean) => {
      const r = Math.max(3, 0.3 * k * VS);
      if (trail && !reducedMotion()) {
        ctx.fillStyle = p.golden ? 'rgba(255,216,74,.3)' : 'rgba(255,255,255,.25)';
        ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.beginPath(); ctx.ellipse(x, G, r, r * 0.35, 0, 0, Math.PI * 2); ctx.fill();
      if (p.golden) {
        ctx.fillStyle = 'rgba(255,216,74,.35)';
        ctx.beginPath(); ctx.arc(x, y, r * 2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = p.golden ? '#ffd84a' : '#fbfaf5';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#c9352b';
      ctx.lineWidth = 1;
      const spin = now / 40;
      ctx.beginPath(); ctx.arc(x, y, r * 0.65, spin, spin + 1.3); ctx.stroke();
    };
    if (p.phase === 'pitch' && p.pitch) {
      const q = pitchAt(p.pitch, p.t);
      if (q.z > -1.5) {
        if (!reducedMotion()) { const q2 = pitchAt(p.pitch, Math.max(0, p.t - 0.03)); ballAt(X(q2.z * FT), Y(q2.y * FT), false); }
        ballAt(X(q.z * FT), Y(q.y * FT), true);
      }
    } else if (p.phase === 'hit' && p.hit) {
      const u = Math.min(1, p.t / flightTime(p.hit));
      const f = flight(p.hit, u);
      const hide = p.hit.kind === 'fly' && u >= 1;
      if (!hide) {
        if (!reducedMotion()) for (let i = 1; i <= 4; i++) {
          const g = flight(p.hit, Math.max(0, u - i * 0.02));
          ctx.fillStyle = `rgba(255,255,255,${0.25 - i * 0.05})`;
          ctx.beginPath(); ctx.arc(X(g.x), Y(g.y), Math.max(2, 3 - i * 0.4), 0, Math.PI * 2); ctx.fill();
        }
        ballAt(X(f.x), Y(f.y), false);
      }
    }
    drawParticles(ctx, parts.current);
    ctx.restore();

    // Ghost, top left, homers ticking with each out
    if (ghost && screen !== 'intro') {
      drawGhost(ctx, ghost, 22, 44, 30, now, ghostAt(ghost.target, OUTS, s.outs / OUTS, ghost.name.length + OUTS), s.runs);
    }
    // Tags, top right
    if (screen === 'play') {
      let ty = 8;
      if (fire) { tag(ctx, 'ON FIRE: bigger sweet spot', w - 8, ty, 11, '#ff8a2a', '#fff', 'right'); ty += 20; }
      if (p.golden && p.phase !== 'windup') { tag(ctx, 'GOLD BALL x2', w - 8, ty, 11, '#ffd84a', '#1a1a1a', 'right'); ty += 20; }
      if (s.wind !== 0) tag(ctx, `Wind ${s.wind > 0 ? 'out' : 'in'} ${Math.abs(s.wind)} mph`, w - 8, ty, 10, 'rgba(20,30,50,.75)', '#dfe8ff', 'right');
      if (s.outs === OUTS - 1) tag(ctx, 'LAST OUT', w / 2, 8, 11, '#d8453b', '#fff', 'center');
    }

    // Words
    const hit = p.hit;
    if (hit && (p.phase === 'hit' || (hit.kind === 'miss' && p.pitch && p.t > p.pitch.time))) {
      const age = p.phase === 'hit' ? p.t : p.t - p.pitch!.time;
      const big = hit.kind === 'homer' ? (p.cleared ? 'HOME RUN!' : '') : SAYS[hit.kind];
      const bigAge = hit.kind === 'homer' ? age - (flightTime(hit) * (WALL / Math.max(WALL, flight(hit, 1).D))) : age;
      if (big) popText(ctx, big, w / 2, h * 0.16, Math.min(w * 0.06, h * 0.12), hit.kind === 'homer' ? (p.golden ? '#ffd84a' : '#ffe27a') : '#fff', Math.max(0, bigAge), 2.4);
      if (hit.kind !== 'miss' && age > 0.5) {
        const sub = hit.kind === 'foul' ? (hit.spray < 0 ? 'Early' : 'Late') : `${hit.feet} ft${hit.perfect ? ' · perfect' : ''}${hit.kind === 'homer' && p.golden ? ' · +2' : ''}`;
        popText(ctx, sub, w / 2, h * 0.16 + Math.min(w * 0.05, h * 0.1), Math.min(w * 0.03, h * 0.06), '#fff', age - 0.5, 2);
      }
    } else if (screen === 'play' && p.phase === 'windup' && s.pitches === 0) {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.font = `${Math.round(Math.min(w * 0.025, 16))}px ui-monospace, monospace`;
      ctx.fillText('Tap as the ball reaches the plate, at its height', w / 2, h * 0.24);
    }
  });

  const restart = () => { play.current = windup(); parts.current = []; setS(fresh()); setScreen('play'); };

  return (
    <div className="game-baseball">
      <div className="game-score game-baseball-hud">
        <span>Runs <b>{s.runs}</b></span>
        <span>HR {s.homers}</span>
        <span className="game-baseball-outs" aria-label={`${s.outs} outs`}>
          {Array.from({ length: OUTS }, (_, i) => <i key={i} className={i < s.outs ? 'on' : ''} />)}
        </span>
      </div>
      <div className="game-baseball-field" style={{ width: size.w, height: size.h }}>
        <canvas ref={canvas} style={{ width: size.w, height: size.h }} onPointerDown={onDown} />
        {screen !== 'play' && (
          <div className="game-overlay">
            {screen === 'done' ? <>
              <img src={sprite('tuck', s.homers >= 5 ? 'cheer' : 'think')} alt="" />
              <p>{s.homers} home run{s.homers === 1 ? '' : 's'}, {s.runs} run{s.runs === 1 ? '' : 's'}{s.longest ? `, longest ${s.longest} ft` : ''}. {best !== undefined && s.runs >= best && s.runs > 0 ? 'Best yet!' : ''}</p>
              {ghost && <p className="game-baseball-ghost">{s.runs > ghost.target ? `You beat ${ghost.name}'s ghost (${ghost.target}).` : `${ghost.name}'s ghost had ${ghost.target}.`}</p>}
              <button className="chip" onClick={restart}>Bat again</button>
            </> : <>
              <img src={sprite('tuck', 'hold')} alt="" />
              <p>Tap to swing as the ball reaches the plate, at its height.<br />Early or late goes foul. Anything but a homer is an out. Ten outs.<br />Three in a row and you're on fire. Gold balls count double. Watch the wind.</p>
              <button className="chip" onClick={() => { play.current = windup(); setScreen('play'); }}>Play ball</button>
            </>}
          </div>
        )}
      </div>
    </div>
  );
}
