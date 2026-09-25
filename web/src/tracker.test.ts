import { describe, expect, it } from 'vitest';
import { trackerOf, type TrackerInput } from './tracker';
import type { ChatItem, CrewInfo } from './types';

const ts = 1;
const ollie: CrewInfo = { name: 'Ollie', role: 'planner', roleLabel: 'Planner', tier: 'flagship', color: '#2f3a72', initial: 'O', agent: 'claude', model: 'opus' };
const nell: CrewInfo = { name: 'Nell', role: 'reviewer', roleLabel: 'Reviewer', tier: 'flagship', color: '#b3452f', initial: 'N', agent: 'codex', model: 'astra' };
const user = (text: string): ChatItem => ({ kind: 'user', text, imageCount: 0, ts });
const plan: ChatItem = { kind: 'consult', phase: 'plan', agent: 'claude', crew: ollie, text: 'Plan…', ts };
const critique: ChatItem = { kind: 'consult', phase: 'critique', agent: 'codex', crew: nell, text: 'VERDICT: OK', ts };
const tool: ChatItem = { kind: 'tool', toolId: 't', name: 'Edit', detail: 'x.ts', done: true, ts };
const pass: ChatItem = { kind: 'verify', report: { passed: true, tampered: false, gates: [], images: [], fingerprint: '', summary: 'ok', startedAt: 0, ms: 1 }, ts };
const fail: ChatItem = { kind: 'verify', report: { passed: false, tampered: false, gates: [], images: [], fingerprint: '', summary: '1 failed', startedAt: 0, ms: 1 }, ts };

const base = (items: ChatItem[], over: Partial<TrackerInput> = {}): TrackerInput =>
  ({ items, mode: 'build', working: false, statusMessage: null, consultPending: false, approvalPending: false, ...over });

const states = (t: ReturnType<typeof trackerOf>) => t!.steps.map((s) => `${s.key}:${s.state}`).join(' ');

describe('the job tracker reports the thread, never a guess', () => {
  it('is nothing until you have asked for something', () => {
    expect(trackerOf(base([]))).toBeNull();
  });

  it('build mode: plan → review → build → verify → done, lit by evidence', () => {
    const t = trackerOf(base([user('Add a --json flag')], { working: true, statusMessage: 'Ollie is drafting a plan…' }));
    expect(states(t)).toBe('plan:active review:todo build:todo verify:todo done:todo');
    expect(t!.name).toBe('--json flag');
  });

  it('a plan awaiting Proceed puts the next move on you, at Build', () => {
    const t = trackerOf(base([user('x'), plan, critique], { consultPending: true }));
    expect(states(t)).toBe('plan:done review:done build:awaiting verify:todo done:todo');
  });

  it('lights Build once the worker is doing things after the conference', () => {
    const t = trackerOf(base([user('x'), plan, critique, tool], { working: true }));
    expect(states(t)).toBe('plan:done review:done build:done verify:active done:todo');
  });

  it('names the gate step from the status line while gates run', () => {
    const t = trackerOf(base([user('x'), plan, critique, tool], { working: true, statusMessage: 'Running the project gates…' }));
    expect(t!.steps.find((s) => s.key === 'verify')!.state).toBe('active');
  });

  it('marks a failed gate FAILED, and Done stays unlit', () => {
    const t = trackerOf(base([user('x'), plan, critique, tool, fail]));
    expect(states(t)).toBe('plan:done review:done build:done verify:failed done:todo');
  });

  it('is all green when the gates pass', () => {
    const t = trackerOf(base([user('x'), plan, critique, tool, pass]));
    expect(states(t)).toBe('plan:done review:done build:done verify:done done:done');
  });

  it('plain chat has no conference and no gate: just Build → Done', () => {
    const t = trackerOf(base([user('hi')], { mode: 'chat', working: true }));
    expect(states(t)).toBe('build:active done:todo');
  });

  it('auto mode grows the conference steps only when one actually ran', () => {
    expect(states(trackerOf(base([user('x')], { mode: 'auto', working: true })))).toBe('build:active done:todo');
    expect(states(trackerOf(base([user('x'), plan], { mode: 'auto', working: true })))).toBe('plan:done review:active build:todo done:todo');
  });

  it('an approval turns the active step into awaiting you', () => {
    const t = trackerOf(base([user('x')], { mode: 'chat', working: true, approvalPending: true }));
    expect(states(t)).toBe('build:awaiting done:todo');
  });

  it('tracks the LAST job only; a verified earlier job is a folded row, not this bar', () => {
    const t = trackerOf(base([user('one'), tool, pass, user('two')], { mode: 'chat', working: true }));
    expect(t!.name).toBe('two');
    expect(states(t)).toBe('build:active done:todo');
  });

  it('a turn that ended with nothing checked is "Your turn", never a green Done', () => {
    // 2026-09-25: Done lit green while the crew only waited on a background
    // job. Stopping is not finishing; only a passing gate is.
    const t = trackerOf(base([user('hi'), tool], { mode: 'chat', working: false }));
    expect(states(t)).toBe('build:done done:awaiting');
    expect(t!.steps.find((x) => x.key === 'done')!.label).toBe('Your turn');
  });

  it('a passing gate is the only green Done', () => {
    const t = trackerOf(base([user('hi'), tool, pass], { mode: 'chat', working: false }));
    expect(t!.steps.find((x) => x.key === 'done')!.state).toBe('done');
  });

  it('endIndex is the job\'s last item + 1, so the UI can tell a finish that just happened from replayed history', () => {
    const items = [user('one'), tool, pass, user('two'), tool];
    const t = trackerOf(base(items, { mode: 'chat', working: false }));
    expect(t!.endIndex).toBe(items.length);
  });
});
