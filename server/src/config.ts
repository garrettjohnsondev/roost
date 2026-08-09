import { readFileSync } from 'node:fs';
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
  claude: AgentConfig;
  codex: AgentConfig;
}

const DEFAULTS: PocketConfig = {
  port: 8790,
  projects: [process.cwd()],
  claude: { models: ['sonnet', 'opus', 'haiku'], defaultModel: 'sonnet', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  codex: { models: [], defaultModel: '', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
};

/** Repo root is two levels up from server/src (or server/dist). */
export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadConfig(): PocketConfig {
  const configPath = process.env.POCKET_CONFIG ?? join(repoRoot, 'pocket.config.json');
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    return { ...DEFAULTS, ...parsed, claude: { ...DEFAULTS.claude, ...parsed.claude }, codex: { ...DEFAULTS.codex, ...parsed.codex } };
  } catch {
    console.warn(`[pocket] no readable config at ${configPath}, using defaults`);
    return DEFAULTS;
  }
}
