import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './config.js';
import type { AgentKind } from './protocol.js';

/** One model, normalized across vendors.
 *
 *  Everything here is VENDOR-DECLARED, fetched from `model/list` (Codex) or
 *  `supportedModels()` (Claude). Nothing is hardcoded, because hardcoding is
 *  what rotted: the config pinned `gpt-5.4-mini` (since deleted), `gpt-5.5`
 *  (since superseded) and an effort ladder containing `minimal`, a rung no
 *  Codex model has ever exposed. */
export interface ModelCard {
  agent: AgentKind;
  /** The id to pass as `model`. May be an alias ('opus'). */
  id: string;
  /** Wire id an alias resolves to ('opus' -> 'claude-opus-5'). Drift here is
   *  how a Claude succession is detected: the alias is stable, the target moves. */
  resolvedId: string | null;
  displayName: string;
  description: string;
  /** Vendor-declared effort rungs, authoritative. Replaces EFFORT_LADDER. */
  efforts: string[];
  defaultEffort: string | null;
  isVendorDefault: boolean;
  /** Codex `upgrade`: the vendor naming this model's successor outright. */
  supersededBy: string | null;
  hidden: boolean;
  seenAt: number;
}

export type Tier = 'light' | 'standard' | 'heavy';

export interface Registry {
  version: 1;
  fetchedAt: number;
  models: ModelCard[];
}

/** Why a tier was chosen, so the UI can always answer "why is Astra heavy?" */
export interface Classification {
  tier: Tier | null;
  why: string;
}

/** Tier from vendor metadata alone.
 *
 *  Deliberately conservative: a model this can't place returns `null` and is
 *  surfaced for review rather than silently routed to. Routing an unvetted
 *  model is how you burn a weekly window on a surprise. */
export function classify(card: ModelCard): Classification {
  if (card.supersededBy) {
    return { tier: null, why: `superseded by ${card.supersededBy}` };
  }
  if (card.hidden) return { tier: null, why: 'hidden by vendor' };

  const d = `${card.displayName} ${card.description}`.toLowerCase();
  const ceiling = effortCeiling(card);

  if (/most capable|most intelligent|complex, demanding|frontier/.test(d)) {
    return { tier: 'heavy', why: 'vendor describes it as most capable' };
  }
  if (/fast and affordable|affordable|fastest|lightweight/.test(d) || /\b(mini|nano|haiku)\b/.test(d)) {
    return { tier: 'light', why: 'vendor describes it as fast/affordable' };
  }
  if (/balanced|workhorse|everyday|general/.test(d)) {
    return { tier: 'standard', why: 'vendor describes it as everyday/balanced' };
  }
  // Fall back to the effort ceiling only as a tiebreak, never as the sole
  // reason -- a high ceiling means "can think hard", not "is the best model".
  if (card.isVendorDefault && (ceiling === 'ultra' || ceiling === 'max')) {
    return { tier: 'heavy', why: 'vendor default with the top effort ceiling' };
  }
  return { tier: null, why: 'no confident match -- needs review' };
}

const EFFORT_ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

export function effortCeiling(card: ModelCard): string | null {
  let best: string | null = null;
  for (const e of card.efforts) {
    if (best == null || EFFORT_ORDER.indexOf(e) > EFFORT_ORDER.indexOf(best)) best = e;
  }
  return best;
}

/** Clamp a desired effort to what this model actually supports.
 *
 *  The SDKs silently downgrade an unsupported level, which makes a routing bug
 *  invisible. Clamping explicitly means the ledger records what was really
 *  asked for. */
export function clampEffort(card: ModelCard, desired: string): { effort: string; clamped: boolean } {
  if (card.efforts.includes(desired)) return { effort: desired, clamped: false };
  if (!card.efforts.length) return { effort: desired, clamped: false };
  const want = EFFORT_ORDER.indexOf(desired);
  let best = card.efforts[0];
  for (const e of card.efforts) {
    const gap = Math.abs(EFFORT_ORDER.indexOf(e) - want);
    if (gap < Math.abs(EFFORT_ORDER.indexOf(best) - want)) best = e;
  }
  return { effort: best, clamped: true };
}

