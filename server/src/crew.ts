import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './config.js';
import type { AgentKind } from './protocol.js';

/** Every model is a named crew member, so the chat reads like a team rather
 *  than a list of model ids: "Sending Moss in to build the UI." Ported from
 *  agent-sync's personas.js, which already had the idea and the cast.
 *
 *  PERSONA is WHO (tied to suite + model). ROLE is WHAT HAT they are wearing on
 *  this task. The same model is Wren whether they are planning or reviewing;
 *  the role badge is what changes. */

export type CrewRole = 'chat' | 'planner' | 'reviewer' | 'executor' | 'explorer' | 'tester' | 'dispatcher';

export const ROLE_LABEL: Record<CrewRole, string> = {
  chat: 'Chat',
  planner: 'Planner',
  reviewer: 'Reviewer',
  executor: 'Builder',
  explorer: 'Explorer',
  tester: 'Tester',
  dispatcher: 'Dispatch',
};

export interface Persona {
  /** Case-insensitive substring matched against the model id. '' = suite default. */
  match: string;
  suite?: AgentKind;
  name: string;
  tier: 'flagship' | 'worker';
  /** Brand colour, sampled from each character's logo mark on their identity
   *  sheet in agent-sync. Used for the monogram avatar and the name chip. */
  color: string;
  /** Optional custom image, served from <dataDir>/avatars/. */
  avatar?: string;
  /** Name of a drawn sprite set under web/public/crew/, when this persona has
   *  one: `<sprite>-idle|type|think|blink|cheer|peek.webp`. Only three personas
   *  do -- the Claude flagship, the Claude worker and the Codex flagship, which
   *  are the three you actually watch work. Everyone else keeps a pool avatar,
   *  and the UI falls back to it rather than inventing a face. */
  sprite?: string;
}

export interface CrewMember extends Persona {
  role: CrewRole;
  roleLabel: string;
  model: string;
  agent: AgentKind;
  /** Letter for the monogram when no avatar image is set. */
  initial: string;
}

/** Order matters — first match wins, so narrower ids come first.
 *
 *  Naming rule, REVERSED from the first cut: the crew owns its names and the
 *  vendors own theirs. Borrowing a model's id for a persona (Fable, Sol, Luna,
 *  Terra, Astra) meant your crew got renamed whenever OpenAI or Anthropic
 *  renamed a model, and it made half the cast words rather than names. Now every
 *  persona is a name from one family — short, warm, a little old-fashioned — and
 *  `match` is purely the routing key. A model rename moves a model between
 *  characters; it never renames a character.
 *
 *  The bug this ordering fixes: a generic /gpt-5/ pattern swallowed
 *  gpt-5.6-luna, gpt-5.6-terra AND gpt-5.5, so three distinct models all
 *  rendered as one persona. */
/** Every crew member arrives with a face. Thirty avatars were generated,
 *  deployed and served -- and assigned to nobody, so all fourteen rendered as
 *  monogram letters and you would have had to hand-pick a face for each in
 *  Settings. Same failure as correction 30: shipped, and off by default.
 *
 *  Each face is the unused pool avatar whose background is nearest the
 *  persona's established colour, so the name chip and the face agree. Personas
 *  that share a name (Tuck, Juno, Otto) share a face: one identity, one look. */
const DEFAULTS: Persona[] = [
  // --- Claude ---
  { match: 'fable', suite: 'claude', name: 'Bram', tier: 'flagship', color: '#5b45c7', avatar: '/avatars/fox.png', sprite: 'bram' },
  { match: 'opus', suite: 'claude', name: 'Ollie', tier: 'flagship', color: '#2f3a72', avatar: '/avatars/narwhal.png', sprite: 'ollie' },
  { match: 'haiku', suite: 'claude', name: 'Moss', tier: 'worker', color: '#205a1d', avatar: '/avatars/mountain-goat.png', sprite: 'moss' },
  { match: 'sonnet', suite: 'claude', name: 'Wren', tier: 'worker', color: '#673eb4', avatar: '/avatars/compass-rose.png', sprite: 'wren' },

  // --- Codex ---
  { match: 'mini', suite: 'codex', name: 'Tuck', tier: 'worker', color: '#c7850b', avatar: '/avatars/robot.png', sprite: 'tuck' },
  { match: 'nano', suite: 'codex', name: 'Tuck', tier: 'worker', color: '#c7850b', avatar: '/avatars/robot.png', sprite: 'tuck' },
  { match: 'luna', suite: 'codex', name: 'Bly', tier: 'worker', color: '#5b7c99', avatar: '/avatars/honeybee.png', sprite: 'bly' },
  { match: 'terra', suite: 'codex', name: 'Rue', tier: 'worker', color: '#2d6a4f', avatar: '/avatars/hot-air-balloon.png', sprite: 'rue' },
  { match: 'astra', suite: 'codex', name: 'Nell', tier: 'flagship', color: '#b3452f', avatar: '/avatars/lighthouse.png', sprite: 'nell' },
  { match: 'sol', suite: 'codex', name: 'Juno', tier: 'flagship', color: '#e65608', avatar: '/avatars/mushroom.png', sprite: 'juno' },
  { match: 'codex', suite: 'codex', name: 'Juno', tier: 'flagship', color: '#e65608', avatar: '/avatars/mushroom.png', sprite: 'juno' },
  { match: 'gpt-5.5', suite: 'codex', name: 'Otto', tier: 'worker', color: '#1543a5', avatar: '/avatars/telescope.png', sprite: 'otto' },

  // Suite defaults, last.
  { match: '', suite: 'codex', name: 'Otto', tier: 'worker', color: '#1543a5', avatar: '/avatars/telescope.png', sprite: 'otto' },
  { match: '', suite: 'claude', name: 'Fig', tier: 'worker', color: '#0f766e', avatar: '/avatars/owl.png' },
];

