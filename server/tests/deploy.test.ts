import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectCheck, detectDeploy, forgetRecipe, getRecipe, lastRun, parseProposal, saveRecipe, startDeploy } from '../src/deploy.js';

const dir = (files: Record<string, string>) => {
  const d = mkdtempSync(join(tmpdir(), 'roost-deploy-'));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(join(d, p, '..'), { recursive: true });
    writeFileSync(join(d, p), body);
  }
  return d;
};
const pkg = (scripts: Record<string, string>) => JSON.stringify({ name: 'x', private: true, scripts });

describe('what deploy means in a project', () => {
  it('prefers the project\'s own deploy script', () => {
    const s = detectDeploy(dir({ 'package.json': pkg({ deploy: 'wrangler deploy', test: 'vitest run' }), 'vercel.json': '{}' }));
    expect(s?.command).toBe('npm run deploy');
    expect(s?.check).toBe('npm test');
  });

  it('reads a linked host from its config file, with the lockfile\'s runner for the check', () => {
    const s = detectDeploy(dir({ 'package.json': pkg({ build: 'next build' }), 'pnpm-lock.yaml': '', '.vercel/project.json': '{}' }));
    expect(s).toMatchObject({ command: 'npx vercel --prod --yes', source: 'Vercel', check: 'pnpm run build' });
    expect(s!.evidence.join(' ')).toMatch(/linked to a Vercel project/);
  });

  it('knows Netlify, Fly, Cloudflare, Firebase and Heroku', () => {
    expect(detectDeploy(dir({ 'netlify.toml': '' }))?.source).toBe('Netlify');
    expect(detectDeploy(dir({ 'fly.toml': '' }))?.command).toBe('fly deploy');
    expect(detectDeploy(dir({ 'wrangler.toml': '' }))?.command).toBe('npx wrangler deploy');
    expect(detectDeploy(dir({ 'firebase.json': '{}' }))?.source).toBe('Firebase');
    expect(detectDeploy(dir({ '.git/config': '[remote "heroku"]\n\turl = x' }))?.command).toBe('git push heroku HEAD:main');
  });

  it('counts a CI workflow that deploys on push', () => {
    const s = detectDeploy(dir({ '.git/config': '[remote "origin"]\n\turl = x', '.github/workflows/pages.yml': 'on:\n  push:\njobs:\n  deploy:\n' }));
    expect(s?.command).toBe('git push');
  });

  it('says nothing rather than inventing a command', () => {
    expect(detectDeploy(dir({ 'package.json': pkg({ test: 'vitest' }), 'README.md': '# hi' }))).toBeNull();
  });

  it('npm\'s placeholder test is not a test', () => {
    expect(detectCheck(dir({ 'package.json': pkg({ test: 'echo "Error: no test specified" && exit 1', build: 'vite build' }) })).check).toBe('npm run build');
  });

  it('finds Roost\'s own installer', () => {
    expect(detectDeploy(dir({ 'scripts/service.mjs': 'install finish-deploy' }))?.command).toBe('node scripts/service.mjs install');
  });
});

describe('the recipe, confirmed once', () => {
  it('saves per project and can be forgotten', () => {
    const data = mkdtempSync(join(tmpdir(), 'roost-data-'));
    expect(getRecipe(data, '/p')).toBeNull();
    saveRecipe(data, '/p', { command: ' fly deploy ', check: '', source: 'Fly.io' });
    expect(getRecipe(data, '/p')).toMatchObject({ command: 'fly deploy', check: null, source: 'Fly.io' });
    forgetRecipe(data, '/p');
    expect(getRecipe(data, '/p')).toBeNull();
    expect(() => saveRecipe(data, '/p', { command: '  ' })).toThrow();
  });

  it('reads a crew member\'s proposal block', () => {
    expect(parseProposal('command: npx vercel --prod\ncheck: npm test')).toEqual({ command: 'npx vercel --prod', check: 'npm test' });
    expect(parseProposal('command: fly deploy\ncheck: none')).toEqual({ command: 'fly deploy', check: null });
    expect(parseProposal('nothing here')).toBeNull();
  });
});

describe('running it: the check decides', () => {
  it('does not deploy when the check fails', async () => {
    const cwd = dir({});
    const data = mkdtempSync(join(tmpdir(), 'roost-data-'));
    const r = await startDeploy(data, cwd, { command: 'touch deployed', check: 'exit 3', source: 't', confirmedAt: 0 });
    expect(r.phase).toBe('gate-failed');
    expect(r.exitCode).toBe(3);
    expect(r.output).toMatch(/not deploying/);
    expect(lastRun(data, cwd)?.phase).toBe('gate-failed');
  });

  it('deploys when the check passes, and keeps the output as evidence', async () => {
    const cwd = dir({});
    const data = mkdtempSync(join(tmpdir(), 'roost-data-'));
    const r = await startDeploy(data, cwd, { command: 'echo shipped-it', check: 'true', source: 't', confirmedAt: 0 });
    expect(r).toMatchObject({ phase: 'passed', exitCode: 0 });
    expect(r.output).toMatch(/check passed[\s\S]*shipped-it/);
  });

  it('reports a failing deploy as failed, with its exit code', async () => {
    const r = await startDeploy(mkdtempSync(join(tmpdir(), 'roost-data-')), dir({}), { command: 'exit 7', check: null, source: 't', confirmedAt: 0 });
    expect(r).toMatchObject({ phase: 'failed', exitCode: 7 });
  });
});
