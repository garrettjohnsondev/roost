import { describe, expect, it } from 'vitest';
import { isAlias, noteResolution, describeDrift, type AliasStore } from '../src/aliasDrift.js';

const AT = 1_790_000_000_000;
const DAY = 86_400_000;

describe('isAlias', () => {
  it('treats a pointer as an alias and a pinned id as itself', () => {
    expect(isAlias('opus', 'claude-opus-5-5')).toBe(true);
    expect(isAlias('claude-opus-5-5', 'claude-opus-5-5')).toBe(false);
  });

  it('ignores a bracketed suffix, so opus[1m] is the same pointer as opus', () => {
    // Otherwise the 1M variant drifts against itself on the first call.
    expect(isAlias('claude-opus-5-5[1m]', 'claude-opus-5-5')).toBe(false);
    expect(isAlias('opus[1m]', 'claude-opus-5-5')).toBe(true);
  });

  it('is not fooled by case or padding', () => {
    expect(isAlias('  Claude-Opus-5-5  ', 'claude-opus-5-5')).toBe(false);
  });

  it('says no when either side is missing', () => {
    expect(isAlias('', 'claude-opus-5-5')).toBe(false);
    expect(isAlias('opus', '')).toBe(false);
  });
});

describe('noteResolution — the Claude half of auto-update', () => {
  it('stays silent on first sight, because there is nothing to differ from', () => {
    // Announcing here would fire on every fresh install.
    const store: AliasStore = {};
    expect(noteResolution(store, { agent: 'claude', alias: 'opus', resolved: 'claude-opus-5', at: AT })).toBeNull();
    expect(store['claude:opus'].resolved).toBe('claude-opus-5');
  });

  it('stays silent while the answer is unchanged', () => {
    const store: AliasStore = {};
    noteResolution(store, { agent: 'claude', alias: 'opus', resolved: 'claude-opus-5', at: AT });
    expect(noteResolution(store, { agent: 'claude', alias: 'opus', resolved: 'claude-opus-5', at: AT + DAY })).toBeNull();
    expect(store['claude:opus'].lastSeen).toBe(AT + DAY);
    expect(store['claude:opus'].firstSeen).toBe(AT);
  });

  it('reports the release that changes nothing in the roster', () => {
    // The actual 2026-09-22 event: Opus 5.5 shipped, `opus` started resolving to
    // it, and no model id anywhere changed.
    const store: AliasStore = {};
    noteResolution(store, { agent: 'claude', alias: 'opus', resolved: 'claude-opus-5', at: AT });
    const d = noteResolution(store, { agent: 'claude', alias: 'opus', resolved: 'claude-opus-5-5', at: AT + 30 * DAY });
    expect(d).toMatchObject({ agent: 'claude', alias: 'opus', from: 'claude-opus-5', to: 'claude-opus-5-5' });
    expect(d!.heldForMs).toBe(30 * DAY);
    expect(describeDrift(d!)).toContain('claude-opus-5-5');
    expect(describeDrift(d!)).toContain('30 days');
  });

  it('re-baselines after drift, so one release is announced once', () => {
    const store: AliasStore = {};
    noteResolution(store, { agent: 'claude', alias: 'opus', resolved: 'a', at: AT });
    expect(noteResolution(store, { agent: 'claude', alias: 'opus', resolved: 'b', at: AT + DAY })).not.toBeNull();
    expect(noteResolution(store, { agent: 'claude', alias: 'opus', resolved: 'b', at: AT + 2 * DAY })).toBeNull();
  });

  it('never reports a pinned id as drift against itself', () => {
    const store: AliasStore = {};
    expect(noteResolution(store, { agent: 'claude', alias: 'claude-opus-5-5', resolved: 'claude-opus-5-5', at: AT })).toBeNull();
    expect(Object.keys(store)).toHaveLength(0);
  });

  it('keeps aliases separate per agent and per alias', () => {
    // `opus` on Claude and a same-named pointer on Codex are different facts.
    const store: AliasStore = {};
    noteResolution(store, { agent: 'claude', alias: 'opus', resolved: 'claude-opus-5', at: AT });
    noteResolution(store, { agent: 'codex', alias: 'opus', resolved: 'gpt-6-astra', at: AT });
    noteResolution(store, { agent: 'claude', alias: 'sonnet', resolved: 'claude-sonnet-5', at: AT });
    expect(Object.keys(store).sort()).toEqual(['claude:opus', 'claude:sonnet', 'codex:opus']);
    expect(noteResolution(store, { agent: 'claude', alias: 'opus', resolved: 'claude-opus-5', at: AT })).toBeNull();
  });

  it('reports a downgrade too, not just a newer model', () => {
    // Pinning back to an older model is also a change you want told about.
    const store: AliasStore = {};
    noteResolution(store, { agent: 'claude', alias: 'opus', resolved: 'claude-opus-5-5', at: AT });
    const d = noteResolution(store, { agent: 'claude', alias: 'opus', resolved: 'claude-opus-5', at: AT + DAY });
    expect(d).toMatchObject({ from: 'claude-opus-5-5', to: 'claude-opus-5' });
  });
});
