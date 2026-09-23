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
    expect(personaFor('claude', 'claude-fable-5').name).toBe('Bram');
    expect(personaFor('claude', 'claude-opus-5').name).toBe('Ollie');
    expect(personaFor('claude', 'claude-sonnet-4-5').name).toBe('Wren');
    expect(personaFor('claude', 'claude-haiku-4-5').name).toBe('Moss');
  });

  it('names the Codex cast', () => {
    expect(personaFor('codex', 'gpt-5.6-sol').name).toBe('Juno');
    expect(personaFor('codex', 'gpt-5-codex').name).toBe('Juno');
    expect(personaFor('codex', 'gpt-5.4-mini').name).toBe('Tuck');
  });

  // A generic /gpt-5/ pattern used to swallow all three of these into Juno.
  it('gives every named model its own identity', () => {
    expect(personaFor('codex', 'gpt-5.6-luna').name).toBe('Bly');
    expect(personaFor('codex', 'gpt-5.6-terra').name).toBe('Rue');
    expect(personaFor('codex', 'gpt-6-astra').name).toBe('Nell');
    expect(personaFor('codex', 'gpt-5.5').name).toBe('Otto');
    const names = ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-6-astra', 'gpt-5.6-sol'].map((m) => personaFor('codex', m).name);
    expect(new Set(names).size).toBe(4); // no two models share a face
  });

  // The model actually running on this machine, which appears in NEITHER of
  // pocket.config.json's two disagreeing model lists.
  it('recognises gpt-6-astra rather than falling through to the suite default', () => {
    expect(personaFor('codex', 'gpt-6-astra').name).toBe('Nell');
    expect(personaFor('codex', 'gpt-6-astra').tier).toBe('flagship');
  });

  it('checks mini before the flagship patterns so gpt-5.4-mini is not Juno', () => {
    expect(personaFor('codex', 'gpt-5.4-mini').name).toBe('Tuck');
    expect(personaFor('codex', 'gpt-6-nano').name).toBe('Tuck');
  });

  it('falls back to a per-suite default rather than guessing', () => {
    expect(personaFor('codex', 'something-unheard-of').name).toBe('Otto');
    expect(personaFor('claude', 'something-unheard-of').name).toBe('Fig');
  });

  it('never leaks a persona across suites', () => {
    // 'sonnet' is a Claude row; a codex model must not pick it up.
    expect(personaFor('codex', 'sonnet-ish-model').name).not.toBe('Wren');
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
    expect(crewMember('claude', 'haiku', 'executor').initial).toBe('M');
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
    expect(personaFor('claude', 'claude-fable-5').name).toBe('Bram');
  });

  it('survives a corrupt overrides file', () => {
    writeFileSync(join(tmp, '.pocket-data', 'crew.json'), '{not json');
    resetCrewCache();
    expect(personaFor('claude', 'claude-fable-5').name).toBe('Bram');
  });
});

describe('rosterBlock', () => {
  it('lists names for the prompt so flagships narrate with them', () => {
    const block = rosterBlock({ claudeModels: ['haiku', 'sonnet'], codexAvailable: true, codexModels: ['gpt-6-astra'] });
    expect(block).toMatch(/Moss — claude haiku/);
    expect(block).toMatch(/Wren — claude sonnet/);
    expect(block).toMatch(/Nell — codex gpt-6-astra/);
  });

  it('omits codex entirely when it is not available', () => {
    expect(rosterBlock({ claudeModels: ['haiku'], codexAvailable: false })).not.toMatch(/codex/);
  });
});

describe('the crew arrives wearing faces', () => {
  it('gives every persona an avatar from the shipped pool', async () => {
    const { allPersonas } = await import('../src/crew.js');
    const { readFileSync } = await import('node:fs');
    const pool = JSON.parse(readFileSync(new URL('../../web/public/avatars/pool.json', import.meta.url), 'utf8'));
    const files = new Set(pool.avatars.map((a: any) => a.file));
    const crew = allPersonas();
    // 30 avatars were generated, deployed and served -- and assigned to
    // nobody, so all fourteen chips rendered as monogram letters.
    expect(crew.length).toBeGreaterThan(0);
    for (const p of crew) {
      expect(p.avatar, `${p.name} has no avatar`).toBeTruthy();
      expect(files.has(p.avatar!), `${p.name}'s avatar ${p.avatar} is not in the pool`).toBe(true);
    }
  });

  it('gives personas that share a name the same face, and others distinct ones', async () => {
    const { allPersonas } = await import('../src/crew.js');
    const byName = new Map<string, Set<string>>();
    for (const p of allPersonas()) byName.set(p.name, new Set([...(byName.get(p.name) ?? []), p.avatar!]));
    for (const [name, faces] of byName) expect(faces.size, `${name} wears ${faces.size} different faces`).toBe(1);
    const distinct = new Set([...byName.values()].map((s) => [...s][0]));
    expect(distinct.size).toBe(byName.size);
  });
});

describe('Pip is the dispatcher, not a model', () => {
  it('answers to the dispatcher role on either engine', () => {
    // Every other persona answers "which model is this". Pip answers "who is
    // running this", so the identity follows the ROLE, not the engine that
    // happened to run the triage call.
    expect(crewMember('claude', 'claude-haiku-4-5', 'dispatcher').name).toBe('Pip');
    expect(crewMember('codex', 'gpt-5.4-mini', 'dispatcher').name).toBe('Pip');
  });

  it('leaves every other role to the model persona', () => {
    expect(crewMember('claude', 'claude-haiku-4-5', 'executor').name).toBe('Moss');
    expect(crewMember('codex', 'gpt-5-codex', 'planner').name).toBe('Juno');
  });

  it('is not reachable by model id — no model may become Pip', () => {
    for (const m of ['pip', 'gpt-5-pip', 'claude-pip-1', '', 'anything']) {
      expect(personaFor('claude', m).name).not.toBe('Pip');
      expect(personaFor('codex', m).name).not.toBe('Pip');
    }
  });
})

describe('the crew owns its names, the vendors own theirs', () => {
  it('shares no name with any model id it routes', () => {
    // The old rule borrowed model ids for personas, so a vendor rename renamed
    // your crew. Nothing in the pool may be a substring of a model id again.
    const ids = ['claude-fable-5-1', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5',
                 'gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-6-astra', 'gpt-5.5', 'gpt-5-codex'];
    const names = [...new Set([...allPersonas().map((p) => p.name), 'Pip'])];
    for (const n of names) {
      for (const id of ids) {
        expect(id.includes(n.toLowerCase()), `${n} appears inside model id ${id}`).toBe(false);
      }
    }
  });
})
