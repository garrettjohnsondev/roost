import { describe, expect, it } from 'vitest';
import { toolDetail } from '../src/toolDetail.js';

describe('toolDetail — what the tool is doing, not how it was encoded', () => {
  it('shows a shell command as the command', () => {
    expect(toolDetail('Bash', { command: 'ls -la && cat README.md' })).toBe('ls -la && cat README.md');
  });
  it('shows a file tool as its path, trimmed to the last two segments', () => {
    expect(toolDetail('Edit', { file_path: '/Volumes/PortableSSD/remote/server/src/sessions.ts', old_string: 'a', new_string: 'b' })).toBe('src/sessions.ts');
  });
  it('shows a search as what it looks for and where', () => {
    expect(toolDetail('Grep', { pattern: 'onModelResolved', path: '/x/server/src' })).toBe('“onModelResolved” in server/src');
  });
  it('still shows an unknown tool’s input rather than hiding it', () => {
    expect(toolDetail('SomethingNew', { a: 1 })).toBe('{"a":1}');
  });
  it('falls back when a known tool arrives without its usual field', () => {
    expect(toolDetail('Bash', { weird: true })).toBe('{"weird":true}');
  });
  it('survives a missing input', () => {
    expect(toolDetail('Read', undefined)).toBe('{}');
  });
});
