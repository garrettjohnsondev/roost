import { useEffect, useState } from 'react';
import anchors from './anchors.json';

/** What each crew member is wearing (games wave 1), shared by every face in
 *  the app so a hat bought in the locker shows in the thread, the home
 *  screen, the arcade and the companion card alike. */
export interface WornPiece { itemId: string; art: string; paint?: string; cert?: string; certValue?: number; text?: string; rarity: string; name: string }
export type Look = Partial<Record<'hat' | 'prop' | 'aura' | 'frame' | 'title' | 'celebration', WornPiece>>;

// Remembered on the phone, so the crew is dressed from the first frame
// (2026-09-30: plain for a second on every fresh load, then "flipped").
const LOOKS_KEY = 'roost:looks';
let looks: Record<string, Look> = (() => { try { return JSON.parse(localStorage.getItem(LOOKS_KEY) ?? '{}'); } catch { return {}; } })();
const remember = () => { try { localStorage.setItem(LOOKS_KEY, JSON.stringify(looks)); } catch { /* private mode */ } };
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function refreshLooks(force = false): void {
  if (typeof fetch === 'undefined' || inflight || (!force && Date.now() - fetchedAt < 60_000)) return;
  inflight = fetch('/api/economy/looks')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { if (d?.looks) { looks = d.looks; remember(); listeners.forEach((l) => l()); } })
    .catch(() => {})
    .finally(() => { fetchedAt = Date.now(); inflight = null; });
}
export function setLooks(next: Record<string, Look>): void {
  looks = next;
  remember();
  fetchedAt = Date.now();
  listeners.forEach((l) => l());
}

export function useLook(name: string | undefined): Look {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    refreshLooks();
    return () => { listeners.delete(l); };
  }, []);
  return (name && looks[name]) || {};
}

export const PAINT_FILTER: Record<string, string> = {
  crimson: 'hue-rotate(-30deg) saturate(1.4)',
  orange: 'hue-rotate(20deg) saturate(1.3)',
  saffron: 'hue-rotate(45deg) saturate(1.3)',
  lime: 'hue-rotate(90deg) saturate(1.3)',
  forest: 'hue-rotate(130deg) brightness(.8)',
  sky: 'hue-rotate(180deg)',
  cobalt: 'hue-rotate(220deg) saturate(1.3)',
  purple: 'hue-rotate(270deg)',
  pink: 'hue-rotate(310deg) saturate(1.2)',
  sienna: 'hue-rotate(10deg) brightness(.75)',
  grey: 'saturate(0)',
  white: 'saturate(0) brightness(1.6)',
  black: 'saturate(0) brightness(.35)',
};
export const PAINT_NAME: Record<string, string> = {
  crimson: 'Crimson', orange: 'Orange', saffron: 'Saffron', lime: 'Lime', forest: 'Forest Green', sky: 'Sky Blue',
  cobalt: 'Cobalt', purple: 'Purple', pink: 'Pink', sienna: 'Burnt Sienna', grey: 'Grey', white: 'Titanium White', black: 'Black',
};
export const CERT_NAME: Record<string, string> = { jobs: 'Jobs Shipped', runs: 'Games Played', ghosts: 'Ghosts Beaten', streak: 'Day Streak', crates: 'Crates Opened' };

type Anchor = { brim: number; cx: number; w: number; hand: [number, number] };
export function anchorFor(sprite?: string): Anchor {
  return ((sprite && (anchors as unknown as Record<string, Anchor>)[sprite]) || { brim: 0.22, cx: 0.5, w: 0.42, hand: [0.82, 0.66] });
}
