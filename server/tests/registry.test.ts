import { describe, expect, it } from 'vitest';
import {
  fromCodexModelList, fromClaudeModelInfo, classify, clampEffort,
  effortCeiling, diffRegistry, auditRoutes,
} from '../src/registry.js';

/** Verbatim from `codex app-server` -> `model/list` on 2026-09-21, codex 0.154.0. */
const CODEX_LIVE = [
  { id: 'gpt-6-astra', model: 'gpt-6-astra', upgrade: null, displayName: 'GPT-6-Astra',
    description: 'Our most capable model for complex, demanding work.', isDefault: true, hidden: false,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: ['low','medium','high','xhigh','max','ultra'].map((r) => ({ reasoningEffort: r })) },
  { id: 'gpt-5.6-sol', model: 'gpt-5.6-sol', upgrade: null, displayName: 'GPT-5.6-Sol',
    description: 'Reliable agentic workhorse for everyday tasks.', isDefault: false, hidden: false,
    defaultReasoningEffort: 'low',
    supportedReasoningEfforts: ['low','medium','high','xhigh','max','ultra'].map((r) => ({ reasoningEffort: r })) },
  { id: 'gpt-5.6-terra', model: 'gpt-5.6-terra', upgrade: null, displayName: 'GPT-5.6-Terra',
    description: 'Balanced agentic coding model for everyday work.', isDefault: false, hidden: false,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: ['low','medium','high','xhigh','max','ultra'].map((r) => ({ reasoningEffort: r })) },
  { id: 'gpt-5.6-luna', model: 'gpt-5.6-luna', upgrade: null, displayName: 'GPT-5.6-Luna',
    description: 'Fast and affordable agentic coding model.', isDefault: false, hidden: false,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: ['low','medium','high','xhigh','max'].map((r) => ({ reasoningEffort: r })) },
  { id: 'gpt-5.5', model: 'gpt-5.5', upgrade: 'gpt-5.6-sol', displayName: 'GPT-5.5',
    description: 'Proven previous-generation model for coding and general work.', isDefault: false, hidden: false,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: ['low','medium','high','xhigh'].map((r) => ({ reasoningEffort: r })) },
];

const cards = fromCodexModelList(CODEX_LIVE);
const byId = (id: string) => cards.find((c) => c.id === id)!;

describe('codex roster normalization', () => {
  it('reads all five live models', () => {
    expect(cards).toHaveLength(5);
    expect(byId('gpt-6-astra').isVendorDefault).toBe(true);
  });

  it('never invents the `minimal` rung that routing.ts assumed', () => {
    // EFFORT_LADDER listed minimal as Codex's bottom rung. No model has it.
    expect(cards.every((c) => !c.efforts.includes('minimal'))).toBe(true);
  });

  it('sees the `ultra` and `max` rungs the hardcoded ladder stopped short of', () => {
    expect(effortCeiling(byId('gpt-6-astra'))).toBe('ultra');
    expect(effortCeiling(byId('gpt-5.6-luna'))).toBe('max');
    expect(effortCeiling(byId('gpt-5.5'))).toBe('xhigh');
  });
});

describe('tier classification from vendor metadata', () => {
  it('places each live model where its own description says it belongs', () => {
    expect(classify(byId('gpt-6-astra')).tier).toBe('heavy');
    expect(classify(byId('gpt-5.6-luna')).tier).toBe('light');
    expect(classify(byId('gpt-5.6-terra')).tier).toBe('standard');
    expect(classify(byId('gpt-5.6-sol')).tier).toBe('standard');
  });

  it('refuses to tier a superseded model, and says why', () => {
    const c = classify(byId('gpt-5.5'));
    expect(c.tier).toBeNull();
    expect(c.why).toContain('gpt-5.6-sol');
  });

  it('returns null rather than guessing at an unrecognizable model', () => {
    const odd = fromCodexModelList([
      { id: 'gpt-7-zephyr', model: 'gpt-7-zephyr', displayName: 'Zephyr', description: '',
        supportedReasoningEfforts: [{ reasoningEffort: 'low' }] },
    ])[0];
    expect(classify(odd).tier).toBeNull();
    expect(classify(odd).why).toMatch(/review/);
  });
});

