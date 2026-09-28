import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Games } from '../src/games.js';

const fresh = () => new Games(join(mkdtempSync(join(tmpdir(), 'games-')), 'games.json'));

describe('the arcade remembers on the Mac', () => {
  it('saves, reloads and clears a game in progress', () => {
    const dir = mkdtempSync(join(tmpdir(), 'games-'));
    const g = new Games(join(dir, 'games.json'));
    g.save('snake', { len: 4 });
    expect(new Games(join(dir, 'games.json')).all().saves.snake).toEqual({ len: 4 });
    g.save('snake', null);
    expect(g.all().saves.snake).toBeUndefined();
  });
  it('keeps the best score, higher or lower is better', () => {
    const g = fresh();
    expect(g.score('snake', 10)?.isBest).toBe(true);
    expect(g.score('snake', 5)?.isBest).toBe(false);
    expect(g.score('minesweeper', 90, true)?.isBest).toBe(true);
    expect(g.score('minesweeper', 60, true)).toEqual({ best: 60, isBest: true });
    expect(g.all().plays.snake).toBe(2);
  });
  it('an achievement is earned once', () => {
    const g = fresh();
    expect(g.achieve('snake:first-apple')).toBe(true);
    expect(g.achieve('snake:first-apple')).toBe(false);
  });
  it('refuses odd ids', () => {
    const g = fresh();
    expect(g.save('../etc', {})).toBe(false);
    expect(g.score('a b', 1)).toBeNull();
  });
});
