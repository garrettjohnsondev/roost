import { describe, expect, it, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractCriteria, renderPlan, writePlan, readPlan, planPath, type PlanFile } from '../src/plans.js';

const tmp = mkdtempSync(join(tmpdir(), 'pocket-plans-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('acceptance criteria come out of the plan', () => {
  it('reads bullets and numbered items under the heading, and stops at the next heading', () => {
    const plan = `## Approach\nx\n## Acceptance criteria\n- \`npm test\` passes\n2. the button renders\n* [ ] no console errors\n## Risks\n- not a criterion`;
    expect(extractCriteria(plan)).toEqual(['`npm test` passes', 'the button renders', 'no console errors']);
  });

  it('returns nothing rather than guessing when the section is absent', () => {
    expect(extractCriteria('## Steps\n- do it')).toEqual([]);
  });
});

describe('the plan is a file', () => {
  const pf: PlanFile = { taskId: '2026-09-22-abc123', task: 'add a flag', plan: '## Approach\nsmall\n## Acceptance criteria\n- works', criteria: ['works'], rounds: 0, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000 };

  it('round-trips through markdown, including review and reconciliation', () => {
    const full = { ...pf, critique: 'VERDICT: SOLID', reconciled: '## Approach\nsame', rounds: 1 };
    writePlan(tmp, full);
    expect(existsSync(planPath(tmp, pf.taskId))).toBe(true);
    const back = readPlan(tmp, pf.taskId)!;
    expect(back.task).toBe('add a flag');
    expect(back.criteria).toEqual(['works']);
    expect(back.critique).toBe('VERDICT: SOLID');
    expect(back.reconciled).toContain('same');
    expect(back.rounds).toBe(1);
  });

  it('says plainly when no criteria were stated', () => {
    expect(renderPlan({ ...pf, criteria: [] })).toMatch(/none stated/);
  });

  it('returns null for a task that has no plan', () => {
    expect(readPlan(tmp, 'nope')).toBeNull();
  });
});
