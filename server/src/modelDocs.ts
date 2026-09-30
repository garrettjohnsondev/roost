// A new model, read from its maker's own docs (2026-09-29).
//
// Roost already notices a new model (registryFetch.ts) and keeps the vendor
// software current (agentsUpdate.ts). This is the step after: fetch the
// vendor's OFFICIAL pages for that model -- never blogs, never guesses -- have
// a crew member turn them into a fixed-shape card with a source on every line,
// then:
//   - apply what is safe on its own (settings: effort defaults, a price for a
//     model the table doesn't know), with the previous value kept for undo;
//   - leave anything that needs code as a proposal the owner approves.
// Both vendors publish machine-readable indexes (llms.txt) with a markdown
// version of every page, so this reads text, not scraped HTML.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentKind } from './protocol.js';

export const DOC_INDEX: Record<AgentKind, string[]> = {
  claude: ['https://platform.claude.com/llms.txt'],
  codex: ['https://developers.openai.com/codex/llms.txt', 'https://learn.chatgpt.com/llms.txt'],
};

export interface DocLink { title: string; url: string }

/** Every `- [Title](url)` line of an llms.txt index. */
export function parseIndex(text: string): DocLink[] {
  const out: DocLink[] = [];
  for (const m of text.matchAll(/^\s*-\s*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)(.*)$/gm)) {
    out.push({ title: `${m[1]}${m[3] ? ` ${m[3].replace(/^\s*[-:]\s*/, '— ')}` : ''}`.trim(), url: m[2] });
  }
  return out;
}

/** "claude-opus-5-5[1m]" -> "opus-5-5"; "gpt-6.1-sol" stays. */
export function modelSlug(agent: AgentKind, id: string): string {
  const bare = id.replace(/\[.*?\]$/, '').replace(/-\d{8}$/, '');
  return agent === 'claude' ? bare.replace(/^claude-/, '') : bare;
}

/** The official pages about one model, most specific first. */
export function pagesFor(agent: AgentKind, id: string, links: DocLink[]): string[] {
  const slug = modelSlug(agent, id);
  const md = (u: string) => (u.endsWith('.md') ? u : `${u}.md`);
  const picked: string[] = [];
  const add = (u?: string) => { if (u && !picked.includes(md(u))) picked.push(md(u)); };
  if (agent === 'claude') {
    for (const l of links) if (l.url.includes(`/models/${slug}/`)) add(l.url);
    add(`https://platform.claude.com/docs/en/models/${slug}/whats-new-${slug}`);
    for (const l of links) if (l.url.includes(`prompting-claude-${slug}`)) add(l.url);
    for (const l of links) if (/\/build-with-claude\/effort(\.md)?$/.test(l.url)) add(l.url);
  } else {
    for (const l of links) if (/\/docs\/models(\.md)?$|model-selection/.test(l.url)) add(l.url);
    add(`https://developers.openai.com/api/docs/models/${slug}`);
  }
  return picked.slice(0, 6);
}

export interface ModelDocCard {
  agent: AgentKind;
  model: string;
  displayName: string;
  /** One plain sentence: what this model is for. */
  headline: string;
  released: string | null;
  contextTokens: number | null;
  maxOutputTokens: number | null;
  /** USD per million tokens, as the docs state it. */
  price: { input: number; output: number } | null;
  /** The docs' effort guidance, per size of job, when they give it. */
  effort: { light: string | null; standard: string | null; heavy: string | null; note: string };
  strengths: string[];
  whatsNew: string[];
  /** Breaking or behaviour changes that could affect a tool built on the model. */
  breaking: string[];
  prompting: string[];
  /** Things Roost could build or change because of this model. Proposals only. */
  ideas: Array<{ title: string; why: string }>;
  sources: string[];
  readAt: number;
}

export function composeDocPrompt(agent: AgentKind, id: string, displayName: string, pages: Array<{ url: string; text: string }>): string {
  return [
    `A new ${agent === 'claude' ? 'Anthropic Claude' : 'OpenAI Codex'} model is available: ${displayName} (id \`${id}\`).`,
    'Below are its maker\'s OFFICIAL documentation pages. Read them and fill in the JSON card described at the end.',
    'Rules: use ONLY what these pages say. If a field is not stated, use null or an empty list -- never guess. Keep every string short and plain.',
    'Context: the reader is Roost, an app that routes coding jobs to a light, standard or heavy tier and picks an effort level for each. So effort guidance per job size, context limits, prices, and breaking changes for tools built on the model matter most.',
    '',
    ...pages.map((p) => `===== ${p.url}\n${p.text}`),
    '',
    'Answer with ONE json code block and nothing else, shaped exactly like:',
    '```json',
    JSON.stringify({
      headline: 'one sentence: what the model is for',
      released: 'YYYY-MM-DD or null',
      contextTokens: 1000000,
      maxOutputTokens: 128000,
      price: { input: 4, output: 20 },
      effort: { light: 'low|medium|high|xhigh|max or null', standard: '… or null', heavy: '… or null', note: 'the docs\' own words on choosing effort, one sentence' },
      strengths: ['…'],
      whatsNew: ['…'],
      breaking: ['…'],
      prompting: ['…'],
      ideas: [{ title: 'a change Roost could make because of this', why: 'which doc line suggests it' }],
    }, null, 1),
    '```',
  ].join('\n');
}

