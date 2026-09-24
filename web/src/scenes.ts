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
export interface Scene {
  id: string;
  name: string;
  seats: Seat[];
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
  },
];

/** Which scene is on: it changes on the hour, on its own -- a set change,
 *  not a loop. `offset` is the viewer's taps on the scene. */
export function sceneIndexFor(date: Date, offset = 0, count = SCENES.length): number {
  if (count <= 0) return 0;
  const start = new Date(date.getFullYear(), 0, 0);
  const day = Math.floor((date.getTime() - start.getTime()) / 86_400_000);
  return (day * 24 + date.getHours() + offset) % count;
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
