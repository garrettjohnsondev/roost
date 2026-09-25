import type { ChatItem, CrewInfo } from './types';

/** The thread folded into the jobs it did — the Chapters board, as a pure
 *  function of the items, so it can never disagree with the thread it folds.
 *
 *  Rules, taken from the board:
 *   - a job CLOSES when its gates pass (a passing verify), and folds into one row;
 *   - it is named after the work, not the date;
 *   - this only changes what you see. Nothing here touches what the agents
 *     remember — their context is the context meter's business. */
export type ChapterStatus = 'verified' | 'needs-work' | 'open';

export interface Chapter {
  /** Item indices, [start, end). */
  start: number;
  end: number;
  name: string;
  /** Everyone who spoke in it, in order of first appearance, once each. */
  crew: CrewInfo[];
  /** Crew turns — assistant replies and conference turns, not tool calls. */
  turns: number;
  status: ChapterStatus;
  /** ts of the chapter's first item -- for day/week grouping below. */
  startedAt: number;
}

export function chaptersOf(items: ChatItem[]): Chapter[] {
  const out: Chapter[] = [];
  let start = 0;
  let spoke = false; // the current job has had a crew turn
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === 'user' && spoke && i > start) {
      const gap = it.ts - (items[i - 1]?.ts ?? it.ts);
      if (startsNewJob(it.text, gap)) {
        // Pip's routing line belongs to the task it routed, not the last one.
        const cut = items[i - 1]?.kind === 'routed' && i - 1 > start ? i - 1 : i;
        out.push(build(items, start, cut));
        start = cut;
        spoke = false;
      }
    }
    if (it.kind === 'assistant' || it.kind === 'consult') spoke = true;
    if (it.kind === 'verify' && it.report.passed) {
      out.push(build(items, start, i + 1));
      start = i + 1;
      spoke = false;
    }
  }
  if (start < items.length) out.push(build(items, start, items.length));
  return out;
}

function build(items: ChatItem[], start: number, end: number): Chapter {
  const slice = items.slice(start, end);
  const crew: CrewInfo[] = [];
  const seen = new Set<string>();
  let turns = 0;
  for (const it of slice) {
    if ((it.kind === 'assistant' || it.kind === 'consult') && it.crew) {
      turns++;
      if (!seen.has(it.crew.name)) {
        seen.add(it.crew.name);
        crew.push(it.crew);
      }
    } else if (it.kind === 'assistant' || it.kind === 'consult') {
      turns++;
    }
  }
  const verifies = slice.filter((x): x is Extract<ChatItem, { kind: 'verify' }> => x.kind === 'verify');
  const last = verifies[verifies.length - 1];
  // NOT VERIFIED (no gates) is neither a pass nor work to redo.
  const status: ChapterStatus = last?.report.passed ? 'verified' : last && !last.report.unverified ? 'needs-work' : 'open';
  const startedAt = slice[0]?.ts ?? 0;
  return { start, end, name: nameFor(slice), crew, turns, status, startedAt };
}

/** Named after the work: the first ask that says something. "Bram proceed
 *  with the remaining" names nothing, so the next ask is tried, then the
 *  crew's own first line about what they did. */
