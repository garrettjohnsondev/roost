import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, appendFileSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { dataDir } from './config.js';
import { loadProjectKnowledge, composeDispatchPrompt, type ProjectKnowledge } from './projectFile.js';
import { loadAgentDefs } from './agentDefs.js';
import { runAgentTask } from './agents/dispatch.js';
import { reviewerFor, REVIEW_STRENGTH_LABEL } from './capabilities.js';
import { modelRegistry } from './registry.js';
import { logDecision } from './decisions.js';
import { truncate } from './util.js';
import type { AgentKind, VerifyReport, EvidenceRecord, ImageCheck } from './protocol.js';

/** Phase 5: the verification gate.
 *
 *  The highest-evidence item in the roadmap, and the one agent-sync got right
 *  in spirit and wrong in mechanism. Three rules, all structural:
 *
 *  1. The gate is a script the HARNESS runs, read from maintainer-authored
 *     sources (the project file's `## gates`, or explicit checks). Agent output
 *     is never a command. An executor that edits the gates mid-task is caught
 *     by the fingerprint taken when the task began.
 *  2. Evidence is command + exit code + output. "The tests pass" is a claim;
 *     `npm test` exiting 0 with its output attached is evidence.
 *  3. Anti-fabrication is not an instruction. A "screenshot" that is a flat
 *     rectangle fails on its colour count; two frames that are pixel-identical
 *     fail each other. That check was learned the hard way in August. */

const TAIL = 4000;
const GATE_TIMEOUT_MS = 10 * 60_000;

/** `## gates` lines: bullets, backticks and blank lines stripped. */
export function gatesFrom(knowledge: ProjectKnowledge): string[] {
  const body = knowledge.sections['gates'] ?? '';
  return body
    .split('\n')
    .map((l) => l.trim().replace(/^[-*]\s+/, '').replace(/^`|`$/g, '').trim())
    .filter((l) => l && !l.startsWith('#'));
}

export function gateFingerprint(commands: string[]): string {
  return createHash('sha256').update(commands.join('\n')).digest('hex');
}

export function runGate(command: string, cwd: string, timeoutMs = GATE_TIMEOUT_MS): Promise<EvidenceRecord> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    // The string reaches a shell -- which is why it may only ever come from a
    // maintainer-authored source, never from an agent's output.
    execFile('/bin/sh', ['-c', command], { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err: any, stdout, stderr) => {
      const timedOut = !!err?.killed && err?.signal === 'SIGTERM';
      resolve({
        command,
        cwd,
        exitCode: err ? (typeof err.code === 'number' ? err.code : null) : 0,
        signal: err?.signal ?? null,
        stdoutTail: String(stdout ?? '').slice(-TAIL),
        stderrTail: String(stderr ?? '').slice(-TAIL),
        ms: Date.now() - startedAt,
        startedAt,
        timedOut,
      });
    });
  });
}

// ---------- images ----------

interface Decoded {
  width: number;
  height: number;
  channels: number;
  pixels: Uint8Array;
}

/** Minimal PNG decoder: 8-bit, non-interlaced, colour types 0/2/4/6. Anything
 *  else is reported as unchecked rather than passed. */
export function decodePng(buf: Buffer): Decoded {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let i = 8;
  let width = 0, height = 0, depth = 0, colour = 0, interlace = 0;
  const idat: Buffer[] = [];
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    const data = buf.subarray(i + 8, i + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; colour = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    i += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) throw new Error('unsupported PNG (need 8-bit, non-interlaced)');
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colour as 0 | 2 | 4 | 6];
  if (!channels) throw new Error('unsupported PNG colour type');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  let prev = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const cur = raw[p++];
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v: number;
      switch (filter) {
        case 0: v = cur; break;
        case 1: v = cur + a; break;
        case 2: v = cur + b; break;
        case 3: v = cur + ((a + b) >> 1); break;
        case 4: {
          const pp = a + b - c;
          const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          v = cur + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`bad PNG filter ${filter}`);
      }
      line[x] = v & 0xff;
    }
    pixels.set(line, y * stride);
    prev = line;
  }
  return { width, height, channels, pixels };
}

const MIN_BYTES = 2 * 1024;
const MIN_COLOURS = 64;

export function checkImage(path: string): ImageCheck {
  if (!existsSync(path)) return { path, ok: false, reason: 'file does not exist', bytes: null, uniqueColours: null };
  const bytes = statSync(path).size;
  if (bytes < MIN_BYTES) return { path, ok: false, reason: `only ${bytes} bytes`, bytes, uniqueColours: null };
  let d: Decoded;
  try {
    d = decodePng(readFileSync(path));
  } catch (err: any) {
    // Not a claim of success: an image we cannot decode is unchecked.
    return { path, ok: false, reason: `unchecked: ${err?.message ?? err}`, bytes, uniqueColours: null };
  }
  const total = d.width * d.height;
  const step = Math.max(1, Math.floor(total / 200_000));
  const seen = new Set<number>();
  for (let px = 0; px < total; px += step) {
    const o = px * d.channels;
    // Quantise to 6 bits per channel so compression noise does not inflate the count.
    const r = d.pixels[o] >> 2, g = d.pixels[o + (d.channels >= 3 ? 1 : 0)] >> 2, b = d.pixels[o + (d.channels >= 3 ? 2 : 0)] >> 2;
    seen.add((r << 12) | (g << 6) | b);
  }
  const sha = createHash('sha256').update(d.pixels).digest('hex').slice(0, 16);
  if (seen.size < MIN_COLOURS) return { path, ok: false, reason: `only ${seen.size} distinct colours — a flat rectangle is not a screenshot`, bytes, uniqueColours: seen.size, sha };
  return { path, ok: true, reason: `${d.width}×${d.height}, ${seen.size}+ colours`, bytes, uniqueColours: seen.size, sha };
}

