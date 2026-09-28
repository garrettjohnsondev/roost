/** The arcade's contract (roadmap #55). Every game is one component that gets
 *  its last save, reports scores and achievements, and pauses when told --
 *  the host owns storage (on the Mac), the needs-you banner and navigation. */
export interface GameStoreView {
  saves: Record<string, unknown>;
  best: Record<string, number>;
  plays: Record<string, number>;
  achievements: Record<string, number>;
}

export interface GameProps<S = unknown> {
  /** The saved state from last time, or null for a fresh game. */
  save: S | null;
  /** Call whenever the state is worth keeping (debounced by the host). Pass
   *  null when a run ends, so next time starts fresh. */
  onSave: (state: S | null) => void;
  /** A finished run. The host records it and celebrates a new best. */
  onScore: (score: number) => void;
  /** Earn an achievement by its short id (namespaced by the host). */
  onAchieve: (id: string) => void;
  /** True while the needs-you banner is up or the tab is hidden: stop timers. */
  paused: boolean;
  best: number | undefined;
  /** The ghost you're racing (wave 3), or null when ghosts are off. Draw it
   *  see-through; the host checks the finished score against `target`. */
  ghost?: Ghost | null;
}

/** A crew member's recorded best, as strong as their model: Haiku's Moss is
 *  easy to beat, Astra's Nell is not (the owner, 2026-09-29). */
export interface Ghost { name: string; sprite: string; strength: number; target: number }
export const GHOSTS: Array<{ name: string; sprite: string; strength: number; model: string }> = [
  { name: 'Moss', sprite: 'moss', strength: 0.2, model: 'Haiku' },
  { name: 'Tuck', sprite: 'tuck', strength: 0.25, model: 'GPT mini' },
  { name: 'Bly', sprite: 'bly', strength: 0.35, model: 'Luna' },
  { name: 'Otto', sprite: 'otto', strength: 0.4, model: 'GPT' },
  { name: 'Fig', sprite: 'fig', strength: 0.45, model: 'Claude' },
  { name: 'Wren', sprite: 'wren', strength: 0.55, model: 'Sonnet' },
  { name: 'Rue', sprite: 'rue', strength: 0.6, model: 'Terra' },
  { name: 'Juno', sprite: 'juno', strength: 0.75, model: 'Sol' },
  { name: 'Bram', sprite: 'bram', strength: 0.8, model: 'Fable' },
  { name: 'Ollie', sprite: 'ollie', strength: 0.88, model: 'Opus' },
  { name: 'Nell', sprite: 'nell', strength: 0.95, model: 'Astra' },
];
export function ghostBeaten(meta: GameMeta, g: Ghost, score: number): boolean {
  return meta.lowerIsBetter ? score < g.target : score > g.target;
}

export interface Achievement { id: string; name: string; says: string }

export interface GameMeta {
  id: string;
  name: string;
  /** One line under the name, in Roost's voice. */
  blurb: string;
  /** Crew sprite that hosts it on the card. */
  host: string;
  /** For timed games (fewer seconds is better). */
  lowerIsBetter?: boolean;
  /** How to show a score: "12", or "1:05" for times. */
  scoreKind?: 'points' | 'time' | 'guesses';
  pack?: 'classic' | 'quick' | 'sports' | 'stretch';
  achievements: Achievement[];
  /** For games whose save outlives a run (unlocks, streaks): is a run in
   *  progress? Without it, any save means "Resume". */
  inProgress?: (save: any) => boolean;
  /** The score a ghost of this strength (0 easy .. 1 hard) posts. Games that
   *  set it get ghosts; the host picks who and checks the win. */
  ghostScore?: (strength: number) => number;
  /** Plays sideways: the host asks you to turn your phone first. */
  orientation?: 'landscape';
  /** Where the coding crew member may sit without covering anything. */
  safeCorner?: 'tl' | 'tr' | 'bl' | 'br';
}

export interface GameModule {
  meta: GameMeta;
  Game: (p: GameProps<any>) => JSX.Element;
}

export const sprite = (name: string, pose = 'idle') => `/crew/${name}-${pose}.webp`;

export function fmtScore(meta: GameMeta, n: number | undefined): string {
  if (n === undefined) return '—';
  if (meta.scoreKind === 'time') return `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
  return String(n);
}

/** A seeded random, so a daily puzzle is the same for everyone all day. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const dayNumber = (d = new Date()) => Math.floor((d.getTime() - d.getTimezoneOffset() * 60_000) / 86_400_000);
