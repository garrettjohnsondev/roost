import { describe, expect, it } from 'vitest';
import { parseTriage, shouldRetriage } from '../src/router.js';

describe('parseTriage', () => {
  it('parses clean JSON', () => {
    expect(parseTriage('{"tier":"light","reason":"one-line rename"}')).toEqual({ tier: 'light', reason: 'one-line rename' });
  });

  it('parses JSON embedded in chatter', () => {
    const out = parseTriage('Sure! Here is my assessment: {"tier":"heavy","reason":"cross-cutting refactor"} Hope that helps.');
    expect(out.tier).toBe('heavy');
  });

  it('falls back to keyword scan when JSON is malformed', () => {
    expect(parseTriage('I would call this a standard task overall.').tier).toBe('standard');
  });

  it('defaults to standard when nothing parseable exists', () => {
    const out = parseTriage('¯\\_(ツ)_/¯');
    expect(out.tier).toBe('standard');
    expect(out.reason).toContain('defaulted');
  });

  it('rejects invalid tier values in JSON and falls back', () => {
    expect(parseTriage('{"tier":"mega","reason":"x"} this is heavy though').tier).toBe('heavy');
  });
});

describe('shouldRetriage', () => {
  it('skips short follow-ups on any tier (continuations stay on the current model)', () => {
    expect(shouldRetriage('yes do that', 'standard')).toBe(false);
    expect(shouldRetriage('looks good, continue', 'light')).toBe(false);
    expect(shouldRetriage('yes, keep going', 'heavy')).toBe(false);
  });

  it('re-triages task-shaped messages even from heavy — the downgrade path exists', () => {
    expect(shouldRetriage('now just fix the typo in the readme', 'heavy')).toBe(true);
    expect(shouldRetriage('add a small comment to util.js', 'heavy')).toBe(true);
  });

  it('re-triages on upgrade keywords from lower tiers', () => {
    expect(shouldRetriage('now refactor the session manager', 'light')).toBe(true);
    expect(shouldRetriage('debug this crash carefully', 'standard')).toBe(true);
  });

  it('re-triages on long messages', () => {
    expect(shouldRetriage('x'.repeat(300), 'light')).toBe(true);
  });
});
