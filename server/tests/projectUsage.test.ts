import { describe, expect, it, beforeEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const data = mkdtempSync(join(tmpdir(), 'pu-data-'));
vi.mock('../src/config.js', () => ({ dataDir: () => data }));
const { scanUsage, projectUsage, _resetForTests } = await import('../src/projectUsage.js');

const now = Date.parse('2026-09-28T12:00:00Z');
function roots() {
  const claude = mkdtempSync(join(tmpdir(), 'pu-claude-'));
  const codex = mkdtempSync(join(tmpdir(), 'pu-codex-'));
  mkdirSync(join(claude, 'proj'), { recursive: true });
  mkdirSync(join(codex, '2026', '09', '28'), { recursive: true });
  return { claude, codex };
}
const claudeLine = (id: string, cwd: string, model: string, input: number, out: number, ts = '2026-09-28T10:00:00Z') =>
  JSON.stringify({ type: 'assistant', cwd, timestamp: ts, message: { id, model, usage: { input_tokens: input, cache_creation_input_tokens: 0, cache_read_input_tokens: 999, output_tokens: out } } }) + '\n';

describe('per-project usage from the vendors’ own logs', () => {
  beforeEach(() => _resetForTests());

  it('adds Claude replies once each, by project and model, and skips cache reads', async () => {
    const r = roots();
    const f = join(r.claude, 'proj', 'a.jsonl');
    writeFileSync(f, claudeLine('m1', '/p/yayo', 'claude-opus-5-5', 100, 50) + claudeLine('m1', '/p/yayo', 'claude-opus-5-5', 100, 50) + claudeLine('m2', '/p/roost/sub', 'claude-sonnet-5', 10, 10));
    await scanUsage({ claudeRoot: r.claude, codexRoot: r.codex, now });
    const u = projectUsage(['/p/yayo', '/p/roost'], now);
    expect(u.find((x) => x.cwd === '/p/yayo')?.tokens).toBe(150);
    expect(u.find((x) => x.cwd === '/p/roost')?.byModel).toEqual({ 'claude-sonnet-5': 20 });
    expect(u.find((x) => x.cwd === '/p/yayo')?.share.claude).toBeCloseTo(150 / 170);
  });

  it('reads Codex token counts against the session cwd, and only what was appended', async () => {
    const r = roots();
    const f = join(r.codex, '2026', '09', '28', 'rollout.jsonl');
    writeFileSync(f, JSON.stringify({ type: 'session_meta', timestamp: '2026-09-28T09:00:00Z', payload: { cwd: '/p/yayo' } }) + '\n'
      + JSON.stringify({ type: 'turn_context', timestamp: '2026-09-28T09:00:01Z', payload: { cwd: '/p/yayo', model: 'gpt-6-astra' } }) + '\n'
      + JSON.stringify({ type: 'event_msg', timestamp: '2026-09-28T09:01:00Z', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 30 } } } }) + '\n');
    await scanUsage({ claudeRoot: r.claude, codexRoot: r.codex, now });
    expect(projectUsage(['/p/yayo'], now)[0].byAgent.codex).toBe(230);
    appendFileSync(f, JSON.stringify({ type: 'event_msg', timestamp: '2026-09-28T09:02:00Z', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 0 } } } }) + '\n');
    await scanUsage({ claudeRoot: r.claude, codexRoot: r.codex, now });
    expect(projectUsage(['/p/yayo'], now)[0].byModel).toEqual({ 'gpt-6-astra': 330 });
  });

  it('leaves out days older than a week', async () => {
    const r = roots();
    writeFileSync(join(r.claude, 'proj', 'old.jsonl'), claudeLine('o1', '/p/yayo', 'claude-opus-5-5', 500, 0, '2026-09-10T10:00:00Z'));
    await scanUsage({ claudeRoot: r.claude, codexRoot: r.codex, now });
    expect(projectUsage(['/p/yayo'], now)).toEqual([]);
  });
});
