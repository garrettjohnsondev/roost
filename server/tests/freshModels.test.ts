import { describe, expect, it } from 'vitest';
import { fromCodexModelList, freshCodexModel, freshenRoutes } from '../src/registry.js';

// The live Codex roster on 2026-09-29.
const cards = fromCodexModelList([
  { id: 'gpt-6.1-sol', isDefault: true, description: 'Latest workhorse model for coding and everyday work.' },
  { id: 'gpt-6-astra', description: 'Frontier intelligence for the most demanding work.' },
  { id: 'gpt-6-sol', description: 'Previous generation workhorse model.' },
  { id: 'gpt-6-luna', description: 'Fast and affordable model for easier tasks.' },
  { id: 'gpt-5.6-sol', description: 'Older generation workhorse model.' },
  { id: 'gpt-5.6-terra', description: 'Older balanced model for straightforward work.' },
  { id: 'gpt-5.6-luna', description: 'Older fast and efficient model.' },
  { id: 'gpt-5.5', upgrade: 'gpt-5.6-sol', description: 'Legacy coding model.' },
]);

describe('Codex routes follow the newest model in each family', () => {
  it('moves older models to the current one in their family', () => {
    expect(freshCodexModel('gpt-5.6-luna', cards)).toBe('gpt-6-luna');
    expect(freshCodexModel('gpt-5.6-sol', cards)).toBe('gpt-6.1-sol');
    expect(freshCodexModel('gpt-6-sol', cards)).toBe('gpt-6.1-sol');
  });
  it('sends a family with nothing current left to the vendor default', () => {
    expect(freshCodexModel('gpt-5.6-terra', cards)).toBe('gpt-6.1-sol');
  });
  it('follows the vendor-named successor for a legacy model', () => {
    expect(freshCodexModel('gpt-5.5', cards)).toBe('gpt-6.1-sol');
  });
  it('keeps current models and unknown ids as they are', () => {
    expect(freshCodexModel('gpt-6-astra', cards)).toBe('gpt-6-astra');
    expect(freshCodexModel('something-else', cards)).toBe('something-else');
    expect(freshCodexModel('gpt-5.6-luna', [])).toBe('gpt-5.6-luna');
  });
  it('rewrites Codex models in routes and candidates, never Claude aliases', () => {
    const r = freshenRoutes({
      claude: { light: { model: 'haiku', candidates: [{ agent: 'codex', model: 'gpt-5.6-luna' }] }, standard: { model: 'sonnet' }, heavy: { model: 'opus' } },
      codex: { light: { model: 'gpt-5.6-luna' }, standard: { model: 'gpt-5.6-terra' }, heavy: { model: 'gpt-6-astra', effort: 'xhigh' } },
    }, cards);
    expect(r.claude.light.model).toBe('haiku');
    expect(r.claude.light.candidates[0].model).toBe('gpt-6-luna');
    expect(r.codex.standard.model).toBe('gpt-6.1-sol');
    expect(r.codex.heavy).toEqual({ model: 'gpt-6-astra', effort: 'xhigh' });
  });
});
