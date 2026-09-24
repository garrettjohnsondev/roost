import { describe, expect, it } from 'vitest';
import { autoTitle, jobName } from '../src/naming.js';

describe('a session is named after the work', () => {
  it('drops the preamble and the leading verb, keeps the first few words', () => {
    expect(jobName('Add a --json flag to the avatar generator')).toBe('--json flag to the avatar');
    expect(jobName('can you please fix the composer losing drafts on reconnect?')).toBe('composer losing drafts on reconnect');
    expect(jobName('Rename fmtAgo to formatAgo everywhere')).toBe('fmtAgo to formatAgo everywhere');
  });

  it('never leaves a job nameless', () => {
    expect(jobName('')).toBe('Untitled job');
    expect(jobName('fix')).toBe('fix');
  });

  it('title is the open job, then closed jobs newest first, and fits the list', () => {
    expect(autoTitle('Add thought bubbles to the crew', ['--json flag to the avatar', 'fmtAgo to formatAgo everywhere'])).toBe(
      'thought bubbles to the crew · fmtAgo to formatAgo everywhere',
    );
    expect(autoTitle(undefined, ['one job'])).toBe('one job');
    expect(autoTitle(undefined, [])).toBe('New session');
    const long = autoTitle('a'.repeat(80), []);
    expect(long.length).toBeLessThanOrEqual(60);
  });
});
