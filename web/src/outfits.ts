import { useEffect, useState } from 'react';

/** Level-ups you can see (roadmap #57, the owner's idea 2026-09-28): the crew
 *  member you lean on most is visibly decked out, so when a plainer one shows
 *  up you notice -- "hold up, what's going on" -- and can tap to see why.
 *  Levels come from the work itself (server/src/companions.ts levelFor). */
export interface Unlock { level: number; tier: 1 | 2 | 3 | 4; name: string }
export const UNLOCKS: Unlock[] = [
  { level: 3, tier: 1, name: 'Sash' },
  { level: 6, tier: 2, name: 'Hat' },
  { level: 10, tier: 3, name: 'Sunglasses' },
  { level: 10, tier: 3, name: 'Necklace' },
  { level: 15, tier: 4, name: 'Wizard robe' },
  { level: 15, tier: 4, name: 'Crown' },
  { level: 15, tier: 4, name: 'Staff' },
  { level: 15, tier: 4, name: 'Crystal ball' },
];

export function tierFor(level: number | undefined): 0 | 1 | 2 | 3 | 4 {
  let t: 0 | 1 | 2 | 3 | 4 = 0;
  for (const u of UNLOCKS) if ((level ?? 0) >= u.level) t = u.tier;
  return t;
}
export function earned(level: number | undefined): string[] {
  return UNLOCKS.filter((u) => (level ?? 0) >= u.level).map((u) => u.name);
}
export function nextUnlock(level: number | undefined): Unlock | null {
  return UNLOCKS.find((u) => (level ?? 0) < u.level) ?? null;
}

// One shared fetch of everyone's level, refreshed every few minutes.
let levels: Record<string, number> = {};
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
function refresh(): void {
  if (inflight || Date.now() - fetchedAt < 5 * 60_000 || typeof fetch === 'undefined') return;
  inflight = fetch('/api/crew/life')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (d?.companions) {
        levels = Object.fromEntries(d.companions.map((c: { name: string; level: number }) => [c.name, c.level]));
        listeners.forEach((l) => l());
      }
    })
    .catch(() => {})
    .finally(() => { fetchedAt = Date.now(); inflight = null; });
}

export function useOutfitTier(name: string | undefined): 0 | 1 | 2 | 3 | 4 {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    refresh();
    return () => { listeners.delete(l); };
  }, []);
  return name ? tierFor(levels[name]) : 0;
}
