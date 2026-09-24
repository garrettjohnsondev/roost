import { describe, expect, it } from 'vitest';
import { SCENES, placeCrew, sceneIndexFor } from './scenes';
import type { CrewInfo } from './types';

const m = (name: string): CrewInfo => ({ name, role: '', roleLabel: '', tier: 'worker', color: '#000', initial: name[0], agent: 'claude', model: '', sprite: name.toLowerCase() });

describe('the scene changes on the hour, on its own, and by a tap', () => {
  it('is stable within an hour and moves on the next', () => {
    const a = sceneIndexFor(new Date(2026, 8, 24, 10, 5), 0, 10);
    const b = sceneIndexFor(new Date(2026, 8, 24, 10, 55), 0, 10);
    const c = sceneIndexFor(new Date(2026, 8, 24, 11, 0), 0, 10);
    expect(a).toBe(b);
    expect(c).toBe((a + 1) % 10);
  });
  it('a tap advances it', () => {
    const d = new Date(2026, 8, 24, 10, 5);
    expect(sceneIndexFor(d, 1, 10)).toBe((sceneIndexFor(d, 0, 10) + 1) % 10);
  });
  it('never indexes past the scenes that exist', () => {
    for (let h = 0; h < 48; h++) expect(sceneIndexFor(new Date(2026, 0, 1, h), 0, SCENES.length)).toBeLessThan(SCENES.length);
  });
});

describe('seats fill in order; a working member sits and types; the rest are awake, not asleep', () => {
  const scene = SCENES[0];
  it('most recent first, into the seats in order', () => {
    const { placed, overflow } = placeCrew([{ member: m('Pip'), working: false }, { member: m('Ollie'), working: true }], scene);
    expect(placed.map((p) => p.member.name)).toEqual(['Pip', 'Ollie']);
    expect(placed[0].seat).toBe(scene.seats[0]);
    expect(placed[1].working).toBe(true);
    expect(overflow).toEqual([]);
  });
  it('overflow past the last seat is returned, not dropped', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => ({ member: m(n), working: false }));
    const { placed, overflow } = placeCrew(many, scene);
    expect(placed.length).toBe(scene.seats.length);
    expect(overflow.map((x) => x.name)).toEqual(['e', 'f']);
  });
  it('every seat has a pose the crew can be drawn in', () => {
    for (const s of SCENES) for (const seat of s.seats) expect(['sit', 'side', 'hold', 'dance']).toContain(seat.pose);
  });
});
