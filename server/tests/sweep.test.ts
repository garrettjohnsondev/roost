import { beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point config (and therefore the session-state file) at a temp dir BEFORE the manager
// touches it — statePath() reads the env at call time, so a beforeAll is early enough.
beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'roost-test-'));
  const configPath = join(dir, 'config.json');
  writeFileSync(configPath, JSON.stringify({ port: 0, projects: [dir], sessionIdleTimeoutHours: 24 }));
  process.env.ROOST_CONFIG = configPath;
});

describe('SessionManager.sweepIdle', () => {
  it('closes sessions idle past the timeout and keeps fresh ones', async () => {
    const { loadConfig } = await import('../src/config.js');
    const { SessionManager } = await import('../src/sessions.js');
    const manager = new SessionManager(loadConfig()) as any;

    const stale = { id: 'stale', updatedAt: Date.now() - 25 * 60 * 60 * 1000, dispose: vi.fn(), meta: () => ({}) };
    const fresh = { id: 'fresh', updatedAt: Date.now(), dispose: vi.fn(), meta: () => ({}) };
    manager.sessions.set(stale.id, stale);
    manager.sessions.set(fresh.id, fresh);

    manager.sweepIdle();

    expect(stale.dispose).toHaveBeenCalledWith(expect.stringContaining('24h of inactivity'));
    expect(manager.sessions.has('stale')).toBe(false);
    expect(fresh.dispose).not.toHaveBeenCalled();
    expect(manager.sessions.has('fresh')).toBe(true);
  });
});
