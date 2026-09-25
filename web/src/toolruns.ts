import type { ChatItem } from './types';

/** Consecutive tool calls folded into one line -- "read 4 files, ran 2
 *  commands, edited 1" -- with the calls themselves behind a tap.
 *
 *  Recovered 2026-09-24: "truthfully I don't care about bash and read and
 *  the actual code. I know some people might but I'm curious how we can just
 *  consolidate that." Pure over the items, so the fold can never disagree
 *  with the thread. A run that is still going says what it is doing NOW on
 *  the summary line, so collapsing loses no state. */
export type Segment = { kind: 'item'; index: number } | { kind: 'run'; start: number; end: number };

/** Item indices [start, end) of the given slice, grouped. A lone tool stays a
 *  plain item; two or more in a row become a run. */
export function segmentsOf(items: ChatItem[], start: number, end: number): Segment[] {
  const out: Segment[] = [];
  let i = start;
  while (i < end) {
    if (items[i].kind !== 'tool') {
      out.push({ kind: 'item', index: i });
      i++;
      continue;
    }
    let j = i;
    while (j < end && items[j].kind === 'tool') j++;
    // A lone call folds too (item 36): it used to render as a raw chip with
    // its whole command, the one line in the thread that looked like a log.
    out.push({ kind: 'run', start: i, end: j });
    i = j;
  }
  return out;
}

type Bucket = 'read' | 'ran' | 'edited' | 'used';
function bucketOf(name: string): Bucket {
  const n = name.toLowerCase();
  if (/edit|write|patch|create|delete|rename|notebook/.test(n)) return 'edited';
  if (/bash|exec|command|shell|run|terminal/.test(n)) return 'ran';
  if (/read|grep|glob|search|list|find|cat|view|fetch/.test(n)) return 'read';
  return 'used';
}

export interface RunSummary {
  text: string;
  /** The call in progress, if the run is still going. */
  running: Extract<ChatItem, { kind: 'tool' }> | null;
  failed: number;
  count: number;
}

export function summarizeRun(tools: Array<Extract<ChatItem, { kind: 'tool' }>>): RunSummary {
  const counts: Record<Bucket, number> = { read: 0, ran: 0, edited: 0, used: 0 };
  let failed = 0;
  for (const t of tools) {
    counts[bucketOf(t.name)]++;
    if (t.done && t.ok === false) failed++;
  }
  const part = (n: number, verb: string, noun: string) => (n ? `${verb} ${n} ${noun}${n === 1 ? '' : 's'}` : '');
  const parts = [
    part(counts.read, 'read', 'file'),
    part(counts.ran, 'ran', 'command'),
    part(counts.edited, 'edited', 'file'),
    part(counts.used, 'used', 'tool'),
  ].filter(Boolean);
  const running = tools.find((t) => !t.done) ?? null;
  return { text: parts.join(', '), running, failed, count: tools.length };
}
