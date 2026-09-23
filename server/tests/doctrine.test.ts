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

describe('a decision that is computed is a decision that is shown', () => {
  // chooseEffort's reason was computed on every routed turn and dropped: the
  // 'routed' event carried the triage and route reasons and nothing about
  // thinking, so the one lever the user cannot see moving was the one the UI
  // never explained. routing.test.ts already pins what the reasons SAY; this
  // pins that something carries them.
  it('carries the effort reason onto the routed event', () => {
    const s = read('server/src/sessions.ts');
    expect(s).toContain('effortPick.reason');
    // Not merely mentioned -- reaching the event the chat renders.
    const routed = s.slice(s.indexOf("type: 'routed'") - 400, s.indexOf("type: 'routed'") + 200);
    expect(routed).toMatch(/effortReason/);
  });

  it('logs the effort decision, applied or held back', () => {
    const s = read('server/src/sessions.ts');
    expect(s).toMatch(/kind: 'effort'/);
    // The held-back row is the one worth having: it is the only trace that the
    // chooser wanted to move, which is what makes the table learnable.
    expect(s).toMatch(/applied: change\.apply/);
    expect(read('server/src/decisions.ts')).toContain("'effort'");
  });
});

describe('compaction is offered, not done behind your back', () => {
  it('never puts a "/compact" bubble in the transcript as if you typed it', () => {
    // The Claude SDK has no programmatic compaction, so the mechanism is the
    // slash command -- but routing it through sendUserMessage would emit a
    // user_message, and the transcript would claim the person typed it.
    const c = read('server/src/agents/claude.ts');
    const body = c.slice(c.indexOf('async compact()'), c.indexOf('async setModel'));
    expect(body).toContain('/compact');
    expect(body).not.toContain('sendUserMessage');
    expect(body).not.toMatch(/type: 'user_message'/);
  });

  it('makes the remembered setting two-way', () => {
    // A setting you can turn on and cannot turn off is a trap.
    for (const f of ['server/src/protocol.ts', 'web/src/types.ts']) {
      expect(read(f), f).toContain("set_auto_compact");
    }
    expect(read('server/src/sessions.ts')).toMatch(/case 'set_auto_compact'/);
    expect(read('web/src/ChatView.tsx')).toMatch(/set_auto_compact', on: false/);
  });

  it('persists the remembered answer across restarts', () => {
    // "Keep doing this" that forgets on restart is not a remembered setting.
    const s = read('server/src/sessions.ts');
    expect(s).toMatch(/autoCompact: s\.autoCompact/);
    expect(s).toMatch(/restore\?\.autoCompact/);
  });
})
