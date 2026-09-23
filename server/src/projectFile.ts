import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { AgentDef } from './agentDefs.js';

/** What a model genuinely does not know: THIS project's conventions, tokens,
 *  commands and done-definition.
 *
 *  One file, sliced per dispatch. Generic role knowledge ("good UX
 *  principles") is what the specialist-agent experiments showed adds nothing;
 *  project-specific facts are what is actually missing. Slicing matters as
 *  much as the content -- handing every agent the whole file is how context
 *  rot starts, and a test runner has no use for design tokens. */
export interface ProjectKnowledge {
  /** Lower-cased H2 heading -> body text. */
  sections: Record<string, string>;
  path: string;
  exists: boolean;
}

export function projectFilePath(projectDir: string): string {
  return join(projectDir, '.roost', 'project.md');
}

export function slugifyHeading(h: string): string {
  return h.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function parseProjectFile(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Split on H2 so the file reads as a normal document to a human.
  const parts = md.split(/^##\s+(.+)$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const key = slugifyHeading(parts[i]);
    const body = (parts[i + 1] ?? '').trim();
    if (key && body) out[key] = body;
  }
  return out;
}

export function loadProjectKnowledge(projectDir: string): ProjectKnowledge {
  const path = projectFilePath(projectDir);
  try {
    if (existsSync(path)) {
      return { sections: parseProjectFile(readFileSync(path, 'utf8')), path, exists: true };
    }
  } catch {
    /* unreadable project file is the same as none */
  }
  return { sections: {}, path, exists: false };
}

/** Only the sections this definition asked for.
 *
 *  A section named in a definition but absent from the file is silently
 *  skipped -- it means the project has not written it yet, which is normal and
 *  must not break a dispatch. */
export function sliceFor(def: AgentDef, knowledge: ProjectKnowledge): string {
  const chunks: string[] = [];
  for (const want of def.context) {
    const body = knowledge.sections[slugifyHeading(want)];
    if (body) chunks.push(`## ${want}\n${body}`);
  }
  return chunks.join('\n\n');
}

/** The full prompt a dispatched agent receives: its contract, the project
 *  slice it asked for, and the task. Nothing else -- notably NOT the caller's
 *  reasoning, which made review worse than self-review when included. */
export function composeDispatchPrompt(opts: {
  def: AgentDef;
  task: string;
  knowledge: ProjectKnowledge;
  criteria?: string;
  extra?: string;
}): string {
  const { def, task, knowledge, criteria, extra } = opts;
  const parts = [def.body.trim()];

  const slice = sliceFor(def, knowledge);
  if (slice) parts.push(`# Project knowledge\n\n${slice}`);

  // Criteria travel WITH the task, not only in the plan: E2EDevBench's failure
  // was executors treating a plan as authority over the requirements.
  if (criteria) parts.push(`# Acceptance criteria\n\nThese outrank any plan you are given.\n\n${criteria}`);
  if (extra) parts.push(extra.trim());

  parts.push(`# Task\n\n${task.trim()}`);
  parts.push(`# Return\n\n${def.returns}`);
  return parts.join('\n\n');
}

const TEMPLATE = `# Project knowledge

Facts a model cannot infer. Each H2 is a section an agent definition can ask
for by name, so keep them short and factual.

## conventions

How code in this repo is written: naming, structure, patterns to follow and
patterns to avoid.

## commands

How to build, test and lint. Exact commands.

## done-definition

What "finished" means here. What must pass before work is accepted.

## constraints

Things that must not change, and why.

## design-tokens

Colours, spacing and type scale, and where they are defined.

## gates

Commands the harness runs to verify work. One per line. The agent never
runs or edits these; the harness does, and records exit code and output.

- npm test
`;

export function writeProjectTemplate(projectDir: string): string {
  const path = projectFilePath(projectDir);
  if (existsSync(path)) return path;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, TEMPLATE);
  return path;
}
