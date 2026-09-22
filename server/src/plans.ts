import { mkdirSync, writeFileSync, readFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseProjectFile } from './projectFile.js';

/** The plan is a FILE. Magentic-One lost 31 points without its ledgers; Cursor
 *  and Windsurf converged on plan.md independently. A file survives context
 *  compaction, can be handed to a fresh session, and makes the cross-vendor
 *  handoff a small artifact rather than a trace. */
export interface PlanFile {
  taskId: string;
  task: string;
  plan: string;
  /** Verifiable statements pulled from the plan's "Acceptance criteria"
   *  section. They travel with execution and verification, and outrank the
   *  plan -- E2EDevBench's executors deferring to the plan over the
   *  requirements was the failure. */
  criteria: string[];
  critique?: string;
  reconciled?: string;
  rounds: number;
  createdAt: number;
  updatedAt: number;
}

export const plansDir = (cwd: string): string => join(cwd, '.pocket', 'plans');
export const planPath = (cwd: string, taskId: string): string => join(plansDir(cwd), `${taskId}.md`);

export function newTaskId(): string {
  return `${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 6)}`;
}

/** Bullets or numbered lines under a heading that mentions acceptance criteria. */
export function extractCriteria(text: string): string[] {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^#{1,4}\s*acceptance criteria/i.test(l.trim()));
  if (start < 0) return [];
  const out: string[] = [];
  for (const raw of lines.slice(start + 1)) {
    const l = raw.trim();
    if (/^#{1,4}\s/.test(l)) break;
    const m = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(l);
    if (m && m[1].trim()) out.push(m[1].trim().replace(/^\[[ x]\]\s*/i, ''));
  }
  return out;
}

/** Embedded bodies keep their own headings one level DOWN, so the file's H2
 *  structure (Task / Acceptance criteria / Plan / Review / Reconciled plan)
 *  stays unambiguous: a plan's own "## Acceptance criteria" used to split the
 *  file at read time and swallow the Plan section. */
const demote = (s: string) => s.trim().replace(/^(#{1,5})\s/gm, '#$1 ');

export function renderPlan(pf: PlanFile): string {
  const parts = [
    `# Plan ${pf.taskId}`,
    '',
    `<!-- created ${new Date(pf.createdAt).toISOString()} · updated ${new Date(pf.updatedAt).toISOString()} · review rounds ${pf.rounds} -->`,
    '',
    '## Task',
    '',
    pf.task.trim(),
    '',
    '## Acceptance criteria',
    '',
    pf.criteria.length ? pf.criteria.map((c) => `- ${c}`).join('\n') : '_(none stated -- verification falls back to the project gates alone)_',
    '',
    '## Plan',
    '',
    demote(pf.plan),
  ];
  if (pf.critique) parts.push('', '## Review', '', demote(pf.critique));
  if (pf.reconciled) parts.push('', '## Reconciled plan', '', demote(pf.reconciled));
  return parts.join('\n') + '\n';
}

export function writePlan(cwd: string, pf: PlanFile): string {
  mkdirSync(plansDir(cwd), { recursive: true });
  const path = planPath(cwd, pf.taskId);
  writeFileSync(path + '.tmp', renderPlan(pf));
  renameSync(path + '.tmp', path);
  return path;
}

export function readPlan(cwd: string, taskId: string): PlanFile | null {
  const path = planPath(cwd, taskId);
  if (!existsSync(path)) return null;
  const md = readFileSync(path, 'utf8');
  const s = parseProjectFile(md);
  if (!s['task'] || !s['plan']) return null;
  const rounds = Number(/review rounds (\d+)/.exec(md)?.[1] ?? 0);
  const created = /created ([^ ]+)/.exec(md)?.[1];
  const updated = /updated ([^ ]+)/.exec(md)?.[1];
  return {
    taskId,
    task: s['task'],
    plan: s['plan'],
    criteria: extractCriteria(`## Acceptance criteria\n${s['acceptance-criteria'] ?? ''}`),
    critique: s['review'],
    reconciled: s['reconciled-plan'],
    rounds,
    createdAt: created ? Date.parse(created) || 0 : 0,
    updatedAt: updated ? Date.parse(updated) || 0 : 0,
  };
}
