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
}

export function chaptersOf(items: ChatItem[]): Chapter[] {
  const out: Chapter[] = [];
  let start = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === 'verify' && it.report.passed) {
      out.push(build(items, start, i + 1));
      start = i + 1;
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
  const firstAsk = slice.find((x): x is Extract<ChatItem, { kind: 'user' }> => x.kind === 'user');
  return { start, end, name: chapterName(firstAsk?.text ?? ''), crew, turns, status };
}

/** "Add a --json flag to the avatar generator" → "--json flag to the avatar".
 *  Named after the WORK: the polite preamble and the leading verb go, the first
 *  few words of what is being asked for stay. Falls back to "Untitled job" so a
 *  row is never nameless. */
const PREAMBLE = /^(?:(?:please|pls|ok|okay|so|hey|hi|now|then|and|also|can you|could you|would you|will you|i want you to|i want to|i'd like you to|i need you to|i need to|let's|lets|let us|go ahead and|try to|help me)\b[\s,:]*)+/i;
const VERB = /^(?:add|fix|make|build|create|implement|write|update|change|refactor|rename|remove|delete|move|review|check|look at|investigate|debug|find|explain|tell me|show me|document|test|port|wire|set up|setup|clean up|improve)\b\s*(?:a|an|the|some)?\s*/i;
export function chapterName(text: string, words = 5): string {
  let s = text.replace(/\s+/g, ' ').trim();
  s = s.replace(PREAMBLE, '');
  const stripped = s.replace(VERB, '');
  // keep the verb only if removing it would leave nothing
  s = stripped.trim() ? stripped : s;
  const cut = s.split(' ').filter(Boolean).slice(0, words).join(' ').replace(/[.,;:!?…]+$/, '');
  return cut || 'Untitled job';
}
