import { describe, expect, it } from 'vitest';
import { describeToolUse } from '../src/approvalWords.js';

describe('a permission request in plain words', () => {
  it('says what, on what, and why', () => {
    expect(describeToolUse('Bash', { command: 'npm test', description: 'Run the tests' })).toEqual({ action: 'run a command', target: 'npm test', note: 'Run the tests', kind: 'commands' });
    expect(describeToolUse('Edit', { file_path: '/p/web/src/a.ts' }, '/p')).toMatchObject({ action: 'edit a file', target: 'web/src/a.ts', kind: 'file edits' });
    expect(describeToolUse('WebFetch', { url: 'https://x.dev' })).toMatchObject({ action: 'open a web page', target: 'https://x.dev' });
  });
  it('names an MCP tool by its server, in words', () => {
    expect(describeToolUse('mcp__claude_ai_Gmail__send_email', {})).toMatchObject({ action: 'use claude ai Gmail', target: 'send email' });
  });
  it('anything unknown still reads as a sentence', () => {
    expect(describeToolUse('Frobnicate', {})).toEqual({ action: 'use Frobnicate', kind: 'Frobnicate uses' });
  });
});
