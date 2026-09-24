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

export const imageUrl = (path: string) => `/api/image?path=${encodeURIComponent(path)}`;
