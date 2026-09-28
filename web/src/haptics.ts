/** One vibration pattern per moment (MOTION.md §07, the board's footer): you
 *  can tell pass from fail from "needs you" without looking. Pure table, so
 *  the shapes are testable and there is exactly one place they live.
 *
 *  - approval: one short tap -- a question, not an alarm.
 *  - pass: three rising -- the same climb as the cheer hop.
 *  - fail: two heavy -- weight, not panic; the gate held.
 *
 *  iOS Safari has no navigator.vibrate. Since iOS 18 a switch control
 *  (<input type="checkbox" switch>) gives a real haptic tick when toggled,
 *  including through its label -- so on iPhone each "on" beat of a pattern
 *  becomes one tick (roadmap #48). */
export type HapticKind = 'approval' | 'pass' | 'fail' | 'reward';

/** For games (wave 3): n quick ticks spaced `gap` ms apart -- on iPhone the
 *  only thing a web page can vary is the COUNT and rhythm, not the strength,
 *  so a bigger moment is more ticks. Android gets matching buzz lengths. */
export function ticks(n: number, gap = 45, strength = 20): void {
  n = Math.max(1, Math.min(12, Math.round(n)));
  if (typeof navigator === 'undefined') return;
  if (typeof navigator.vibrate === 'function') {
    const p: number[] = [];
    for (let i = 0; i < n; i++) p.push(strength, gap);
    try { navigator.vibrate(p); } catch { /* */ }
    return;
  }
  if (!isIOS()) return;
  for (let i = 0; i < n; i++) setTimeout(iosTick, i * (gap + 15));
}
export const HAPTICS: Record<HapticKind, number[]> = {
  /** An achievement or a new best in the arcade: two quick taps. */
  reward: [25, 60, 25],
  approval: [60],
  pass: [30, 40, 40, 40, 90],
  fail: [120, 70, 120],
};
let tickLabel: HTMLLabelElement | null = null;
function iosTick(): boolean {
  if (typeof document === 'undefined') return false;
  if (!tickLabel) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    label.appendChild(input);
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(label);
    tickLabel = label;
  }
  tickLabel.click();
  return true;
}
const isIOS = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);

export function buzz(kind: HapticKind): boolean {
  if (typeof navigator === 'undefined') return false;
  if (typeof navigator.vibrate !== 'function') {
    if (!isIOS()) return false;
    // One tick per "on" beat, spaced like the pattern.
    const p = HAPTICS[kind];
    let at = 0;
    for (let i = 0; i < p.length; i += 2) {
      setTimeout(iosTick, at);
      at += p[i] + (p[i + 1] ?? 0) + 40;
    }
    return true;
  }
  try { return navigator.vibrate(HAPTICS[kind]) === true; } catch { return false; }
}
