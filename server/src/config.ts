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
  /** Hard ceiling across a task's whole agent tree: dispatches per task. */
  maxDispatchesPerTask?: number | null;
  /** Hard ceiling across a task's whole agent tree: ledgered tokens per task.
   *  Null by default -- there is no honest universal number. */
  maxTaskTokens?: number | null;
}

export interface ConsultConfig {
  /** Decision 3: skip the cross-model review when triage sizes a task small
   *  (fewer than ~10 files and fewer than 3 independent pieces). */
  sizeGate: boolean;
  /** One review pass by default; two at most. Round 1 buys ~8 points, round 2
   *  ~4.5, round 3 ~1.5 and rising noise. */
  maxReviewRounds: number;
  /** Build mode: execute without waiting for Proceed. Off by default -- the
   *  accept/reject decision rests on a verifier or a human, not on two
   *  models agreeing. */
  autoProceed: boolean;
  /** Run the project gates when the executor's turn ends after a Proceed. */
  verifyAfterProceed: boolean;
  /** What a session starts in. 'auto' is the point of the product: triage
   *  every message, run cheap models on cheap work. 'chat' is one model with
   *  no ceremony, which is what every session silently defaulted to before. */
  defaultMode: 'chat' | 'auto' | 'plan' | 'build';
  /** In auto mode, a task triage sizes LARGE runs the conference -- plan,
   *  cross-model review, reconcile -- instead of a plain turn. This is what
   *  makes the two vendors actually talk without the user hunting for a
   *  button. Still gated by the human on Proceed. */
  escalateToConference: boolean;
}

export interface GuardsConfig {
  /** Decision 2, one writer. 'warn' posts a notice when a second session opens
   *  on a project; 'block' refuses it with a 409. */
  oneWriter: 'warn' | 'block';
}

export interface RoostConfig {
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

const DEFAULTS: RoostConfig = {
  port: 8790,
  projects: [process.cwd()],
  sessionIdleTimeoutHours: 24,
  notifications: { url: 'https://ntfy.sh', topic: '' },
  autoRoute: {
    // `candidates` let a tier cross vendors: the router picks whichever
    // subscription has better KNOWN headroom. Only light and standard cross --
    // heavy work stays where the session is, because moving hard reasoning
    // between engines mid-task costs more than the quota it saves.
    claude: {
      light: { model: 'haiku', candidates: [{ agent: 'claude', model: 'haiku' }, { agent: 'codex', model: 'gpt-5.6-luna' }] },
      standard: { model: 'sonnet', candidates: [{ agent: 'claude', model: 'sonnet' }, { agent: 'codex', model: 'gpt-5.6-terra' }] },
      heavy: { model: 'opus', effort: 'xhigh' },
    },
    // From the live model/list roster on 2026-09-21. The previous defaults
    // pointed a FRESH install at a deleted model and a superseded one; the
    // registry (Phase 7) audits these against the roster at startup.
    codex: {
      light: { model: 'gpt-5.6-luna', candidates: [{ agent: 'codex', model: 'gpt-5.6-luna' }, { agent: 'claude', model: 'haiku' }] },
      standard: { model: 'gpt-5.6-terra', candidates: [{ agent: 'codex', model: 'gpt-5.6-terra' }, { agent: 'claude', model: 'sonnet' }] },
      heavy: { model: 'gpt-6-astra', effort: 'xhigh' },
    },
  },
  budget: {
    reprioritizeAtPct: 75,
    gateAtPct: 90,
    hardStopPct: 98,
    staleAfterMins: 90,
    dailyUsd: null,
    // A weekly window resetting within a day with over 30% unused (2026-09-24).
    surplusHeadroomPct: 30,
    surplusWithinMins: 24 * 60,
    maxDispatchesPerTask: 40,
    maxTaskTokens: null,
  },
  consult: { sizeGate: true, maxReviewRounds: 1, autoProceed: false, verifyAfterProceed: true, defaultMode: 'auto', escalateToConference: true },
  guards: { oneWriter: 'warn' },
  claude: { models: ['sonnet', 'opus', 'haiku', 'fable'], defaultModel: 'sonnet', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  codex: { models: [], defaultModel: '', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] }, // no Codex model exposes 'minimal'
};

/** Repo root is two levels up from server/src (or server/dist). */
export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Environment variables keep their old spellings as a fallback.
 *
 *  The app was called Roost until the rename, and anyone running it has
 *  ROOST_TOKEN's predecessor exported in a shell profile or a LaunchAgent plist.
 *  Renaming the variable without accepting the old one would silently drop the
 *  auth token — turning a rename into an open server. */
const env = (name: string): string | undefined =>
  process.env[`ROOST_${name}`] ?? process.env[`POCKET_${name}`];

const configPath = () =>
  env('CONFIG') ?? preferExisting(join(repoRoot, 'roost.config.json'), join(repoRoot, 'pocket.config.json'));

/** During the rename, an existing file under the old name still wins: a config
 *  the person wrote must not stop being read because we picked a new name. */
function preferExisting(next: string, previous: string): string {
  try {
    if (!existsSync(next) && existsSync(previous)) return previous;
  } catch {
    /* fall through to the new name */
  }
  return next;
}

/** Session-state file lives next to the config so scratch/test configs get their own. */
export const statePath = () => migrated(join(dirname(configPath()), '.roost-state.json'), '.pocket-state.json');

/** Durable data (usage ledger, quota windows, prices) lives next to the config for
 *  the same reason session state does: a ROOST_CONFIG-scoped test run gets its own. */
export const dataDir = () => migrated(join(dirname(configPath()), '.roost-data'), '.pocket-data');

/** Renames the pre-rename path into place, once, the first time it is asked for.
 *
 *  Without this the rename would quietly orphan every quota window, the whole
 *  decision log and the call ledger — and an empty quota store does not fail
 *  loudly, it just reports `unknown`, which the policy treats as "no data" and
 *  the gate stops gating. A cosmetic rename would have disabled the safety
 *  system. Failure is swallowed: worst case you start fresh, which is what
 *  would have happened anyway. */
function migrated(next: string, oldBasename: string): string {
  try {
    if (existsSync(next)) return next;
    const previous = join(dirname(next), oldBasename);
    if (existsSync(previous)) renameSync(previous, next);
  } catch {
    /* a failed migration must not stop the app starting */
  }
  return next;
}

export function loadConfig(): RoostConfig {
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
        console.error(`[roost] config at ${configPath()} is unreadable (${err?.message ?? err}); moved aside to ${aside}, using defaults`);
      } catch {
        console.error(`[roost] config at ${configPath()} is unreadable (${err?.message ?? err}) and could not be moved aside; using defaults WITHOUT saving`);
      }
    } else {
      console.warn(`[roost] no config at ${configPath()}, using defaults`);
    }
    return structuredClone(DEFAULTS);
  }
}

export function saveConfig(config: RoostConfig): void {
  const tmp = `${configPath()}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n');
  renameSync(tmp, configPath());
}