/** Pip is not a model — Pip is the dispatcher.
 *
 *  Every other persona answers "which model is this"; Pip answers "who is
 *  running this". Pip does the triage, says which crew member is going in, and
 *  is the one who greets you, so the identity belongs to the ROLE rather than to
 *  any engine. Carried over from agent-sync, where Pip was the concierge on the
 *  setup screen and the only character the product had a voice for. */
export const DISPATCHER: Persona = {
  match: '', name: 'Pip', tier: 'worker', color: '#c9803a', avatar: '/avatars/beacon.png', sprite: 'pip',
};

const overridesFile = () => join(dataDir(), 'crew.json');

let cache: { rows: Persona[]; at: number } | null = null;
const TTL_MS = 5_000;

export function loadOverrides(): Persona[] {
  try {
    if (!existsSync(overridesFile())) return [];
    const parsed = JSON.parse(readFileSync(overridesFile(), 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => p && typeof p.name === 'string' && typeof p.match === 'string');
  } catch {
    return [];
  }
}

export function saveOverrides(rows: Persona[]): void {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(overridesFile(), JSON.stringify(rows, null, 2) + '\n');
  cache = null;
}

export function resetCrewCache(): void {
  cache = null;
}

/** Overrides shadow a default with the same (match, suite); anything else is
 *  appended, so a user can add crew for models we have never heard of. */
export function allPersonas(): Persona[] {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const overrides = loadOverrides();
  const merged = [...overrides];
  for (const d of DEFAULTS) {
    if (!merged.some((o) => o.match === d.match && (o.suite ?? d.suite) === d.suite)) merged.push(d);
  }
  cache = { rows: merged, at: Date.now() };
  return merged;
}

export function personaFor(agent: AgentKind, model: string | undefined | null): Persona {
  const m = String(model ?? '').toLowerCase();
  const list = allPersonas().filter((p) => !p.suite || p.suite === agent);
  return (
    list.find((p) => p.match && m.includes(p.match.toLowerCase())) ??
    list.find((p) => p.match === '') ?? { match: '', name: 'Crew', tier: 'worker', color: '#6b7280' }
  );
}

export function crewMember(agent: AgentKind, model: string | undefined | null, role: CrewRole): CrewMember {
  // The one role that is a WHO rather than a hat: whoever is dispatching is Pip,
  // whichever engine the triage call happened to run on.
  const p = role === 'dispatcher' ? DISPATCHER : personaFor(agent, model);
  return {
    ...p,
    role,
    roleLabel: ROLE_LABEL[role],
    model: String(model ?? ''),
    agent,
    initial: (p.name[0] ?? 'A').toUpperCase(),
  };
}

/** Roster text for flagship prompts, so they narrate with names instead of
 *  model ids. Straight port of agent-sync's rosterBlock(). */
export function rosterBlock(resources: { claudeModels?: string[]; codexAvailable?: boolean; codexModels?: string[] }): string {
  const lines = ['## Your crew (use these names when talking to the human — e.g. "Sending Moss in to build the UI")'];
  for (const model of resources.claudeModels ?? []) {
    const p = personaFor('claude', model);
    lines.push(`- ${p.name} — claude ${model} (${p.tier})`);
  }
  if (resources.codexAvailable) {
    const models = resources.codexModels?.length ? resources.codexModels : [''];
    for (const model of models) {
      const p = personaFor('codex', model);
      lines.push(`- ${p.name} — codex ${model || 'default'} (${p.tier})`);
    }
  }
  return lines.join('\n');
}
