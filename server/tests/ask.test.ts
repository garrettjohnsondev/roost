import { describe, expect, it } from 'vitest';
import { ASK_LEVELS, askGuidance } from '../src/ask.js';

describe('talking it over, at the level you choose', () => {
  it('just build adds nothing to your message', () => {
    expect(askGuidance('off')).toBe('');
  });
  it('every other level asks the way a friend texts: one question at a time, with their pick', () => {
    for (const level of ['quick', 'talk', 'grill'] as const) {
      const n = askGuidance(level);
      expect(n).toMatch(/ONE question per message/);
      expect(n).toMatch(/never a bulleted list/);
      expect(n).toMatch(/say what you would pick/);
      expect(n).toMatch(/Look up facts yourself/);
    }
  });
  it('the levels escalate: a check, a design chat, an interview', () => {
    expect(askGuidance('quick')).toMatch(/at most one or two questions/);
    expect(askGuidance('talk')).toMatch(/talk it through with me first/);
    expect(askGuidance('grill')).toMatch(/Do not build until I confirm/);
  });
  it('defaults to a quick check', () => {
    expect(askGuidance(undefined)).toBe(ASK_LEVELS.quick.note);
  });
});
