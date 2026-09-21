import { describe, expect, it } from 'vitest';
import { parseAgentDef, builtInDefs } from '../src/agentDefs.js';
import { parseProjectFile, sliceFor, composeDispatchPrompt } from '../src/projectFile.js';

describe('agent definitions are task contracts', () => {
  const defs = builtInDefs();
  const by = (n: string) => defs.find((d) => d.name === n)!;

  it('names tasks, not job titles', () => {
    const names = defs.map((d) => d.name).sort();
    expect(names).toEqual(['explore', 'implement', 'plan', 'review', 'test-runner', 'ui-review']);
    // The team reading is display-only.
    expect(by('plan').hat).toBe('architect');
    expect(by('ui-review').hat).toBe('designer');
  });

  it('gives every definition a capability and a return shape', () => {
    for (const d of defs) {
      expect(d.capability).toBeTruthy();
      expect(d.returns.length).toBeGreaterThan(10);
    }
  });

  it('keeps planners and reviewers unable to write', () => {
    expect(by('plan').capability).toBe('read-only');
    expect(by('review').capability).toBe('read-only');
    expect(by('explore').capability).toBe('read-only');
  });

  it('lets the test runner execute but never edit', () => {
    // A runner that can rewrite the code it is testing can make any check pass.
    expect(by('test-runner').capability).toBe('execute');
  });

  it('fails closed on an unrecognised capability', () => {
    const d = parseAgentDef('---\nname: sketchy\ncapability: superuser\n---\nbody');
    expect(d.capability).toBe('read-only');
  });

  it('parses list and scalar frontmatter without a YAML dependency', () => {
    const d = parseAgentDef(`---
name: custom
label: Custom
hat: specialist
capability: read-write
tier: heavy
context: [conventions, design-tokens]
returns: a diff
gate: npm run check
---
Do the thing.`);
    expect(d.context).toEqual(['conventions', 'design-tokens']);
    expect(d.gate).toBe('npm run check');
    expect(d.body).toBe('Do the thing.');
    expect(d.tier).toBe('heavy');
  });
});

describe('project knowledge is sliced, not broadcast', () => {
  const md = `# Project knowledge

## conventions
Use tabs. Never default-export.

## commands
npm test

## design-tokens
--accent: #6d28d9
`;
  const knowledge = { sections: parseProjectFile(md), path: '/x/.pocket/project.md', exists: true };

  it('splits on H2 headings', () => {
    expect(Object.keys(knowledge.sections).sort()).toEqual(['commands', 'conventions', 'design-tokens']);
  });

  it('gives each agent only what it asked for', () => {
    const runner = builtInDefs().find((d) => d.name === 'test-runner')!;
    const slice = sliceFor(runner, knowledge);
    expect(slice).toContain('npm test');
    // A test runner has no use for design tokens; handing them over is how
    // context rot starts.
    expect(slice).not.toContain('#6d28d9');
  });

  it('skips a requested section the project has not written yet', () => {
    const plan = builtInDefs().find((d) => d.name === 'plan')!;
    expect(() => sliceFor(plan, knowledge)).not.toThrow();
    expect(sliceFor(plan, knowledge)).toContain('Use tabs');
  });

  it('puts acceptance criteria above the plan, explicitly', () => {
    const prompt = composeDispatchPrompt({
      def: builtInDefs().find((d) => d.name === 'implement')!,
      task: 'add a logout button',
      knowledge,
      criteria: 'must clear the session cookie',
    });
    expect(prompt).toContain('These outrank any plan');
    expect(prompt.indexOf('Acceptance criteria')).toBeLessThan(prompt.indexOf('# Task'));
  });

  it('never includes the caller reasoning that made review worse', () => {
    const prompt = composeDispatchPrompt({
      def: builtInDefs().find((d) => d.name === 'review')!,
      task: 'review the diff',
      knowledge,
    });
    expect(prompt).not.toContain('design-tokens');
  });
});
