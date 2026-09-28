import { useEffect, useState } from 'react';

/** Dev mode (roadmap #52): for people who want to see the machinery. Work
 *  runs and tool calls open in place, finished jobs don't fold, and each reply
 *  names its exact model. Kept on this phone. */
const KEY = 'roost:dev';
const EVENT = 'roost-dev-change';

export function devModeOn(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
export function setDevMode(on: boolean): void {
  try { on ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY); } catch { /* private mode */ }
  window.dispatchEvent(new Event(EVENT));
}
export function useDevMode(): boolean {
  const [on, setOn] = useState(devModeOn);
  useEffect(() => {
    const f = () => setOn(devModeOn());
    window.addEventListener(EVENT, f);
    window.addEventListener('storage', f);
    return () => { window.removeEventListener(EVENT, f); window.removeEventListener('storage', f); };
  }, []);
  return on;
}
