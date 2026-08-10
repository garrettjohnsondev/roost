import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AgentConfig {
  models: string[];
  defaultModel: string;
  efforts: string[];
}

export interface PocketConfig {
  port: number;
  projects: string[];
  /** Hours an active session may sit with no real activity before it's auto-closed. */
  sessionIdleTimeoutHours: number;
  claude: AgentConfig;
  codex: AgentConfig;
}

const DEFAULTS: PocketConfig = {
  port: 8790,
  projects: [process.cwd()],
  sessionIdleTimeoutHours: 24,
  claude: { models: ['sonnet', 'opus', 'haiku'], defaultModel: 'sonnet', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  codex: { models: [], defaultModel: '', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
};

/** Repo root is two levels up from server/src (or server/dist). */
export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const configPath = () => process.env.POCKET_CONFIG ?? join(repoRoot, 'pocket.config.json');

export function loadConfig(): PocketConfig {
  try {
    const parsed = JSON.parse(readFileSync(configPath(), 'utf8'));
    return { ...DEFAULTS, ...parsed, claude: { ...DEFAULTS.claude, ...parsed.claude }, codex: { ...DEFAULTS.codex, ...parsed.codex } };
  } catch {
    console.warn(`[pocket] no readable config at ${configPath()}, using defaults`);
    return DEFAULTS;
  }
}

export function saveConfig(config: PocketConfig): void {
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + '\n');
}
