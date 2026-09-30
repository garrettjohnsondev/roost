import { describe, expect, it } from 'vitest';
import { modelSlug, pagesFor, parseCard, parseIndex, settingsFromCard } from '../src/modelDocs.js';
import { readModelDocs, proposalTask } from '../src/modelNews.js';

const claudeIndex = `### Models & pricing
- [Claude Opus 5](https://platform.claude.com/docs/en/models/opus-5/overview.md)
- [Claude Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/overview.md)
- [Migration guide](https://platform.claude.com/docs/en/models/opus-5-5/migration-guide.md) - Migrating to Claude Opus 5.5
- [Prompting Claude Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5.md)
- [Effort](https://platform.claude.com/docs/en/build-with-claude/effort.md)`;

const answer = '```json\n' + JSON.stringify({
  headline: 'For long-running agentic coding.', released: '2026-09-22', contextTokens: 1000000, maxOutputTokens: 128000,
  price: { input: 4, output: 20 }, effort: { light: null, standard: 'high', heavy: 'xhigh', note: 'Start at high for coding.' },
  strengths: ['Long agentic runs'], whatsNew: ['Thinking is always on'], breaking: ['Forced tool use returns an error'], prompting: [], ideas: [{ title: 'Stop forcing tool choice', why: 'migration guide' }],
}) + '\n```';

describe('a new model, read from its maker\'s docs', () => {
  it('finds that model\'s own pages in the vendor index', () => {
    expect(modelSlug('claude', 'claude-opus-5-5[1m]')).toBe('opus-5-5');
    const urls = pagesFor('claude', 'claude-opus-5-5', parseIndex(claudeIndex));
    expect(urls).toContain('https://platform.claude.com/docs/en/models/opus-5-5/overview.md');
    expect(urls).toContain('https://platform.claude.com/docs/en/models/opus-5-5/migration-guide.md');
    expect(urls).toContain('https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5.md');
    expect(urls).toContain('https://platform.claude.com/docs/en/build-with-claude/effort.md');
    expect(urls.some((u) => u.includes('/opus-5/'))).toBe(false); // not the older model
  });
  it('turns the answer into a card, and never guesses a field', () => {
    const c = parseCard(answer, { agent: 'claude', model: 'claude-opus-5-5', displayName: 'Opus 5.5', sources: ['s'] })!;
    expect(c.price).toEqual({ input: 4, output: 20 });
    expect(c.effort).toMatchObject({ light: null, standard: 'high', heavy: 'xhigh' });
    expect(parseCard('no json here', { agent: 'claude', model: 'x', displayName: 'x', sources: [] })).toBeNull();
  });
  it('changes only the tiers that run this model, to an effort the model supports', () => {
    const c = parseCard(answer, { agent: 'claude', model: 'claude-opus-5-5', displayName: 'Opus 5.5', sources: ['doc'] })!;
    const routes = { claude: { light: { model: 'haiku' }, standard: { model: 'claude-sonnet-5' }, heavy: { model: 'claude-opus-5-5', effort: 'high' } }, codex: { light: { model: 'a' }, standard: { model: 'b' }, heavy: { model: 'c' } } } as any;
    const out = settingsFromCard(c, routes, ['low', 'medium', 'high', 'xhigh', 'max']);
    expect(out.changes).toEqual([{ what: 'claude heavy effort', from: 'high', to: 'xhigh', source: 'doc' }]);
    expect(out.routes.claude.standard).toEqual({ model: 'claude-sonnet-5' });
    expect(routes.claude.heavy.effort).toBe('high'); // pure
    expect(settingsFromCard(c, routes, ['low', 'high']).changes).toEqual([]);
    // an alias tier ('opus') is matched by what it resolves to
    const aliased = { ...routes, claude: { ...routes.claude, heavy: { model: 'opus', effort: 'high' } } };
    expect(settingsFromCard(c, aliased, [], (_a, m) => (m === 'opus' ? 'claude-opus-5-5[1m]' : m)).changes[0]?.to).toBe('xhigh');
  });
  it('reads end to end from fetched pages, and asks for a plan, not a build', async () => {
    const pages: Record<string, string> = { 'https://platform.claude.com/llms.txt': claudeIndex };
    const card = await readModelDocs({
      agent: 'claude', id: 'claude-opus-5-5', displayName: 'Opus 5.5',
      fetch: async (u) => pages[u] ?? `# page ${u}`,
      oneShot: async (prompt) => { expect(prompt).toContain('OFFICIAL documentation'); return answer; },
    });
    expect(card?.sources[0]).toBe('https://platform.claude.com/docs/en/models/opus-5-5/overview');
    expect(proposalTask(card!)).toMatch(/Plan them \(do not build yet\)/);
  });
});
