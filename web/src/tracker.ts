import { chaptersOf, type Chapter } from './chapters';
import type { ChatItem, CrewInfo, SessionMode } from './types';

/** The job tracker -- "Domino's pizza tracker, but for this section of work."
 *
 *  Rebuilt 2026-09-25: "I should be able to look while an agent is running at
 *  the messages they are giving me and then look up and see it's in the (x)
 *  phase and understand where I'm at and roughly how much is left." And: "do
 *  we really Plan every piece of work?" -- no. Plan and Review happen only when
 *  the conference runs; direct work goes straight to building. The old tracker
 *  listed Plan whenever the session's mode was Build, so it lit "Plan" behind a
 *  job that had already built: out of order, and a claim the thread did not
 *  support.
 *
 *  So the phases are read from what the crew actually DID, in the order they
 *  did it:
 *    Look    -- reading and searching
 *    Plan    -- a written plan (the conference)        only when it happens
 *    Review  -- a second crew member on the plan       only when it happens
 *    Build   -- editing files
 *    Test    -- tests, typecheck, build, the project gates
 *    Done    -- a passing check: VERIFIED. Nothing checked: your turn.
 *
 *  A pure function of the thread, like chapters: never a timer, never an
 *  estimate. "How much is left" is the phases still ahead, not a guess at
 *  minutes. When the crew goes back a step (a test fails, back to fixing), the
 *  tracker goes back too, and says so; the phases after it must be earned
 *  again. It covers the LAST chapter only. */
export type StepKey = 'look' | 'plan' | 'review' | 'build' | 'test' | 'done';
export type StepState = 'todo' | 'active' | 'awaiting' | 'done' | 'failed';
export interface TrackerStep { key: StepKey; label: string; state: StepState }
export interface Tracker {
  name: string;
  steps: TrackerStep[];
  status: Chapter['status'];
  /** The phase happening now, in words -- what you read when you look up. */
  headline: { key: StepKey; word: string; detail: string };
  /** The crew stepped back to an earlier phase after reaching a later one. */
  back: boolean;
  /** How the job ended, when it has: a passing check, a failing one, or
   *  handed back to you with nothing checked. */
  outcome: 'verified' | 'failed' | 'yours' | null;
  endIndex: number;
  who?: CrewInfo;
}

const ORDER: StepKey[] = ['look', 'plan', 'review', 'build', 'test', 'done'];
const LABEL: Record<StepKey, string> = { look: 'Look', plan: 'Plan', review: 'Review', build: 'Build', test: 'Test', done: 'Done' };
const WORD: Record<StepKey, string> = { look: 'Looking', plan: 'Planning', review: 'Reviewing', build: 'Building', test: 'Testing', done: 'Done' };

export interface TrackerInput {
  items: ChatItem[];
  mode: SessionMode | undefined;
  /** The engine's state. Only 'working' can make a step active. */
  working: boolean;
  /** The current status line, e.g. "Ollie is drafting a plan…". */
  statusMessage: string | null;
  /** A plan is waiting on Proceed: Review is done, Build is yours to start. */
  consultPending: boolean;
  /** An approval is waiting: whatever step is active is awaiting you. */
  approvalPending: boolean;
}

type Tool = Extract<ChatItem, { kind: 'tool' }>;

const TEST_CMD = /\b(vitest|jest|mocha|pytest|playwright|cypress|tsc\b|typecheck|type-check|lint|eslint|smoke|cargo (test|check|clippy)|go (test|vet)|(npm|pnpm|yarn|bun)( run)? (test|build|check|verify)\b|make (test|check))/i;
const LOOK_CMD = /^\s*(cd [^&;]+(&&|;)\s*)?(grep|rg|ag|cat|ls|head|tail|sed -n|find|wc|tree|git (log|diff|status|show|blame)|awk|jq|less)\b/i;

const NEUTRAL_CMD = /^\s*(cd [^&;]+(&&|;)\s*)?(git (add|commit|push|stash|tag|checkout|switch|branch)|echo|sleep|true|open|pwd|which)\b/i;

