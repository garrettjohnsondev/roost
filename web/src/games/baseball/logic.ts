import { clamp } from '../_sports/flick';

/** Home Run Derby. A pitch is a trip from the mound to the plate in `time`
 *  seconds; a swing is a tap at some moment and some height. Everything that
 *  isn't a home run is an out, and ten outs ends the round. */

export const OUTS = 10;
export const MOUND = 18.4; // metres, rubber to plate
export const RELEASE_Y = 1.8;

export interface Pitch { time: number; x: number; y: number; kind: 'fastball' | 'changeup' | 'curve' }

/** Pitches get quicker as the round goes on. r1..r3 are 0..1 randoms. */
export function pitchFor(n: number, r1: number, r2: number, r3: number): Pitch {
  const base = clamp(0.95 - n * 0.025, 0.58, 0.95);
  const kind: Pitch['kind'] = n < 2 ? 'fastball' : r1 < 0.2 ? 'changeup' : r1 < 0.4 ? 'curve' : 'fastball';
  const time = kind === 'changeup' ? base * 1.3 : kind === 'curve' ? base * 1.12 : base;
  return { time: Math.round(time * 1000) / 1000, x: (r2 * 2 - 1) * 0.25, y: 0.55 + r3 * 0.6, kind };
}

/** Where the ball is `t` seconds after release (curveballs drop late). */
export function pitchAt(p: Pitch, t: number) {
  const u = t / p.time;
  const hump = 0.18 + (p.kind === 'curve' ? 0.45 * (1 - u) : 0);
  return { x: p.x * u * u, y: RELEASE_Y + (p.y - RELEASE_Y) * u + hump * Math.sin(Math.PI * clamp(u, 0, 1)), z: MOUND * (1 - u) };
}

export type Kind = 'homer' | 'fly' | 'grounder' | 'foul' | 'miss';
export interface Hit { kind: Kind; feet: number; spray: number; launch: number; perfect: boolean }

export const PERFECT = 0.035; // s either side of the plate
export const GOOD = 0.08;
export const CONTACT = 0.15;

/** err: swing time minus arrival time (s; negative is early). high: where
 *  the bat met the ball, in ball-heights (+ above centre, - below).
 *  Wave 3: on `fire` (three homers running) the perfect window is wider, and
 *  `wind` (mph, + blowing out) carries or knocks down anything in the air. */
export function judgeSwing(err: number, high: number, o: { fire?: boolean; wind?: number } = {}): Hit {
  const a = Math.abs(err), h = Math.abs(high);
  if (a > CONTACT || h > 1.2) return { kind: 'miss', feet: 0, spray: 0, launch: 0, perfect: false };
  const spray = clamp((err / CONTACT) * 70, -70, 70); // early pulls (to the left)
  const launch = clamp(28 - high * 30, -10, 70); // under the ball lifts it
  const timing = 1 - Math.pow(a / CONTACT, 2);
  const square = 1 - Math.pow(h / 1.2, 1.5);
  const win = o.fire ? PERFECT * FIRE_WINDOW : PERFECT;
  const perfect = a <= win && h <= (o.fire ? 0.45 : 0.3);
  let feet = Math.round(perfect ? 430 + (1 - a / win) * 50 * (1 - h) : 490 * timing * square * Math.sin(Math.PI * clamp(launch, 1, 89) / 90) ** 0.5);
  if (Math.abs(spray) > 45) return { kind: 'foul', feet, spray, launch, perfect: false };
  if (launch >= 8) feet = carry(feet, o.wind ?? 0);
  if (perfect) return { kind: 'homer', feet, spray, launch, perfect };
  if (launch < 8) return { kind: 'grounder', feet: Math.min(feet, 120), spray, launch, perfect };
  if (feet >= fence(spray)) return { kind: 'homer', feet, spray, launch, perfect };
  return { kind: 'fly', feet, spray, launch, perfect };
}

export const FIRE_AT = 3;
export const FIRE_WINDOW = 1.6;
export const onFire = (streak: number) => streak >= FIRE_AT;

/** Wind for a round, mph: + blows out to centre, - blows in. */
export const windFor = (r: number) => Math.round((r * 2 - 1) * 12);
/** A fly ball in the wind: each mph out adds about 1.2% of carry. */
export const carry = (feet: number, wind: number) => Math.round(feet * (1 + wind * 0.012));

/** Now and then a gold ball: a home run off it counts twice. */
export const isGolden = (n: number, r: number) => n >= 3 && r < 0.15;
export const runsFor = (homer: boolean, golden: boolean) => (homer ? (golden ? 2 : 1) : 0);

/** A ghost's derby, in runs: Moss (0.2) hits two, Nell (0.95) nineteen. */
export const ghostScore = (strength: number) => Math.round(1 + 4 * strength + 16 * strength * strength);

/** The wall: 330 down the lines, 400 to dead centre. */
export const fence = (spray: number) => Math.round(400 - (Math.abs(spray) / 45) * 70);
