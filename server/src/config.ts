import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AgentConfig {
  models: string[];
  defaultModel: string;
  efforts: string[];
}

export interface NotificationConfig {
  /** ntfy server base URL. */
  url: string;
  /** ntfy topic; empty string disables notifications. */
  topic: string;
}

export interface RouteTarget {
  model: string;
  effort?: string;
  candidates?: RouteCandidate[];
}

export interface AutoRouteConfig {
  light: RouteTarget;
  standard: RouteTarget;
  heavy: RouteTarget;
}

/** A tier may name candidates across both suites; the router picks by live quota
 *  headroom and price. Absent `candidates` keeps the original single-target behaviour. */
export interface RouteCandidate {
  agent: 'claude' | 'codex';
  model: string;
  effort?: string;
}

export interface BudgetConfig {
  /** Window utilisation (%) at which the router starts stepping tiers down. */
  reprioritizeAtPct: number;
  /** Utilisation at which dispatches are gated and the user is warned. */
  gateAtPct: number;
  /** Utilisation at which new dispatches are refused outright. */
  hardStopPct: number;
  /** Quota observations older than this are 'stale' — which is NOT headroom. */
  staleAfterMins: number;
  /** Optional rolling-24h API-value ceiling across the whole agent tree. */
  dailyUsd?: number | null;
  /** Surplus mode: a window with this much unused headroom, resetting within
   *  surplusWithinMins, is a use-it-or-lose-it opportunity worth upgrading for. */
  surplusHeadroomPct: number;
  surplusWithinMins: number;
}

export interface ConsultConfig {
  /** Decision 3: skip the cross-model review when triage sizes a task small
   *  (fewer than ~10 files and fewer than 3 independent pieces). */
  sizeGate: boolean;
}

export interface GuardsConfig {
  /** Decision 2, one writer. 'warn' posts a notice when a second session opens
   *  on a project; 'block' refuses it with a 409. */
  oneWriter: 'warn' | 'block';
}

export interface PocketConfig {
  port: number;
  projects: string[];
  /** Hours an active session may sit with no real activity before it's auto-closed. */
  sessionIdleTimeoutHours: number;
  notifications: NotificationConfig;
  autoRoute: { claude: AutoRouteConfig; codex: AutoRouteConfig };
  budget: BudgetConfig;
  consult: ConsultConfig;
  guards: GuardsConfig;
  claude: AgentConfig;
  codex: AgentConfig;
}

const DEFAULTS: PocketConfig = {
  port: 8790,
  projects: [process.cwd()],
  sessionIdleTimeoutHours: 24,
  notifications: { url: 'https://ntfy.sh', topic: '' },
  autoRoute: {
    claude: {
      light: { model: 'haiku' },
      standard: { model: 'sonnet' },
      heavy: { model: 'opus', effort: 'xhigh' },
    },
    // From the live model/list roster on 2026-09-21. The previous defaults
    // pointed a FRESH install at a deleted model and a superseded one; the
    // registry (Phase 7) audits these against the roster at startup.
    codex: {
      light: { model: 'gpt-5.6-luna' },
      standard: { model: 'gpt-5.6-terra' },
      heavy: { model: 'gpt-6-astra', effort: 'xhigh' },
    },
  },
  budget: {
    reprioritizeAtPct: 75,
    gateAtPct: 90,
    hardStopPct: 98,
    staleAfterMins: 90,
    dailyUsd: null,
    surplusHeadroomPct: 25,
    surplusWithinMins: 360,
  },
  consult: { sizeGate: true },
  guards: { oneWriter: 'warn' },
  claude: { models: ['sonnet', 'opus', 'haiku', 'fable'], defaultModel: 'sonnet', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  codex: { models: [], defaultModel: '', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] }, // no Codex model exposes 'minimal'
};

/** Repo root is two levels up from server/src (or server/dist). */
export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const configPath = () => process.env.POCKET_CONFIG ?? join(repoRoot, 'pocket.config.json');

/** Session-state file lives next to the config so scratch/test configs get their own. */
export const statePath = () => join(dirname(configPath()), '.pocket-state.json');

/** Durable data (usage ledger, quota windows, prices) lives next to the config for
 *  the same reason session state does: a POCKET_CONFIG-scoped test run gets its own. */
export const dataDir = () => join(dirname(configPath()), '.pocket-data');

export function loadConfig(): PocketConfig {
  try {
    const parsed = JSON.parse(readFileSync(configPath(), 'utf8'));
    return {
      ...DEFAULTS,
      ...parsed,
      notifications: { ...DEFAULTS.notifications, ...parsed.notifications },
      autoRoute: {
        claude: { ...DEFAULTS.autoRoute.claude, ...parsed.autoRoute?.claude },
        codex: { ...DEFAULTS.autoRoute.codex, ...parsed.autoRoute?.codex },
      },
      budget: { ...DEFAULTS.budget, ...parsed.budget },
      consult: { ...DEFAULTS.consult, ...parsed.consult },
      guards: { ...DEFAULTS.guards, ...parsed.guards },
      claude: { ...DEFAULTS.claude, ...parsed.claude },
      codex: { ...DEFAULTS.codex, ...parsed.codex },
    };
  } catch (err: any) {
    // "No file yet" and "a file we could not parse" are different situations.
    // Returning the shared DEFAULTS object for a corrupt file meant the next
    // save silently overwrote the user's recoverable config with defaults.
    if (existsSync(configPath())) {
      const aside = `${configPath()}.corrupt-${Date.now()}`;
      try {
        renameSync(configPath(), aside);
        console.error(`[pocket] config at ${configPath()} is unreadable (${err?.message ?? err}); moved aside to ${aside}, using defaults`);
      } catch {
        console.error(`[pocket] config at ${configPath()} is unreadable (${err?.message ?? err}) and could not be moved aside; using defaults WITHOUT saving`);
      }
    } else {
      console.warn(`[pocket] no config at ${configPath()}, using defaults`);
    }
    return structuredClone(DEFAULTS);
  }
}

export function saveConfig(config: PocketConfig): void {
  const tmp = `${configPath()}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n');
  renameSync(tmp, configPath());
}
