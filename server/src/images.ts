import { realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, isAbsolute, sep } from 'node:path';

/** Which local images the phone may see.
 *
 *  2026-09-24: "I'm on my phone. I can't click the link." An agent that says
 *  "the sheet is at /tmp/roost-shots/logo.png" has told a phone user nothing.
 *  The app shows the picture itself -- but a route that serves local files is
 *  a route that can serve ~/.ssh, so it is narrow on purpose:
 *
 *  - raster images only, by extension (no SVG: it is a document that runs
 *    script, and this route is same-origin with the app);
 *  - the REAL path (symlinks resolved) must sit under a configured project,
 *    Roost's data folder, or a temp folder -- where agents actually write
 *    screenshots and sheets;
 *  - a size cap, so a stray 2GB file is refused rather than streamed. */
export const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export type ImageCheck =
  | { ok: true; path: string; type: string; size: number }
  | { ok: false; status: 400 | 403 | 404 | 413; reason: string };

function realOrNull(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

export function imageRoots(projects: string[], dataDir: string): string[] {
  const roots = [...projects, dataDir, tmpdir(), '/tmp', '/private/tmp'];
  return [...new Set(roots.map(realOrNull).filter((r): r is string => Boolean(r)))];
}

export function checkImagePath(raw: string, roots: string[]): ImageCheck {
  if (!raw || !isAbsolute(raw)) return { ok: false, status: 400, reason: 'an absolute path is required' };
  const type = IMAGE_TYPES[extname(raw).toLowerCase()];
  if (!type) return { ok: false, status: 403, reason: 'only png, jpg, gif and webp images are shown' };
  const real = realOrNull(raw);
  if (!real) return { ok: false, status: 404, reason: 'that image is gone — temporary files are cleared' };
  // Re-check the extension on the resolved path: a link named x.png can point anywhere.
  if (!IMAGE_TYPES[extname(real).toLowerCase()]) return { ok: false, status: 403, reason: 'only png, jpg, gif and webp images are shown' };
  const inside = roots.some((r) => real === r || real.startsWith(r.endsWith(sep) ? r : r + sep));
  if (!inside) return { ok: false, status: 403, reason: 'images are shown from your projects and temp folders only' };
  let size: number;
  try {
    const st = statSync(real);
    if (!st.isFile()) return { ok: false, status: 404, reason: 'not a file' };
    size = st.size;
  } catch {
    return { ok: false, status: 404, reason: 'that image is gone — temporary files are cleared' };
  }
  if (size > MAX_IMAGE_BYTES) return { ok: false, status: 413, reason: 'too large to show on the phone' };
  return { ok: true, path: real, type, size };
}
