import type { AutoRouteConfig } from './config.js';
import type { Persona } from './crew.js';
import type { ModelCard } from './registry.js';

/** @-mentions: "@Nell, take a look at the composer" sends the turn to Nell.
 *
 *  2026-09-24: "I'm already starting to learn their names and at one point
 *  haiku was under-performing and I had the need to @Nell in the chat." The
 *  names are the interface. A mention is the first `@Name` in the text that
 *  is a crew member's name (case-insensitive, whole word). The name is kept in
 *  the text that goes out -- the member should know they were asked for. */
export interface Mention {
  /** The persona's canonical name, as the roster spells it. */
  name: string;
  /** The message with the @ stripped from that one token ("@Nell fix" -> "Nell fix"). */
  text: string;
}

export function parseMention(text: string, names: string[]): Mention | null {
  const re = /(^|[\s(,])@([A-Za-z][\w-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const hit = names.find((n) => n.toLowerCase() === m![2].toLowerCase());
    if (!hit) continue;
    const at = m.index + m[1].length;
    return { name: hit, text: text.slice(0, at) + hit + text.slice(at + 1 + m[2].length) };
  }
  return null;
}

/** The concrete model a persona runs on. Persona rows match a model-id
 *  substring; the registry knows the ids. '' is the suite default, which is
 *  the route config's standard tier. Never returns '' -- an unresolvable
 *  persona falls back to the suite's standard model, and says so via the
 *  second return. */
export function modelForPersona(
  p: Persona,
  suite: 'claude' | 'codex',
  cards: ModelCard[],
  route: AutoRouteConfig,
): { model: string; exact: boolean } {
  const std = route.standard.model;
  if (!p.match) return { model: std, exact: true };
  const needle = p.match.toLowerCase();
  // A card whose OWN id names the model wins over one that only resolves to
  // it. "default" resolves to Opus today, and matching on that sent every
  // "Ollie, …" to the model id "default" -- which is Fig's, so Ollie's
  // replies were signed Fig (item 32, 2026-09-25).
  const mine = cards.filter((c) => c.agent === suite && !c.hidden);
  const card =
    mine.find((c) => c.id.toLowerCase().includes(needle)) ??
    mine.find((c) => (c.resolvedId ?? '').toLowerCase().includes(needle));
  if (card) return { model: card.id, exact: true };
  for (const tier of ['heavy', 'standard', 'light'] as const) {
    const m = route[tier]?.model;
    if (m && m.toLowerCase().includes(needle)) return { model: m, exact: true };
  }
  return { model: std, exact: false };
}

export function composeMentionPrompt(name: string, ask: string, context: string): string {
  return [
    `You are ${name}, a member of a small crew of coding agents that shares one conversation with the person you work for. They asked for you by name.`,
    context ? `\nWhat was said recently (oldest first):\n${context}\n` : '',
    `Their ask:\n${ask}`,
    '',
    'Do the work in this repository. When you are done, report what you did and what you found, briefly and concretely -- paths, commands, results. Do not restate the ask.',
  ].join('\n');
}

export function composeHandoffPrompt(name: string, from: string, context: string, planPath: string | undefined): string {
  return [
    `You are ${name}. ${from}'s context window is nearly full, so the work is being handed to you with a fresh one. You are picking up mid-job.`,
    planPath ? `\nThe plan for this job is at ${planPath}. Read it first; it carries the acceptance criteria.` : '',
    context ? `\nThe conversation so far (oldest first, trimmed):\n${context}\n` : '',
    'Continue the work from where it stands: check the repository state (git status, recent diff) before assuming anything in the summary above is done. Report what you found and what you did, briefly.',
  ].join('\n');
}

/** A model id as a person reads it: "claude-opus-5-5[1m]" -> "Claude Opus 5.5",
 *  "claude-haiku-4-5-20251001" -> "Claude Haiku 4.5", "gpt-6-astra" ->
 *  "GPT-6 Astra". For the @ pop-up, which names who you are asking for. */
export function prettyModel(id: string): string {
  const clean = id.replace(/\[.*?\]$/, '').replace(/-\d{8}$/, '');
  const c = clean.match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?$/i);
  if (c) return `Claude ${c[1][0].toUpperCase()}${c[1].slice(1)} ${c[3] ? `${c[2]}.${c[3]}` : c[2]}`;
  const g = clean.match(/^gpt-([\d.]+)(?:-(.+))?$/i);
  if (g) return `GPT-${g[1]}${g[2] ? ` ${g[2].split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')}` : ''}`;
  return id;
}
