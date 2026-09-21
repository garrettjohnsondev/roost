import { describe, expect, it } from 'vitest';
import { chooseEffort, classifyKind, EFFORT_LADDER } from '../src/routing.js';

const base = { tier: 'standard' as const, kind: 'mixed' as const, agent: 'claude' as const, headroom: 'room' as const };

describe('chooseEffort', () => {
  it('scales with task tier', () => {
    expect(chooseEffort({ ...base, tier: 'light' }).effort).toBe('low');
    expect(chooseEffort({ ...base, tier: 'standard' }).effort).toBe('medium');
    expect(chooseEffort({ ...base, tier: 'heavy' }).effort).toBe('xhigh');
  });

  // Aider's editor works because it transcribes rather than reasons; a rename
  // gains nothing from xhigh, and reasoning tokens bill as expensive output.
  it('caps mechanical work low even at heavy tier', () => {
    const d = chooseEffort({ ...base, tier: 'heavy', kind: 'mechanical' });
    expect(d.effort).toBe('medium');
    expect(d.reason).toMatch(/mechanical/);
  });

  it('raises effort for reasoning-heavy work', () => {
    expect(chooseEffort({ ...base, tier: 'standard', kind: 'reasoning' }).effort).toBe('high');
  });

  it('trims thinking BEFORE downgrading the model when quota is tight', () => {
    const d = chooseEffort({ ...base, tier: 'heavy', headroom: 'tight' });
    expect(d.effort).toBe('high'); // down from xhigh
    expect(d.steppedFrom).toBe('xhigh');
    expect(d.reason).toMatch(/before downgrading the model/);
  });

  it('floors effort when gated or exhausted', () => {
    expect(chooseEffort({ ...base, tier: 'heavy', headroom: 'gated' }).effort).toBe('low');
    expect(chooseEffort({ ...base, tier: 'heavy', headroom: 'exhausted' }).effort).toBe('low');
  });

  it('spends a soon-resetting window on thinking', () => {
    const d = chooseEffort({ ...base, tier: 'standard', surplus: true });
    expect(d.effort).toBe('high');
    expect(d.reason).toMatch(/resets soon|spending it on thinking/);
  });

  it('stays conservative when quota data is missing — unknown is not licence', () => {
    const d = chooseEffort({ ...base, tier: 'heavy', headroom: 'unknown' });
    expect(EFFORT_LADDER.claude.indexOf(d.effort)).toBeLessThanOrEqual(2);
    expect(d.reason).toMatch(/no live quota data/);
  });

  it('never requests a level the model does not implement', () => {
    const d = chooseEffort({ ...base, tier: 'heavy', supported: ['low', 'medium'] });
    expect(d.effort).toBe('medium');
    expect(d.clamped).toBe(true);
  });

  it('defers to a model that budgets its own thinking', () => {
    const d = chooseEffort({ ...base, adaptive: true });
    expect(d.adaptive).toBe(true);
    expect(d.effort).toBe('');
  });

  it('never overrides an explicit human choice', () => {
    const d = chooseEffort({ ...base, tier: 'light', headroom: 'exhausted', override: 'max' });
    expect(d.effort).toBe('max');
    expect(d.reason).toBe('set by you');
  });

  it('uses the codex ladder for codex, which starts a rung lower', () => {
    expect(chooseEffort({ ...base, agent: 'codex', tier: 'light' }).effort).toBe('minimal');
    expect(chooseEffort({ ...base, agent: 'codex', tier: 'heavy' }).effort).toBe('xhigh');
  });
});

describe('classifyKind', () => {
  it('spots mechanical work', () => {
    expect(classifyKind('rename the getUser helper across the repo')).toBe('mechanical');
    expect(classifyKind('fix this typo in the changelog')).toBe('mechanical');
  });

  it('spots reasoning work', () => {
    expect(classifyKind('debug why the websocket deadlocks under load')).toBe('reasoning');
    expect(classifyKind('design the migration strategy')).toBe('reasoning');
  });

  it('refuses to guess when signals conflict or are absent', () => {
    expect(classifyKind('refactor and rename the module')).toBe('mixed');
    expect(classifyKind('add a button')).toBe('mixed');
  });
});
