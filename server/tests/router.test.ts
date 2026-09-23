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

import { parseTriage as parseTriageSized } from '../src/router.js';
describe('triage carries a size for the conference gate', () => {
  it('reads a valid size and ignores an invalid one', () => {
    expect(parseTriageSized('{"tier":"light","size":"small","reason":"rename"}').size).toBe('small');
    expect(parseTriageSized('{"tier":"heavy","size":"enormous","reason":"x"}').size).toBeUndefined();
    // Unknown size must never read as small: the gate never skips on a guess.
    expect(parseTriageSized('{"tier":"standard","reason":"x"}').size).toBeUndefined();
  });
});

describe('parseTriage — a failed call is not a bad answer', () => {
  it('reads fenced JSON, which is how Haiku actually replies', () => {
    expect(parseTriage('```json\n{"tier":"light","size":"small","reason":"quick look"}\n```')).toMatchObject({ tier: 'light', size: 'small' });
  });
  it('says an empty reply returned nothing, rather than that it was unparseable', () => {
    const r = parseTriage('   ');
    expect(r.reason).toBe('triage returned nothing — defaulted');
    expect(r.raw).toBe('');
  });
  it('keeps what the model said when it cannot be used', () => {
    const r = parseTriage('I think this is probably medium-ish?');
    expect(r.reason).toBe('triage unparseable — defaulted');
    expect(r.raw).toBe('I think this is probably medium-ish?');
  });
  it('keeps no evidence when the answer was usable', () => {
    expect(parseTriage('{"tier":"heavy","reason":"x"}').raw).toBeUndefined();
    expect(parseTriage('heavy').raw).toBeUndefined();
  });
});
