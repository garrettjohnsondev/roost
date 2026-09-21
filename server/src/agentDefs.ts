import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentKind } from './protocol.js';
import type { Capability } from './agents/dispatch.js';

/** An agent definition is a TASK CONTRACT, not a job title.
 *
 *  E2EDevBench added a Designer agent to a working pipeline and the score fell
 *  43.0% -> 32.8%, with executors deferring to the specialist's plan over the
 *  actual requirements. Meanwhile SWE-agent gained 3.8% -> 12.5% from tool
 *  design alone. So strength here comes from what an agent is GIVEN, what it
 *  may TOUCH, what shape it must RETURN and what CHECKS its output -- never
 *  from telling it that it is a senior architect.
 *
 *  `hat` exists only for display: the crew still reads as a team. */
export interface AgentDef {
  name: string;
  /** Badge text. */
  label: string;
  /** Role-flavoured display only -- carries no behaviour. */
  hat: string;
  capability: Capability;
  /** Routing hint; the quota-aware router may still step it down. */
  tier: 'light' | 'standard' | 'heavy';
  /** Preferred suite, when the task genuinely needs one. */
  agent?: AgentKind;
  /** Which sections of the project file this agent receives. Naming them
   *  explicitly is the point: a test runner does not need design tokens, and
   *  handing it the whole file is how context rot starts. */
  context: string[];
  /** What the agent must return. Shape, not prose. */
  returns: string;
  /** A command the HARNESS runs to check the work. The agent must not author
   *  or edit it -- self-graded work is not evidence. */
  gate?: string;
  /** The system prompt body. */
  body: string;
}

const CAPABILITIES: Capability[] = ['read-only', 'read-write', 'execute', 'all'];

/** Minimal frontmatter reader: `key: value` and `key: [a, b]`. Deliberately
 *  not a YAML dependency -- the schema is six keys and a body. */
export function parseAgentDef(md: string, fallbackName = 'unnamed'): AgentDef {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md.trim());
  const head = m ? m[1] : '';
  const body = (m ? m[2] : md).trim();
  const fields: Record<string, string> = {};
  for (const line of head.split(/\r?\n/)) {
    const kv = /^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  const list = (v?: string): string[] =>
    !v ? [] : v.replace(/^\[|\]$/g, '').split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);

  const capability = CAPABILITIES.includes(fields.capability as Capability)
    ? (fields.capability as Capability)
    : 'read-only'; // Unknown capability fails CLOSED, never open.
  const tier = ['light', 'standard', 'heavy'].includes(fields.tier) ? (fields.tier as any) : 'standard';
  const name = fields.name || fallbackName;

  return {
    name,
    label: fields.label || name,
    hat: fields.hat || 'agent',
    capability,
    tier,
    agent: fields.agent === 'claude' || fields.agent === 'codex' ? fields.agent : undefined,
    context: list(fields.context),
    returns: fields.returns || 'a short written answer',
    gate: fields.gate || undefined,
    body,
  };
}

/** Built-ins. Every name is a TASK, not a job. The `hat` is what the UI shows. */
export const BUILT_IN_DEFS: string[] = [
  `---
name: explore
label: Explore
hat: scout
capability: read-only
tier: light
context: [conventions]
returns: a list of file paths with one line each on why it is relevant
---
Locate the code relevant to the task. Read widely, report narrowly.
Return paths and one-line reasons. Do not propose changes, do not write code,
do not summarise the whole file - the caller has a limited context and you are
spending it.`,

  `---
name: plan
label: Plan
hat: architect
capability: read-only
tier: heavy
context: [conventions, constraints, done-definition]
returns: a plan as ordered steps, each naming the files it touches
---
Write a plan for the task. Ground every step in code you have actually read.
State the acceptance criteria you are planning against, and say plainly if the
task as described cannot be met. Do not write the implementation.`,

  `---
name: review
label: Review
hat: reviewer
capability: read-only
tier: heavy
context: [done-definition]
returns: findings[] each with {file, line, problem, why-it-matters}
---
Review the work against the acceptance criteria you were given.
Report ONLY correctness problems and requirement gaps. Do not report style
preferences, do not suggest refactors, and do not invent findings to seem
useful - an empty findings list is a valid and useful answer.`,

  `---
name: ui-review
label: UI review
hat: designer
capability: execute
tier: standard
context: [design-tokens, conventions]
returns: findings[] each with {selector-or-file, rule-violated, evidence}
---
Check the interface against the project's design tokens and conventions.
Every finding must cite concrete evidence - a token that is not used, a
measured value, a rendered artifact. Opinions about taste are not findings.`,

  `---
name: test-runner
label: Tests
hat: QA
capability: execute
tier: light
context: [commands]
returns: the command run, its exit code, and the failing output verbatim
---
Run the project's checks and report what happened. Report the command, the
exit code and the real output. Never edit code to make a check pass, and never
report success you did not observe.`,

  `---
name: implement
label: Implement
hat: lead dev
capability: read-write
tier: standard
context: [conventions, done-definition]
returns: a summary of what changed and which acceptance criteria it satisfies
---
Implement the plan you were given. Follow the project's conventions over your
own preferences. If the plan conflicts with the acceptance criteria, the
CRITERIA win - say so rather than silently following the plan.`,
];

export function builtInDefs(): AgentDef[] {
  return BUILT_IN_DEFS.map((md) => parseAgentDef(md));
}

/** Project definitions override built-ins by name. Same shape as
 *  `.claude/agents/` and Grok Build's `.grok/agents/`, so they stay portable. */
export function loadAgentDefs(projectDir: string): AgentDef[] {
  const out = new Map(builtInDefs().map((d) => [d.name, d]));
  const dir = join(projectDir, '.pocket', 'agents');
  try {
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.md')) continue;
        const def = parseAgentDef(readFileSync(join(dir, f), 'utf8'), f.replace(/\.md$/, ''));
        out.set(def.name, def);
      }
    }
  } catch {
    /* a broken definition must not take the built-ins down with it */
  }
  return [...out.values()];
}
