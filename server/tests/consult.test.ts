import { describe, expect, it } from 'vitest';
import { composeCriticPrompt, composePlannerPrompt, composeProceedPrompt } from '../src/consult.js';

describe('consult prompt composition', () => {
  it('planner prompt includes the task and forbids modification', () => {
    const p = composePlannerPrompt('add dark mode', 'User: hi\nAgent: hello');
    expect(p).toContain('add dark mode');
    expect(p).toContain('Recent conversation context');
    expect(p).toMatch(/change NOTHING/i);
  });

  it('planner prompt omits the context section when there is none', () => {
    expect(composePlannerPrompt('add dark mode', '')).not.toContain('Recent conversation context');
  });

  it('critic prompt carries both task and plan and demands a verdict', () => {
    const p = composeCriticPrompt('the task', 'the plan');
    expect(p).toContain('the task');
    expect(p).toContain('the plan');
    expect(p).toContain('VERDICT');
  });

  it('proceed prompt carries task, plan, and critique for the executing agent', () => {
    const p = composeProceedPrompt('T', 'P', 'C');
    expect(p).toContain('Execute this task:\nT');
    expect(p).toContain('P');
    expect(p).toContain('C');
    expect(p).toMatch(/already reconciles them/i);
  });
});

import { composeCriticPrompt as critic2, composeReconcilePrompt, composeProceedPrompt as proceed2, composePlannerPrompt as planner2 } from '../src/consult.js';
describe('conference prompts carry the doctrine', () => {
  it('asks the planner for checkable acceptance criteria', () => {
    expect(planner2('do x', '')).toMatch(/## Acceptance criteria/);
    expect(planner2('do x', '')).toMatch(/can be CHECKED/);
  });

  it('starves the reviewer: task, plan, criteria -- and tells it that nothing found is fine', () => {
    const p = critic2('do x', 'the plan', ['tests pass']);
    expect(p).toContain('- tests pass');
    expect(p).not.toMatch(/conversation context/i);
    expect(p).toMatch(/valid and useful answer/);
  });

  it('reconciles finding by finding, with the criteria on top', () => {
    const p = composeReconcilePrompt('do x', 'the plan', 'the review', ['tests pass']);
    expect(p).toMatch(/ACCEPT/);
    expect(p).toMatch(/REJECT/);
    expect(p).toMatch(/outrank both the plan and the review/);
    expect(p).toMatch(/Do not add work the task did not ask for/);
  });

  it('tells the executor the criteria outrank the plan and the gates are not its to touch', () => {
    const p = proceed2('do x', 'the plan', 'the review', ['tests pass']);
    expect(p).toMatch(/criteria win/);
    expect(p).toMatch(/do not edit or run the gate definitions/);
  });
});
