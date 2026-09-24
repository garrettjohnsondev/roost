import { useEffect, useState } from 'react';

/** The current time, updated once a minute while `active`. For countdowns
 *  that must go down with no new messages ("Spend it", 2026-09-24). Kept out
 *  of ChatView, whose motion is pinned to real state and holds no timers. */
export function useMinute(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}