/** The card out of the model's answer; null when it isn't a usable card. */
export function parseCard(text: string, base: { agent: AgentKind; model: string; displayName: string; sources: string[] }): ModelDocCard | null {
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(text) ?? /(\{[\s\S]*\})/.exec(text);
  if (!m) return null;
  let j: any;
  try { j = JSON.parse(m[1]); } catch { return null; }
  if (!j || typeof j.headline !== 'string') return null;
  const strs = (x: unknown) => (Array.isArray(x) ? x.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()).slice(0, 12) : []);
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null);
  const eff = (x: unknown) => (typeof x === 'string' && /^(minimal|low|medium|high|xhigh|max)$/i.test(x.trim()) ? x.trim().toLowerCase() : null);
  const price = j.price && num(j.price.input) != null && num(j.price.output) != null ? { input: j.price.input, output: j.price.output } : null;
  return {
    ...base,
    headline: j.headline.trim(),
    released: typeof j.released === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.released) ? j.released : null,
    contextTokens: num(j.contextTokens),
    maxOutputTokens: num(j.maxOutputTokens),
    price,
    effort: { light: eff(j.effort?.light), standard: eff(j.effort?.standard), heavy: eff(j.effort?.heavy), note: typeof j.effort?.note === 'string' ? j.effort.note.trim() : '' },
    strengths: strs(j.strengths),
    whatsNew: strs(j.whatsNew),
    breaking: strs(j.breaking),
    prompting: strs(j.prompting),
    ideas: Array.isArray(j.ideas) ? j.ideas.filter((i: any) => i && typeof i.title === 'string').slice(0, 8).map((i: any) => ({ title: String(i.title).trim(), why: String(i.why ?? '').trim() })) : [],
    readAt: Date.now(),
  };
}

// ---- what Roost does with a card ---------------------------------------------

export interface AppliedChange { what: string; from: string | null; to: string; source: string }

type Tier = 'light' | 'standard' | 'heavy';
type Routes = Record<AgentKind, Record<Tier, { model: string; effort?: string }>>;

/** Settings a card can change on its own: the effort of a tier that runs this
 *  model, when the docs recommend one the model supports. Pure -- the caller
 *  saves. Never touches a tier running a different model. */
export function settingsFromCard(card: ModelDocCard, routes: Routes, supported: string[], resolve: (agent: AgentKind, model: string) => string = (_a, m) => m): { routes: Routes; changes: AppliedChange[] } {
  const next = JSON.parse(JSON.stringify(routes)) as Routes;
  const changes: AppliedChange[] = [];
  const src = card.sources[0] ?? '';
  const side = next[card.agent];
  for (const tier of ['light', 'standard', 'heavy'] as Tier[]) {
    const want = card.effort[tier];
    const t = side?.[tier];
    // A tier names an alias ('sonnet'); what it runs is what the alias resolves to.
    if (!want || !t || modelSlug(card.agent, resolve(card.agent, t.model)) !== modelSlug(card.agent, card.model)) continue;
    if (supported.length && !supported.includes(want)) continue;
    if ((t.effort ?? null) === want) continue;
    changes.push({ what: `${card.agent} ${tier} effort`, from: t.effort ?? null, to: want, source: src });
    t.effort = want;
  }
  return { routes: next, changes };
}

// ---- storage -------------------------------------------------------------------

export interface ModelNews { card: ModelDocCard; applied: AppliedChange[]; proposed: string | null; seen: boolean }

const dirOf = (dataDir: string) => join(dataDir, 'model-docs');
const fileOf = (dataDir: string, agent: AgentKind, model: string) => join(dirOf(dataDir), `${agent}-${modelSlug(agent, model).replace(/[^a-z0-9.-]/gi, '_')}.json`);

export function hasNews(dataDir: string, agent: AgentKind, model: string): boolean {
  return existsSync(fileOf(dataDir, agent, model));
}
export function saveNews(dataDir: string, n: ModelNews): void {
  mkdirSync(dirOf(dataDir), { recursive: true });
  writeFileSync(fileOf(dataDir, n.card.agent, n.card.model), JSON.stringify(n, null, 2));
}
export function listNews(dataDir: string): ModelNews[] {
  if (!existsSync(dirOf(dataDir))) return [];
  return readdirSync(dirOf(dataDir)).filter((f) => f.endsWith('.json')).map((f) => {
    try { return JSON.parse(readFileSync(join(dirOf(dataDir), f), 'utf8')) as ModelNews; } catch { return null; }
  }).filter((n): n is ModelNews => !!n).sort((a, b) => b.card.readAt - a.card.readAt);
}
export function markSeen(dataDir: string, agent: AgentKind, model: string): void {
  const f = fileOf(dataDir, agent, model);
  if (!existsSync(f)) return;
  const n = JSON.parse(readFileSync(f, 'utf8')) as ModelNews;
  writeFileSync(f, JSON.stringify({ ...n, seen: true }, null, 2));
}