export type RegistryChange =
  | { kind: 'added'; agent: AgentKind; id: string; displayName: string; suggested: Classification }
  | { kind: 'vanished'; agent: AgentKind; id: string }
  | { kind: 'superseded'; agent: AgentKind; id: string; by: string }
  | { kind: 'resolved-moved'; agent: AgentKind; id: string; from: string; to: string }
  | { kind: 'efforts-changed'; agent: AgentKind; id: string; added: string[]; removed: string[] }
  | { kind: 'default-moved'; agent: AgentKind; from: string | null; to: string };

/** What changed between two roster fetches. This is the auto-update signal. */
export function diffRegistry(prev: ModelCard[], next: ModelCard[]): RegistryChange[] {
  const out: RegistryChange[] = [];
  const byId = (rows: ModelCard[]) => new Map(rows.map((m) => [`${m.agent}:${m.id}`, m]));
  const a = byId(prev);
  const b = byId(next);

  for (const [k, card] of b) {
    const before = a.get(k);
    if (!before) {
      out.push({ kind: 'added', agent: card.agent, id: card.id, displayName: card.displayName, suggested: classify(card) });
      continue;
    }
    if (card.supersededBy && card.supersededBy !== before.supersededBy) {
      out.push({ kind: 'superseded', agent: card.agent, id: card.id, by: card.supersededBy });
    }
    // A stable alias whose wire target moved IS a new model release.
    if (card.resolvedId && before.resolvedId && card.resolvedId !== before.resolvedId) {
      out.push({ kind: 'resolved-moved', agent: card.agent, id: card.id, from: before.resolvedId, to: card.resolvedId });
    }
    const added = card.efforts.filter((e) => !before.efforts.includes(e));
    const removed = before.efforts.filter((e) => !card.efforts.includes(e));
    if (added.length || removed.length) {
      out.push({ kind: 'efforts-changed', agent: card.agent, id: card.id, added, removed });
    }
  }

  for (const [k, card] of a) {
    if (!b.has(k)) out.push({ kind: 'vanished', agent: card.agent, id: card.id });
  }

  for (const agent of ['claude', 'codex'] as const) {
    const was = prev.find((m) => m.agent === agent && m.isVendorDefault)?.id ?? null;
    const now = next.find((m) => m.agent === agent && m.isVendorDefault)?.id ?? null;
    if (now && was !== now) out.push({ kind: 'default-moved', agent, from: was, to: now });
  }
  return out;
}

/** A configured model that no longer exists is the loudest possible failure:
 *  dispatches to it error, or silently land somewhere unintended. */
export function auditRoutes(
  autoRoute: Record<string, Record<string, { model?: string; effort?: string }>>,
  models: ModelCard[],
): Array<{ agent: string; tier: string; model: string; problem: string; suggestion: string | null }> {
  const out: Array<{ agent: string; tier: string; model: string; problem: string; suggestion: string | null }> = [];
  for (const [agent, tiers] of Object.entries(autoRoute ?? {})) {
    for (const [tier, cfg] of Object.entries(tiers ?? {})) {
      const id = cfg?.model;
      if (!id) continue;
      const card = models.find((m) => m.agent === agent && (m.id === id || m.resolvedId === id));
      if (!card) {
        const alt = models.filter((m) => m.agent === agent && classify(m).tier === tier)[0];
        out.push({ agent, tier, model: id, problem: 'model no longer exists', suggestion: alt?.id ?? null });
        continue;
      }
      if (card.supersededBy) {
        out.push({ agent, tier, model: id, problem: `superseded by ${card.supersededBy}`, suggestion: card.supersededBy });
      }
      if (cfg.effort && !card.efforts.includes(cfg.effort)) {
        out.push({
          agent, tier, model: id,
          problem: `effort '${cfg.effort}' not supported (has ${card.efforts.join('/')})`,
          suggestion: clampEffort(card, cfg.effort).effort,
        });
      }
    }
  }
  return out;
}

