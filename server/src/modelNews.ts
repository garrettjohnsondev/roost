import type { AgentKind } from './protocol.js';
import { DOC_INDEX, composeDocPrompt, pagesFor, parseCard, parseIndex, type ModelDocCard } from './modelDocs.js';

/** Plain text of one official page; the markdown versions are small. */
export async function fetchText(url: string, cap = 24_000): Promise<string | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'Roost (model docs reader)' } });
    if (!r.ok) return null;
    const t = await r.text();
    // An HTML error page is not documentation.
    if (/^\s*<!doctype html|^\s*<html/i.test(t)) return null;
    return t.slice(0, cap);
  } catch {
    return null;
  }
}

/** Read one model's official docs into a card. `oneShot` runs a read-only
 *  crew turn on a prompt and returns its text (consult.ts in production). */
export async function readModelDocs(o: {
  agent: AgentKind;
  id: string;
  displayName: string;
  oneShot: (prompt: string) => Promise<string>;
  fetch?: (url: string) => Promise<string | null>;
}): Promise<ModelDocCard | null> {
  const get = o.fetch ?? ((u: string) => fetchText(u));
  const links = (await Promise.all(DOC_INDEX[o.agent].map((u) => get(u)))).flatMap((t) => (t ? parseIndex(t) : []));
  const urls = pagesFor(o.agent, o.id, links);
  const pages = (await Promise.all(urls.map(async (url) => ({ url, text: await get(url) })))).filter((p): p is { url: string; text: string } => !!p.text);
  if (!pages.length) return null;
  const answer = await o.oneShot(composeDocPrompt(o.agent, o.id, o.displayName, pages));
  return parseCard(answer, { agent: o.agent, model: o.id, displayName: o.displayName, sources: pages.map((p) => p.url.replace(/\.md$/, '')) });
}

/** The task handed to the crew when a card suggests code work: planned and
 *  reviewed like any big job, and nothing is built until the owner says go. */
export function proposalTask(card: ModelDocCard): string {
  const lines = [
    `${card.displayName} is out, and its official docs suggest changes to Roost. Plan them (do not build yet).`,
    card.breaking.length ? `Breaking or behaviour changes in the docs:\n${card.breaking.map((b) => `- ${b}`).join('\n')}` : '',
    card.ideas.length ? `Ideas from the docs:\n${card.ideas.map((i) => `- ${i.title}${i.why ? ` (${i.why})` : ''}`).join('\n')}` : '',
    `Sources: ${card.sources.join(' , ')}`,
    'Check each against Roost\'s code first: drop anything already handled or not worth it, and say why.',
  ];
  return lines.filter(Boolean).join('\n\n');
}
