import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './config.js';
import type { AgentKind } from './protocol.js';

/** Every model is a named crew member, so the chat reads like a team rather
 *  than a list of model ids: "Sending Larry in to build the UI." Ported from
 *  agent-sync's personas.js, which already had the idea and the cast.
 *
 *  PERSONA is WHO (tied to suite + model). ROLE is WHAT HAT they are wearing on
 *  this task. The same model is Sunny whether she is planning or reviewing;
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
 *  Naming rule: a model that HAS a name of its own keeps it (Fable, Sol, Luna,
 *  Terra, Astra) — that way a newly released model gets an obvious persona and
 *  nothing is silently absorbed into another character. Unnamed//generic models
 *  wear the cast's names (Sunny, Larry, Bolt, Rex, Ace).
 *
 *  The bug this ordering fixes: a generic /gpt-5/ pattern swallowed
 *  gpt-5.6-luna, gpt-5.6-terra AND gpt-5.5, so three distinct models all
 *  rendered as Sol. */
/** Every crew member arrives with a face. Thirty avatars were generated,
 *  deployed and served -- and assigned to nobody, so all fourteen rendered as
 *  monogram letters and you would have had to hand-pick a face for each in
 *  Settings. Same failure as correction 30: shipped, and off by default.
 *
 *  Each face is the unused pool avatar whose background is nearest the
 *  persona's established colour, so the name chip and the face agree. Personas
 *  that share a name (Bolt, Sol, Rex) share a face: one identity, one look. */
const DEFAULTS: Persona[] = [
  // --- Claude, named ---
  { match: 'fable', suite: 'claude', name: 'Fable', tier: 'flagship', color: '#5b45c7', avatar: '/avatars/fox.png' },
  { match: 'opus', suite: 'claude', name: 'Ollie', tier: 'flagship', color: '#2f3a72', avatar: '/avatars/narwhal.png' },
  { match: 'haiku', suite: 'claude', name: 'Larry', tier: 'worker', color: '#205a1d', avatar: '/avatars/mountain-goat.png' },
  { match: 'sonnet', suite: 'claude', name: 'Sunny', tier: 'worker', color: '#673eb4', avatar: '/avatars/compass-rose.png' },

  // --- Codex, named models keep their own names ---
  { match: 'mini', suite: 'codex', name: 'Bolt', tier: 'worker', color: '#c7850b', avatar: '/avatars/robot.png' },
  { match: 'nano', suite: 'codex', name: 'Bolt', tier: 'worker', color: '#c7850b', avatar: '/avatars/robot.png' },
  { match: 'luna', suite: 'codex', name: 'Luna', tier: 'worker', color: '#5b7c99', avatar: '/avatars/honeybee.png' },
  { match: 'terra', suite: 'codex', name: 'Terra', tier: 'worker', color: '#2d6a4f', avatar: '/avatars/hot-air-balloon.png' },
  { match: 'astra', suite: 'codex', name: 'Astra', tier: 'flagship', color: '#b3452f', avatar: '/avatars/lighthouse.png' },
  { match: 'sol', suite: 'codex', name: 'Sol', tier: 'flagship', color: '#e65608', avatar: '/avatars/mushroom.png' },
  { match: 'codex', suite: 'codex', name: 'Sol', tier: 'flagship', color: '#e65608', avatar: '/avatars/mushroom.png' },
  { match: 'gpt-5.5', suite: 'codex', name: 'Rex', tier: 'worker', color: '#1543a5', avatar: '/avatars/telescope.png' },

  // Suite defaults, last.
  { match: '', suite: 'codex', name: 'Rex', tier: 'worker', color: '#1543a5', avatar: '/avatars/telescope.png' },
  { match: '', suite: 'claude', name: 'Ace', tier: 'worker', color: '#0f766e', avatar: '/avatars/owl.png' },
];

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
    list.find((p) => p.match === '') ?? { match: '', name: 'Agent', tier: 'worker', color: '#6b7280' }
  );
}

export function crewMember(agent: AgentKind, model: string | undefined | null, role: CrewRole): CrewMember {
  const p = personaFor(agent, model);
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
  const lines = ['## Your crew (use these names when talking to the human — e.g. "Sending Larry in to build the UI")'];
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
