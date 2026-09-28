import { describe, expect, it } from 'vitest';
import { GOLD, canMove, comboBonus, ghostPace, ghostScore, maxTile, mergeTicks, move, newBoard, slideLine, spawn, who } from './logic';

describe('hatch', () => {
  it('slides and merges once per pair', () => {
    expect(slideLine([1, 1, 1, 1])).toMatchObject({ line: [2, 2, 0, 0], gained: 8, merges: 2 });
    expect(slideLine([0, 2, 0, 2])).toMatchObject({ line: [3, 0, 0, 0], gained: 8, dest: [-1, 0, -1, 0], absorbed: [3] });
    expect(slideLine([1, 2, 1, 2]).gained).toBe(0);
  });
  it('moves in every direction', () => {
    const b = [1, 1, 0, 0, ...Array(12).fill(0)];
    expect(move(b, 'right').board.slice(0, 4)).toEqual([0, 0, 0, 2]);
    expect(move(b, 'right').mergedAt).toEqual([3]);
    expect(move(b, 'down').board[12]).toBe(1);
    expect(move(b, 'up').moved).toBe(false);
  });
  it('tracks where each tile went', () => {
    const b = [0, 1, 0, 1, ...Array(12).fill(0)];
    const r = move(b, 'left');
    expect(r.moves).toEqual([{ from: 1, to: 0, absorbed: false }, { from: 3, to: 0, absorbed: true }]);
  });
  it('spawns and detects dead boards', () => {
    expect(newBoard().filter(Boolean)).toHaveLength(2);
    const full = Array.from({ length: 16 }, (_, i) => ((i + Math.floor(i / 4)) % 2) + 1);
    expect(canMove(full)).toBe(false);
    expect(spawn(full)).toBe(full);
  });
  it('plays on a 5x5 board', () => {
    const b = newBoard(Math.random, 5);
    expect(b).toHaveLength(25);
    const row = [1, 0, 0, 0, 1, ...Array(20).fill(0)];
    expect(move(row, 'left').board.slice(0, 5)).toEqual([2, 0, 0, 0, 0]);
    expect(move(row, 'down').board[20]).toBe(1);
  });
  it('golden eggs merge with their rank and pay triple', () => {
    expect(slideLine([1 + GOLD, 1, 0, 0])).toMatchObject({ line: [2, 0, 0, 0], gained: 12, golds: 1 });
    expect(maxTile([3 + GOLD, 1])).toBe(3);
    const always = () => 0;
    expect(spawn(Array(16).fill(0), always, 0.5)[0]).toBe(1 + GOLD);
    expect(spawn(Array(16).fill(0), always, 0)[0]).toBe(1);
  });
  it('rewards merge chains and scales haptics', () => {
    expect(comboBonus(100, 2)).toBe(0);
    expect(comboBonus(100, 3)).toBe(10);
    expect(comboBonus(100, 50)).toBe(100);
    expect(mergeTicks(0, 5)).toBe(0);
    expect(mergeTicks(1, 3)).toBe(1);
    expect(mergeTicks(4, 9)).toBe(7);
  });
  it('calibrates ghosts', () => {
    expect(ghostScore(0.2)).toBeLessThan(3000);
    expect(ghostScore(0.95)).toBeGreaterThan(15000);
    expect(ghostPace(1000, 0)).toBe(0);
    expect(ghostPace(1000, 10_000)).toBe(1000);
    expect(ghostPace(100_000, 200)).toBeGreaterThan(ghostPace(100_000, 100));
  });
  it('Ollie is 2048', () => { expect(who(11)).toBe('ollie'); expect(who(1)).toBe('egg'); expect(who(1 + GOLD)).toBe('egg'); });
});
