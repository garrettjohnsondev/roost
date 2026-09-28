/** Chiptune sound (games wave 1): off by default, and quiet when on -- the
 *  owner: "I don't want to surprise them … where they have to reach for their
 *  phone volume and never use it again". Synthesised with Web Audio, so there
 *  are no sound files to load, and nothing plays until you switch it on. */
const KEY = 'roost:sound';
const MASTER = 0.08;
let ctx: AudioContext | null = null;

export function soundOn(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
export function setSound(on: boolean): void {
  try { on ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY); } catch { /* private mode */ }
  if (on) sfx('coin');
}

type Note = [freq: number, dur: number, wave?: OscillatorType, vol?: number];
const SOUNDS: Record<string, Note[]> = {
  tap: [[660, 0.04, 'square', 0.5]],
  hit: [[180, 0.06, 'square'], [120, 0.08, 'triangle']],
  bounce: [[420, 0.05, 'triangle']],
  score: [[660, 0.07, 'square'], [880, 0.1, 'square']],
  coin: [[988, 0.06, 'square'], [1319, 0.14, 'square']],
  win: [[523, 0.1, 'square'], [659, 0.1, 'square'], [784, 0.1, 'square'], [1047, 0.25, 'square']],
  lose: [[392, 0.12, 'triangle'], [330, 0.12, 'triangle'], [262, 0.3, 'triangle']],
  equip: [[740, 0.05, 'triangle'], [988, 0.08, 'triangle']],
  'crate-shake': [[110, 0.08, 'sawtooth', 0.4], [130, 0.08, 'sawtooth', 0.4], [110, 0.08, 'sawtooth', 0.4], [146, 0.1, 'sawtooth', 0.4]],
  reveal: [[523, 0.08, 'square'], [784, 0.2, 'square']],
  fanfare: [[523, 0.1, 'square'], [659, 0.1, 'square'], [784, 0.1, 'square'], [1047, 0.12, 'square'], [784, 0.08, 'square'], [1047, 0.35, 'square']],
  crash: [[90, 0.15, 'sawtooth'], [60, 0.25, 'sawtooth']],
  whoosh: [[300, 0.05, 'triangle', 0.4], [500, 0.05, 'triangle', 0.4], [700, 0.06, 'triangle', 0.3]],
};

/** Play a named effect if sound is on. Never throws, never blocks. */
export function sfx(name: keyof typeof SOUNDS | string): void {
  if (!soundOn() || typeof window === 'undefined') return;
  const notes = SOUNDS[name];
  if (!notes) return;
  try {
    ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    let t = ctx.currentTime;
    for (const [f, d, wave = 'square', v = 1] of notes) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = wave;
      o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(MASTER * v, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + d + 0.02);
      t += d * 0.9;
    }
  } catch { /* no audio: silent is fine */ }
}
