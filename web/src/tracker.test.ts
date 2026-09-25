import { describe, expect, it } from 'vitest';
import { phaseOfTool, trackerOf, type TrackerInput } from './tracker';
import type { ChatItem, CrewInfo } from './types';

const ts = 1;
const ollie: CrewInfo = { name: 'Ollie', role: 'planner', roleLabel: 'Planner', tier: 'flagship', color: '#2f3a72', initial: 'O', agent: 'claude', model: 'opus' };
const nell: CrewInfo = { name: 'Nell', role: 'reviewer', roleLabel: 'Reviewer', tier: 'flagship', color: '#b3452f', initial: 'N', agent: 'codex', model: 'astra' };
const user = (text: string): ChatItem => ({ kind: 'user', text, imageCount: 0, ts });
const say = (text: string): ChatItem => ({ kind: 'assistant', text, complete: true, crew: ollie, ts });
const plan: ChatItem = { kind: 'consult', phase: 'plan', agent: 'claude', crew: ollie, text: 'Plan…', ts };
const critique: ChatItem = { kind: 'consult', phase: 'critique', agent: 'codex', crew: nell, text: 'VERDICT: OK', ts };
const read = (f = 'a.ts', done = true): ChatItem => ({ kind: 'tool', toolId: 'r', name: 'Read', detail: f, done, ts });
const edit = (f = 'x.ts', done = true): ChatItem => ({ kind: 'tool', toolId: 'e', name: 'Edit', detail: f, done, ok: true, ts });
const bash = (cmd: string, done = true, ok = true): ChatItem => ({ kind: 'tool', toolId: 'b', name: 'Bash', detail: cmd, done, ok, ts });
const verify = (passed: boolean, unverified = false): ChatItem => ({ kind: 'verify', report: { passed, unverified: unverified || undefined, tampered: false, gates: [], images: [], fingerprint: '', summary: passed ? '1/1 gates passed' : '0/1 gates passed', startedAt: 0, ms: 1 }, ts });

const base = (items: ChatItem[], over: Partial<TrackerInput> = {}): TrackerInput =>
  ({ items, mode: 'build', working: false, statusMessage: null, consultPending: false, approvalPending: false, ...over });
const states = (t: ReturnType<typeof trackerOf>) => t!.steps.map((s) => `${s.key}:${s.state}`).join(' ');

describe('which phase a tool call is evidence of', () => {
  it('reads are looking, edits are building, test runs are testing, commits say nothing', () => {
    expect(phaseOfTool({ name: 'Read', detail: 'a.ts' })).toBe('look');
    expect(phaseOfTool({ name: 'Bash', detail: 'cd /x && grep -n foo src' })).toBe('look');
    expect(phaseOfTool({ name: 'Edit', detail: 'a.ts' })).toBe('build');
    expect(phaseOfTool({ name: 'Bash', detail: "python3 - <<'EOF'" })).toBe('build');
    expect(phaseOfTool({ name: 'Bash', detail: 'cd /x && npm test -w server' })).toBe('test');
    expect(phaseOfTool({ name: 'Bash', detail: 'npx tsc --noEmit -p web' })).toBe('test');
    expect(phaseOfTool({ name: 'Bash', detail: 'npm run typecheck' })).toBe('test');
    expect(phaseOfTool({ name: 'Bash', detail: 'git add -A && git commit -m x' })).toBeNull();
  });
});

describe('the tracker shows what happened, in the order it happened', () => {
  it('is nothing until you have asked for something', () => {
    expect(trackerOf(base([]))).toBeNull();
  });

  it('direct work never shows a Plan it did not make (the screenshot, 2026-09-25)', () => {
    const t = trackerOf(base([user('Before we deploy, fix the tracker'), read(), edit('ChatView.tsx', false)], { working: true, mode: 'build' }));
    expect(states(t)).toBe('look:done build:active test:todo done:todo');
    expect(t!.headline).toMatchObject({ word: 'Building', detail: 'editing ChatView.tsx · 1 file changed' });
  });

  it('the conference shows Plan and Review only when they ran', () => {
    const t = trackerOf(base([user('x'), plan, critique], { consultPending: true }));
    expect(states(t)).toBe('plan:done review:done build:awaiting test:todo done:todo');
    expect(t!.headline.word).toBe('Plan ready');
    const drafting = trackerOf(base([user('x')], { working: true, statusMessage: 'Ollie is drafting a plan…' }));
    expect(states(drafting)).toBe('plan:active review:todo build:todo test:todo done:todo');
  });

  it('reading mid-build is building, not a step back', () => {
    const t = trackerOf(base([user('x'), edit(), read('b.ts', false)], { working: true }));
    expect(states(t)).toBe('build:active test:todo done:todo');
  });

  it('testing lights Test and says what is running', () => {
    const t = trackerOf(base([user('x'), read(), edit(), bash('cd /r && npm test', false)], { working: true }));
    expect(states(t)).toBe('look:done build:done test:active done:todo');
    expect(t!.headline.word).toBe('Testing');
    expect(t!.headline.detail).toMatch(/^npm test/);
  });

  it('back to building after a test: Test must be earned again, and it says so', () => {
    const t = trackerOf(base([user('x'), edit(), bash('npm test', true, false), edit('y.ts', false)], { working: true }));
    expect(states(t)).toBe('build:active test:todo done:todo');
    expect(t!.back).toBe(true);
    expect(t!.headline.word).toBe('Back to build');
  });

  it('a passing check is VERIFIED -- the only green Done', () => {
    const items = [user('x'), edit(), verify(true)];
    const t = trackerOf(base(items));
    // chaptersOf marks a job whose last gate passed as verified.
    expect(t!.outcome).toBe('verified');
    expect(states(t)).toBe('build:done test:done done:done');
    expect(t!.headline.word).toBe('Verified');
  });

  it('a failing check stamps Test red', () => {
    const t = trackerOf(base([user('x'), edit(), verify(false)]));
    expect(t!.outcome).toBe('failed');
    expect(states(t)).toBe('build:done test:failed done:todo');
    expect(t!.headline.word).toBe('Checks failed');
  });

  it('stopping with nothing checked hands it back, and says it was not tested', () => {
    const t = trackerOf(base([user('x'), edit(), say('Done.')]));
    expect(t!.outcome).toBe('yours');
    expect(states(t)).toBe('build:done test:todo done:awaiting');
    expect(t!.headline.word).toBe('Your turn · not tested');
  });

  it('no gates reads as your turn, not a failure', () => {
    const t = trackerOf(base([user('x'), edit(), verify(false, true)]));
    expect(t!.outcome).toBe('yours');
  });

  it('a plain answer with no tools is just your turn', () => {
    const t = trackerOf(base([user('what does this do?'), say('It routes.')]));
    expect(states(t)).toBe('done:awaiting');
    expect(t!.headline.word).toBe('Your turn');
  });

  it('an approval waiting puts the active phase on you', () => {
    const t = trackerOf(base([user('x'), bash('rm -rf dist', false)], { working: true, approvalPending: true }));
    expect(t!.steps.find((s) => s.key === 'build')!.state).toBe('awaiting');
    expect(t!.headline.word).toBe('Needs you');
  });

  it('the face follows whoever last did something', () => {
    const t = trackerOf(base([user('x'), plan, critique]));
    expect(t!.who?.name).toBe('Nell');
  });
});
