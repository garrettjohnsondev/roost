import { describe, expect, it } from 'vitest';
import { fromCodexModelList, fromClaudeModelInfo } from '../src/registry.js';
import { reviewerFor, capabilitiesFrom, vendorsPresent } from '../src/capabilities.js';

const codex = fromCodexModelList([
  { id: 'gpt-6-astra', model: 'gpt-6-astra', displayName: 'GPT-6-Astra', isDefault: true,
    description: 'Our most capable model for complex, demanding work.',
    supportedReasoningEfforts: [{ reasoningEffort: 'high' }] },
  { id: 'gpt-5.6-terra', model: 'gpt-5.6-terra', displayName: 'GPT-5.6-Terra',
    description: 'Balanced agentic coding model for everyday work.',
    supportedReasoningEfforts: [{ reasoningEffort: 'high' }] },
  { id: 'gpt-5.5', model: 'gpt-5.5', displayName: 'GPT-5.5', upgrade: 'gpt-5.6-sol',
    description: 'Proven previous-generation model.',
    supportedReasoningEfforts: [{ reasoningEffort: 'high' }] },
]);

const claude = fromClaudeModelInfo([
  { value: 'opus', resolvedModel: 'claude-opus-5', displayName: 'Opus',
    description: 'Opus 5 · Best for everyday, complex tasks', supportedEffortLevels: ['high'] },
  { value: 'claude-fable-5-1', resolvedModel: 'claude-fable-5-1', displayName: 'Fable',
    description: 'Fable 5.1 · Most capable for your hardest and longest-running tasks',
    supportedEffortLevels: ['high'] },
  { value: 'haiku', resolvedModel: 'claude-haiku-4-5', displayName: 'Haiku',
    description: 'Haiku 4.5 · Fastest for quick answers' },
]);

describe('both subscriptions', () => {
  const all = [...codex, ...claude];

  it('sees both vendors and prefers a cross-vendor reviewer', () => {
    expect(vendorsPresent(all).sort()).toEqual(['claude', 'codex']);
    const r = reviewerFor({ agent: 'claude', model: 'opus' }, all);
    expect(r.strength).toBe('cross-vendor');
    expect(r.agent).toBe('codex');
  });

  it('reports both cross-vendor capabilities', () => {
    const c = capabilitiesFrom(all);
    expect(c.crossVendorReview).toBe(true);
    expect(c.crossVendorRouting).toBe(true);
  });
});

describe('Claude only', () => {
  it('falls back to a different model on the same subscription', () => {
    const r = reviewerFor({ agent: 'claude', model: 'opus' }, claude);
    expect(r.strength).toBe('cross-model');
    expect(r.agent).toBe('claude');
    expect(r.model).not.toBe('opus');
    // Fable outranks Haiku, so the second opinion is the stronger model.
    expect(r.model).toBe('claude-fable-5-1');
  });

  it('says plainly that cross-vendor work is unavailable', () => {
    const c = capabilitiesFrom(claude);
    expect(c.vendors).toEqual(['claude']);
    expect(c.crossVendorReview).toBe(false);
    expect(c.crossVendorRouting).toBe(false);
  });
});

describe('Codex only', () => {
  it('reviews with a different Codex model', () => {
    const r = reviewerFor({ agent: 'codex', model: 'gpt-6-astra' }, codex);
    expect(r.strength).toBe('cross-model');
    expect(r.model).toBe('gpt-5.6-terra');
  });

  it('never routes review to a superseded model', () => {
    const r = reviewerFor({ agent: 'codex', model: 'gpt-6-astra' }, codex);
    expect(r.model).not.toBe('gpt-5.5');
  });
});

describe('a single model available', () => {
  const one = claude.filter((m) => m.id === 'opus');

  it('degrades to fresh-context self-review and labels it as such', () => {
    const r = reviewerFor({ agent: 'claude', model: 'opus' }, one);
    expect(r.strength).toBe('same-model');
    expect(r.why).toMatch(/clean context/);
  });

  it('reports none when nothing is usable at all', () => {
    expect(reviewerFor({ agent: 'claude', model: 'opus' }, []).strength).toBe('none');
    expect(capabilitiesFrom([]).vendors).toEqual([]);
  });
});
