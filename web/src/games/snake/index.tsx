import { useEffect, useRef, useState } from 'react';
import type { GameMeta, GameProps } from '../types';
import { sprite } from '../types';

/** Snake, Roost style: Pip leads a conga line, and every seed he picks up
 *  brings another crew member into the line. The reference game for the
 *  arcade -- the others follow its shape (save, pause, score, achieve). */
export const meta: GameMeta = {
  id: 'snake',
  name: 'Conga',
  blurb: 'Pip leads the line. Every seed brings another friend.',
  host: 'pip',
  pack: 'classic',
  achievements: [
    { id: 'first', name: 'First seed', says: 'Pick up a seed.' },
    { id: 'ten', name: 'Party of ten', says: 'Get ten in the line.' },
    { id: 'full-crew', name: 'Whole crew', says: 'Score 25 in one run.' },
    { id: 'fifty', name: 'Parade', says: 'Score 50 in one run.' },
  ],
};

const N = 15;
const CREW = ['ollie', 'bram', 'wren', 'moss', 'fig', 'nell', 'juno', 'rue', 'bly', 'tuck', 'otto'];
type P = [number, number];
interface Save { body: P[]; dir: P; seed: P; score: number }

const same = (a: P, b: P) => a[0] === b[0] && a[1] === b[1];
function freeCell(body: P[]): P {
  for (;;) {
    const c: P = [Math.floor(Math.random() * N), Math.floor(Math.random() * N)];
    if (!body.some((b) => same(b, c))) return c;
  }
}
const fresh = (): Save => {
  const body: P[] = [[7, 7], [6, 7], [5, 7]];
  return { body, dir: [1, 0], seed: freeCell(body), score: 0 };
};

export function Game({ save, onSave, onScore, onAchieve, paused, best }: GameProps<Save>) {
  const [s, setS] = useState<Save>(() => save ?? fresh());
  const [over, setOver] = useState(false);
  const [started, setStarted] = useState(!!save);
  const queued = useRef<P[]>([]);
  const cell = Math.floor(Math.min(window.innerWidth - 24, 420) / N);

  const turn = (d: P) => {
    setStarted(true);
    const last = queued.current.at(-1) ?? s.dir;
    if (last[0] === -d[0] && last[1] === -d[1]) return;
    if (last[0] === d[0] && last[1] === d[1]) return;
    if (queued.current.length < 3) queued.current.push(d);
  };

  useEffect(() => {
    if (paused || over || !started) return;
    const speed = Math.max(85, 190 - s.score * 3);
    const t = setTimeout(() => {
      const cur = s;
      const dir = queued.current.shift() ?? cur.dir;
      const head: P = [cur.body[0][0] + dir[0], cur.body[0][1] + dir[1]];
      const hit = head[0] < 0 || head[1] < 0 || head[0] >= N || head[1] >= N || cur.body.slice(0, -1).some((b) => same(b, head));
      if (hit) {
        setOver(true);
        onScore(cur.score);
        onSave(null);
        return;
      }
      const ate = same(head, cur.seed);
      const body = [head, ...(ate ? cur.body : cur.body.slice(0, -1))];
      const next: Save = { body, dir, seed: ate ? freeCell(body) : cur.seed, score: cur.score + (ate ? 1 : 0) };
      if (ate) {
        if (next.score === 1) onAchieve('first');
        if (next.body.length >= 10) onAchieve('ten');
        if (next.score >= 25) onAchieve('full-crew');
        if (next.score >= 50) onAchieve('fifty');
      }
      setS(next);
      onSave(next);
    }, speed);
    return () => clearTimeout(t);
  }, [s, paused, over, started, onSave, onScore, onAchieve]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const m: Record<string, P> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
      if (m[e.key]) { e.preventDefault(); turn(m[e.key]); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const touch = useRef<{ x: number; y: number } | null>(null);
  const restart = () => { queued.current = []; setS(fresh()); setOver(false); setStarted(false); };

  return (
    <div className="snake">
      <div className="game-score">Line: <b>{s.score}</b>{best !== undefined && <span> · best {best}</span>}</div>
      <div
        className="snake-board"
        style={{ width: cell * N, height: cell * N }}
        onTouchStart={(e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
        onTouchEnd={(e) => {
          const t0 = touch.current; touch.current = null;
          if (!t0) return;
          const dx = e.changedTouches[0].clientX - t0.x, dy = e.changedTouches[0].clientY - t0.y;
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
          turn(Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)]);
        }}
      >
        <span className="snake-seed-dot" style={{ left: s.seed[0] * cell + cell / 4, top: s.seed[1] * cell + cell / 4, width: cell / 2, height: cell / 2 }} />
        {s.body.map((b, i) => (
          <img
            key={i}
            src={sprite(i === 0 ? 'pip' : CREW[(i - 1) % CREW.length], i === 0 ? 'side' : 'idle')}
            alt=""
            className="snake-part"
            style={{ left: b[0] * cell, top: b[1] * cell, width: cell, height: cell, transform: i === 0 && s.dir[0] < 0 ? 'scaleX(-1)' : undefined }}
          />
        ))}
        {(!started || over) && (
          <div className="game-overlay">
            {over ? <>
              <img src={sprite('pip', 'think')} alt="" />
              <p>Line of {s.score}. {best !== undefined && s.score >= best ? 'Best yet!' : 'Again?'}</p>
              <button className="chip" onClick={restart}>Play again</button>
            </> : <>
              <img src={sprite('pip', 'cheer')} alt="" />
              <p>Swipe to steer Pip. Grab seeds, don't bump the line.</p>
              <button className="chip" onClick={() => setStarted(true)}>Start</button>
            </>}
          </div>
        )}
      </div>
      <div className="dpad">
        <button onClick={() => turn([0, -1])} aria-label="Up">▲</button>
        <div>
          <button onClick={() => turn([-1, 0])} aria-label="Left">◀</button>
          <button onClick={() => turn([1, 0])} aria-label="Right">▶</button>
        </div>
        <button onClick={() => turn([0, 1])} aria-label="Down">▼</button>
      </div>
    </div>
  );
}
