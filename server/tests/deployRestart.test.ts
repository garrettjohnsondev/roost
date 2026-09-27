import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deployRestart } from '../src/sessions.js';

const dir = (at?: string) => {
  const d = mkdtempSync(join(tmpdir(), 'restart-'));
  mkdirSync(join(d, 'releases'));
  if (at) writeFileSync(join(d, 'releases', 'restart.json'), JSON.stringify({ commit: 'abc1234', subject: 'Ship it', smoke: 'passed', at }));
  return d;
};

describe('why this boot happened', () => {
  const boot = Date.parse('2026-09-27T13:00:00Z');
  it('a marker written moments before boot is that deploy', () => {
    expect(deployRestart(boot, dir('2026-09-27T12:59:50Z'))).toEqual({ commit: 'abc1234', subject: 'Ship it', smoke: 'passed' });
  });
  it('an old marker is not this boot (a crash later is a crash)', () => {
    expect(deployRestart(boot, dir('2026-09-27T12:40:00Z'))).toBeNull();
  });
  it('no marker, no claim', () => {
    expect(deployRestart(boot, dir())).toBeNull();
  });
});
