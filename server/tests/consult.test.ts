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
    expect(p).toMatch(/incorporating the critique/i);
  });
});
