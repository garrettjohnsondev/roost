import { describe, expect, it } from 'vitest';
import {
  DT, HW, KART_R, LAPS, N, TRACKS, buildTrack, clampToRoad, ghostTime, lateral, nearest, newRace, place, step, type Race,
} from './logic';

const run = (r: Race, secs: number, input = { steer: 0, drift: false, use: false }) => {
  for (let i = 0; i < secs / DT && !r.done; i++) { r.events = []; step(r, input); }
  return r;
};
/** A simple autopilot for the player: steer at the racing line. */
const drive = (r: Race, secs: number, until?: (r: Race) => boolean) => {
  const tr = buildTrack(r.track);
  for (let i = 0; i < secs / DT && !r.done && !until?.(r); i++) {
    const k = r.karts[0];
    const p = tr.line[(k.idx + 10) % N];
    let d = Math.atan2(p.y - k.y, p.x - k.x) - k.ang;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    r.events = [];
    step(r, { steer: Math.max(-1, Math.min(1, d * 3)), drift: false, use: false });
  }
  return r;
};

describe('crewkart tracks', () => {
  for (const d of TRACKS) {
    it(`${d.id} never overlaps itself`, () => {
      const tr = buildTrack(d.id);
      expect(tr.s).toHaveLength(N);
      let worst = Infinity;
      for (let i = 0; i < N; i++) for (let j = i + 40; j < N; j++) {
        if (N - (j - i) < 40) continue;
        worst = Math.min(worst, Math.hypot(tr.s[i].x - tr.s[j].x, tr.s[i].y - tr.s[j].y));
      }
      expect(worst).toBeGreaterThan(HW * 2 + 20);
    });
  }
});

describe('crewkart sim', () => {
  it('holds still through the countdown', () => {
    const r = newRace('garden', 'pip');
    const x = r.karts[0].x;
    run(r, 2.5, { steer: 1, drift: false, use: false });
    expect(r.karts[0].x).toBe(x);
  });

  it('keeps karts inside the track bounds', () => {
    const tr = buildTrack('garden');
    const k = { x: tr.s[100].x + 400, y: tr.s[100].y + 400, idx: 100 };
    k.idx = nearest(tr, k.x, k.y, 100);
    expect(clampToRoad(tr, k)).toBe(true);
    expect(Math.abs(lateral(tr, k.x, k.y, k.idx))).toBeLessThanOrEqual(HW - KART_R + 0.01);
    // Holding one side for 20s grinds the wall but never leaves the road.
    const r = newRace('server', 'pip');
    let bumps = 0;
    for (let i = 0; i < 20 / DT; i++) {
      r.events = [];
      step(r, { steer: 1, drift: false, use: false });
      bumps += r.events.filter((e) => e === 'bump:0').length;
      const p = r.karts[0];
      expect(Math.abs(lateral(tr.id === 'server' ? tr : buildTrack('server'), p.x, p.y, p.idx))).toBeLessThanOrEqual(HW - KART_R + 0.5);
    }
    expect(bumps).toBeGreaterThan(0);
  });

  it('counts laps, records lap times and finishes after three', () => {
    const r = newRace('beach', 'pip');
    drive(r, 30, (q) => q.laps.length >= 1);
    expect(r.karts[0].lapsDone).toBe(2);
    expect(r.laps).toHaveLength(1);
    expect(r.laps[0]).toBeGreaterThan(15);
    drive(r, 200, (q) => q.karts[0].finish !== null);
    expect(r.laps).toHaveLength(LAPS);
    expect(r.karts[0].finish).not.toBeNull();
  });

  it('does not count a lap for reversing over the line', () => {
    const r = newRace('garden', 'pip');
    const k = r.karts[0];
    run(r, 3.2);
    // Turn round and drive backwards over the start.
    k.ang += Math.PI; k.mv = k.ang;
    run(r, 4);
    expect(k.prog).toBeLessThan(0);
    expect(r.laps).toHaveLength(0);
  });

  it('AI makes progress, and stronger crew are faster', () => {
    for (const d of TRACKS) {
      const r = newRace(d.id, 'pip', 7);
      run(r, 3 + 40);
      const ai = r.karts.filter((k) => k.ai);
      for (const k of ai) expect(k.prog).toBeGreaterThan(N * 0.9);
      const [slow, , fast] = [...ai].sort((a, b) => a.skill - b.skill);
      expect(fast.prog).toBeGreaterThan(slow.prog);
    }
  });

  it('drift boosts after a charge', () => {
    const r = newRace('beach', 'pip');
    drive(r, 6);
    const evs: string[] = [];
    for (let i = 0; i < 1.8 / DT; i++) { r.events = []; step(r, { steer: 0, drift: true, use: false }); }
    r.events = [];
    step(r, { steer: 0, drift: false, use: false });
    evs.push(...r.events);
    expect(evs).toContain('boost:0:big');
    expect(r.karts[0].boost).toBeGreaterThan(0);
  });

  it('shells spin out, shields block', () => {
    const r = newRace('beach', 'pip');
    drive(r, 5);
    const me = r.karts[0];
    const them = r.karts[1];
    them.x = me.x + Math.cos(me.ang) * 60; them.y = me.y + Math.sin(me.ang) * 60; them.idx = me.idx; them.prog = me.prog + 6;
    me.item = 'shell';
    let hit = false;
    for (let i = 0; i < 60 && !hit; i++) { r.events = []; step(r, { steer: 0, drift: false, use: i === 0 }); hit = r.events.some((e) => e.startsWith('hit:')); }
    expect(hit).toBe(true);
    me.shield = 5;
    r.oils.push({ x: me.x + Math.cos(me.mv) * 12, y: me.y + Math.sin(me.mv) * 12, owner: 9, age: 2 });
    r.events = []; step(r, { steer: 0, drift: false, use: false });
    expect(me.spin).toBeLessThanOrEqual(0);
    expect(me.shield).toBe(0);
  });

  it('ranks by progress', () => {
    const r = newRace('city', 'pip');
    expect(place(r)).toBe(4);
    r.karts[0].prog = 999;
    expect(place(r)).toBe(1);
  });

  it('ghost times get harder with strength', () => {
    expect(ghostTime(0.2)).toBeGreaterThan(ghostTime(0.55));
    expect(ghostTime(0.55)).toBeGreaterThan(ghostTime(0.95));
    expect(ghostTime(0.2)).toBeGreaterThan(80);
    expect(ghostTime(0.95)).toBeLessThan(72);
  });
});
