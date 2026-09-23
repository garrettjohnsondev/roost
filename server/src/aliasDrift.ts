import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './config.js';
import type { AgentKind } from './protocol.js';

/** Auto-update, for the half of it that Phase 7 does not cover.
 *
 *  Codex names models with versions and hands us a succession pointer
 *  (`gpt-5.5` → superseded by `gpt-5.6-sol`), so a new release appears in the
 *  registry as a new row and the roster diff announces it. Claude does not: it
 *  exposes ALIASES. `opus` is a stable string that quietly starts resolving to
 *  something new, and on 2026-09-22 it did exactly that — Opus 5.5 shipped and
 *  nothing in the registry changed, because no id changed.
 *
 *  So the Claude side of "recognise a new version" cannot be a diff of the model
 *  list. It has to be a diff of what an alias RESOLVES to, observed from the
 *  engine's own report of what it just ran. That is this file. */

export interface Resolution {
  agent: AgentKind;
  /** What was asked for — 'opus', 'sonnet', 'opus[1m]'. */
  alias: string;
  /** What the engine said it actually ran. */
  resolved: string;
  firstSeen: number;
  lastSeen: number;
}

export interface Drift {
  agent: AgentKind;
  alias: string;
  from: string;
  to: string;
  /** How long the previous resolution had been the answer. */
  heldForMs: number;
}

export type AliasStore = Record<string, Resolution>;

const key = (agent: AgentKind, alias: string) => `${agent}:${alias}`;

/** True when `alias` is a pointer rather than a pinned id.
 *
 *  A pinned id resolving to itself is not an alias and must never be recorded,
 *  or every model in the roster becomes a drift candidate against itself. The
 *  comparison ignores a `[1m]`-style suffix, because `opus[1m]` resolving to
 *  `claude-opus-5-5` is the same pointer as `opus` doing so. */
export function isAlias(alias: string, resolved: string): boolean {
  if (!alias || !resolved) return false;
  const strip = (s: string) => s.replace(/\[[^\]]*\]/g, '').trim().toLowerCase();
  return strip(alias) !== strip(resolved);
}

/** Records what an alias resolved to and reports a CHANGE, never a first sight.
 *
 *  The first observation is not drift — we had no previous answer to differ
 *  from, and announcing one would fire on every fresh install. */
export function noteResolution(
  store: AliasStore,
  opts: { agent: AgentKind; alias: string; resolved: string; at: number },
): Drift | null {
  const { agent, alias, resolved, at } = opts;
  if (!isAlias(alias, resolved)) return null;
  const k = key(agent, alias);
  const prev = store[k];
  if (!prev) {
    store[k] = { agent, alias, resolved, firstSeen: at, lastSeen: at };
    return null;
  }
  if (prev.resolved === resolved) {
    prev.lastSeen = at;
    return null;
  }
  const drift: Drift = { agent, alias, from: prev.resolved, to: resolved, heldForMs: Math.max(0, at - prev.firstSeen) };
  store[k] = { agent, alias, resolved, firstSeen: at, lastSeen: at };
  return drift;
}

export function describeDrift(d: Drift): string {
  const days = d.heldForMs / 86_400_000;
  const held = days >= 1 ? ` — it had been ${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}` : '';
  return `${d.agent} '${d.alias}' now runs ${d.to}, not ${d.from}${held}.`;
}

// ---- persistence -----------------------------------------------------------

const storePath = () => join(dataDir(), 'aliases.json');

export function loadAliases(): AliasStore {
  try {
    if (!existsSync(storePath())) return {};
    const parsed = JSON.parse(readFileSync(storePath(), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as AliasStore) : {};
  } catch {
    // A corrupt file costs one missed announcement, not a broken chat.
    return {};
  }
}

export function saveAliases(store: AliasStore): void {
  try {
    mkdirSync(dataDir(), { recursive: true });
    // tmp+rename, as everywhere else: a crash mid-write must not truncate it.
    const tmp = storePath() + '.tmp';
    writeFileSync(tmp, JSON.stringify(store, null, 2) + '\n');
    renameSync(tmp, storePath());
  } catch {
    /* losing the record costs a duplicate announcement later, nothing more */
  }
}
