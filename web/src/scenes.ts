import type { CrewInfo } from './types';

/** The scenes (docs/SCENES.md): a backdrop and its seats. A seat is a place,
 *  a pose, an optional prop, an optional flip. Any member can take any seat
 *  because every member gets the same four scene poses. Positions are in the
 *  backdrop's 512×256 space; `size` is the sprite's box there. */
export type ScenePose = 'sit' | 'side' | 'hold' | 'dance';
export interface Seat {
  x: number;
  y: number;
  size: number;
  pose: ScenePose;
  /** Mirror the sprite (a `side` seat facing right). */
  flip?: boolean;
  prop?: string;
  /** Nudge the prop from its default spot over the paws, in the same space. */
  propOffset?: [number, number];
}
/** What moves in a scene (2026-09-24: "each scene needs something
 *  animated"). CSS only -- no timers -- and off under reduced motion. The
 *  crew still only move for real state; this is the set, not the cast.
 *  All positions in the backdrop's 512x256 space. */
export interface Ambient {
  /** Twinkling stars scattered, deterministically, in this sky rectangle. */
  stars?: { x0: number; y0: number; x1: number; y1: number; n: number };
  /** A shooting star crosses this sky now and then; the cycle length in s. */
  shooting?: { x0: number; y0: number; x1: number; y1: number; every: number };
  /** Light sources that flicker (fire) or breathe (lamps). */
  glows?: Array<{ x: number; y: number; r: number; color: string; kind: 'flicker' | 'breathe' }>;
  /** Small bulbs that twinkle in turn (string lights). */
  bulbs?: Array<[number, number]>;
  /** Steam rising from a point. */
  steam?: [number, number];
  /** Snow falling over the whole scene. */
  snow?: boolean;
  /** A small light that blinks (the workshop robot's eye). */
  blink?: { x: number; y: number; color: string };
}
export interface Scene {
  id: string;
  name: string;
  seats: Seat[];
  ambient?: Ambient;
}

/** Only scenes whose backdrop has been drawn and shipped. A doctrine test
 *  checks each id here has web/public/scenes/<id>.webp, so this list can
 *  never promise a set that does not exist. */
