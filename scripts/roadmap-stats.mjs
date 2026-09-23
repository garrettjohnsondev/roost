// Writes ROADMAP.md's status line from the suites themselves.
//
// The line was typed by hand and it drifted three times in one session — 114
// claimed at 200, 200 at 275, 275 at 305. A number a person has to remember to
// update is a number that will be wrong. This runs both workspaces, reads the
// counts vitest reports, and writes them; if anything failed it says so rather
// than printing "green", because a status line that flatters is worse than none.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(join(tmpdir(), 'roost-stats-'));

function suite(ws) {
  const out = join(scratch, `${ws}.json`);
  try {
    execFileSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${out}`], { cwd: join(root, ws), stdio: 'ignore' });
  } catch {
    /* a failing suite exits non-zero; the JSON still says how many failed */
  }
  const r = JSON.parse(readFileSync(out, 'utf8'));
  return { passed: r.numPassedTests, failed: r.numFailedTests, total: r.numTotalTests };
}

function typecheckClean() {
  try {
    execFileSync('npm', ['run', 'typecheck'], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const server = suite('server');
const web = suite('web');
const tc = typecheckClean();
rmSync(scratch, { recursive: true, force: true });

const passed = server.passed + web.passed;
const failed = server.failed + web.failed;
const date = new Date().toISOString().slice(0, 10);
const verdict = failed === 0 ? `**${passed} tests green` : `**${passed} passing, ${failed} FAILING`;
const line = `${verdict}, typecheck ${tc ? 'clean' : 'FAILING'} both workspaces.** <!-- written by scripts/roadmap-stats.mjs on ${date}: server ${server.passed}/${server.total}, web ${web.passed}/${web.total} — do not edit by hand -->`;

const path = join(root, 'ROADMAP.md');
const before = readFileSync(path, 'utf8');
const re = /^\*\*[^\n]*(?:tests green|FAILING)[^\n]*\*\*(?: <!--[^\n]*-->)?/m;
if (!re.test(before)) {
  console.error('roadmap-stats: could not find the status line to replace');
  process.exit(1);
}
writeFileSync(path, before.replace(re, line));
console.log(line.replace(/<!--.*-->/, '').trim());
process.exit(failed === 0 && tc ? 0 : 1);