describe('auditing the live config', () => {
  // pocket.config.json exactly as found on 2026-09-21.
  const autoRoute = {
    codex: {
      light: { model: 'gpt-5.4-mini' },
      standard: { model: 'gpt-5.5' },
      heavy: { model: 'gpt-5.6-sol', effort: 'xhigh' },
    },
  };
  const found = auditRoutes(autoRoute, cards);

  it('catches the deleted model', () => {
    const f = found.find((x) => x.model === 'gpt-5.4-mini')!;
    expect(f.problem).toMatch(/no longer exists/);
    expect(f.suggestion).toBe('gpt-5.6-luna');
  });

  it('catches the superseded model and names its successor', () => {
    const f = found.find((x) => x.model === 'gpt-5.5')!;
    expect(f.problem).toMatch(/superseded/);
    expect(f.suggestion).toBe('gpt-5.6-sol');
  });

  it('passes a model that is genuinely fine', () => {
    expect(found.find((x) => x.model === 'gpt-5.6-sol')).toBeUndefined();
  });
});

describe('effort clamping', () => {
  it('leaves a supported level alone', () => {
    expect(clampEffort(byId('gpt-6-astra'), 'xhigh')).toEqual({ effort: 'xhigh', clamped: false });
  });

  it('clamps down to the nearest rung a model actually has', () => {
    // Luna tops out at max; asking for ultra must not silently become default.
    expect(clampEffort(byId('gpt-5.6-luna'), 'ultra')).toEqual({ effort: 'max', clamped: true });
  });
});

describe('detecting a new release', () => {
  it('sees a Claude alias whose wire target moved -- the Opus 5.5 case', () => {
    const before = fromClaudeModelInfo([
      { value: 'opus', resolvedModel: 'claude-opus-5', displayName: 'Opus 5',
        description: 'Most capable', supportedEffortLevels: ['low','medium','high','xhigh'] },
    ]);
    const after = fromClaudeModelInfo([
      { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5',
        description: 'Most capable', supportedEffortLevels: ['low','medium','high','xhigh','max'] },
    ]);
    const changes = diffRegistry(before, after);
    expect(changes).toContainEqual({
      kind: 'resolved-moved', agent: 'claude', id: 'opus',
      from: 'claude-opus-5', to: 'claude-opus-5-5',
    });
    // And the new rung it brought with it.
    expect(changes).toContainEqual({
      kind: 'efforts-changed', agent: 'claude', id: 'opus', added: ['max'], removed: [],
    });
  });

  it('reports a brand-new model with a suggested tier', () => {
    const next = fromCodexModelList([...CODEX_LIVE, {
      id: 'gpt-6-nova', model: 'gpt-6-nova', displayName: 'GPT-6-Nova',
      description: 'Fast and affordable agentic coding model.',
      supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }],
    }]);
    const added = diffRegistry(cards, next).find((c) => c.kind === 'added');
    expect(added).toMatchObject({ kind: 'added', id: 'gpt-6-nova' });
    expect((added as any).suggested.tier).toBe('light');
  });

  it('flags a model that disappeared', () => {
    const next = cards.filter((c) => c.id !== 'gpt-5.5');
    expect(diffRegistry(cards, next)).toContainEqual({ kind: 'vanished', agent: 'codex', id: 'gpt-5.5' });
  });

  it('notices the vendor default moving', () => {
    const next = fromCodexModelList(
      CODEX_LIVE.map((m) => ({ ...m, isDefault: m.id === 'gpt-5.6-terra' })),
    );
    expect(diffRegistry(cards, next)).toContainEqual({
      kind: 'default-moved', agent: 'codex', from: 'gpt-6-astra', to: 'gpt-5.6-terra',
    });
  });
});

