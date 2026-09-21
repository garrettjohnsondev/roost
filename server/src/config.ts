import { readFileSync, writeFileSync } from 'node:fs';
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

export interface PocketConfig {
  port: number;
  projects: string[];
  /** Hours an active session may sit with no real activity before it's auto-closed. */
  sessionIdleTimeoutHours: number;
  notifications: NotificationConfig;
  autoRoute: { claude: AutoRouteConfig; codex: AutoRouteConfig };
  budget: BudgetConfig;
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
    codex: {
      light: { model: 'gpt-5.4-mini' },
      standard: { model: 'gpt-5.5' },
      heavy: { model: 'gpt-5.6-sol', effort: 'xhigh' },
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
  claude: { models: ['sonnet', 'opus', 'haiku', 'fable'], defaultModel: 'sonnet', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  codex: { models: [], defaultModel: '', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
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
      claude: { ...DEFAULTS.claude, ...parsed.claude },
      codex: { ...DEFAULTS.codex, ...parsed.codex },
    };
  } catch {
    console.warn(`[pocket] no readable config at ${configPath()}, using defaults`);
    return DEFAULTS;
  }
}

export function saveConfig(config: PocketConfig): void {
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + '\n');
}
