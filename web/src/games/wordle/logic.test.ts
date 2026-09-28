import { describe, expect, it } from 'vitest';
import { answerFor, finish, forToday, ghostRows, ghostScore, hardModeError, isWord, keyMarks, mark, practiceAnswer, shareText, untilMidnight } from './logic';
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
  it('keeps stats: a histogram, games played, best streak', () => {
    let s = finish({ ...forToday(null, 20), guesses: ['crane', 'slate', 'birds'] }, true);
    expect(s.dist).toEqual([0, 0, 1, 0, 0, 0, 0]);
    expect(s.played).toBe(1);
    expect(s.maxStreak).toBe(1);
    s = finish({ ...forToday(s, 21), guesses: Array(6).fill('crane') }, false);
    expect(s.dist).toEqual([0, 0, 1, 0, 0, 0, 1]);
    expect(s.played).toBe(2);
    expect(s.maxStreak).toBe(1);
    expect(forToday({ ...s, hard: true }, 22)).toMatchObject({ hard: true, played: 2, guesses: [] });
  });
  it('enforces hard mode', () => {
    // crane vs there: r yellow, e green.
    expect(hardModeError('slate', ['crane'], 'there')).toBe('Guess must contain R');
    expect(hardModeError('rusty', ['crane'], 'there')).toBe('Letter 5 must be E');
    expect(hardModeError('three', ['crane'], 'there')).toBeNull();
    expect(hardModeError('anything', [], 'there')).toBeNull();
  });
  it('picks a practice word that is not today', () => {
    const today = 300;
    for (let i = 0; i < 20; i++) expect(practiceAnswer(today)).not.toBe(answerFor(today));
    expect(practiceAnswer(today, () => ANSWERS.indexOf(answerFor(today)) / ANSWERS.length + 1e-9)).not.toBe(answerFor(today));
  });
  it('calibrates ghosts and draws their rows', () => {
    expect(ghostScore(0.2)).toBe(6);
    expect(ghostScore(0.95)).toBe(3);
    const rows = ghostRows(4, 123);
    expect(rows).toHaveLength(4);
    expect(rows[3].join('')).toBe('ggggg');
    expect(rows.slice(0, 3).some((r) => r.join('') === 'ggggg')).toBe(false);
    expect(ghostRows(4, 123)).toEqual(rows);
    const miss = ghostRows(7, 5);
    expect(miss).toHaveLength(6);
    expect(miss.some((r) => r.join('') === 'ggggg')).toBe(false);
  });
  it('shares and counts down', () => {
    expect(shareText(5, ['crane'], 'crane')).toContain('1/6\n\n🟩🟩🟩🟩🟩');
    expect(untilMidnight(new Date(2026, 0, 1, 22, 30))).toBe('01:30');
  });
});
