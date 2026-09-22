import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** Rules from ROADMAP §5, pinned to the source. A rule with no test drifts —
 *  correction 26 is two of them that had. */
const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('decision 7 — no number the data cannot support', () => {
  it('renders no `?? 0` on the surfaces that show cost or percent', () => {
    for (const f of ['web/src/UsagePanel.tsx', 'web/src/ChatView.tsx', 'server/src/usage.ts']) {
      expect(read(f), f).not.toMatch(/\?\?\s*0\b/);
    }
  });

  it('shows no dollar figure in the chat header', () => {
    const chat = read('web/src/ChatView.tsx');
    expect(chat).not.toContain('costUsd.toFixed');
    // The removed line was `<> · ${session.usage.costUsd.toFixed(2)}</>`: a
    // literal dollar sign interpolating a cost. Crew-chip titles also contain
    // `· ${...}`, so the guard is on the cost, not the separator.
    expect(chat).not.toMatch(/\$\{[^}]*costUsd/);
  });
});

describe('dispatch safety', () => {
  it('never maps a capability to danger-full-access', () => {
    expect(read('server/src/agents/dispatch.ts')).not.toMatch(/['"]danger-full-access['"]\s*[,}]/);
  });

  it('isolates every one-shot from filesystem settings', () => {
    // Omitted, the SDK loads all sources and a settings file's permissions.allow
    // rules approve tools without consulting canUseTool.
    for (const f of ['server/src/agents/dispatch.ts', 'server/src/consult.ts', 'server/src/router.ts']) {
      expect(read(f), f).toContain('settingSources: []');
    }
  });
});