export function checkImages(paths: string[]): ImageCheck[] {
  const out = paths.map(checkImage);
  // No two frames in a set may be pixel-identical.
  const byHash = new Map<string, number[]>();
  out.forEach((c, i) => { if (c.sha) byHash.set(c.sha, [...(byHash.get(c.sha) ?? []), i]); });
  for (const idxs of byHash.values()) {
    if (idxs.length > 1) for (const i of idxs) out[i] = { ...out[i], ok: false, reason: `pixel-identical to ${idxs.length - 1} other frame(s) in the set` };
  }
  return out;
}

// ---------- the gate ----------

export interface VerifyOptions {
  cwd: string;
  taskId?: string;
  /** Explicit commands; otherwise the project file's `## gates`. */
  checks?: string[];
  images?: string[];
  /** gateFingerprint() taken when the task began. A mismatch means the gates
   *  were edited during the task, and the result cannot be trusted. */
  fingerprintAtStart?: string | null;
  /** Run the fresh-context diff reviewer last. */
  review?: { executorAgent: AgentKind; criteria?: string };
}

export async function verifyTask(opts: VerifyOptions): Promise<VerifyReport> {
  const startedAt = Date.now();
  const knowledge = loadProjectKnowledge(opts.cwd);
  const commands = opts.checks ?? gatesFrom(knowledge);
  const fingerprint = gateFingerprint(commands);
  const tampered = opts.fingerprintAtStart != null && opts.fingerprintAtStart !== fingerprint;

  const gates: EvidenceRecord[] = [];
  for (const cmd of commands) gates.push(await runGate(cmd, opts.cwd));
  const images = checkImages(opts.images ?? []);

  const gatesOk = gates.every((g) => g.exitCode === 0);
  const imagesOk = images.every((c) => c.ok);
  const nothingChecked = !commands.length && !images.length;
  const passed = !tampered && !nothingChecked && gatesOk && imagesOk;

  let review: VerifyReport['review'];
  if (opts.review) review = await reviewDiff(opts.cwd, opts.review.executorAgent, opts.review.criteria, opts.taskId);

  const parts: string[] = [];
  if (tampered) parts.push('gate definitions changed during the task');
  if (nothingChecked) parts.push('nothing to verify — no gates defined and no images given');
  if (commands.length) parts.push(`${gates.filter((g) => g.exitCode === 0).length}/${gates.length} gates passed`);
  if (images.length) parts.push(`${images.filter((c) => c.ok).length}/${images.length} images genuine`);
  if (review) parts.push(`diff reviewed by ${review.agent}/${review.model}`);

  const report: VerifyReport = { taskId: opts.taskId, passed, tampered, gates, images, review, fingerprint, summary: parts.join(' · '), startedAt, ms: Date.now() - startedAt };
  persistEvidence(report);
  logDecision({ kind: 'verify', taskId: opts.taskId, passed, tampered, gates: gates.length, gatesPassed: gates.filter((g) => g.exitCode === 0).length, images: images.length, reviewed: !!review, ms: report.ms });
  return report;
}

function persistEvidence(report: VerifyReport): void {
  try {
    const dir = join(dataDir(), 'evidence');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `${(report.taskId ?? 'adhoc').replace(/[^a-z0-9_-]/gi, '_')}.jsonl`), JSON.stringify(report) + '\n');
  } catch {
    /* evidence on disk is best effort; the report itself is returned */
  }
}

function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve) => execFile('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (_e, out) => resolve(String(out ?? ''))));
}

/** The diff reviewer runs LAST, in a fresh context, on the diff and the
 *  criteria only -- never the executor's reasoning, which made review worse
 *  than self-review when included. Picks the most independent reviewer
 *  available: another vendor, else another model, else a clean context. */
export async function reviewDiff(cwd: string, executorAgent: AgentKind, criteria?: string, taskId?: string): Promise<VerifyReport['review']> {
  const diff = (await git(['diff', '--no-color'], cwd)) + (await git(['diff', '--cached', '--no-color'], cwd));
  if (!diff.trim()) return { agent: executorAgent, model: '', strength: 'none', text: '(no diff to review)' };
  const def = loadAgentDefs(cwd).find((d) => d.name === 'review');
  if (!def) return { agent: executorAgent, model: '', strength: 'none', text: '(no review definition)' };
  const choice = reviewerFor({ agent: executorAgent, model: '' }, modelRegistry().all(), (a) => modelRegistry().presence(a));
  if (choice.strength === 'none') return { agent: executorAgent, model: '', strength: 'none', text: '(no reviewer available)' };
  const prompt = composeDispatchPrompt({
    def,
    knowledge: loadProjectKnowledge(cwd),
    criteria,
    task: `Review this diff against the acceptance criteria.\n\n\`\`\`diff\n${truncate(diff, 60_000)}\n\`\`\``,
  });
  const r = await runAgentTask({ agent: choice.agent, model: choice.model, capability: 'read-only', cwd, prompt, role: 'review', taskId }).promise;
  return { agent: choice.agent, model: choice.model, strength: REVIEW_STRENGTH_LABEL[choice.strength], text: r.text };
}