export const SCENES: Scene[] = [
  {
    id: 'campfire',
    name: 'Campfire',
    seats: [
      // On the logs: left (guitar, facing the fire), right (flute), front-left
      // (sitting), and the open ground right of the fire for the dancer.
      { x: 268, y: 156, size: 70, pose: 'side', prop: 'flute' },
      { x: 112, y: 144, size: 68, pose: 'side', flip: true, prop: 'guitar' },
      { x: 336, y: 192, size: 74, pose: 'dance' },
      { x: 158, y: 200, size: 64, pose: 'sit' },
    ],
    ambient: { stars: { x0: 0, y0: 0, x1: 512, y1: 62, n: 26 }, shooting: { x0: 80, y0: 6, x1: 460, y1: 50, every: 61 }, glows: [{ x: 198, y: 170, r: 46, color: '#ff9a2e', kind: 'flicker' }] },
  },
  { id: 'cards', name: 'Card table', seats: [
    { x: 150, y: 128, size: 64, pose: 'hold', prop: 'cards' },
    { x: 348, y: 128, size: 64, pose: 'hold', prop: 'cards' },
    { x: 250, y: 150, size: 66, pose: 'sit' },
    { x: 430, y: 200, size: 70, pose: 'side' },
  ], ambient: { glows: [{ x: 241, y: 8, r: 70, color: '#ffc46b', kind: 'breathe' }, { x: 414, y: 48, r: 34, color: '#ff8a2a', kind: 'flicker' }] } },
  { id: 'bucket', name: 'Ball and bucket', seats: [
    { x: 150, y: 178, size: 74, pose: 'hold', prop: 'ball' },
    { x: 280, y: 196, size: 70, pose: 'sit' },
    { x: 400, y: 180, size: 72, pose: 'dance' },
    { x: 60, y: 205, size: 64, pose: 'side', flip: true },
  ], ambient: { stars: { x0: 0, y0: 0, x1: 512, y1: 52, n: 16 } } },
  { id: 'picnic', name: 'Picnic', seats: [
    { x: 112, y: 192, size: 66, pose: 'sit' },
    { x: 196, y: 206, size: 66, pose: 'hold', prop: 'sandwich' },
    { x: 330, y: 192, size: 70, pose: 'side' },
    { x: 440, y: 204, size: 68, pose: 'sit' },
  ], ambient: { stars: { x0: 150, y0: 0, x1: 430, y1: 68, n: 18 }, shooting: { x0: 180, y0: 4, x1: 420, y1: 40, every: 83 }, glows: [{ x: 451, y: 8, r: 26, color: '#fff2b0', kind: 'breathe' }] } },
  { id: 'stargazing', name: 'Stargazing', seats: [
    { x: 380, y: 202, size: 70, pose: 'side', flip: true },
    { x: 140, y: 206, size: 70, pose: 'sit' },
    { x: 250, y: 212, size: 68, pose: 'side' },
    { x: 60, y: 200, size: 62, pose: 'hold', prop: 'telescope' },
  ], ambient: { stars: { x0: 0, y0: 0, x1: 512, y1: 150, n: 44 }, shooting: { x0: 40, y0: 10, x1: 470, y1: 120, every: 47 } } },
  { id: 'kitchen', name: 'Kitchen', seats: [
    { x: 392, y: 200, size: 72, pose: 'hold', prop: 'ladle' },
    { x: 150, y: 212, size: 68, pose: 'sit' },
    { x: 258, y: 216, size: 66, pose: 'hold', prop: 'bowl' },
    { x: 60, y: 202, size: 64, pose: 'side', flip: true },
  ], ambient: { steam: [396, 58], glows: [{ x: 395, y: 112, r: 30, color: '#ff8a2a', kind: 'flicker' }, { x: 104, y: 70, r: 22, color: '#ffc46b', kind: 'breathe' }, { x: 47, y: 16, r: 20, color: '#ffc46b', kind: 'breathe' }] } },
  { id: 'library', name: 'Library', seats: [
    { x: 250, y: 192, size: 70, pose: 'hold', prop: 'book' },
    { x: 140, y: 202, size: 68, pose: 'side', flip: true },
    { x: 360, y: 206, size: 66, pose: 'sit' },
    { x: 452, y: 188, size: 62, pose: 'hold', prop: 'book' },
  ], ambient: { glows: [{ x: 453, y: 62, r: 44, color: '#ffd98a', kind: 'breathe' }, { x: 393, y: 58, r: 16, color: '#ffb44a', kind: 'flicker' }, { x: 108, y: 88, r: 18, color: '#ffc46b', kind: 'flicker' }] } },
  { id: 'workshop', name: 'Workshop', seats: [
    { x: 220, y: 202, size: 72, pose: 'hold', prop: 'wrench' },
    { x: 110, y: 206, size: 68, pose: 'side', flip: true },
    { x: 330, y: 212, size: 66, pose: 'sit' },
    { x: 432, y: 200, size: 66, pose: 'hold', prop: 'gear' },
  ], ambient: { blink: { x: 244, y: 30, color: '#6fe0ff' }, glows: [{ x: 62, y: 17, r: 18, color: '#ffd98a', kind: 'breathe' }] } },
  { id: 'rooftop', name: 'Rooftop', seats: [
    { x: 130, y: 206, size: 70, pose: 'side', flip: true },
    { x: 390, y: 206, size: 70, pose: 'side' },
    { x: 262, y: 200, size: 74, pose: 'dance' },
    { x: 50, y: 216, size: 60, pose: 'sit' },
  ], ambient: { stars: { x0: 80, y0: 30, x1: 512, y1: 60, n: 14 }, bulbs: [[87, 14], [156, 22], [203, 27], [252, 28], [305, 27], [352, 24], [396, 20], [443, 15], [474, 10]] } },
  { id: 'snow', name: 'Snow day', seats: [
    { x: 200, y: 192, size: 72, pose: 'hold', prop: 'snowball' },
    { x: 300, y: 190, size: 74, pose: 'dance' },
    { x: 380, y: 206, size: 66, pose: 'sit' },
    { x: 112, y: 202, size: 66, pose: 'side', flip: true },
  ], ambient: { stars: { x0: 60, y0: 0, x1: 512, y1: 48, n: 18 }, shooting: { x0: 120, y0: 4, x1: 440, y1: 36, every: 71 }, snow: true } },
];

/** Which scene is on: one a day (item 39, 2026-09-25 -- "I only want the
 *  scene to switch every 24 hours"). It turns over at local midnight, the
 *  same for every screen that day, and walks the whole set before repeating.
 *  `offset` stays for tests; nothing in the app passes one. */
export function sceneIndexFor(date: Date, offset = 0, count = SCENES.length): number {
  if (count <= 0) return 0;
  const day = Math.floor(new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 86_400_000);
  return (((day + offset) % count) + count) % count;
}

export interface Placed {
  member: CrewInfo;
  seat: Seat;
  /** Working right now: drawn typing at the seat, laptop in the paws. */
  working: boolean;
}

/** Fill seats in order with the awake crew, most recently active first. A
 *  working member takes their seat but types there -- honest, and funny.
 *  Members past the last seat are returned so the caller can show them
 *  awake beside the bunks rather than pretending they are asleep. */
export function placeCrew(awake: Array<{ member: CrewInfo; working: boolean }>, scene: Scene): { placed: Placed[]; overflow: CrewInfo[] } {
  const placed: Placed[] = [];
  const overflow: CrewInfo[] = [];
  awake.forEach((a, i) => {
    const seat = scene.seats[i];
    if (seat) placed.push({ member: a.member, seat, working: a.working });
    else overflow.push(a.member);
  });
  return { placed, overflow };
}
