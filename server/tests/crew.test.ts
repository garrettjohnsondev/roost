import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'pocket-crew-'));
process.env.POCKET_CONFIG = join(tmp, 'pocket.config.json');
writeFileSync(process.env.POCKET_CONFIG, '{}');

const { personaFor, crewMember, rosterBlock, saveOverrides, resetCrewCache, allPersonas } = await import('../src/crew.js');

beforeEach(() => resetCrewCache());
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('personaFor', () => {
  it('names the Claude cast', () => {
    expect(personaFor('claude', 'claude-fable-5').name).toBe('Fable');
    expect(personaFor('claude', 'claude-opus-5').name).toBe('Ollie');
    expect(personaFor('claude', 'claude-sonnet-4-5').name).toBe('Sunny');
    expect(personaFor('claude', 'claude-haiku-4-5').name).toBe('Larry');
  });

  it('names the Codex cast', () => {
    expect(personaFor('codex', 'gpt-5.6-sol').name).toBe('Sol');
    expect(personaFor('codex', 'gpt-5-codex').name).toBe('Sol');
    expect(personaFor('codex', 'gpt-5.4-mini').name).toBe('Bolt');
  });

  // A generic /gpt-5/ pattern used to swallow all three of these into Sol.
  it('gives every named model its own identity', () => {
    expect(personaFor('codex', 'gpt-5.6-luna').name).toBe('Luna');
    expect(personaFor('codex', 'gpt-5.6-terra').name).toBe('Terra');
    expect(personaFor('codex', 'gpt-6-astra').name).toBe('Astra');
    expect(personaFor('codex', 'gpt-5.5').name).toBe('Rex');
    const names = ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-6-astra', 'gpt-5.6-sol'].map((m) => personaFor('codex', m).name);
    expect(new Set(names).size).toBe(4); // no two models share a face
  });

  // The model actually running on this machine, which appears in NEITHER of
  // pocket.config.json's two disagreeing model lists.
  it('recognises gpt-6-astra rather than falling through to the suite default', () => {
    expect(personaFor('codex', 'gpt-6-astra').name).toBe('Astra');
    expect(personaFor('codex', 'gpt-6-astra').tier).toBe('flagship');
  });

  it('checks mini before the flagship patterns so gpt-5.4-mini is not Sol', () => {
    expect(personaFor('codex', 'gpt-5.4-mini').name).toBe('Bolt');
    expect(personaFor('codex', 'gpt-6-nano').name).toBe('Bolt');
  });

  it('falls back to a per-suite default rather than guessing', () => {
    expect(personaFor('codex', 'something-unheard-of').name).toBe('Rex');
    expect(personaFor('claude', 'something-unheard-of').name).toBe('Ace');
  });

  it('never leaks a persona across suites', () => {
    // 'sonnet' is a Claude row; a codex model must not pick it up.
    expect(personaFor('codex', 'sonnet-ish-model').name).not.toBe('Sunny');
  });

  it('carries a brand colour for every default', () => {
    for (const p of allPersonas()) expect(p.color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('crewMember', () => {
  it('separates who from what hat', () => {
    const planning = crewMember('claude', 'claude-opus-5', 'planner');
    const reviewing = crewMember('claude', 'claude-opus-5', 'reviewer');
    expect(planning.name).toBe(reviewing.name); // same person
    expect(planning.roleLabel).toBe('Planner');
    expect(reviewing.roleLabel).toBe('Reviewer');
  });

  it('provides a monogram initial for the avatar fallback', () => {
    expect(crewMember('claude', 'haiku', 'executor').initial).toBe('L');
  });
});

describe('overrides', () => {
  it('lets a user rename and recolour a crew member', () => {
    mkdirSync(join(tmp, '.pocket-data'), { recursive: true });
    saveOverrides([{ match: 'haiku', suite: 'claude', name: 'Scout', tier: 'worker', color: '#ff0000' }]);
    resetCrewCache();
    const p = personaFor('claude', 'claude-haiku-4-5');
    expect(p.name).toBe('Scout');
    expect(p.color).toBe('#ff0000');
  });

  it('lets a user add crew for a model we have never heard of', () => {
    saveOverrides([{ match: 'llama', suite: 'claude', name: 'Llama', tier: 'worker', color: '#00ff00' }]);
    resetCrewCache();
    expect(personaFor('claude', 'llama-4-maverick').name).toBe('Llama');
    // ...without clobbering the built-ins
    expect(personaFor('claude', 'claude-fable-5').name).toBe('Fable');
  });

  it('survives a corrupt overrides file', () => {
    writeFileSync(join(tmp, '.pocket-data', 'crew.json'), '{not json');
    resetCrewCache();
    expect(personaFor('claude', 'claude-fable-5').name).toBe('Fable');
  });
});

describe('rosterBlock', () => {
  it('lists names for the prompt so flagships narrate with them', () => {
    const block = rosterBlock({ claudeModels: ['haiku', 'sonnet'], codexAvailable: true, codexModels: ['gpt-6-astra'] });
    expect(block).toMatch(/Larry — claude haiku/);
    expect(block).toMatch(/Sunny — claude sonnet/);
    expect(block).toMatch(/Astra — codex gpt-6-astra/);
  });

  it('omits codex entirely when it is not available', () => {
    expect(rosterBlock({ claudeModels: ['haiku'], codexAvailable: false })).not.toMatch(/codex/);
  });
});