/** Verbatim from `supportedModels()` on 2026-09-21. */
const CLAUDE_LIVE = [
  { value: 'default', resolvedModel: 'claude-opus-5[1m]', displayName: 'Default (recommended)',
    description: 'Opus 5 with 1M context · Best for everyday, complex tasks',
    supportsEffort: true, supportsAdaptiveThinking: true,
    supportedEffortLevels: ['low','medium','high','xhigh','max'] },
  { value: 'opus[1m]', resolvedModel: 'claude-opus-5[1m]', displayName: 'Opus (1M context)',
    description: 'Opus 5 with 1M context · Best for everyday, complex tasks',
    supportsEffort: true, supportsAdaptiveThinking: true,
    supportedEffortLevels: ['low','medium','high','xhigh','max'] },
  { value: 'claude-fable-5-1[1m]', resolvedModel: 'claude-fable-5-1', displayName: 'Fable',
    description: 'Fable 5.1 · Most capable for your hardest and longest-running tasks',
    supportsEffort: true, supportsAdaptiveThinking: true,
    supportedEffortLevels: ['low','medium','high','xhigh','max'] },
  { value: 'sonnet', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet',
    description: 'Sonnet 5 · Efficient for routine tasks',
    supportsEffort: true, supportsAdaptiveThinking: true,
    supportedEffortLevels: ['low','medium','high','xhigh','max'] },
  { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku',
    description: 'Haiku 4.5 · Fastest for quick answers' },
];

describe('claude roster', () => {
  const cc = fromClaudeModelInfo(CLAUDE_LIVE);
  const c = (id: string) => cc.find((x) => x.id === id)!;

  it('tiers each model the way its own description reads', () => {
    // "Best for everyday, complex tasks" -- `everyday` must not win over
    // `complex tasks`, which is what filed Opus as standard the first time.
    expect(classify(c('opus[1m]')).tier).toBe('heavy');
    expect(classify(c('claude-fable-5-1[1m]')).tier).toBe('heavy');
    expect(classify(c('sonnet')).tier).toBe('standard');
    expect(classify(c('haiku')).tier).toBe('light');
  });

  it('captures adaptive thinking, so routing need not guess a budget', () => {
    expect(c('sonnet').adaptiveThinking).toBe(true);
    expect(c('haiku').adaptiveThinking).toBe(false);
    expect(c('haiku').supportsEffort).toBe(false);
  });

  it('does not report a working alias as deleted', () => {
    // The roster offers `opus[1m]`; a config saying `opus` is still valid.
    const issues = auditRoutes(
      { claude: { heavy: { model: 'opus', effort: 'xhigh' }, light: { model: 'haiku' } } },
      cc,
    );
    expect(issues.filter((i) => i.problem.includes('no longer exists'))).toEqual([]);
  });

  it('still catches an effort level a model genuinely lacks', () => {
    const issues = auditRoutes({ claude: { light: { model: 'haiku', effort: 'xhigh' } } }, cc);
    expect(issues).toEqual([]); // haiku declares no levels at all -- nothing to contradict
    const issues2 = auditRoutes({ claude: { heavy: { model: 'opus', effort: 'ultra' } } }, cc);
    expect(issues2[0].problem).toMatch(/not supported/);
    expect(issues2[0].suggestion).toBe('max');
  });
});

import { ModelRegistry as PresenceRegistry } from '../src/registry.js';
import { mkdtempSync as mkTmp } from 'node:fs';
import { tmpdir as osTmp } from 'node:os';
import { join as joinPath } from 'node:path';
describe('vendor presence comes from the last fetch, not the cache', () => {
  it('reports absent after a failed fetch even with a cached roster', () => {
    const reg = new PresenceRegistry(mkTmp(joinPath(osTmp(), 'pocket-presence-')));
    expect(reg.presence('codex')).toBe('unknown');
    reg.update('codex', fromCodexModelList(CODEX_LIVE));
    reg.noteFetch('codex', true);
    expect(reg.presence('codex')).toBe('present');
    reg.noteFetch('codex', false, 'not logged in');
    expect(reg.all().some((m) => m.agent === 'codex')).toBe(true); // cache kept
    expect(reg.presence('codex')).toBe('absent');
  });
});
