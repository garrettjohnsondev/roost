import { chaptersOf, type Chapter } from './chapters';
import type { ChatItem, SessionMode } from './types';

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
export interface Tracker { name: string; steps: TrackerStep[]; status: Chapter['status'] }

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
    done: ch.status === 'verified',
  };

  const steps: TrackerStep[] = keys.map((key) => ({ key, label: LABEL[key], state: evidence[key] ? 'done' : 'todo' }));
  const verifyStep = steps.find((s) => s.key === 'verify');
  if (verifyStep && lastVerify && !lastVerify.report.passed) verifyStep.state = 'failed';

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
  return { name: ch.name, steps, status: ch.status };
}
