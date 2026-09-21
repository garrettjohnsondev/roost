import { describe, expect, it } from 'vitest';
import { chooseEffort, classifyKind, EFFORT_LADDER } from '../src/routing.js';

const base = { tier: 'standard' as const, kind: 'mixed' as const, agent: 'claude' as const, headroom: 'room' as const };

describe('chooseEffort', () => {
  it('scales with task tier using conservative defaults', () => {
    expect(chooseEffort({ ...base, tier: 'light' }).effort).toBe('low');
    expect(chooseEffort({ ...base, tier: 'standard' }).effort).toBe('medium');
    // Tops out at high, not xhigh: Anthropic warns max risks overthinking on
    // structured work, and extended reasoning shows an inverted-U on accuracy.
    expect(chooseEffort({ ...base, tier: 'heavy' }).effort).toBe('high');
  });

  it('modulates configured effort rather than overriding it', () => {
    // pocket.config.json asks for xhigh on heavy -- honour it...
    expect(chooseEffort({ ...base, tier: 'heavy', configured: 'xhigh' }).effort).toBe('xhigh');
    // ...and still trim it under pressure rather than ignoring the pressure.
    expect(chooseEffort({ ...base, tier: 'heavy', configured: 'xhigh', headroom: 'tight' }).effort).toBe('high');
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
    expect(d.effort).toBe('medium'); // down from high
    expect(d.steppedFrom).toBe('high');
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
    const d = chooseEffort({ ...base, tier: 'heavy', configured: 'xhigh', supported: ['low', 'medium'] });
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
    expect(chooseEffort({ ...base, agent: 'codex', tier: 'heavy' }).effort).toBe('high');
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

import { shouldApplyEffort } from '../src/routing.js';

describe('shouldApplyEffort — protecting the prompt cache', () => {
  const base = { agent: 'claude' as const, current: 'medium', proposed: 'high' };

  it('always applies when nothing is set yet', () => {
    expect(shouldApplyEffort({ ...base, current: null }).apply).toBe(true);
  });

  it('is a no-op when unchanged', () => {
    expect(shouldApplyEffort({ ...base, proposed: 'medium' }).apply).toBe(false);
  });

  // The core hazard: a top-level effort change invalidates the prompt cache on
  // most models, and cache reads bill at ~1/10 of input.
  it('refuses a one-rung nudge mid-session — it cannot pay for the cache reset', () => {
    const d = shouldApplyEffort(base);
    expect(d.apply).toBe(false);
    expect(d.reason).toMatch(/cache reset/);
  });

  it('allows a big jump, which does pay for itself', () => {
    expect(shouldApplyEffort({ ...base, current: 'low', proposed: 'xhigh' }).apply).toBe(true);
  });

  it('always applies on a fresh context, where there is no cache to lose', () => {
    expect(shouldApplyEffort({ ...base, fresh: true }).apply).toBe(true);
  });

  it('applies freely when the model supports per-message effort', () => {
    expect(shouldApplyEffort({ ...base, perMessageEffort: true }).apply).toBe(true);
  });

  it('stops flapping after repeated changes', () => {
    const d = shouldApplyEffort({ ...base, current: 'low', proposed: 'xhigh', changesSoFar: 2 });
    expect(d.apply).toBe(false);
    expect(d.reason).toMatch(/flapping/);
  });
});
