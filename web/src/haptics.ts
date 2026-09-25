/** One vibration pattern per moment (MOTION.md §07, the board's footer): you
 *  can tell pass from fail from "needs you" without looking. Pure table, so
 *  the shapes are testable and there is exactly one place they live.
 *
 *  - approval: one short tap -- a question, not an alarm.
 *  - pass: three rising -- the same climb as the cheer hop.
 *  - fail: two heavy -- weight, not panic; the gate held.
 *
 *  iOS Safari has no navigator.vibrate; `buzz` is a no-op there and the
 *  visual carries it. */
export type HapticKind = 'approval' | 'pass' | 'fail';
export const HAPTICS: Record<HapticKind, number[]> = {
  approval: [60],
  pass: [30, 40, 40, 40, 90],
  fail: [120, 70, 120],
};
export function buzz(kind: HapticKind): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  try { return navigator.vibrate(HAPTICS[kind]) === true; } catch { return false; }
}
