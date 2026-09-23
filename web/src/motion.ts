/** The arithmetic behind the motion — kept pure and out of the components so
 *  the rules that decide WHEN something moves are tested, not eyeballed.
 *
 *  Every function here obeys the rule the rest of the app does: motion reports
 *  something that actually happened. So each one returns "nothing to show" for
 *  a first sighting, a missing reading, or a value that went the wrong way. */

/** How far a crew member's colour drains as their context fills, 0..1.
 *
 *  Nothing below `degrading` (60%) — the board's promise is "you feel quality
 *  dropping before a number says so", and quality holds until then. Full drain
 *  at 90%. A null reading drains nothing: unknown is never pressure, the same
 *  rule the compaction offer follows, and a character going grey because the
 *  meter is offline would be a lie about their state. */
export const ROT_START = 60;
export const ROT_FULL = 90;
export function rotFor(percent: number | null | undefined): number {
  if (percent == null || !Number.isFinite(percent)) return 0;
  if (percent <= ROT_START) return 0;
  if (percent >= ROT_FULL) return 1;
  return Math.round(((percent - ROT_START) / (ROT_FULL - ROT_START)) * 100) / 100;
}

export type Block = 'free' | 'used' | 'spent';

/** A quota window as blocks, with the ones spent since the last reading marked.
 *
 *  `spent` is what flares. It is only ever the DIFFERENCE between two real
 *  readings of the same window going up:
 *   - no previous reading → nothing flares (first sight is not spending — the
 *     same rule the alias-drift detector uses, for the same reason);
 *   - the value went down → nothing flares (that is a reset, not spending);
 *   - no current reading → no blocks at all, not twenty empty ones. */
export function fuelBlocks(prev: number | null | undefined, now: number | null | undefined, n = 20): Block[] | null {
  if (now == null || !Number.isFinite(now)) return null;
  const clamp = (p: number) => Math.max(0, Math.min(100, p));
  const usedN = Math.round((clamp(now) / 100) * n);
  const fromN = prev == null || !Number.isFinite(prev) || prev > now ? usedN : Math.round((clamp(prev) / 100) * n);
  return Array.from({ length: n }, (_, i) => (i >= usedN ? 'free' : i >= fromN ? 'spent' : 'used'));
}

/** Capacity that will expire unused, as a count of blocks out of `n`.
 *
 *  Pulses only while it is genuinely at risk: a surplus exists and has not been
 *  claimed by boost. The moment you spend it — or the window resets — the
 *  surplus disappears from the session meta and this returns 0, so the pulse
 *  stops because its cause stopped. */
export function expiringBlocks(headroomPct: number | null | undefined, n = 10): number {
  if (headroomPct == null || !Number.isFinite(headroomPct) || headroomPct <= 0) return 0;
  return Math.max(0, Math.min(n, Math.round((headroomPct / 100) * n)));
}

/** Commands type themselves: how many visible steps, and how long.
 *
 *  One step per character for short commands, capped at 48 so a long one still
 *  reads as typing rather than a smooth wipe; the duration grows with length but
 *  never past 900ms. A command you have to wait to read has stopped informing
 *  and started performing. */
export const TYPE_MS_PER_CHAR = 22;
export const TYPE_MAX_MS = 900;
export function typeSteps(text: string | null | undefined): number {
  const n = String(text ?? '').length;
  return Math.max(1, Math.min(48, n));
}
export function typeDurationMs(text: string | null | undefined): number {
  const n = String(text ?? '').length;
  return Math.max(120, Math.min(TYPE_MAX_MS, n * TYPE_MS_PER_CHAR));
}
