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

/** The work stream (2026-09-25): "this is too much noise... make this cool
 *  without stripping context of what's being done and what the agent is
 *  replying."
 *
 *  Everything a crew member does on the way to their answer -- each line they
 *  say between tool calls, the calls, the thinking -- is ONE card, not a row
 *  per piece. Live, it shows their latest line in their own voice and what is
 *  running now; each new line replaces the last inside the card, so nothing
 *  grows big and then shrinks. Finished, it folds to one line; a tap opens the
 *  whole timeline, so no context is lost. The reply stays a full message.
 *
 *  A stretch is work when it holds at least one tool call and is made only of
 *  tool calls, thinking, and lines followed by more tool calls (narration).
 *  While the turn is live (`liveTail`), trailing lines after a call stay in
 *  the card too: nobody knows yet whether they are narration or the answer,
 *  and moving them out and back in is the jump that was reported. */
export type StreamSegment = Segment | { kind: 'work'; start: number; end: number };

function narrationAt(items: ChatItem[], i: number, end: number): boolean {
  if (items[i]?.kind !== 'assistant') return false;
  for (let j = i + 1; j < end; j++) {
    const k = items[j].kind;
    if (k === 'user' || k === 'verify' || k === 'consult') return false;
    if (k === 'tool') return true;
  }
  return false;
}

export function workSegments(items: ChatItem[], start: number, end: number, liveTail = false): StreamSegment[] {
  // Everything from here to the end is only assistant/thinking: the live tail.
  const tailFrom = (() => {
    let t = end;
    while (t > start && (items[t - 1].kind === 'assistant' || items[t - 1].kind === 'thinking')) t--;
    return t;
  })();
  const inWork = (i: number) => {
    const k = items[i].kind;
    if (k === 'tool' || k === 'thinking') return true;
    if (k !== 'assistant') return false;
    return narrationAt(items, i, end) || (liveTail && i >= tailFrom);
  };
  const out: StreamSegment[] = [];
  let i = start;
  while (i < end) {
    if (!inWork(i)) {
      out.push({ kind: 'item', index: i });
      i++;
      continue;
    }
    let j = i;
    while (j < end && inWork(j)) j++;
    const hasTool = items.slice(i, j).some((x) => x.kind === 'tool');
    if (hasTool) out.push({ kind: 'work', start: i, end: j });
    // No tool call in it: a line and some thinking are a plain conversation.
    else for (const s of segmentsOf(items, i, j)) out.push(s);
    i = j;
  }
  return out;
}
