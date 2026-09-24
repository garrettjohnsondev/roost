import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'roost-auth-'));
process.env.ROOST_CONFIG = join(tmp, 'roost.config.json');
writeFileSync(process.env.ROOST_CONFIG, '{}');
const A = await import('../src/claudeAuth.js');
const FAKE = ['node', fileURLToPath(new URL('./fixtures/fake-setup-token.mjs', import.meta.url))];
const tokenFile = join(tmp, '.roost-data', 'claude-oauth-token');

afterAll(() => rmSync(tmp, { recursive: true, force: true }));
beforeEach(() => { A.clearToken(); A.cancelSignIn(); });

describe('isAuthFailure — telling a sign-in problem from any other failure', () => {
  it('recognises the ways an expired or missing sign-in is reported', () => {
    for (const m of [
      'Claude turn failed: OAuth token has expired',
      'API Error: 401 {"type":"error","error":{"type":"authentication_error"}}',
      'Invalid API key · Please run /login',
      'Not logged in · Please run /login',
      'invalid_grant: refresh token revoked',
    ]) expect(A.isAuthFailure(m), m).toBe(true);
  });
  it('does not mistake other failures for it', () => {
    for (const m of ['Claude turn failed: error_max_turns', 'API Error: 529 overloaded', 'rate limit reached', 'tool failed: ENOENT'])
      expect(A.isAuthFailure(m), m).toBe(false);
  });
});

describe('reading the CLI screen', () => {
  it('finds the manual sign-in link through escape codes', () => {
    const raw = '\x1b[34mhttps://claude.com/cai/oauth/authorize?code=true&code_challenge=abc&state=s\x1b[0m\r\nPaste code';
    expect(A.findSignInUrl(raw)).toBe('https://claude.com/cai/oauth/authorize?code=true&code_challenge=abc&state=s');
  });
  it('rejoins a link a narrow terminal wrapped across lines', () => {
    const raw = 'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c\r\n250a&code_challenge=wcrB\r\nu_ow&state=G_Tj\r\n\r\nHold Shift';
    expect(A.findSignInUrl(raw)).toBe('https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a&code_challenge=wcrBu_ow&state=G_Tj');
  });
  it('rejoins a wrapped token', () => {
    expect(A.findToken(' sk-ant-oat01-W_Hma7NX\r\n Y0HsAU7n-1GW\r\nStore this')).toBe('sk-ant-oat01-W_Hma7NXY0HsAU7n-1GW');
  });
  it('finds nothing when there is nothing', () => {
    expect(A.findSignInUrl('Welcome to Claude Code')).toBeNull();
    expect(A.findToken('no token here')).toBeNull();
  });
});

describe('Roost’s own token', () => {
  it('is readable by this user only', () => {
    A.saveToken('sk-ant-oat01-abc_DEF-123');
    expect(statSync(tokenFile).mode & 0o777).toBe(0o600);
  });
  it('refuses to store something that is not a token', () => {
    expect(() => A.saveToken('hello')).toThrow();
  });
  it('is applied to Claude sessions only when present', () => {
    expect(A.withClaudeAuth({ cwd: '/x' } as any).env).toBeUndefined();
    A.saveToken('sk-ant-oat01-abc_DEF-123');
    const opts = A.withClaudeAuth({ cwd: '/x', env: { KEEP: '1' } } as any);
    expect(opts.env).toMatchObject({ KEEP: '1', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-abc_DEF-123' });
  });
  it('is forgotten on request, falling back to the Mac login', () => {
    A.saveToken('sk-ant-oat01-abc_DEF-123');
    A.clearToken();
    expect(A.loadToken()).toBeNull();
  });
});

describe('signing in from the phone — against a stand-in, never the real CLI', () => {
  it('shows the link, takes the code, and keeps the token', async () => {
    const { flowId, url } = await A.startSignIn({ command: FAKE });
    expect(url).toMatch(/^https:\/\/claude\.com\/cai\/oauth\/authorize\?code=true/);
    await A.finishSignIn(flowId, 'good-code');
    expect(A.loadToken()).toBe('sk-ant-oat01-TESTtokenONLY_abc-123');
    expect(statSync(tokenFile).mode & 0o777).toBe(0o600);
  }, 20_000);

  it('disables the Mac’s browser, so nothing signs in with nobody present', async () => {
    // The first probe of the real CLI opened a browser on the Mac, and a Mac
    // already signed in to claude.ai completed the whole flow by itself. The
    // CLI runs `$BROWSER <url>` when BROWSER is set, so it is set to a no-op —
    // and any existing Roost token is withheld from the sign-in itself.
    A.saveToken('sk-ant-oat01-existing');
    const { url } = await A.startSignIn({
      command: ['sh', '-c', 'printf "https://claude.com/cai/oauth/authorize?code=true&code_challenge=c&b=%s&t=%s\\n" "$BROWSER" "$CLAUDE_CODE_OAUTH_TOKEN"; sleep 5'],
    });
    const q = new URL(url).searchParams;
    expect(q.get('b')).toBe('/usr/bin/true');
    expect(q.get('t')).toBe('');
  }, 20_000);

  it('rejects a code that was not accepted, and keeps no token', async () => {
    const { flowId } = await A.startSignIn({ command: FAKE });
    await expect(A.finishSignIn(flowId, 'bad-code')).rejects.toThrow();
    expect(A.loadToken()).toBeNull();
  }, 20_000);

  it('refuses a stale or unknown sign-in', async () => {
    await expect(A.finishSignIn('not-a-flow', 'good-code')).rejects.toThrow(/expired/);
  });

  it('refuses something that is not a code before sending it anywhere', async () => {
    const { flowId } = await A.startSignIn({ command: FAKE });
    await expect(A.finishSignIn(flowId, 'two words')).rejects.toThrow(/does not look like/);
  }, 20_000);
});
