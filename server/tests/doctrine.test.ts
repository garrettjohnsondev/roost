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

describe('the crew animates by cutting, not fading', () => {
  it('steps the frame opacity instead of easing it', () => {
    // A cross-fade read as a smudge rather than a character: every in-between
    // state of two pixel-art frames is a frame nobody drew.
    const css = read('web/src/styles.css');
    const block = css.slice(css.indexOf('.crew-sprite .frame-b'), css.indexOf('@media (prefers-reduced-motion'));
    expect(block).toMatch(/steps\(1/);
    expect(block).not.toMatch(/ease|linear|cubic-bezier/);
    // Hard cut: the keyframes jump, they do not ramp.
    expect(css).toMatch(/@keyframes sprite-cut\s*\{[^}]*0%,\s*49\.99%\s*\{\s*opacity:\s*0/);
  });

  it('never blurs pixel art on upscale', () => {
    expect(read('web/src/styles.css')).toMatch(/\.crew-sprite img\s*\{[^}]*image-rendering:\s*pixelated/s);
  });

  it('holds the pose when the system asks for reduced motion', () => {
    const css = read('web/src/styles.css');
    const rm = css.slice(css.indexOf('@media (prefers-reduced-motion'));
    expect(rm.slice(0, 200)).toMatch(/\.crew-sprite \.frame-b\s*\{\s*animation:\s*none/);
  });

  it('only moves for real state, never on a loop of its own', () => {
    // Ambient movement is the commonest tell of a generated interface. `moving`
    // is derived from whether a reply is actually streaming or the engine is
    // actually reasoning -- there is no timer driving it.
    const c = read('web/src/ChatView.tsx');
    expect(c).toMatch(/const moving = pose === 'type' \|\| pose === 'think'/);
    expect(c).toMatch(/pose=\{item\.complete \? 'idle' : 'type'\}/);
    expect(c).not.toMatch(/setInterval|setTimeout/);
  });

  it('falls back to a pool avatar rather than inventing a face', () => {
    // Only three personas have drawn sets; the other eight must not get a
    // stand-in that implies art exists.
    const c = read('web/src/ChatView.tsx');
    expect(c).toMatch(/if \(!crew\.sprite \|\| failed\) return <CrewAvatar crew=\{crew\} \/>/);
    const crew = read('server/src/crew.ts');
    expect((crew.match(/sprite: '/g) ?? []).length).toBe(4); // sol appears twice
  });
})

describe('per-persona spend names the right person', () => {
  it('credits an orchestrator call to its own role, not the live chat’s', () => {
    // ledgerCall(d, 'triage') recorded the role correctly and then derived the
    // PERSONA from this.currentRole, so a triage, plan or review call was
    // credited to whoever was chatting. Half of Phase 4's "per-role and
    // per-persona spend" was one bucket wearing two labels.
    const s = read('server/src/sessions.ts');
    const body = s.slice(s.indexOf('private ledgerCall('), s.indexOf('private ledgerCall(') + 1400);
    expect(body).toMatch(/persona: crewMember\(d\.agent, d\.model, Session\.LEDGER_ROLE\[role\]/);
    expect(body).not.toMatch(/persona: crewMember\(d\.agent, d\.model, this\.currentRole/);
  });

  it('files triage under the dispatcher so Pip is credited for routing', () => {
    expect(read('server/src/sessions.ts')).toMatch(/triage: 'dispatcher'/);
  });

  it('puts a name on the routing turn', () => {
    // It was the only line in the thread with nobody's name on it, which is odd
    // for the decision that picks who does the work.
    expect(read('server/src/sessions.ts')).toMatch(/crew: crewMember\(t\.agent, t\.model, 'dispatcher'\)/);
  });
})

describe('the wake-up runs once, then stops', () => {
  it('never loops — opening the session is the event, not a timer', () => {
    // Everything else in this file forbids ambient motion. The wake-up is allowed
    // because it reports a real state change (you opened the session) and then
    // holds; an `infinite` here would turn it into exactly the decoration the
    // rest of the design refuses.
    const css = read('web/src/styles.css');
    const block = css.slice(css.indexOf('/* ---- The crew waking up'));
    const upToMedia = block.slice(0, block.indexOf('@media (prefers-reduced-motion'));
    expect(upToMedia).not.toMatch(/infinite/);
    // `both`/`forwards` is what makes it hold on the final frame instead of
    // snapping back to asleep.
    expect(upToMedia).toMatch(/animation: wake-rise[^;]*both/);
    expect(upToMedia).toMatch(/steps\(1, end\) both/);
  });

  it('cuts between frames rather than fading, like every other sprite', () => {
    const css = read('web/src/styles.css');
    const block = css.slice(css.indexOf('/* ---- The crew waking up'));
    expect(block).toMatch(/@keyframes wake-hide \{\s*0%, 54\.99% \{ opacity: 1; \}/);
  });

  it('does not scale pixel art on a non-integer factor', () => {
    // A scale-up during the rise would blur every frame of it.
    const css = read('web/src/styles.css');
    const rise = css.slice(css.indexOf('@keyframes wake-rise'), css.indexOf('@keyframes wake-rise') + 260);
    expect(rise).not.toMatch(/scale/);
  });

  it('degrades to eyes-open when a frame is missing, not to a broken image', () => {
    const c = read('web/src/ChatView.tsx');
    const block = c.slice(c.indexOf('function CrewWakeUp'), c.indexOf('function CrewWakeUp') + 2200);
    expect(block).toMatch(/onError=\{\(\) => gone\(`\$\{c\.sprite\}-sleep`\)\}/);
    expect(block).toMatch(/onError=\{\(\) => gone\(`\$\{c\.sprite\}-blink`\)\}/);
  });

  it('shows each character once, so a roll-call never repeats a face', () => {
    // Two models can share a persona; de-duplicating by model would show the
    // same face twice and read as a bug.
    expect(read('server/src/sessions.ts')).toMatch(/seen\.has\(c\.name\)/);
  });
})
