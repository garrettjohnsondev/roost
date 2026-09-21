import { execFile, spawn } from 'node:child_process';
import { mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { dataDir } from './config.js';

const run = promisify(execFile);

/** Codex drains stdin before working, so a piped stdin hangs it forever.
 *  `execFile` silently ignores a `stdio` option, so this has to be spawn. */
function runCodex(args: string[], cwd: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('codex', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.stdout.resume();
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('image generation timed out')); }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(err.trim().slice(-400) || `codex exited ${code}`));
    });
  });
}

/** Custom avatars are generated against the REQUESTING USER's own Codex
 *  subscription, so the ~10-12k text tokens land on whoever asked for one.
 *  The shipped pool in web/public/avatars is generated once by a maintainer
 *  (tools/gen-avatars.mjs) and costs a user nothing. */
export function avatarDir(): string {
  const d = join(dataDir(), 'avatars');
  mkdirSync(d, { recursive: true });
  return d;
}

export function listCustom(): Array<{ file: string; at: number }> {
  try {
    return readdirSync(avatarDir())
      .filter((f) => /^custom-[a-z0-9-]+\.png$/.test(f))
      .map((f) => ({ file: f, at: statSync(join(avatarDir(), f)).mtimeMs }))
      .sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

const SAFE_COLOR = /^#[0-9a-fA-F]{6}$/;

/** The exact style clause used by tools/gen-avatars.mjs. Kept identical so a
 *  custom avatar sits beside the shipped pool without looking pasted in. */
function stylePrompt(subject: string, color: string): string {
  return [
    'Use your built-in image_gen tool to generate ONE 1024x1024 image.',
    '',
    'Use exactly this style description:',
    `"Minimal flat vector icon of ${subject}, centered, front-facing, simple geometric shapes,`,
    'limited palette of 3-4 flat colours, no shading, no gradients, no drop shadows, no outline glow,',
    `no text or lettering, solid ${color} background filling the entire frame, subject fills about`,
    '70 percent of the frame, clean vector illustration in the style of a modern app icon."',
    '',
    'Use the image_gen tool directly. Do not write code or scripts.',
  ].join('\n');
}

export class AvatarGenError extends Error {}

/** One custom avatar. Rejects rather than guessing on bad input, and never
 *  interpolates user text into a shell -- execFile takes an argv array. */
export async function generateAvatar(subject: string, color: string, timeoutMs = 6 * 60_000): Promise<string> {
  const clean = String(subject ?? '').trim().slice(0, 120);
  if (clean.length < 2) throw new AvatarGenError('describe the avatar you want');
  if (!SAFE_COLOR.test(color)) throw new AvatarGenError('color must be #rrggbb');

  const dir = avatarDir();
  const id = randomUUID().slice(0, 8);
  const raw = `raw-${id}.png`;
  const out = `custom-${id}.png`;

  await runCodex([
    'exec', '-s', 'workspace-write', '--skip-git-repo-check', '-C', dir,
    `${stylePrompt(clean, color)}\n\nSave it as ${raw} in the current directory.`,
  ], dir, timeoutMs);

  if (!existsSync(join(dir, raw))) throw new AvatarGenError('generation produced no image');
  // Ship a 128px copy; the 1024 original is not worth storing per user.
  await run('sips', ['-z', '128', '128', join(dir, raw), '--out', join(dir, out)]);
  return out;
}
