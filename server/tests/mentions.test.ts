import { describe, expect, it } from 'vitest';
import { modelForPersona, parseMention, prettyModel } from '../src/mentions.js';

const NAMES = ['Ollie', 'Moss', 'Nell', 'Juno', 'Pip'];

describe('@-mentions pick a crew member by name', () => {
  it('finds a name at the start, mid-sentence, after punctuation; keeps the name, drops the @', () => {
    expect(parseMention('@Nell look at the composer', NAMES)).toEqual({ name: 'Nell', text: 'Nell look at the composer' });
    expect(parseMention('can @moss do this?', NAMES)).toEqual({ name: 'Moss', text: 'can Moss do this?' });
    expect(parseMention('ok, (@juno) review it', NAMES)).toEqual({ name: 'Juno', text: 'ok, (Juno) review it' });
  });

  it('ignores names that are not crew, and emails', () => {
    expect(parseMention('@everyone hi', NAMES)).toBeNull();
    expect(parseMention('mail me@nell.dev', NAMES)).toBeNull();
    expect(parseMention('no mention here', NAMES)).toBeNull();
  });

  it('takes the first real one', () => {
    expect(parseMention('@bob then @Ollie then @Nell', NAMES)?.name).toBe('Ollie');
  });
});

describe('a persona resolves to a concrete model', () => {
  const route = { light: { model: 'haiku' }, standard: { model: 'sonnet' }, heavy: { model: 'opus' } } as any;
  const card = (agent: 'claude' | 'codex', id: string, resolvedId: string | null = null) =>
    ({ agent, id, resolvedId, hidden: false } as any);

  it('suite default is the standard tier', () => {
    expect(modelForPersona({ match: '', name: 'Fig', tier: 'worker', color: '#000' }, 'claude', [], route)).toEqual({ model: 'sonnet', exact: true });
  });

  it('matches the registry by id or by what an alias resolves to', () => {
    const cards = [card('claude', 'opus', 'claude-opus-5-5'), card('codex', 'gpt-5.6-astra')];
    expect(modelForPersona({ match: 'opus-5', name: 'Ollie', tier: 'flagship', color: '#000' }, 'claude', cards, route)).toEqual({ model: 'opus', exact: true });
    expect(modelForPersona({ match: 'astra', name: 'Nell', tier: 'flagship', color: '#000' }, 'codex', cards, route)).toEqual({ model: 'gpt-5.6-astra', exact: true });
  });

  it('prefers a card that names the model over an alias that only resolves to it (item 32)', () => {
    // The live roster, 2026-09-25: "default" is listed first and resolves to
    // Opus. Matching it sent "Ollie, …" to model "default" -- Fig's.
    const cards = [card('claude', 'default', 'claude-opus-5-5[1m]'), card('claude', 'opus[1m]', 'claude-opus-5-5[1m]')];
    expect(modelForPersona({ match: 'opus', name: 'Ollie', tier: 'flagship', color: '#000' }, 'claude', cards, route).model).toBe('opus[1m]');
  });

  it('never returns an empty model; an unresolvable match falls back and says so', () => {
    const r = modelForPersona({ match: 'nonesuch', name: 'X', tier: 'worker', color: '#000' }, 'claude', [], route);
    expect(r.model).toBe('sonnet');
    expect(r.exact).toBe(false);
  });
});

describe('a model id as a person reads it', () => {
  it('names the version', () => {
    expect(prettyModel('claude-opus-5-5[1m]')).toBe('Claude Opus 5.5');
    expect(prettyModel('claude-haiku-4-5-20251001')).toBe('Claude Haiku 4.5');
    expect(prettyModel('claude-sonnet-5')).toBe('Claude Sonnet 5');
    expect(prettyModel('claude-fable-5-1')).toBe('Claude Fable 5.1');
    expect(prettyModel('gpt-6-astra')).toBe('GPT-6 Astra');
    expect(prettyModel('gpt-5.6-sol')).toBe('GPT-5.6 Sol');
    expect(prettyModel('gpt-5.5')).toBe('GPT-5.5');
  });
});
