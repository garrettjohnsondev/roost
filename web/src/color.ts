/** Persona colours were chosen for light chips. On the Roost ground (#0f1729)
 *  several are unreadable — Ollie's #2f3a72 has a contrast of about 1.5:1. The
 *  design canvas quietly used lighter variants; this computes them instead of
 *  hand-picking, lightening each colour only as far as it needs to reach the
 *  WCAG AA ratio for normal text against the background it actually sits on. */

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function parse(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
export function contrast(a: string, b: string): number | null {
  const x = parse(a), y = parse(b);
  if (!x || !y) return null;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}
const hex = ([r, g, b]: [number, number, number]) =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** The colour itself if it already reads; otherwise the least-lightened version
 *  of it that does. Hue is kept, so Ollie is still recognisably Ollie's blue. */
export function readableOn(color: string, bg: string, min = 4.5): string {
  const c = parse(color);
  if (!c || contrast(color, bg) == null) return color;
  if ((contrast(color, bg) ?? 0) >= min) return color;
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const mixed = hex(c.map((v) => v + (255 - v) * t) as [number, number, number]);
    if ((contrast(mixed, bg) ?? 0) >= min) return mixed;
  }
  return '#ffffff';
}

/** A crew name's colour for the current theme. */
export const ROOST_GROUND = '#0f1729';
export function nameColor(color: string | undefined): string | undefined {
  if (!color) return color;
  const dark = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark';
  return dark ? readableOn(color, ROOST_GROUND) : color;
}
