import { spawn } from 'node:child_process';
import { existsSync, readFileSync, watchFile } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './config.js';
import { checkoutDir } from './updates.js';
import { sendNotification } from './notify.js';
import { refreshRegistry } from './registryFetch.js';

/** Keep Claude's and Codex's own software current, so new models appear on
 *  their own (2026-09-29: "can't be having people run on old models"). Once
 *  shortly after start, then daily, run scripts/agents-update.mjs detached --
 *  it may restart Roost through the normal checked deploy, which waits for
 *  the crew to finish talking. `busy` defers a run while any session works. */
export function startAgentsUpdate(cwd: string, busy: () => boolean, onModels?: () => void, everyMs = 24 * 3600_000): void {
  if (process.env.ROOST_NO_AGENT_UPDATES === '1') return;
  const script = join(checkoutDir(), 'scripts', 'agents-update.mjs');
  if (!existsSync(script)) return;
  const reportPath = join(dataDir(), 'agents-update.json');
  let seen = readReport(reportPath)?.checkedAt ?? 0;
  const tick = () => {
    if (busy()) { setTimeout(tick, 10 * 60_000).unref?.(); return; }
    const child = spawn(process.execPath, [script], { cwd: checkoutDir(), detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
  };
  // A finished run: say what changed, and re-read the model lists now.
  watchFile(reportPath, { interval: 5000 }, () => {
    const r = readReport(reportPath);
    if (!r || r.checkedAt === seen) return;
    seen = r.checkedAt;
    if (r.updated?.length) {
      console.log(`[roost] updated: ${r.updated.join(', ')}`);
      sendNotification('agents-update', 'New AI models are ready', `${r.updated.join(' · ')} — the model lists are refreshed.`, { minIntervalMs: 3600_000 });
      refreshRegistry(cwd).then(() => onModels?.(), () => {});
    }
  });
  setTimeout(tick, 3 * 60_000).unref?.();
  setInterval(tick, everyMs).unref?.();
}

function readReport(p: string): { checkedAt: number; updated?: string[] } | null {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}