/** Which phase a tool call is evidence of; null for housekeeping (a commit,
 *  an echo) that says nothing about where the job is. */
export function phaseOfTool(t: Pick<Tool, 'name' | 'detail'>): 'look' | 'build' | 'test' | null {
  const n = t.name.toLowerCase();
  if (/edit|write|patch|create|delete|rename|notebook/.test(n)) return 'build';
  if (/bash|exec|command|shell|run|terminal/.test(n)) {
    if (TEST_CMD.test(t.detail)) return 'test';
    if (NEUTRAL_CMD.test(t.detail)) return null;
    if (LOOK_CMD.test(t.detail)) return 'look';
    return 'build';
  }
  return 'look'; // read, grep, glob, search, fetch, list
}

const base = (p: string) => p.trim().split(/[\s]/)[0].split('/').pop() ?? p;

function detailFor(key: StepKey, tools: Tool[], running: Tool | null): string {
  const mine = tools.filter((t) => phaseOfTool(t) === key);
  const now = running && phaseOfTool(running) === key ? running : null;
  if (key === 'build') {
    const files = new Set(mine.filter((t) => /edit|write|patch|create|notebook/i.test(t.name)).map((t) => base(t.detail)));
    const doing = now ? (/edit|write|patch|create|notebook/i.test(now.name) ? `editing ${base(now.detail)}` : 'running a command') : '';
    const n = files.size ? `${files.size} file${files.size === 1 ? '' : 's'} changed` : '';
    return [doing, n].filter(Boolean).join(' · ');
  }
  if (key === 'test') {
    const failed = mine.filter((t) => t.done && t.ok === false).length;
    const doing = now ? now.detail.replace(/^\s*cd [^&;]+(&&|;)\s*/, '').slice(0, 48) : '';
    const n = mine.length ? `${mine.length} run${mine.length === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}` : '';
    return [doing, n].filter(Boolean).join(' · ');
  }
  if (key === 'look') {
    const doing = now ? `reading ${base(now.detail)}` : '';
    const n = mine.length ? `${mine.length} look${mine.length === 1 ? '' : 's'}` : '';
    return [doing, n].filter(Boolean).join(' · ');
  }
  return '';
}

