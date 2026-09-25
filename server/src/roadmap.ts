import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The map, as it stands (the `Roadmap` board, docs/board/Roadmap.dc.html).
 *
 *  "A roadmap you maintain by hand is a roadmap that drifts." Nothing here is
 *  typed for the screen: phases and their state come from the project's own
 *  ROADMAP.md status table, the test count from the line scripts/roadmap-stats
 *  writes from the suites, corrections from the log's table, and what is in
 *  hand from the open working-order items. A project without a ROADMAP.md, or
 *  a section it does not have, reads as null -- "no data" -- never zero. */

export type PhaseState = 'shipped' | 'in-hand' | 'pending';

export interface Phase {
  id: string;
  name: string;
  state: PhaseState;
  /** The state cell as written, markdown stripped: the node's evidence. */
  detail: string;
}

export interface OpenItem {
  n: number;
  title: string;
}

export interface RoadmapView {
  exists: boolean;
  phases: Phase[] | null;
  tests: { passed: number; failing: number } | null;
  corrections: number | null;
  open: OpenItem[] | null;
}

const plain = (s: string) =>
  s.replace(/\*\*|__|`/g, '').replace(/~~/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<!--[\s\S]*?-->/g, '').trim();

/** The body of the first `## N. <title>` section whose title matches. */
function section(md: string, title: RegExp): string | null {
  const heads = [...md.matchAll(/^## .*$/gm)];
  for (let i = 0; i < heads.length; i++) {
    if (!title.test(heads[i][0])) continue;
    const start = heads[i].index! + heads[i][0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index! : md.length;
    return md.slice(start, end);
  }
  return null;
}

function stateOf(cell: string): PhaseState {
  if (/✅|\bdone\b|\bshipped\b/i.test(cell)) return 'shipped';
  if (/🟨|🚧|in progress|in hand|partial/i.test(cell)) return 'in-hand';
  return 'pending';
}

export function parsePhases(md: string): Phase[] | null {
  const body = section(md, /status/i);
  if (!body) return null;
  const rows = body.split('\n').filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l));
  const phases: Phase[] = [];
  for (const row of rows.slice(1)) {
    const cells = row.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;
    const id = plain(cells[0]);
    if (!id) continue;
    // "Truth — pricing, ledger, …" -> "Truth": the node has room for a name.
    const name = plain(cells[1]).split(/\s+[—–-]\s+|\s*\(/)[0].trim();
    // The state marker is read, then dropped: the app draws no emoji (the
    // node's colour already says shipped / in hand / not yet).
    const detail = plain(cells[2]).replace(/^[\s\u2705\u274C\u2B1C\u{1F7E8}\u{1F6A7}\uFE0F]+/u, '').trim();
    phases.push({ id, name, state: stateOf(cells[2]), detail });
  }
  return phases.length ? phases : null;
}

export function parseTests(md: string): RoadmapView['tests'] {
  const green = md.match(/\*\*(\d+) tests green/);
  if (green) return { passed: Number(green[1]), failing: 0 };
  const red = md.match(/\*\*(\d+) passing, (\d+) FAILING/);
  if (red) return { passed: Number(red[1]), failing: Number(red[2]) };
  return null;
}

export function parseCorrections(md: string): number | null {
  const body = section(md, /corrections/i);
  if (!body) return null;
  return body.split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l)).length;
}

/** Open items in the working order: numbered, and not struck through. */
export function parseOpen(md: string): OpenItem[] | null {
  // §12 by number, or the section that says it lists what is not built;
  // "Open risks" (§9) is a different list and must not be picked up.
  const body = section(md, /^## 12\./) ?? section(md, /not built/i);
  if (!body) return null;
  const out: OpenItem[] = [];
  for (const m of body.matchAll(/^(\d+)\.\s+(.+)$/gm)) {
    const text = m[2];
    if (/^~~/.test(text)) continue;
    const bold = text.match(/\*\*(.+?)\*\*/);
    out.push({ n: Number(m[1]), title: plain(bold ? bold[1] : text).replace(/[.:]$/, '').slice(0, 120) });
  }
  return out;
}

export function roadmapFrom(md: string): RoadmapView {
  return { exists: true, phases: parsePhases(md), tests: parseTests(md), corrections: parseCorrections(md), open: parseOpen(md) };
}

export function readRoadmap(projectDir: string): RoadmapView {
  const path = join(projectDir, 'ROADMAP.md');
  if (!existsSync(path)) return { exists: false, phases: null, tests: null, corrections: null, open: null };
  try {
    return roadmapFrom(readFileSync(path, 'utf8'));
  } catch {
    return { exists: false, phases: null, tests: null, corrections: null, open: null };
  }
}
