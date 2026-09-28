import { describe, expect, it } from 'vitest';
import { answerFor, finish, forToday, isWord, keyMarks, mark, shareText, untilMidnight } from './logic';
import { ANSWERS, VALID } from './words';

describe('daily word', () => {
  it('has sane lists', () => {
    expect(ANSWERS.length).toBeGreaterThanOrEqual(400);
    expect(VALID.size).toBeGreaterThanOrEqual(2000);
    for (const w of ANSWERS) expect(w).toMatch(/^[a-z]{5}$/);
    for (const w of VALID) expect(w).toMatch(/^[a-z]{5}$/);
    expect(new Set(ANSWERS).size).toBe(ANSWERS.length);
    expect(isWord('birds')).toBe(true);
    expect(isWord('xqzzt')).toBe(false);
  });
  it('picks one word per day', () => {
    expect(answerFor(100)).toBe(answerFor(100));
    expect(answerFor(100)).not.toBe(answerFor(101));
  });
  it('marks repeated letters properly', () => {
    expect(mark('crane', 'crane').join('')).toBe('ggggg');
    expect(mark('speed', 'abide').join('')).toBe('bbyby');
    expect(mark('eerie', 'there').join('')).toBe('ybybg');
    expect(keyMarks(['eerie'], 'there').e).toBe('g');
  });
  it('keeps and breaks streaks', () => {
    let s = forToday(null, 10);
    s = finish({ ...s, guesses: ['crane'] }, true);
    expect(s.streak).toBe(1);
    s = finish(forToday(s, 11), true);
    expect(s.streak).toBe(2);
    expect(forToday(s, 11)).toBe(s);
    expect(forToday(s, 13).streak).toBe(0);
    expect(finish(forToday(s, 12), false).streak).toBe(0);
  });
  it('shares and counts down', () => {
    expect(shareText(5, ['crane'], 'crane')).toContain('1/6\n\n🟩🟩🟩🟩🟩');
    expect(untilMidnight(new Date(2026, 0, 1, 22, 30))).toBe('01:30');
  });
});
