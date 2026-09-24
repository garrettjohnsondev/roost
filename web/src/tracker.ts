import { chaptersOf, type Chapter } from './chapters';
import type { ChatItem, CrewInfo, SessionMode } from './types';

/** The job tracker -- "Domino's pizza tracker, but for this section of work."
 *
 *  Asked for on 2026-09-24, in the message that got dropped: a visual of
 *  roughly where the current job is, without reading the code going by.
 *
 *  It is a pure function of the thread, the same way chapters are, so it can
 *  never claim a step the thread does not show. Nothing here is a timer or an
 *  estimate: a step is DONE when its evidence is in the items, ACTIVE when the
 *  engine is working and this is the first step without evidence, AWAITING
 *  when the next move is yours, FAILED when a gate failed. The tracker covers
 *  the LAST chapter only -- earlier jobs are folded rows, already told. */
export type StepKey = 'plan' | 'review' | 'build' | 'verify' | 'done';
export type StepState = 'todo' | 'active' | 'awaiting' | 'done' | 'failed';
export interface TrackerStep { key: StepKey; label: string; state: StepState }
export interface Tracker {
  name: string;
  steps: TrackerStep[];
  status: Chapter['status'];
  /** Index just past the job's last item -- so the caller can tell a job that
   *  JUST finished (endIndex > replayedCount) from one replayed on open,
   *  without a timer (2026-09-24: a plain chat turn had no "finished" beat). */
  endIndex: number;
  /** Whoever last did something in this job, from the thread itself (the
   *  latest turn that names its crew) -- so the face follows a handoff from
   *  Bram to Ollie instead of keeping whoever started it (2026-09-24). */
  who?: CrewInfo;
}

const LABEL: Record<StepKey, string> = { plan: 'Plan', review: 'Review', build: 'Build', verify: 'Verify', done: 'Done' };

export interface TrackerInput {
  items: ChatItem[];
  mode: SessionMode | undefined;
  /** The engine's state. Only 'working' can make a step active. */
  working: boolean;
  /** The current status line, e.g. "Ollie is drafting a plan…". Names the
   *  active step more precisely than position alone when the conference runs. */
  statusMessage: string | null;
  /** A plan is waiting on Proceed: Review is done, Build is yours to start. */
  consultPending: boolean;
  /** An approval is waiting: whatever step is active is awaiting you. */
  approvalPending: boolean;
}

export function trackerOf(input: TrackerInput): Tracker | null {
  const chapters = chaptersOf(input.items);
  const ch = chapters[chapters.length - 1];
  if (!ch) return null;
  const slice = input.items.slice(ch.start, ch.end);
  if (!slice.some((i) => i.kind === 'user')) return null;

  const consults = slice.filter((i): i is Extract<ChatItem, { kind: 'consult' }> => i.kind === 'consult');
  const hasPlan = consults.some((c) => c.phase === 'plan');
  const hasReview = consults.some((c) => c.phase === 'critique' || c.phase === 'reconcile');
  const lastConsultAt = slice.reduce((at, it, i) => (it.kind === 'consult' ? i : at), -1);
  // Build evidence: anything the worker did after the conference (or at all,
  // when there was no conference).
  const built = slice.some((it, i) => i > lastConsultAt && (it.kind === 'tool' || (it.kind === 'assistant' && it.text.length > 0)));
  const verifies = slice.filter((i): i is Extract<ChatItem, { kind: 'verify' }> => i.kind === 'verify');
  const lastVerify = verifies[verifies.length - 1];
  const msg = input.statusMessage ?? '';
  const planning = /drafting a plan/i.test(msg);
  const reviewing = /reviewing|reconciling/i.test(msg);
  const verifying = /gates/i.test(msg);

  // Which steps this job has. The conference steps appear when the mode runs
  // one, or when one actually happened (auto mode escalating a large task).
  const conference = input.mode === 'build' || input.mode === 'plan' || hasPlan || hasReview || planning || reviewing;
  const gated = input.mode === 'build' || verifies.length > 0 || verifying;
  const keys: StepKey[] = [
    ...(conference ? (['plan', 'review'] as StepKey[]) : []),
    'build',
    ...(gated ? (['verify'] as StepKey[]) : []),
    'done',
  ];

  const evidence: Record<StepKey, boolean> = {
    plan: hasPlan,
    review: hasReview,
    build: built,
    verify: !!lastVerify,
    // Done is the job's end, not only a passing gate. With no gate step (a
    // plain chat turn), the job is done when something was built and the
    // engine went idle -- it could never reach Done before (2026-09-24). With
    // a gate: a pass, or an honest NOT VERIFIED (no gates to run) once idle.
    done: gated
      ? ch.status === 'verified' || (!!lastVerify?.report.unverified && !input.working)
      : built && !input.working && !input.consultPending,
  };

  const steps: TrackerStep[] = keys.map((key) => ({ key, label: LABEL[key], state: evidence[key] ? 'done' : 'todo' }));
  const verifyStep = steps.find((s) => s.key === 'verify');
  if (verifyStep && lastVerify && !lastVerify.report.passed && !lastVerify.report.unverified) verifyStep.state = 'failed';

  // The one step that is happening now, if any. Status text wins when it
  // names a step; otherwise the first step without evidence.
  if (input.consultPending) {
    const b = steps.find((s) => s.key === 'build');
    if (b) b.state = 'awaiting';
  } else if (input.working) {
    const named: StepKey | null = planning ? 'plan' : reviewing ? 'review' : verifying ? 'verify' : null;
    const target = named ? steps.find((s) => s.key === named) : steps.find((s) => s.state === 'todo' || s.state === 'failed');
    if (target && target.key !== 'done') target.state = input.approvalPending ? 'awaiting' : 'active';
  }
  let who: CrewInfo | undefined;
  for (let i = slice.length - 1; i >= 0 && !who; i--) {
    const it = slice[i];
    if ((it.kind === 'assistant' || it.kind === 'consult') && it.crew) who = it.crew;
    else if (it.kind === 'routed') who = it.worker ?? it.crew;
  }
  return { name: ch.name, steps, status: ch.status, who, endIndex: ch.end };
}
