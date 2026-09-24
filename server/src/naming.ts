/** A session is named after the work, not after the first sixty characters.
 *
 *  2026-09-24: "I'm not finding it easy to go back and see 'oh that was the
 *  convo that had X work'." The title is now the session's chapters, most
 *  recent first: the job in progress, then the jobs that closed (a chapter
 *  closes when its gates pass), each named the way the Chapters board names
 *  a row. Typing a title yourself still wins and sticks.
 *
 *  jobName() is the same function as chapterName() in web/src/chapters.ts -- the board and
 *  the list must agree on what a job is called. A doctrine test pins the two
 *  regexes to each other. */
const PREAMBLE = /^(?:(?:please|pls|ok|okay|so|hey|hi|now|then|and|also|can you|could you|would you|will you|i want you to|i want to|i'd like you to|i need you to|i need to|let's|lets|let us|go ahead and|try to|help me)\b[\s,:]*)+/i;
const VERB = /^(?:add|fix|make|build|create|implement|write|update|change|refactor|rename|remove|delete|move|review|check|look at|investigate|debug|find|explain|tell me|show me|document|test|port|wire|set up|setup|clean up|improve)\b\s*(?:a|an|the|some)?\s*/i;

export function jobName(text: string, words = 5): string {
  let s = text.replace(/\s+/g, ' ').trim();
  s = s.replace(PREAMBLE, '');
  const stripped = s.replace(VERB, '');
  s = stripped.trim() ? stripped : s;
  const cut = s.split(' ').filter(Boolean).slice(0, words).join(' ').replace(/[.,;:!?…]+$/, '');
  return cut || 'Untitled job';
}

/** The title from the chapters: the open job first, then closed ones newest
 *  first, joined with a middle dot and cut to fit the list. */
export function autoTitle(openAsk: string | undefined, closed: string[], max = 60): string {
  const parts = [openAsk ? jobName(openAsk) : '', ...[...closed].reverse()].filter(Boolean);
  if (!parts.length) return 'New session';
  let out = parts[0];
  for (const p of parts.slice(1)) {
    const next = `${out} · ${p}`;
    if (next.length > max) break;
    out = next;
  }
  return out.length > max ? out.slice(0, max - 1) + '…' : out;
}
