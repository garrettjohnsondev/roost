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