// ---------- normalization ----------

export function fromCodexModelList(rows: any[]): ModelCard[] {
  const now = Date.now();
  return (rows ?? []).filter(Boolean).map((m) => ({
    agent: 'codex' as const,
    id: String(m.id ?? m.model ?? ''),
    resolvedId: m.model && m.model !== m.id ? String(m.model) : null,
    displayName: String(m.displayName ?? m.id ?? ''),
    description: String(m.description ?? ''),
    efforts: Array.isArray(m.supportedReasoningEfforts)
      ? m.supportedReasoningEfforts.map((e: any) => String(e?.reasoningEffort ?? e)).filter(Boolean)
      : [],
    defaultEffort: m.defaultReasoningEffort ? String(m.defaultReasoningEffort) : null,
    isVendorDefault: m.isDefault === true,
    supersededBy: m.upgrade ? String(m.upgrade) : null,
    hidden: m.hidden === true,
    seenAt: now,
  })).filter((m) => m.id);
}

export function fromClaudeModelInfo(rows: any[]): ModelCard[] {
  const now = Date.now();
  return (rows ?? []).filter(Boolean).map((m) => ({
    agent: 'claude' as const,
    id: String(m.value ?? ''),
    resolvedId: m.resolvedModel ? String(m.resolvedModel) : null,
    displayName: String(m.displayName ?? m.value ?? ''),
    description: String(m.description ?? ''),
    efforts: Array.isArray(m.supportedEffortLevels) ? m.supportedEffortLevels.map(String) : [],
    defaultEffort: null,
    isVendorDefault: false,
    supersededBy: null,
    hidden: false,
    seenAt: now,
  })).filter((m) => m.id);
}

// ---------- persistence ----------

export class ModelRegistry {
  private dir: string;
  private reg: Registry = { version: 1, fetchedAt: 0, models: [] };

  constructor(dir?: string) {
    this.dir = dir ?? dataDir();
    this.load();
  }

  private file(): string {
    return join(this.dir, 'models.json');
  }

  all(): ModelCard[] {
    return this.reg.models;
  }

  fetchedAt(): number {
    return this.reg.fetchedAt;
  }

  forAgent(agent: AgentKind): ModelCard[] {
    return this.reg.models.filter((m) => m.agent === agent && !m.hidden);
  }

  get(agent: AgentKind, id: string): ModelCard | null {
    return this.reg.models.find((m) => m.agent === agent && (m.id === id || m.resolvedId === id)) ?? null;
  }

  /** Replace one agent's roster, returning what changed. Other agents are left
   *  alone so a Codex fetch failing can never erase the Claude roster. */
  update(agent: AgentKind, cards: ModelCard[]): RegistryChange[] {
    if (!cards.length) return [];
    const prev = this.reg.models.filter((m) => m.agent === agent);
    const changes = diffRegistry(prev, cards);
    this.reg = {
      version: 1,
      fetchedAt: Date.now(),
      models: [...this.reg.models.filter((m) => m.agent !== agent), ...cards],
    };
    this.persist();
    return changes;
  }

  private load(): void {
    try {
      if (!existsSync(this.file())) return;
      const parsed = JSON.parse(readFileSync(this.file(), 'utf8'));
      if (parsed?.version === 1 && Array.isArray(parsed.models)) this.reg = parsed;
    } catch {
      /* a corrupt registry is refetched, never fatal */
    }
  }

  private persist(): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      const tmp = this.file() + '.tmp';
      writeFileSync(tmp, JSON.stringify(this.reg, null, 2));
      renameSync(tmp, this.file());
    } catch {
      /* best effort */
    }
  }
}

let singleton: ModelRegistry | null = null;
export function modelRegistry(): ModelRegistry {
  if (!singleton) singleton = new ModelRegistry();
  return singleton;
}
