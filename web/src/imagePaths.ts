/** Absolute paths to raster images mentioned in a message or a tool call.
 *
 *  2026-09-24: "I'm on my phone. I can't click the link." Agents name the
 *  pictures they make by path (/tmp/roost-shots/logo.png), which on a phone
 *  is a dead end. These are the paths the app turns into pictures; the
 *  server (images.ts) decides which of them it will actually serve. */
const PATH = /(?:^|[\s`'"(\[<:=])(\/(?:[\w.@+-]+\/)*[\w.@+-]+\.(?:png|jpe?g|gif|webp))(?=$|[\s`'")\]>,;:!?]|\.(?:\s|$))/gi;

export function findImagePaths(text: string, max = 6): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PATH)) {
    const p = m[1];
    if (!out.includes(p)) out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

export function isImagePath(s: string): boolean {
  const t = s.trim();
  return findImagePaths(t, 1)[0] === t;
}

/** `v` makes the address unique per view. Agents overwrite files in place
 *  (the same sheet.png, redrawn), and a phone browser reuses an image it has
 *  already shown in the page for an identical address -- no-store or not --
 *  so a new message about a redrawn file showed the OLD picture (2026-09-24). */
export const imageUrl = (path: string, v?: string | number) =>
  `/api/image?path=${encodeURIComponent(path)}${v === undefined ? '' : `&v=${encodeURIComponent(String(v))}`}`;
