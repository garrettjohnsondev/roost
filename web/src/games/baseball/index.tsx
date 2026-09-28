import { useMemo, useRef, useState } from 'react';
import type { GameMeta, GameProps } from '../types';
import { sprite } from '../types';
import { project, type Cam } from '../_sports/flick';
import { useStageSize, useLoop, useFlick, drawCrew, CREW, pick } from '../_sports/stage';
import { pitchFor, pitchAt, judgeSwing, OUTS, MOUND, type Pitch, type Hit } from './logic';
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
  ],
};

interface Save { outs: number; homers: number; pitches: number; streak: number; longest: number }
const fresh = (): Save => ({ outs: 0, homers: 0, pitches: 0, streak: 0, longest: 0 });

/** How many metres of ball-height count as one unit of `high` in judgeSwing. */
const SWEET = 0.2;
const SAYS: Record<Hit['kind'], string> = { homer: 'HOME RUN!', fly: 'Fly out', grounder: 'Grounder', foul: 'Foul', miss: 'Strike!' };

interface Play {
  phase: 'windup' | 'pitch' | 'hit';
  t: number;
  wait: number;
  pitch: Pitch | null;
  hit: Hit | null;
  swingAt: number | null;
  settled: boolean;
}
const windup = (): Play => ({ phase: 'windup', t: 0, wait: 0.9 + Math.random() * 0.8, pitch: null, hit: null, swingAt: null, settled: false });

