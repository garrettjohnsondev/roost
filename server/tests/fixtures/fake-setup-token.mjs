// Stands in for `claude setup-token` in tests, so the real one never runs:
// escape codes, a spinner, the manual sign-in link, a paste prompt — then a
// token once a code arrives, or an error for a bad one. It also reports the
// BROWSER it was given, so the test can prove the Mac's browser is disabled.
import readline from 'node:readline';
const out = (s) => process.stdout.write(s);
out('\x1b[?25l\x1b[1mWelcome to Claude Code\x1b[0m\r\n');
out(`browser-was: ${process.env.BROWSER ?? '(unset)'}\r\n`);
out('✢ ✳ ✶ Opening browser to sign in…\r\n');
out("Browser didn't open? Use the url below to sign in\r\n");
out('\x1b[34mhttps://claude.com/cai/oauth/authorize?code=true&client_id=test-client&response_type=code&code_challenge=abc123&code_challenge_method=S256&state=xyz\x1b[0m\r\n');
out('Paste code here if prompted > ');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const code = line.trim();
  if (code === 'good-code') {
    out('\r\n\x1b[32m✓ Long-lived authentication token created successfully!\x1b[0m\r\n Your OAuth token (valid for 1 year):\r\n sk-ant-oat01-TESTtokenONLY_abc-123\r\n');
    setTimeout(() => process.exit(0), 50);
  } else {
    out('\r\nOAuth error: invalid code\r\n');
    setTimeout(() => process.exit(1), 50);
  }
});
