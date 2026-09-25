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

export function jobName(text: string, words = 5): string {
  // The first sentence only: five words across a full stop read as noise
  // ("on my phone. I").
  let s = text.replace(/^▶\s*/, '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0];
  s = s.replace(PREAMBLE, '');
  const stripped = s.replace(VERB, '');
  s = stripped.trim() ? stripped : s;
  const cut = s.split(' ').filter(Boolean).slice(0, words).join(' ').replace(/[.,;:!?…]+$/, '');
  return cut || 'Untitled job';
}

/** The title from the chapters: the open job first, then closed ones newest
 *  first, joined with a middle dot and cut to fit the list. */
export function autoTitle(openAsk: string | undefined, closed: string[], max = 60, named = false): string {
  // `named`: openAsk is already a job name (sessions.ts jobLabel), not raw text.
  const parts = [openAsk ? (named ? openAsk : jobName(openAsk)) : '', ...[...closed].reverse()].filter(Boolean);
  if (!parts.length) return 'New session';
  let out = parts[0];
  for (const p of parts.slice(1)) {
    const next = `${out} · ${p}`;
    if (next.length > max) break;
    out = next;
  }
  return out.length > max ? out.slice(0, max - 1) + '…' : out;
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