function nameFor(slice: ChatItem[]): string {
  for (const x of slice) {
    if (x.kind !== 'user') continue;
    const n = chapterName(x.text);
    if (!isWeakName(n)) return n;
  }
  for (const x of slice) {
    if ((x.kind === 'assistant' || x.kind === 'consult') && x.text) {
      const first = x.text.replace(/[`*_#>]/g, '').split(/(?<=[.!?])\s|\n/)[0] ?? '';
      const n = chapterName(first);
      if (!isWeakName(n)) return n;
    }
  }
  return 'Untitled job';
}

/** Board §12d's day and week rows: chapters grouped under a label, in the
 *  same chronological order they already render in -- oldest first. Pure of
 *  the wall clock except for the `now` you hand it, so it stays testable and
 *  never disagrees with what `dayLabel` alone would say for the same ts. */
export interface ChapterGroup {
  /** Stable, comparable bucket id (also a fine React key) -- distinct from
   *  `label`, which is what a person reads. */
  key: string;
  label: string;
  chapters: Chapter[];
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Midnight-aligned day number in the LOCAL calendar, so 11:58pm and
 *  12:02am count as different days even though they are 4 minutes apart. */
function dayKey(ts: number): number {
  const d = new Date(ts);
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86_400_000);
}

/** The Monday that starts ts's calendar week, as an epoch day-number key --
 *  so every chapter in the same Mon–Sun window buckets identically, however
 *  many days apart their own timestamps are within it. */
function weekKey(ts: number): number {
  const d = new Date(ts);
  const mondayOffset = (d.getDay() + 6) % 7; // Sun=0 -> 6 back to Monday; Mon=1 -> 0
  return dayKey(ts) - mondayOffset;
}

/** "Today" / "Yesterday" / a weekday name for the rest of this week / "Week
 *  of <date>" beyond that. `now` is a parameter, never read internally, so
 *  this never disagrees with the phone's clock by surprise and stays a pure
 *  function like the rest of this file. */
export function dayLabel(ts: number, now: number): string {
  const diff = dayKey(now) - dayKey(ts);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return WEEKDAY[new Date(ts).getDay()];
  const monday = new Date(weekKey(ts) * 86_400_000);
  return `Week of ${monday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

/** Groups by the SAME bucket dayLabel would put a chapter in -- today, or a
 *  named day this week, or a calendar week -- collapsing consecutive
 *  chapters that land in the same bucket under one header. Chapters already
 *  arrive chronological, so this is a single pass, not a sort. */
export function groupChaptersByDay(chapters: Chapter[], now: number): ChapterGroup[] {
  const out: ChapterGroup[] = [];
  const keyOf = (ts: number): string => {
    const diff = dayKey(now) - dayKey(ts);
    if (diff === 0) return 'today';
    if (diff === 1) return 'yesterday';
    if (diff > 1 && diff < 7) return `d:${dayKey(ts)}`;
    return `w:${weekKey(ts)}`;
  };
  for (const ch of chapters) {
    const key = keyOf(ch.startedAt);
    const prev = out[out.length - 1];
    if (prev && prev.key === key) prev.chapters.push(ch);
    else out.push({ key, label: dayLabel(ch.startedAt, now), chapters: [ch] });
  }
  return out;
}

/** "Add a --json flag to the avatar generator" → "--json flag to the avatar".
 *  Named after the WORK: the polite preamble and the leading verb go, the first
 *  few words of what is being asked for stay. Falls back to "Untitled job" so a
 *  row is never nameless. */
const PREAMBLE = /^(?:(?:@?(?:pip|ollie|moss|wren|tuck|bly|rue|nell|juno|otto|fig|bram)|please|pls|ok|okay|so|hey|hi|now|then|and|also|can you|could you|would you|will you|i want you to|i want to|i'd like you to|i need you to|i need to|let's|lets|let us|go ahead and|try to|help me|proceed with|proceed on|proceed|continue with|continue on|continue|keep going with|keep going on|keep going|carry on with|carry on|resume|go on with|i'm|i’m|im|i am|hmm+|yea|yeah)\b[\s,:]*)+/i;
/** Where a job ends (item 31, 2026-09-25). A job used to close only on a
 *  PASSING verify: one failed verify early on 2026-09-24 and nothing passed
 *  after it, so a whole day of different tasks was one job, named after the
 *  message that opened it ("Bram proceed with the remaining"). Now every
 *  message you send starts a new job -- once the current one has had a crew
 *  turn -- unless it is plainly a continuation: a go-ahead ("yes", "proceed",
 *  "deploy") or a short question about the work in hand ("are we stalled?").
 *  Checked against the real 2026-09-24 transcript, not guessed. */
const CONTINUES = /^(?:yes|yep|yeah|yup|ok|okay|sure|go|go ahead|proceed|continue|keep going|carry on|do it|do that|deploy|ship it|sounds good|looks good|agreed|correct|right|perfect|great|thanks|thank you|nice|cool|indifferent|both|either|fine|approved?|lgtm|same|no preference|i agree|agree|agreed|hmm+|yea|▶)(?=\W|$)/i;
const JOB_GAP_MS = 45 * 60_000;
/** A name with no work in it: "the remaining", "it", "this". */
const WEAK = /^(?:(?:the|a|an|it|this|that|these|those|all|rest|remaining|remainder|items?|stuff|things?|open|same|next|last|one|ones|of|on|with|from|here|there)\b\s*)*$/i;

const VERB = /^(?:add|fix|make|build|create|implement|write|update|change|refactor|rename|remove|delete|move|review|check|look at|investigate|debug|find|explain|tell me|show me|document|test|port|wire|set up|setup|clean up|improve)\b\s*(?:a|an|the|some)?\s*/i;
export function chapterName(text: string, words = 5): string {
  // The first sentence only: five words across a full stop read as noise
  // ("on my phone. I").
  let s = text.replace(/^▶\s*/, '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0];
  s = s.replace(PREAMBLE, '');
  const stripped = s.replace(VERB, '');
  // keep the verb only if removing it would leave nothing
  s = stripped.trim() ? stripped : s;
  const cut = s.split(' ').filter(Boolean).slice(0, words).join(' ').replace(/[.,;:!?…]+$/, '');
  return cut || 'Untitled job';
}

/** True when a user message starting now opens a new job. */
export function startsNewJob(text: string, gapMs: number): boolean {
  if (gapMs >= JOB_GAP_MS) return true;
  const t = text.trim();
  if (CONTINUES.test(t) && t.length < 120) return false;
  if (t.endsWith('?') && t.length < 100) return false;
  return true;
}

/** A job name that says nothing about the work. */
export function isWeakName(name: string): boolean {
  return name === 'Untitled job' || WEAK.test(name.trim());
}
