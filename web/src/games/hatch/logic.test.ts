import { describe, expect, it } from 'vitest';
import { canMove, move, newBoard, slideLine, spawn, who } from './logic';

describe('hatch', () => {
  it('slides and merges once per pair', () => {
    expect(slideLine([1, 1, 1, 1])).toEqual({ line: [2, 2, 0, 0], gained: 8 });
    expect(slideLine([0, 2, 0, 2])).toEqual({ line: [3, 0, 0, 0], gained: 8 });
    expect(slideLine([1, 2, 1, 2]).gained).toBe(0);
  });
  it('moves in every direction', () => {
    const b = [1, 1, 0, 0, ...Array(12).fill(0)];
    expect(move(b, 'right').board.slice(0, 4)).toEqual([0, 0, 0, 2]);
    expect(move(b, 'down').board[12]).toBe(1);
    expect(move(b, 'up').moved).toBe(false);
  });
  it('spawns and detects dead boards', () => {
    expect(newBoard().filter(Boolean)).toHaveLength(2);
    const full = Array.from({ length: 16 }, (_, i) => ((i + Math.floor(i / 4)) % 2) + 1);
    expect(canMove(full)).toBe(false);
    expect(spawn(full)).toBe(full);
  });
  it('Ollie is 2048', () => { expect(who(11)).toBe('ollie'); expect(who(1)).toBe('egg'); });
});
