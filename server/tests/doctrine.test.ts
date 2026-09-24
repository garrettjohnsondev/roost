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
    // The full built-in roster now has drawn sets (12 crew + Pip the
    // dispatcher), finished 2026-09-23. The fallback path stays in code
    // regardless -- a user's custom persona (crew.json override) can still
    // lack a sprite, and the CrewAvatar stand-in must never claim art that
    // does not exist for one.
    const c = read('web/src/ChatView.tsx');
    expect(c).toMatch(/if \(!crew\.sprite \|\| failed\) return <CrewAvatar crew=\{crew\} size=\{size\} \/>/);
    const crew = read('server/src/crew.ts');
    const rows = crew.match(/\{ match: '[^']*'.*?\},/g) ?? [];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).toMatch(/sprite: '/);
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

describe('motion reports state — including the one case that repeats', () => {
  const block = (name: string) => {
    const css = read('web/src/styles.css');
    const i = css.indexOf(name);
    return css.slice(i, css.indexOf('@keyframes', i + name.length + 40));
  };

  it('celebrates once and stops, like a person', () => {
    expect(block('.crew-sprite.pose-cheer')).toMatch(/both/);
    expect(block('.crew-sprite.pose-cheer')).not.toMatch(/infinite/);
  });

  it('stamps the badge, never the sprite beside it', () => {
    // Scaling pixel art on a non-integer factor blurs it, even for 300ms — so
    // the stamp scales the TEXT badge and leaves the crew member alone.
    const css = read('web/src/styles.css');
    expect(css).toMatch(/\.verify-msg\.pass\.fresh \.verify-badge \{ animation: stamp-land/);
    expect(css).not.toMatch(/\.verify-msg\.pass \.crew-sprite \{ animation/);
  });

  it('only celebrates a gate that actually passed', () => {
    // A failed gate getting a cheer would undo the reason for having a gate.
    const c = read('web/src/ChatView.tsx');
    expect(c).toMatch(/\{r\.passed && crew\?\.sprite && \(/);
  });

  it('lets exactly one pose repeat, because its state persists', () => {
    // An approval waits until you answer, so the motion waits with it. This is
    // the rule applied, not an exception: every other animation in the app ends
    // because the thing it reports ends.
    const css = read('web/src/styles.css');
    const repeating = [...css.matchAll(/\.crew-sprite\.pose-([a-z]+) \{ animation:[^}]*infinite/g)].map((m) => m[1]);
    expect(repeating).toEqual(['peek']);
  });

  it('holds every new pose still under reduced motion', () => {
    // Every reduced-motion block, not just the last: reading only the final one
    // broke the moment a later feature added its own.
    const css = read('web/src/styles.css');
    const rm = css.split('@media (prefers-reduced-motion').slice(1).map((b) => b.slice(0, 600)).join('\n');
    for (const sel of ['pose-cheer', 'pose-peek', 'verify-badge', 'fuel-block.spent', 'expiry-block.expiring', 'tool-detail.typing']) {
      expect(rm, sel).toContain(sel);
    }
  });
})

describe('the only things that repeat are states that persist', () => {
  it('names every infinite animation, and each one has a cause that ends', () => {
    // Waiting approval (peek) ends when you answer. Expiring surplus ends at the
    // reset or when you take the boost. Typing and thinking end when the reply
    // or the reasoning does. Loading spinners end when the load does. Anything
    // else looping is decoration, and this list is where it would have to be
    // justified.
    const css = read('web/src/styles.css');
    const looping = [...css.matchAll(/\n([^\n{}]+)\{[^}]*\binfinite\b/g)].map((m) => m[1].trim());
    // typing-dots: shown only while a session's state is `working`, so it ends when the turn does.
    const sanctioned = [/pose-peek/, /expiry-block\.expiring/, /frame-[ab]/, /typing-dots/, /spin|pulse|working|loading/];
    const unsanctioned = looping.filter((sel) => !sanctioned.some((re) => re.test(sel)));
    expect(unsanctioned, `looping without a stated cause: ${unsanctioned.join(', ')}`).toEqual([]);
  });

  it('never flares fuel on a first sighting or a reset', () => {
    // Pinned in the web workspace's motion.test.ts; restated here as doctrine so
    // the rule sits beside the others it shares a reason with.
    const m = read('web/src/motion.ts');
    expect(m).toMatch(/prev == null \|\| !Number\.isFinite\(prev\) \|\| prev > now \? usedN/);
  });

  it('never greys out a character because the meter is offline', () => {
    expect(read('web/src/motion.ts')).toMatch(/if \(percent == null \|\| !Number\.isFinite\(percent\)\) return 0;/);
  });
})

describe('replayed history does not perform', () => {
  it('knows where history ends from the replay itself, not from a clock', () => {
    // The phone's clock and the Mac's need not agree closely enough for a time
    // window to separate "just happened" from "happened before you opened this".
    const s = read('web/src/useSession.ts');
    expect(s).toMatch(/replayedCount: items\.length/);
    expect(read('web/src/ChatView.tsx')).toMatch(/fresh=\{i >= session\.replayedCount\}/);
  });

  it('gates every one-shot on freshness', () => {
    const css = read('web/src/styles.css');
    expect(css).toMatch(/\.verify-msg\.fresh \.crew-sprite\.pose-cheer \{ animation/);
    expect(css).toMatch(/\.verify-msg\.pass\.fresh \.verify-badge \{ animation/);
    expect(css).toMatch(/\.tool-detail\.typing \{ animation/);
    // …and none of them fire on the un-gated selector.
    expect(css).not.toMatch(/\n\.crew-sprite\.pose-cheer \{ animation/);
    expect(css).not.toMatch(/\n\.verify-msg\.pass \.verify-badge \{ animation/);
  });
})

describe('the roadmap does not flatter itself', () => {
  it('carries a status line written by the suites, not by hand', () => {
    // It drifted four times in one session — the last time by 47 tests. The
    // marker is what a hand edit removes, so its absence is the tell.
    const r = read('ROADMAP.md');
    expect(r).toMatch(/\*\*\d+ (tests green|passing, \d+ FAILING)[^*]*\*\* <!-- written by scripts\/roadmap-stats\.mjs on \d{4}-\d{2}-\d{2}/);
  });

  it('refuses to print "green" when anything failed', () => {
    const s = read('scripts/roadmap-stats.mjs');
    expect(s).toMatch(/failed === 0 \? `\*\*\$\{passed\} tests green` : `\*\*\$\{passed\} passing, \$\{failed\} FAILING`/);
    expect(s).toMatch(/process\.exit\(failed === 0 && tc \? 0 : 1\)/);
  });
})

describe('one drawing on screen at a time', () => {
  // The frames are transparent PNGs, so an upper frame does not hide a lower one.
  // The first version kept idle drawn under the typing frame (a typing owl with
  // four wings) and stacked sleep over blink over idle in the wake-up (a
  // sleeping owl with a standing owl's ears behind it). It shipped because it
  // was checked by reasoning; it was caught by rendering. These pin the rule.
  it('alternates a two-frame pose in exact antiphase', () => {
    const css = read('web/src/styles.css');
    expect(css).toMatch(/@keyframes sprite-cut \{\s*0%, 49\.99% \{ opacity: 0; \}\s*50%, 100% \{ opacity: 1; \}/);
    expect(css).toMatch(/@keyframes sprite-cut-a \{\s*0%, 49\.99% \{ opacity: 1; \}\s*50%, 100% \{ opacity: 0; \}/);
    expect(css).toMatch(/\.crew-sprite \.frame-a \{\s*animation: sprite-cut-a/);
  });

  it('draws only the pose itself when a pose is held', () => {
    const c = read('web/src/ChatView.tsx');
    const s = c.slice(c.indexOf('export function SpriteAvatar('), c.indexOf('export function SpriteAvatar(') + 1600);
    // held branch renders exactly one <img>, with no idle frame beneath it
    const held = s.slice(s.indexOf(') : ('), s.indexOf(')}', s.indexOf(') : (')));
    expect((held.match(/<img/g) ?? []).length).toBe(1);
    expect(held).not.toMatch(/-idle\.webp/);
  });

  it('gives each wake-up frame its own window and hides it outside', () => {
    const css = read('web/src/styles.css');
    expect(css).toMatch(/@keyframes wake-hide \{\s*0%, 54\.99% \{ opacity: 1; \}\s*55%, 100% \{ opacity: 0; \}/);
    expect(css).toMatch(/@keyframes wake-blink-window \{\s*0%, 54\.99% \{ opacity: 0; \}\s*55%, 74\.99% \{ opacity: 1; \}\s*75%, 100% \{ opacity: 0; \}/);
    expect(css).toMatch(/@keyframes wake-show-late \{\s*0%, 74\.99% \{ opacity: 0; \}\s*75%, 100% \{ opacity: 1; \}/);
    expect(css).toMatch(/\.crew-wake-frames \.wake-idle \{ animation: wake-show-late/);
  });
})

describe('chapters change what you see, never what the agents remember', () => {
  it('derives chapters on the client, from the items alone', () => {
    // The board: "this only changes what you see, never what the agents
    // remember." So nothing about chapters may reach the server or the engines.
    const ch = read('web/src/chapters.ts');
    expect(ch).not.toMatch(/fetch\(|send\(|WebSocket/);
    for (const f of ['server/src/sessions.ts', 'server/src/protocol.ts']) {
      expect(read(f), f).not.toMatch(/chapter/i);
    }
  });

  it('folds a job that closed live only after the celebration has been seen', () => {
    const css = read('web/src/styles.css');
    expect(css).toMatch(/\.chapter\.folded\.folding \.chapter-body \{ animation: chapter-fold 700ms [^;]* 1\.8s both; \}/);
    // and replayed history arrives already folded — no performance
    expect(read('web/src/ChatView.tsx')).toMatch(/foldingNow=\{ch\.status === 'verified' && ch\.end - 1 >= session\.replayedCount\}/);
  });

  it('folds with a grid track, never a pixel height a font can outgrow', () => {
    const css = read('web/src/styles.css');
    expect(css).toMatch(/@keyframes chapter-fold \{ from \{ grid-template-rows: 1fr; \} to \{ grid-template-rows: 0fr; \} \}/);
  });
})

describe('"stop asking" says what it actually stops', () => {
  // User-reported 2026-09-23: "accept all" kept prompting in "different
  // situations." Root cause was the remember-choice button being scoped to
  // one tool but labelled like a session-wide promise. Fixed two ways: the
  // per-tool button's label now says "this tool" rather than "this session",
  // and a real, separately-labelled full-auto switch sits next to it.
  const chat = read('web/src/ChatView.tsx');

  it('never re-labels the per-tool remember-choice as session-wide', () => {
    expect(chat).not.toMatch(/Allow and stop asking this session/);
    expect(chat).toMatch(/Allow — and stop asking for this tool/);
  });

  it('offers a real full-auto switch as its own explicit action, not a side effect', () => {
    expect(chat).toMatch(/Turn on full auto for this session/);
    // It must resolve the pending request AND flip the session mode --
    // set_approvals alone does not retroactively resolve an in-flight ask.
    expect(chat).toMatch(/decision: 'allow' \}\);\s*\n\s*session\.send\(\{ type: 'set_approvals', approvals: 'full-auto' \}\);/);
  });

  it('keeps full auto visible for as long as it is on, never a fire-and-forget toggle', () => {
    expect(chat).toMatch(/session\.meta\?\.approvals === 'full-auto'/);
    expect(chat).toMatch(/Full auto — no approvals this session/);
    // Off switch present, and it does not reuse boost's "good news" green.
    expect(chat).toMatch(/set_approvals', approvals: 'ask' \}/);
    const css = read('web/src/styles.css');
    expect(css).toMatch(/\.surplus-bar\.on\.full-auto-bar/);
  });

  it('stays one line, never the two-line-plus-button stack that was reported', () => {
    // User-reported 2026-09-23: the banner alone was eating a fifth of the
    // screen on every turn.
    const css = read('web/src/styles.css');
    expect(css).toMatch(/\.full-auto-text \{[^}]*white-space: nowrap/);
    expect(css).toMatch(/\.surplus-bar\.on\.full-auto-bar \{[^}]*flex-wrap: nowrap/);
  });
})

describe('verify is not hero space', () => {
  // User-reported 2026-09-23: "Run gates" / "Gates + review diff" sat as a
  // permanent two-chip bar directly under the header of EVERY session,
  // ahead of the thread itself, whether or not there was anything to
  // verify. Moved into the git sheet, next to the diff it checks.
  it('renders no permanent verify bar above the thread', () => {
    const chat = read('web/src/ChatView.tsx');
    expect(chat).not.toMatch(/verify-bar/);
  });

  it('the git sheet carries verify, but only when a live session can act on it', () => {
    const git = read('web/src/GitSheet.tsx');
    expect(git).toMatch(/onVerify\?: \(review: boolean\) => void/);
    expect(git).toMatch(/\{onVerify && \(/);
    // The home screen's git peek (no attached session) must not render a
    // verify row wired to a dead action.
    const sessionList = read('web/src/SessionList.tsx');
    expect(sessionList).toMatch(/<GitSheet cwd=\{gitSheetFor\} onClose=\{\(\) => setGitSheetFor\(null\)\} \/>/);
  });
})

describe('someone is always visibly on the job', () => {
  // User-reported 2026-09-23: tapping send in auto mode gave no sign of life
  // while Pip triaged; the routed line said "sent this to haiku" instead of
  // naming Moss; and the working state was "working…" text flashing on a pulse.
  const chat = read('web/src/ChatView.tsx');
  const hook = read('web/src/useSession.ts');
  const sessions = read('server/src/sessions.ts');

  it('puts Pip on screen from the tap itself, not from the server', () => {
    // Set synchronously in send(), only for a message that actually went out.
    expect(hook).toMatch(/if \(sent && msg\.type === 'user_message' && core\.meta\?\.mode === 'auto'\) setTriaging\(true\)/);
    // And the indicator renders on that local flag alone -- waiting for
    // status 'working' would be the round trip that was the reported delay.
    expect(chat).toMatch(/\(session\.triaging \|\| session\.status === 'working'\) && !session\.closedReason/);
  });

  it('says the same words locally as the server does, so nothing jumps when it lands', () => {
    const local = chat.match(/session\.triaging \? '([^']+)' : session\.statusMessage/)?.[1];
    const server = sessions.match(/message: '(Pip is picking[^']+)'/)?.[1];
    expect(local).toBeTruthy();
    expect(local).toBe(server);
  });

  it('announces triage before the triage call, not after it', () => {
    const body = sessions.slice(sessions.indexOf('private async routeFor('));
    const announce = body.indexOf("crew: crewMember(this.agent, this.model, 'dispatcher')");
    expect(announce).toBeGreaterThan(-1);
    expect(announce).toBeLessThan(body.indexOf('await triage('));
    expect(announce).toBeLessThan(body.indexOf('shouldRetriage('));
  });

  it('knows Pip exactly as the server does', () => {
    const crew = read('server/src/crew.ts');
    const server = crew.slice(crew.indexOf('export const DISPATCHER'), crew.indexOf('};', crew.indexOf('export const DISPATCHER')));
    const client = chat.slice(chat.indexOf('export const PIP'), chat.indexOf('};', chat.indexOf('export const PIP')));
    for (const field of ['name', 'color', 'avatar', 'sprite']) {
      const s = server.match(new RegExp(`${field}: '([^']+)'`))?.[1];
      expect(s, field).toBeTruthy();
      expect(client, field).toContain(`${field}: '${s}'`);
    }
  });

  it('names the worker on the routed turn, not the model id', () => {
    expect(sessions).toMatch(/worker: crewMember\(this\.agent, target\.model, this\.currentRole\)/);
    expect(chat).toMatch(/<strong style=\{\{ color: nameColor\(item\.worker\.color\) \}\}>\{item\.worker\.name\}<\/strong>/);
  });

  it('draws the worker working, with no pulsing "working…" text', () => {
    expect(chat).not.toMatch(/'working…'/);
    const ind = chat.slice(chat.indexOf('function WorkingIndicator('), chat.indexOf('function WorkingIndicator(') + 1400);
    expect(ind).toMatch(/<SpriteAvatar crew=\{crew\} pose=\{pose\}/);
    // Motion is real state: typing only while a reply streams or a tool runs.
    expect(ind).toMatch(/const pose: Pose = !session\.triaging && producing \? 'type' : 'think'/);
    const css = read('web/src/styles.css');
    const block = css.slice(css.indexOf('.working-indicator {'), css.indexOf('}', css.indexOf('.working-indicator {')));
    expect(block).not.toMatch(/animation/);
  });

  it('lays the home crew out in rows a phone can read', () => {
    const css = read('web/src/styles.css');
    expect(css).toMatch(/\.crew-strip-faces \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  });
})

describe('a resumed chat\'s history is opened on purpose, never scrolled into by accident', () => {
  // User-reported 2026-09-23: landed mid-scroll inside a resumed session's
  // recap -- a wall of old diffs with the "Picking up from before" header
  // already off screen -- and could not tell it from live work.
  it('starts collapsed, so the wall of old diffs is never the default view', () => {
    const chat = read('web/src/ChatView.tsx');
    expect(chat).toMatch(/const \[recapOpen, setRecapOpen\] = useState\(false\)/);
    expect(chat).toMatch(/\{recapOpen && \(/);
  });
})

describe('a message you sent is never silently dropped', () => {
  // Recovered 2026-09-24: "Don't stop your initial plan, these are additions"
  // was sent while a plan was being built. Pip triaged it -- it survives in the
  // triage prompt -- and it reached nobody. Every path a user_message can take
  // now ends visibly: delivered, held with a notice, or an error naming it.
  const s = read('server/src/sessions.ts');
  const body = s.slice(s.indexOf("case 'user_message': {"), s.indexOf("case 'approval_response'"));

  it('joins the build in flight instead of starting a second conference', () => {
    expect(body).toMatch(/if \(this\.proceeding\) \{[\s\S]{0,400}?await this\.deliver\(msg\.text, msg\.images\);\s*break;/);
    // ...and it is checked BEFORE the plan/build branch, or it would never be reached there.
    expect(body.indexOf('if (this.proceeding)')).toBeLessThan(body.indexOf("this.mode === 'plan' || this.mode === 'build'"));
    expect(s).toMatch(/this\.proceeding = true;/);
    expect(s).toMatch(/if \(event\.type === 'status' && event\.state === 'idle'\) this\.proceeding = false;/);
  });

  it('holds a message sent mid-plan, echoes it, and folds it into Proceed', () => {
    expect(body).toMatch(/if \(this\.consultRunning\) \{\s*this\.hold\(msg\.text, msg\.images\);/);
    const hold = s.slice(s.indexOf('private hold('));
    expect(hold).toMatch(/this\.pushEvent\(\{ type: 'user_message', text, imageCount/);
    expect(s).toMatch(/this\.pendingConsult\.task \+= `\\n\\nAdditions sent while planning:/);
  });

  it('lets routing fail without taking the message with it', () => {
    expect(body).toMatch(/try \{\s*triaged = await this\.routeFor\(msg\.text\);\s*\} catch/);
    // and no bare routeFor left outside the try on this path
    expect(body.match(/await this\.routeFor\(/g)?.length).toBe(1);
  });

  it('names an undelivered message as undelivered at the socket', () => {
    expect(read('server/src/index.ts')).toMatch(/Your message was not delivered \(\$\{why\}\)\. It is not in the conversation/);
  });
})

describe('the job tracker reports the thread and lights up, it does not perform', () => {
  // Asked for 2026-09-24 in the message that got dropped: "a progress bar with
  // the work and/or phases. Think Domino's pizza tracker."
  it('is derived on the client from the items alone, like chapters', () => {
    const t = read('web/src/tracker.ts');
    expect(t).toMatch(/import \{ chaptersOf/);
    expect(t).not.toMatch(/fetch\(|send\(|WebSocket|setTimeout|setInterval|Date\.now/);
    for (const f of ['server/src/sessions.ts', 'server/src/protocol.ts']) expect(read(f), f).not.toMatch(/tracker/i);
  });

  it('never estimates: a step is done only on evidence in the thread', () => {
    const t = read('web/src/tracker.ts');
    expect(t).toMatch(/state: evidence\[key\] \? 'done' : 'todo'/);
    expect(t).not.toMatch(/percent|progress:|\d+%/);
  });

  it('lights the active step; the sprite is the motion', () => {
    const css = read('web/src/styles.css');
    const block = css.slice(css.indexOf('/* ---------- job tracker'), css.indexOf('/* ---------- auto-route chip'));
    expect(block).not.toMatch(/animation/);
    expect(block).toMatch(/\.tracker-step\.active \.tracker-dot/);
  });
})

describe('the thread follows the work only while you are at the bottom', () => {
  // Recovered 2026-09-24: "I can't scroll up and read anything because it
  // jumps me down when there's something new."
  const c = read('web/src/ChatView.tsx');
  it('auto-scrolls only when pinned, and counts what arrives otherwise', () => {
    expect(c).toMatch(/if \(pinned\.current\) \{\s*el\.scrollTop = el\.scrollHeight;/);
    expect(c).toMatch(/const atBottom = el\.scrollHeight - el\.scrollTop - el\.clientHeight < 80;/);
    expect(c).toMatch(/\{unseen > 0 && \(\s*<button className="new-below" onClick=\{jumpDown\}>/);
  });
  it('pinned is a ref, so a scroll tick never re-renders the thread', () => {
    expect(c).toMatch(/const pinned = useRef\(true\);/);
  });
})

describe('the crew bubble is a stable wink, not a loop', () => {
  // User asked for the home crew to feel more alive -- "Zzz" for asleep, "fun
  // little things" for idle. Implemented as a pure function of name and pose,
  // never a timer, so it never joins the small, justified set of things in
  // this app that move on their own schedule.
  const sl = read('web/src/SessionList.tsx');

  it('is literal for sleep and a fixed per-name pick for idle, never Math.random', () => {
    expect(sl).toMatch(/if \(pose === 'sleep'\) return SLEEP_BUBBLE/);
    expect(sl).not.toMatch(/Math\.random/);
    expect(sl).toMatch(/return IDLE_BUBBLES\[h % IDLE_BUBBLES\.length\]/);
  });

  it('says nothing while working -- the typing sprite already reports that', () => {
    expect(sl).toMatch(/if \(pose !== 'idle'\) return null/);
  });
})

describe('every Claude session carries Roost’s sign-in', () => {
  it('starts Claude only through authedQuery', () => {
    // A direct SDK `query(` would quietly use the Mac's shared login instead of
    // Roost's own token — the exact dependency that left the phone stranded.
    const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
      const p = `${d}/${f}`; return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
    const offenders = walk(`${root}server/src`)
      .filter((f) => !f.endsWith('claudeAuth.ts'))
      .filter((f) => /(^|[^A-Za-z])query\(\{/.test(readFileSync(f, 'utf8').replace(/authedQuery\(\{/g, '')));
    expect(offenders.map((f) => f.replace(root, ''))).toEqual([]);
  });

  it('never hands the token back to the phone', () => {
    // Status reports WHICH sign-in is used, never the token itself.
    const a = read('server/src/claudeAuth.ts');
    const status = a.slice(a.indexOf('export async function authStatus'), a.indexOf('// ---- reading the CLI screen'));
    // The only use is a boolean: whether a token exists.
    expect(status.match(/loadToken\(/g) ?? []).toHaveLength(1);
    expect(status).toMatch(/const token = !!loadToken\(\)/);
  });
})