export function trackerOf(input: TrackerInput): Tracker | null {
  const chapters = chaptersOf(input.items);
  const ch = chapters[chapters.length - 1];
  if (!ch) return null;
  const slice = input.items.slice(ch.start, ch.end);
  if (!slice.some((i) => i.kind === 'user')) return null;
  const msg = input.statusMessage ?? '';

  // Walk the job in order: every piece of evidence moves the phase.
  const reached = new Set<StepKey>();
  let current = null as StepKey | null;
  let furthest = -1;
  let back = false;
  const move = (k: StepKey) => {
    reached.add(k);
    const at = ORDER.indexOf(k);
    back = at < furthest;
    furthest = Math.max(furthest, at);
    current = k;
  };
  let lastVerify: Extract<ChatItem, { kind: 'verify' }> | undefined;
  const tools: Tool[] = [];
  for (const it of slice) {
    if (it.kind === 'tool') {
      tools.push(it);
      const k = phaseOfTool(it);
      // Reading mid-build is part of building, not a step back to Look.
      if (k === 'look' && furthest > ORDER.indexOf('look')) continue;
      if (k) move(k);
    } else if (it.kind === 'consult') {
      move(it.phase === 'plan' ? 'plan' : it.phase === 'critique' || it.phase === 'reconcile' ? 'review' : current ?? 'plan');
    } else if (it.kind === 'verify') {
      lastVerify = it;
      move('test');
    } else if (it.kind === 'assistant' && it.text.trim() && !reached.size) {
      // A reply with no tools at all is still work you asked for.
      current = null;
    }
  }
  // The status line names the conference and the gates before their items land.
  if (input.working) {
    if (/drafting a plan/i.test(msg)) move('plan');
    else if (/reviewing|reconciling/i.test(msg) && !/diff/i.test(msg)) move('review');
    else if (/gates|checking the work/i.test(msg)) move('test');
  }

  const conference = reached.has('plan') || reached.has('review');
  const talkedOnly = !reached.size;
  // The phases this job has: what happened, plus what a job like it still
  // needs. Look only when they looked; the conference only when it ran.
  const keys = ORDER.filter((k) =>
    k === 'look' ? reached.has('look')
    : k === 'plan' || k === 'review' ? conference
    : k === 'build' ? !talkedOnly || input.working
    : k === 'test' ? !talkedOnly
    : true,
  );

  const running = [...tools].reverse().find((t) => !t.done) ?? null;
  const passed = !!lastVerify?.report.passed;
  const gateFailed = !!lastVerify && !lastVerify.report.passed && !lastVerify.report.unverified;
  // The latest test run the crew did themselves, when no gate has spoken.
  const lastTest = [...tools].reverse().find((t) => phaseOfTool(t) === 'test' && t.done);
  const testFailed = gateFailed || (!lastVerify && current === 'test' && lastTest?.ok === false);

  const curAt = current ? ORDER.indexOf(current) : -1;
  const steps: TrackerStep[] = keys.map((key) => {
    const at = ORDER.indexOf(key);
    // Phases after the current one must be earned again: a change after a
    // test means the test no longer speaks for the work.
    const doneByEvidence = key === 'done' ? false : reached.has(key) && (at < curAt || (!input.working && at <= curAt));
    return { key, label: LABEL[key], state: doneByEvidence ? 'done' : 'todo' };
  });
  const step = (k: StepKey) => steps.find((s) => s.key === k);

  let outcome: Tracker['outcome'] = null;
  const idle = !input.working && !input.consultPending;
  if (idle) {
    const test = step('test');
    if (testFailed && test) {
      test.state = 'failed';
      outcome = 'failed';
    } else if (passed && ch.status === 'verified') {
      step('done')!.state = 'done';
      step('done')!.label = 'Verified';
      outcome = 'verified';
    } else if (!talkedOnly || slice.some((i) => i.kind === 'assistant')) {
      // Green is a claim only a passing check can make (2026-09-25: "it isn't
      // done, right?"). Anything else hands the job back to you.
      step('done')!.state = 'awaiting';
      step('done')!.label = 'Your turn';
      outcome = 'yours';
    }
  } else if (input.consultPending) {
    const b = step('build');
    if (b) b.state = 'awaiting';
  } else {
    const target = current && current !== 'done' ? step(current) : step('build') ?? steps[0];
    if (target) target.state = input.approvalPending ? 'awaiting' : 'active';
  }

  // The headline: the phase happening now, or how it ended.
  const nowKey: StepKey = outcome ? (outcome === 'failed' ? 'test' : 'done') : input.consultPending ? 'build' : current ?? (talkedOnly ? 'done' : 'build');
  const word =
    outcome === 'verified' ? 'Verified'
    : outcome === 'failed' ? (gateFailed ? 'Checks failed' : 'Tests failed')
    : outcome === 'yours' ? (reached.has('test') || !reached.size ? 'Your turn' : 'Your turn · not tested')
    : input.consultPending ? 'Plan ready'
    : input.approvalPending ? 'Needs you'
    : current ? (back ? `Back to ${LABEL[current].toLowerCase()}` : WORD[current])
    : input.working ? 'Thinking' : 'Your turn';
  const detail =
    outcome === 'verified' || outcome === 'failed' ? (lastVerify?.report.summary ?? detailFor('test', tools, null))
    : outcome === 'yours' ? [detailFor('build', tools, null)].filter(Boolean).join('')
    : input.consultPending ? 'tap Proceed to build it'
    : current ? detailFor(current, tools, running)
    : '';

  let who: CrewInfo | undefined;
  for (let i = slice.length - 1; i >= 0 && !who; i--) {
    const it = slice[i];
    if ((it.kind === 'assistant' || it.kind === 'consult') && it.crew) who = it.crew;
    else if (it.kind === 'routed') who = it.worker ?? it.crew;
  }
  return { name: ch.name, steps, status: ch.status, headline: { key: nowKey, word, detail }, back: back && !!input.working, outcome, who, endIndex: ch.end };
}