export function Game({ save, onSave, onScore, onAchieve, paused, best }: GameProps<Save>) {
  const [s, setS] = useState<Save>(() => save ?? fresh());
  const [screen, setScreen] = useState<'intro' | 'play' | 'done'>(save ? 'play' : 'intro');
  const size = useStageSize();
  const canvas = useRef<HTMLCanvasElement>(null);
  const play = useRef<Play>(windup());
  const pitcher = useMemo(() => pick(CREW), []);
  const cam = useRef<Cam>({ z: -2.5, y: 1.3, focal: 400, cx: 200, horizon: 250 });

  const settle = (hit: Hit | null) => {
    const homer = hit?.kind === 'homer';
    const next: Save = {
      outs: s.outs + (hit && !homer ? 1 : 0),
      homers: s.homers + (homer ? 1 : 0),
      pitches: s.pitches + 1,
      streak: homer ? s.streak + 1 : hit ? 0 : s.streak,
      longest: Math.max(s.longest, homer ? hit!.feet : 0),
    };
    if (homer) onAchieve('first');
    if (homer && hit!.feet >= 450) onAchieve('moon');
    if (next.streak >= 3) onAchieve('streak');
    if (next.homers >= 10) onAchieve('ten');
    setS(next);
    play.current = windup();
    if (next.outs >= OUTS) {
      onScore(next.homers);
      onSave(null);
      setScreen('done');
    } else onSave(next);
  };

  const swing = (_x: number, y: number) => {
    const p = play.current;
    if (screen !== 'play' || paused || p.phase !== 'pitch' || p.swingAt !== null || !p.pitch) return;
    p.swingAt = p.t;
    const c = cam.current;
    const s0 = c.focal / (0 - c.z);
    const tapY = c.y - (y - c.horizon) / s0;
    p.hit = judgeSwing(p.t - p.pitch.time, (tapY - p.pitch.y) / SWEET);
    if (p.hit.kind !== 'miss') { p.phase = 'hit'; p.t = 0; }
  };
  const flick = useFlick((_f, start) => swing(start.x, start.y), swing);

  useLoop(canvas, size, !paused, (ctx, w, h, dt) => {
    const c: Cam = { z: -2.5, y: 1.3, focal: w * 1.1, cx: w / 2, horizon: h * 0.4 };
    cam.current = c;
    const p = play.current;
    if (screen === 'play') {
      p.t += dt;
      if (p.phase === 'windup' && p.t >= p.wait) {
        p.phase = 'pitch';
        p.t = 0;
        p.pitch = pitchFor(s.pitches, Math.random(), Math.random(), Math.random());
      }
      if (p.phase === 'pitch' && p.pitch && !p.settled) {
        if (p.hit?.kind === 'miss' && p.t > p.pitch.time + 0.9) { p.settled = true; settle(p.hit); }
        else if (!p.hit && p.t > p.pitch.time + 0.7) { p.settled = true; settle(null); }
      }
      if (p.phase === 'hit' && !p.settled && p.t > 2.0) { p.settled = true; settle(p.hit); }
    }

    // Field
    const sky = ctx.createLinearGradient(0, 0, 0, c.horizon);
    sky.addColorStop(0, '#1d2d4f');
    sky.addColorStop(1, '#5d7fa8');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, c.horizon);
    ctx.fillStyle = '#2d5d2f';
    ctx.fillRect(0, c.horizon, w, h - c.horizon);
    // Trees past the wall
    ctx.fillStyle = '#1e3b24';
    for (let i = 0; i < 14; i++) {
      const tx = (i / 13) * w, th = 14 + ((i * 37) % 11);
      ctx.beginPath(); ctx.moveTo(tx - 18, c.horizon - 6); ctx.lineTo(tx, c.horizon - 6 - th); ctx.lineTo(tx + 18, c.horizon - 6); ctx.fill();
    }
    ctx.fillStyle = '#244a2a';
    ctx.fillRect(0, c.horizon - 7, w, 8);
    // Infield dirt
    const poly = (pts: [number, number][], fill: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      pts.forEach(([x, z], i) => { const q = project(c, x, 0, z); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
      ctx.fill();
    };
    poly([[0, -1.5], [22, 20], [0, 40], [-22, 20]], '#9c6b43');
    poly([[0, 1.5], [16, 19.4], [0, 36], [-16, 19.4]], '#2d5d2f');
    const mound = project(c, 0, 0, MOUND);
    ctx.fillStyle = '#a8764c';
    ctx.beginPath(); ctx.ellipse(mound.x, mound.y, mound.s * 2.6, mound.s * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    poly([[-0.22, 0], [0.22, 0], [0.22, 0.22], [0, 0.43], [-0.22, 0.22]], '#f3f0e6');
    // Strike zone
    const z1 = project(c, -0.28, 1.2, 0), z2 = project(c, 0.28, 0.5, 0);
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(z1.x, z1.y, z2.x - z1.x, z2.y - z1.y);

    // Pitcher
    const pose = p.phase === 'windup' ? (p.t > p.wait - 0.35 ? 'side' : 'hold')
      : p.phase === 'hit' ? (p.hit?.kind === 'homer' && p.t > 0.8 ? 'think' : 'look1')
      : p.hit?.kind === 'miss' && p.t > p.pitch!.time ? 'cheer' : 'idle';
    drawCrew(ctx, pitcher, pose, mound.x, mound.y + 2, mound.s * 2.4);

    // Ball
    const ball = (x: number, y: number, z: number) => {
      const b = project(c, x, y, z), g = project(c, x, 0, z);
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.beginPath(); ctx.ellipse(g.x, g.y, Math.max(1, b.s * 0.07), Math.max(1, b.s * 0.025), 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fbfaf5';
      ctx.beginPath(); ctx.arc(b.x, b.y, Math.max(1.5, b.s * 0.06), 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#c9352b';
      ctx.lineWidth = Math.max(0.5, b.s * 0.01);
      ctx.beginPath(); ctx.arc(b.x, b.y, Math.max(1, b.s * 0.04), 0.3, 1.6); ctx.stroke();
    };
    if (p.phase === 'pitch' && p.pitch) {
      const q = pitchAt(p.pitch, p.t);
      if (q.z > c.z + 0.4) ball(q.x, q.y, q.z);
    } else if (p.phase === 'hit' && p.hit) {
      const u = Math.min(1, p.t / 1.6);
      const d = p.hit.feet * 0.3048, a = (p.hit.spray * Math.PI) / 180;
      const apex = p.hit.kind === 'grounder' ? 0 : Math.min(45, d * Math.tan((Math.max(5, p.hit.launch) * Math.PI) / 180) / 4);
      const y = 0.9 + 4 * apex * u * (1 - u) + (p.hit.kind === 'grounder' ? 0 : -0.9 * u);
      ball(Math.sin(a) * d * u, Math.max(0, y), Math.cos(a) * d * u);
    }

    // Bat
    if (p.swingAt !== null) {
      const since = p.phase === 'hit' ? p.t + 0.001 : p.t - p.swingAt;
      const k = Math.min(1, since / 0.14);
      const pivot = project(c, 0.55, 0.8, -0.3);
      const ang = Math.PI * (0.15 + 0.85 * k);
      ctx.strokeStyle = '#c48b4a';
      ctx.lineWidth = Math.max(4, pivot.s * 0.06);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(pivot.x, pivot.y);
      ctx.lineTo(pivot.x - Math.cos(ang) * pivot.s * 0.9, pivot.y - Math.sin(ang) * pivot.s * 0.25);
      ctx.stroke();
    }

    // Words
    ctx.textAlign = 'center';
    const hit = p.hit;
    if (hit && (p.phase === 'hit' || (hit.kind === 'miss' && p.pitch && p.t > p.pitch.time))) {
      ctx.fillStyle = hit.kind === 'homer' ? '#ffe27a' : '#fff';
      ctx.font = `bold ${Math.round(w * 0.08)}px ui-monospace, monospace`;
      ctx.fillText(SAYS[hit.kind], w / 2, h * 0.13);
      if (hit.kind !== 'miss' && p.t > 0.6) {
        ctx.font = `${Math.round(w * 0.045)}px ui-monospace, monospace`;
        ctx.fillText(hit.kind === 'foul' ? (hit.spray < 0 ? 'Early' : 'Late') : `${hit.feet} ft${hit.perfect ? ' · perfect' : ''}`, w / 2, h * 0.13 + w * 0.07);
      }
    } else if (screen === 'play' && p.phase === 'windup' && s.pitches === 0) {
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.font = `${Math.round(w * 0.04)}px ui-monospace, monospace`;
      ctx.fillText('Tap where the ball crosses the plate', w / 2, h - 16);
    }
  });

  const restart = () => { play.current = windup(); setS(fresh()); setScreen('play'); };

  return (
    <div className="game-baseball">
      <div className="game-score game-baseball-hud">
        <span>Home runs <b>{s.homers}</b></span>
        <span className="game-baseball-outs" aria-label={`${s.outs} outs`}>
          {Array.from({ length: OUTS }, (_, i) => <i key={i} className={i < s.outs ? 'on' : ''} />)}
        </span>
      </div>
      <div className="game-baseball-field" style={{ width: size.w, height: size.h }}>
        <canvas ref={canvas} style={{ width: size.w, height: size.h }} {...flick} />
        {screen !== 'play' && (
          <div className="game-overlay">
            {screen === 'done' ? <>
              <img src={sprite(pitcher, s.homers >= 5 ? 'think' : 'cheer')} alt="" />
              <p>{s.homers} home run{s.homers === 1 ? '' : 's'}{s.longest ? `, longest ${s.longest} ft` : ''}. {best !== undefined && s.homers >= best && s.homers > 0 ? 'Best yet!' : ''}</p>
              <button className="chip" onClick={restart}>Bat again</button>
            </> : <>
              <img src={sprite(pitcher, 'hold')} alt="" />
              <p>Tap to swing as the ball reaches the plate.<br />Tap at its height. Early or late goes foul.<br />Anything but a homer is an out. Ten outs.</p>
              <button className="chip" onClick={() => { play.current = windup(); setScreen('play'); }}>Play ball</button>
            </>}
          </div>
        )}
      </div>
    </div>
  );
}
