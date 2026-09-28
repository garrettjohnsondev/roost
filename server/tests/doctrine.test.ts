import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
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
    expect(c).toMatch(/pose=\{item\.complete \? \(asking \? 'peek' : 'idle'\) : 'type'\}/);
    // No timer drives a pose in the sprite itself. (A whole-file ban stopped
    // being true on 2026-09-27: the crew line's wake-up hands over to the
    // living idle once, by a timeout -- see "the crew, alive".)
    const sprite = c.slice(c.indexOf('export function SpriteAvatar'), c.indexOf('const CONFETTI_COLOURS'));
    expect(sprite).not.toMatch(/setInterval|setTimeout/);
    // Alive is only ever the idle pose, and only where a caller asked for it.
    expect(c).toMatch(/if \(alive && pose === 'idle'\) return <AliveSprite/);
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
    const block = c.slice(c.indexOf('function CrewWakeUp'), c.indexOf('function CrewWakeUp') + 3400);
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

  it('stamps the badge, never the sprite beside it -- on both a pass and a fail', () => {
    // Scaling pixel art on a non-integer factor blurs it, even for 300ms — so
    // the stamp scales the TEXT badge and leaves the crew member alone. The
    // red stamp on failure (item 01) shares the same rule, not a new one.
    const css = read('web/src/styles.css');
    expect(css).toMatch(/\.verify-msg\.pass\.fresh \.verify-badge,\s*\.verify-msg\.fail\.fresh \.verify-badge \{ animation: stamp-land/);
    expect(css).not.toMatch(/\.verify-msg\.pass \.crew-sprite \{ animation/);
  });

  it('only celebrates a gate that actually passed -- the WHOLE job\'s crew, not just whoever is live', () => {
    // A failed gate getting a cheer would undo the reason for having a gate.
    // Item 08: every member of the chapter cheers, not only the live one.
    const c = read('web/src/ChatView.tsx');
    expect(c).toMatch(/const cheerers = r\.passed \? \(chapterCrew\?\.length \? chapterCrew : crew \? \[crew\] : \[\]\) : \[\];/);
    expect(c).toMatch(/\{cheerers\.filter\(\(c\) => c\.sprite\)\.map\(\(c\) => \(/);
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
    // .amb-*: the scene's set (stars, fire, lamps, steam, snow, a robot's eye).
    // Its cause is the scene being on screen -- it ends when the home screen is
    // left or the set changes on the hour -- and it is the SET, never the crew,
    // who still only move for real state. Asked for, 2026-09-24: "each scene
    // needs something animated". Off under reduced motion.
    // .tool-caret: the command-typing caret (item 05), rendered only while
    // !item.done and removed from the DOM the instant it flips -- so the loop
    // itself is not the gate, the element's presence is.
    // .four .f0-3: the four drawings of a working pose (item 38) -- they loop
    // only while the engine is actually typing or thinking, like frame-a/b.
    // .crew-sprite.alive: the crew, alive (2026-09-27, the owner's call: "motion
    // reports state" kept the crew frozen and the app felt still). Breathing,
    // blinking and a glance, only on crew standing around -- the home screen and
    // a chat's crew line -- never on a message in the thread. Its cause is the
    // crew being on screen; off under reduced motion.
    // .seat / .crew-strip-member.sleep: the same breathing on the scene's seated
    // crew and the sleepers in the bunks (no blink is drawn for those poses).
    // .snake-* / .game-* / .arcade-*: the arcade (#55). A game is play, not a
    // report of the crew's state; its loops end when you leave the game.
    // .rocket-ready: changes passed but not live; ends when they are deployed.
    // .aura-*: a worn aura (games wave 1) -- the owner chose it in the locker;
    // its cause is them wearing it, and it ends when they take it off.
    // .crate-* / .locker-*: the crate opening and shop, on screen only there.
    const sanctioned = [/^\.aura/, /crate|locker|hub-/, /rocket-ready/, /^\.(snake|game-|arcade)/, /crew-sprite\.alive/, /^\.seat:not\(\.working\)$/, /crew-strip-member\.sleep/, /pose-peek/, /expiry-block\.expiring/, /frame-[ab]/, /\.four \.f[0-3]$/, /typing-dots/, /spin|pulse|working|loading/, /^\.amb-/, /tool-caret/];
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
    expect(read('web/src/ChatView.tsx')).toMatch(/fresh=\{seg\.index >= session\.replayedCount\}/);
  });

  it('gates every one-shot on freshness', () => {
    const css = read('web/src/styles.css');
    expect(css).toMatch(/\.verify-msg\.fresh \.crew-sprite\.pose-cheer \{ animation/);
    expect(css).toMatch(/\.verify-msg\.pass\.fresh \.verify-badge,\s*\.verify-msg\.fail\.fresh \.verify-badge \{ animation/);
    expect(css).toMatch(/\.tool-detail\.typing \{ animation/);
    // …and none of them fire on the un-gated selector.
    expect(css).not.toMatch(/\n\.crew-sprite\.pose-cheer \{ animation/);
    expect(css).not.toMatch(/\n\.verify-msg\.pass \.verify-badge \{ animation/);
    // The three new one-shots (07's ring, 08's confetti) also gate on a
    // real arrival: the ring on requestId, confetti on a fresh pass.
    const c = read('web/src/ChatView.tsx');
    // The approval waiting on you pulses in the thread until answered (the
    // pop-up and its ring are gone, 2026-09-25); an answered one is still.
    expect(c).toMatch(/className=\{`msg assistant approval-ask\$\{waiting \? ' ask-pulse' : ''\}`\}/);
    expect(c).toMatch(/\{r\.passed && fresh && <Confetti variant=\{celebrant\} \/>\}/);
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
    const s = c.slice(c.indexOf('function SpriteAvatarBase('), c.indexOf('function SpriteAvatarBase(') + 3200);
    // held branch renders exactly one <img>, with no idle frame beneath it
    // (the four-frame working branch returns earlier, item 38)
    const at = s.lastIndexOf(') : (');
    const held = s.slice(at, s.indexOf(')}', at));
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
    expect(css).toMatch(/\.chapter\.folded\.folding \.chapter-body \{ animation: chapter-fold 700ms [^;]* 5s both; \}/); // held 5s: at 1.8s the fold swallowed the celebration (2026-09-27 audit)
    // and replayed history arrives already folded — no performance
    expect(read('web/src/ChatView.tsx')).toMatch(/foldingNow=\{ch\.status === 'verified' && bodyEnd - 1 >= session\.replayedCount\}/);
    // the crew's last word outlives the fold, shown only once the fold is done
    // shown only once the fold has finished -- never a blank placeholder (2026-09-28)
    expect(read('web/src/ChatView.tsx')).toMatch(/\{folded && lastWord && \(!foldingNow \|\| foldDone \|\| choice !== null\) && <div className="chapter-last-word">/);
    expect(read('scripts/service.mjs')).toMatch(/const QUIET_READINGS = 5;/);
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
    // 2026-09-25: the approval is a text in the thread now; its lasting
    // answer names the one kind of thing it stops asking about.
    expect(chat).not.toMatch(/stop asking this session/i);
    expect(chat).toMatch(/Yes, and don't ask again for \{w\?\.kind \?\? 'this'\}/);
    expect(chat).toMatch(/send\(item\.requestId, 'allow-session'\)/);
  });

  it('offers a real full-auto switch as its own explicit action, not a side effect', () => {
    // It moved out of the approval ("confusing in how they were written and
    // displayed and didn't even look like buttons") into the session settings,
    // where it is one of the approval choices, chosen on purpose.
    expect(chat).toMatch(/onClick=\{\(\) => session\.send\(\{ type: 'set_approvals', approvals: value \}\)\}/);
    const a = chat.slice(chat.indexOf('function ApprovalText('), chat.indexOf('const ApprovalContext'));
    expect(a).not.toMatch(/full-auto/);
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
    expect(s).toMatch(/const turnEnded = event\.type === 'status' && event\.state === 'idle' && !this\.inNotice && !this\.crossBuild;\s*if \(turnEnded\) this\.proceeding = false;/);
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

  it('never estimates: phases come from what the crew did, in order', () => {
    // Rebuilt 2026-09-25: "do we really Plan every piece of work?" -- no. Plan
    // and Review appear only when the conference actually ran; the old tracker
    // listed them whenever the mode was Build and lit Plan behind a finished
    // build. A phase is reached only on evidence: a tool call, a consult, a
    // verify. "How much is left" is the phases ahead, never minutes.
    const t = read('web/src/tracker.ts');
    expect(t).toMatch(/k === 'plan' \|\| k === 'review' \? conference/);
    expect(t).toMatch(/const conference = reached\.has\('plan'\) \|\| reached\.has\('review'\);/);
    expect(t).not.toMatch(/percent|progress:|\d+%|\beta\b|remaining/i);
  });

  it('green is earned: only a passing check makes Done green', () => {
    const t = read('web/src/tracker.ts');
    expect(t).toMatch(/\} else if \(passed && ch\.status === 'verified'\) \{/);
    expect(t).toMatch(/step\('done'\)!\.state = 'awaiting';/);
  });

  it('moves only on a real change: one-shots keyed by state, a stamp only when the job just finished', () => {
    const c = read('web/src/ChatView.tsx');
    expect(c).toMatch(/key=\{`\$\{st\.key\}:\$\{st\.state\}`\}/);
    expect(c).toMatch(/const landing = justFinished && \(t\.outcome === 'verified' \|\| t\.outcome === 'failed'\);/);
    const css = read('web/src/styles.css');
    const block = css.slice(css.indexOf('/* ---------- job tracker'), css.indexOf('/* ---------- tool runs'));
    // The layout block itself does not move; the motion is its own section,
    // and every piece of it stops under reduced motion.
    expect(block).not.toMatch(/animation/);
    const motion = css.slice(css.indexOf('/* ---------- tracker motion'));
    expect(motion).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.tracker-stamp\.land[\s\S]*animation: none !important/);
    // The only loop is the phase in progress -- a persistent state, named so.
    expect(motion).toMatch(/\.stop\.active\.working \.stop-mark::after/);
    // They walk only when the phase changes, and stop by the walk's own end.
    expect(c).toMatch(/onTransitionEnd=\{\(e\) => \{ if \(e\.propertyName === 'left'\) setWalk\(null\); \}\}/);
  });
})

describe('a question is a text, never a permission', () => {
  // 2026-09-25: Claude's AskUserQuestion reached the phone as "Claude wants to
  // use AskUserQuestion" with raw JSON. Allowing it ran the tool with no
  // answers; the question was never seen. It is asked in the thread now.
  const claude = read('server/src/agents/claude.ts');
  it('is intercepted before any approval logic, in every mode', () => {
    const c = claude.slice(claude.indexOf('canUseTool:'));
    expect(c.indexOf("if (toolName === 'AskUserQuestion')")).toBeLessThan(c.indexOf('this.sessionAllowedTools.has(toolName)'));
    expect(c).toMatch(/return \{ behavior: 'allow', updatedInput: \{ \.\.\.toolInput, answers \} \};/);
  });
  it('whatever you text back while a question waits is the answer', () => {
    const s = read('server/src/sessions.ts');
    expect(s).toMatch(/if \(this\.pendingQuestion && msg\.text\?\.trim\(\)\) \{/);
  });
  it('the thread shows only what you typed; the level travels as a note behind it', () => {
    const s = read('server/src/sessions.ts');
    expect(s).toMatch(/await this\.adapter\.sendUserMessage\(note \? `\$\{text\}\\n\\n\$\{note\}` : text, images, note \? text : undefined\);/);
  });
  it('the question waiting on you pulses; it stops under reduced motion', () => {
    const css = read('web/src/styles.css');
    expect(css).toMatch(/\.msg\.assistant\.ask-pulse \{[^}]*animation: ask-pulse/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.msg\.assistant\.ask-pulse \{ animation: none; \} \}/);
  });
})

describe('a job that edited files is checked when it ends', () => {
  // 2026-09-25: the VERIFIED stamp never landed -- direct work never ran a
  // gate. The project's own checks now run after a turn that edited files.
  const b = read('server/src/sessions.ts');
  const m = b.slice(b.indexOf('private async autoCheck('), b.indexOf('private async autoVerify('));
  it('runs commands only -- never a model, so it costs no quota', () => {
    expect(m).toMatch(/verifyTask\(\{ cwd: this\.cwd, taskId: this\.id, fingerprintAtStart: this\.gateFingerprintAtStart, checks \}\)/);
    expect(m).not.toMatch(/review:/);
  });
  it('leaves a project with no check alone instead of stamping every edit "not verified"', () => {
    expect(m).toMatch(/if \(checks === null\) return;/);
  });
  it('never marks a newer turn idle', () => {
    expect(m).toMatch(/if \(seq === this\.turnSeq\) this\.pushEvent\(\{ type: 'status', state: 'idle'/);
  });
})

describe('the thread follows the work only while you are at the bottom', () => {
  // Recovered 2026-09-24: "I can't scroll up and read anything because it
  // jumps me down when there's something new."
  const c = read('web/src/ChatView.tsx');
  it('auto-scrolls only when pinned, and counts what arrives otherwise', () => {
    expect(c).toMatch(/if \(pinned\.current\) \{[\s\S]{0,260}el\.scrollTo\(\{ top: el\.scrollHeight, behavior: 'smooth' \}\)[\s\S]{0,260}else el\.scrollTop = el\.scrollHeight;/); // glides after the first placement (2026-09-28)
    // Our own glide can't unpin you, and sending re-pins (2026-09-28).
    expect(c).toMatch(/if \(!atBottom && Date\.now\(\) < glidingUntil\.current\) return;/);
    expect(c).toMatch(/pinned\.current = true;\s*if \(pendingQ && text\.trim\(\)\)/);
    expect(c).toMatch(/const atBottom = el\.scrollHeight - el\.scrollTop - el\.clientHeight < 80;/);
    expect(c).toMatch(/\{unseen > 0 && \(\s*<button className="new-below" onClick=\{jumpDown\}>/);
  });
  it('pinned is a ref, so a scroll tick never re-renders the thread', () => {
    expect(c).toMatch(/const pinned = useRef\(true\);/);
  });
})

describe('tool calls fold into words, and folding hides no state', () => {
  // Recovered 2026-09-24: "I don't care about bash and read and the actual
  // code... how we can just consolidate that."
  it('groups on the client, from the items alone', () => {
    const t = read('web/src/toolruns.ts');
    expect(t).not.toMatch(/fetch\(|send\(|WebSocket|setTimeout/);
    // The work stream (2026-09-25) supersedes one row per piece: a stretch of
    // work is ONE card, grouped by the same pure module.
    expect(read('web/src/ChatView.tsx')).toMatch(/workSegments\(session\.items, from, to, live\)\.map/);
    expect(read('web/src/ChatView.tsx')).toMatch(/const rows = segmentRows\(ch\.start, bodyEnd, liveTail\);/);
    expect(t).not.toMatch(/Date\.now/);
  });
  it('the work card hides nothing: the latest line, the call running now, and the whole timeline on a tap', () => {
    const c = read('web/src/ChatView.tsx');
    const w = c.slice(c.indexOf('function WorkStream('), c.indexOf('function ThinkingBlock('));
    expect(w).toMatch(/<Markdown text=\{latest\.text\} \/>/);
    expect(w).toMatch(/\{s\.running\.name\}/);
    expect(w).toMatch(/segmentsOf\(items, start, end\)\.map/);
    // Its sprite moves only for real state, like every other face.
    expect(w).toMatch(/const pose: Pose = live \?/);
  });
  it('names the call in progress on the folded line', () => {
    const c = read('web/src/ChatView.tsx');
    const run = c.slice(c.indexOf('function ToolRun('), c.indexOf('function ThinkingBlock('));
    expect(run).toMatch(/\{s\.running\.name\}/);
    expect(run).toMatch(/pose=\{s\.running \? 'type' : 'idle'\}/);
  });
})

describe('the conference announces itself', () => {
  // Recovered 2026-09-24: "I never saw the back and forth between Ollie and
  // Nell, I only saw the output." The turns existed and did not say what they
  // were: the phase label lived only in the no-crew fallback.
  it('labels a named planner or reviewer turn with its phase', () => {
    const c = read('web/src/ChatView.tsx');
    const block = c.slice(c.indexOf("case 'consult': {"), c.indexOf('if (item.crew) {', c.indexOf("case 'consult': {")));
    expect(block).toMatch(/<span className=\{`consult-phase \$\{item\.phase\}`\}>\{phaseLabel\}<\/span>/);
  });
})

describe('Proceed answers on the spot, and Stop is nowhere near Send', () => {
  // The last two from the dropped message of 2026-09-24.
  const c = read('web/src/ChatView.tsx');
  const s = read('server/src/sessions.ts');

  it('broadcasts the cleared bar BEFORE the triage round trip', () => {
    const block = s.slice(s.indexOf("case 'consult_proceed': {"), s.indexOf("case 'verify': {"));
    expect(block.indexOf('this.broadcastMeta();')).toBeGreaterThan(-1);
    expect(block.indexOf('this.broadcastMeta();')).toBeLessThan(block.indexOf('await this.routeFor(consult.task)'));
    expect(block).toMatch(/try \{\s*await this\.routeFor\(consult\.task\);\s*\} catch/);
  });

  it('the button says Proceeding… and stops taking taps until the server confirms', () => {
    expect(c).toMatch(/\{proceeding \? 'Proceeding…' : '▶ Proceed'\}/);
    expect(c).toMatch(/if \(!session\.meta\?\.consultPending\) setProceeding\(false\);/);
  });

  it('drops the "new messages join the conversation" sentence', () => {
    expect(c).not.toMatch(/new messages join the conversation as it goes\s*</);
  });

  it('puts Stop first in the composer row, Send last', () => {
    const row = c.slice(c.indexOf('<div className="composer-row">'), c.indexOf('</div>', c.indexOf('<button className="primary send"')));
    expect(row.indexOf('className="stop-btn"')).toBeLessThan(row.indexOf('<textarea'));
    expect(row.indexOf('<textarea')).toBeLessThan(row.indexOf('className="primary send"'));
  });
})

describe('bugs from the phone, 2026-09-24', () => {
  const s = read('server/src/sessions.ts');

  it('an auto-compaction clears the offer it answers, on both paths', () => {
    const auto = s.slice(s.indexOf("intent.kind === 'auto'"), s.indexOf('this.transcript.push(event);'));
    expect(auto).toMatch(/this\.contextOffer = undefined;/);
    const run = s.slice(s.indexOf('private async runCompaction('), s.indexOf('private lastLine('));
    expect(run).toMatch(/await this\.adapter\.compact\(\);[\s\S]{0,200}this\.contextOffer = undefined;/);
  });

  it('the thread survives a restart: written as it happens, read back on restore, and the cut turn named', () => {
    expect(s).toMatch(/this\.transcriptWriter\.append\(event\);/);
    expect(s).toMatch(/this\.transcript = readTranscript\(this\.id, TRANSCRIPT_CAP\);/);
    expect(s).toMatch(/Roost restarted at \$\{at\} — the turn that was running was cut off/);
    // closing on purpose forgets the file; a sweep does too; a restart does not
    expect(s).toMatch(/session\.dispose\('Closed', \{ forget: true \}\)/);
    expect(s).toMatch(/of inactivity`, \{ forget: true \}\)/);
    const t = read('server/src/transcripts.ts');
    expect(t).toMatch(/if \(event\.type === 'assistant_delta' \|\| event\.type === 'thinking_delta'\) return;/);
    expect(t).toMatch(/\.unref\(\)/);
  });

  it("Pip's frames are preloaded, so his face lands with his line", () => {
    const html = read('web/index.html');
    expect(html).toMatch(/<link rel="preload" as="image" href="\/crew\/pip-idle\.webp" \/>/);
    expect(html).toMatch(/<link rel="preload" as="image" href="\/crew\/pip-think\.webp" \/>/);
  });

  it('the routed chip is not a pill, because it wraps', () => {
    const css = read('web/src/styles.css');
    const chip = css.slice(css.indexOf('.routed-chip {'), css.indexOf('.routed-chip strong'));
    expect(chip).not.toMatch(/border-radius: 999px/);
  });

  it('the avatar generator does not refuse over a colour the person never typed', () => {
    const a = read('server/src/avatars.ts');
    expect(a).not.toMatch(/throw new AvatarGenError\('color must be/);
    expect(a).toMatch(/if \(!SAFE_COLOR\.test\(color\)\) color = '#[0-9a-f]{6}';/);
    expect(read('web/src/AvatarPicker.tsx')).toMatch(/Codex is drawing it — \{elapsed\}s/);
  });
})

describe('the names are the interface: @-mentions and the handoff', () => {
  // 2026-09-24: "I'm already starting to learn their names and at one point
  // haiku was under-performing and I had the need to @Nell in the chat."
  const s = read('server/src/sessions.ts');
  const c = read('web/src/ChatView.tsx');

  it('a mention is checked before routing, and before the plan/build branch', () => {
    const body = s.slice(s.indexOf("case 'user_message': {"), s.indexOf("case 'approval_response'"));
    const at = body.indexOf('parseMention(msg.text');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(body.indexOf("this.mode === 'plan' || this.mode === 'build'"));
    expect(at).toBeLessThan(body.indexOf('await this.routeFor(msg.text)'));
  });

  it('same vendor switches the model for the turn; other vendor is a one-shot that lands as their turn', () => {
    const m = s.slice(s.indexOf('private async askByName('), s.indexOf('private async deliver('));
    expect(m).toMatch(/if \(suite === this\.agent && how === 'mention'\) \{[\s\S]*?await this\.adapter\.setModel\(model\);/);
    expect(m).toMatch(/runAgentTask\(\{\s*agent: suite, model, prompt, images, cwd: this\.cwd, capability: 'all', role: how, persona: name/);
    expect(m).toMatch(/this\.pushEvent\(\{ type: 'consult', phase: how === 'build' \? 'handoff' : how, agent: suite, crew: member/);
    // Images travel now (dispatch.ts); the "cannot see attached images"
    // notice that used to be pinned here would be a lie if it came back.
    expect(m).not.toMatch(/cannot see attached images yet/);
    expect(m).toMatch(/imageCount: images\?\.length \?\? 0/);
    // Stop stops it
    expect(s).toMatch(/this\.activeMention\?\.cancel\(\);/);
  });

  it('the handoff briefs from the plan file and the thread, and is offered where the meter degrades', () => {
    expect(s).toMatch(/composeHandoffPrompt\(name, from, context, this\.pendingConsult\?\.planPath \?\? this\.lastPlanPath\)/);
    // The Context board's ladder: compact asks at 60 (degrading), hand-off is
    // the 80% rung (critical) and asks on its own.
    expect(c).toMatch(/\{session\.context\.pressure === 'critical' && \(\(\) => \{/);
    expect(c).toMatch(/action: 'handoff', to: other\.name/);
    const h = read('server/src/mentions.ts');
    expect(h).toMatch(/check the repository state \(git status, recent diff\) before assuming anything in the summary above is done/);
  });

  it('the composer completes a name on "@", and settings say how to reach the other vendor', () => {
    expect(c).toMatch(/const atMatch = text\.match\(\/\(\^\|\\s\)@\(\[A-Za-z\]\*\)\$\/\);/);
    expect(c).toMatch(/className="mention-pop"/);
    expect(c).toMatch(/crew: ask them by name in the message box/);
  });
})

describe('the gauge is asked, not waited for', () => {
  // 2026-09-24: the Claude reading went dark for 31 hours -- it only arrived
  // from a live session's rate-limit events -- and every route in that time
  // said "no move on missing data". Not conservative; blind.
  it('refreshes usage on a schedule, unref’d, and once soon after boot', () => {
    const i = read('server/src/index.ts');
    expect(i).toMatch(/const usageTimer = setInterval\(\(\) => \{\s*void refreshUsage\(/);
    expect(i).toMatch(/usageTimer\.unref\(\);/);
    expect(i).toMatch(/setTimeout\(\(\) => void refreshUsage\([^)]*\)\.catch\(\(\) => \{\}\), 5_000\)\.unref\(\);/);
  });
})

describe('a session is named after its jobs', () => {
  const s = read('server/src/sessions.ts');
  it('the server and the board name a job with the same regexes', () => {
    const a = read('server/src/naming.ts');
    const b = read('web/src/chapters.ts');
    const pick = (src: string, name: string) => src.match(new RegExp(`const ${name} = (/.*/i);`))?.[1];
    expect(pick(a, 'PREAMBLE')).toBeTruthy();
    expect(pick(a, 'PREAMBLE')).toBe(pick(b, 'PREAMBLE'));
    expect(pick(a, 'VERB')).toBe(pick(b, 'VERB'));
    // Item 31: where a job ends is the same rule on both sides too.
    for (const name of ['CONTINUES', 'WEAK']) {
      expect(pick(a, name), name).toBeTruthy();
      expect(pick(a, name), name).toBe(pick(b, name));
    }
    const fn = (src: string) => src.slice(src.indexOf('export function startsNewJob'), src.indexOf('export function isWeakName'));
    expect(fn(a)).toBe(fn(b));
    expect(a.match(/const JOB_GAP_MS = .*;/)?.[0]).toBe(b.match(/const JOB_GAP_MS = .*;/)?.[0]);
  });
  it('the first sixty characters are no longer the title; chapters are, unless you typed one', () => {
    expect(s).not.toMatch(/this\.title = truncate\(msg\.text, 60\)/);
    expect(s).toMatch(/this\.jobsDone\.push\(this\.jobLabel\(\)\);/);
    // Item 31: the next task closes the job, verified or not.
    expect(s).toMatch(/this\.jobTurns > 0\s*&& startsNewJob\(event\.text, event\.ts - this\.lastEventTs\)/);
    expect(s).toMatch(/this\.title = title;\s*this\.titleAuto = false;/);
    expect(s).toMatch(/if \(!this\.titleAuto\) return;/);
  });
})

describe('the planner is told the fuel, and sizes the plan to it', () => {
  it('the note comes from the quota store and is absent when nothing is fresh', () => {
    const s = read('server/src/sessions.ts');
    const f = s.slice(s.indexOf('private fuelNote(): string {'), s.indexOf('private retitle(): void {'));
    expect(f).toMatch(/quotaStore\(\)\.headroom\(agent, this\.budget\)/);
    expect(f).toMatch(/if \(h\.state === 'unknown' \|\| h\.state === 'stale' \|\| h\.worstPercent == null\) continue;/);
    expect(s).toMatch(/composePlannerPrompt\(task, context, this\.fuelNote\(\)\)/);
  });
  it('asks for a Fit line, a first slice and a remainder -- only when there is fuel to size against', () => {
    const c = read('server/src/consult.ts');
    expect(c).toMatch(/fuel\s*\?\s*'## Fit — one line/);
    expect(c).toMatch(/"First slice"/);
    expect(c).toMatch(/"Remainder"/);
  });
})

describe('the fuel card closes again, and carries the day’s decisions', () => {
  it('has a Less button when opened from the summary', () => {
    expect(read('web/src/UsagePanel.tsx')).toMatch(/\{compact && \(\s*<button className="chip" onClick=\{\(\) => setExpanded\(false\)\}>/);
  });
  it('the decisions are one line under the fuel, not a card of their own', () => {
    expect(read('web/src/SessionList.tsx')).not.toMatch(/What the crew decided/);
    expect(read('web/src/UsagePanel.tsx')).toMatch(/<DecisionsLine \/>/);
  });
})

describe('the scene promises only sets that exist, and nothing in it moves on a timer', () => {
  // docs/SCENES.md. The scene list is client code; each id it names must have
  // a shipped backdrop, or the home screen would show a broken image.
  it('every listed scene has its backdrop', () => {
    const { existsSync } = require('node:fs') as typeof import('node:fs');
    const ids = [...read('web/src/scenes.ts').matchAll(/^\s+id: '([a-z-]+)',$/gm)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(existsSync(join(root, 'web/public/scenes', `${id}.webp`)), id).toBe(true);
  });
  it('the SET moves (CSS only), the crew do not, and all of it stops under reduced motion', () => {
    // 2026-09-24: "each scene needs something animated" -- stars, fire, lamps,
    // snow. Still no JS timers in the scene, and the seats themselves never
    // animate: the crew only move for real state.
    expect(read('web/src/Scene.tsx')).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
    const css = read('web/src/styles.css');
    const seats = css.slice(css.indexOf('/* ---------- the scene'), css.indexOf('/* The bunks:'));
    expect(seats).not.toMatch(/animation/);
    const amb = css.slice(css.indexOf('/* ---------- the set moves'));
    expect(amb).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.amb i \{ animation: none !important; \}/);
  });
  it('a working member sits in the scene and types, with the laptop', () => {
    const s = read('web/src/Scene.tsx');
    expect(s).toMatch(/const pose = working \? 'type' : poseMissing \? 'idle' : seat\.pose;/);
    expect(s).toMatch(/const prop = working \? 'laptop' : poseMissing \? undefined : seat\.prop;/);
  });
})

describe('the builder is the vendor with room -- item 23, the structural half', () => {
  const s = read('server/src/sessions.ts');
  it('a consulted plan goes to the other vendor as a one-shot when its headroom is strictly better and KNOWN', () => {
    const c = s.slice(s.indexOf('chooseBuilder(): {'), s.indexOf('private async askByName('));
    expect(c).toMatch(/const known = theirs\.headroom\.state === 'room' \|\| theirs\.headroom\.state === 'tight';/);
    expect(c).toMatch(/if \(theirs\.presence !== 'absent' && known && b < a\)/);
    // a named vendor wins, unless it is not signed in
    expect(c).toMatch(/if \(theirs\.presence === 'absent'\) return \{ agent: this\.agent, reason: `you chose \$\{other\}, but it is not signed in` \};/);
  });
  it('the gates are armed BEFORE the build is sent, whichever vendor builds', () => {
    const b = s.slice(s.indexOf("case 'consult_proceed': {"), s.indexOf("case 'verify': {"));
    expect(b.indexOf('this.pendingVerify = {')).toBeLessThan(b.indexOf('const pick = this.chooseBuilder();'));
    expect(b).toMatch(/await this\.askByName\(name, display, undefined, 'build', prompt\);/);
    expect(b).toMatch(/kind: 'route', sessionId: this\.id, stage: 'build'/);
  });
  it('the remainder can be parked in the project roadmap, dated, with its task', () => {
    expect(s).toMatch(/case 'park_remainder': \{/);
    expect(s).toMatch(/## Parked \$\{stamp\} — \$\{truncate\(c\.task, 80\)\}/);
    expect(read('web/src/ChatView.tsx')).toMatch(/session\.meta\.planHasRemainder && \(/);
  });
  it('who builds is a per-session setting that survives a restart', () => {
    expect(s).toMatch(/builder: entry\.builder,/);
    expect(read('web/src/ChatView.tsx')).toMatch(/<label>Who builds<\/label>/);
  });
})

describe('a notice is never the end of a turn', () => {
  // 2026-09-24: Proceed handed the build to Nell on Codex; Pip's notice about
  // it repeated the idle state, the gate read that as "the build finished",
  // and ran -- against nothing -- 63 seconds before Nell was done.
  const s = read('server/src/sessions.ts');
  it('notices are flagged while pushed, and the gate trigger ignores them', () => {
    expect(s).toMatch(/this\.inNotice = true;\s*try \{\s*this\.pushEvent\(\{ type: 'status', state: this\.lastStatus, message/);
    expect(s).toMatch(/if \(turnEnded && this\.executing && this\.pendingVerify\)/);
  });
  it('a build on the other vendor is gated when the one-shot RETURNS', () => {
    const b = s.slice(s.indexOf("case 'consult_proceed': {"), s.indexOf("case 'verify': {"));
    expect(b).toMatch(/this\.crossBuild = true;\s*try \{\s*await this\.askByName\(name, display, undefined, 'build', prompt\);/);
    expect(b.indexOf('await this.autoVerify(pv);')).toBeGreaterThan(b.indexOf("await this.askByName(name, display, undefined, 'build', prompt);"));
  });
  it('no gates reads NOT VERIFIED, not FAILED, and does not fail the tracker', () => {
    expect(read('web/src/ChatView.tsx')).toMatch(/r\.passed \? 'PASSED' : r\.unverified \? 'NOT VERIFIED' : 'FAILED'/);
    expect(read('web/src/tracker.ts')).toMatch(/!lastVerify\.report\.passed && !lastVerify\.report\.unverified/);
  });
})

describe('live preview: same origin, never an arbitrary port, never a file outside its root', () => {
  // roadmap 28 / docs/PREVIEW.md: "see the project I am building, from the
  // phone -- and I may not be on my computer or on the same network."
  const live = read('server/src/live.ts');
  const proxy = read('server/src/liveProxy.ts');
  it('the pid is the project path itself, not a lookup table, and never resolves to an unconfigured or stopped project', () => {
    expect(live).toMatch(/export function toPid\(cwd: string\): string \{\s*return Buffer\.from\(cwd, 'utf8'\)\.toString\('base64url'\);/);
    expect(live).toMatch(/if \(!entry \|\| entry\.state !== 'running'\) return null;/);
  });
  it('a command never runs from anything but the project file the person keeps -- agent output is not a command', () => {
    expect(live).toMatch(/const body = knowledge\.sections\['preview'\];/);
    expect(live).not.toMatch(/exec\(|execSync/);
  });
  it('the proxy is mounted before the SPA catch-all, and the upgrade path only acts on \/live', () => {
    const idx = read('server/src/index.ts');
    // Anchored on the catch-all itself, not the comment above it (which changed).
    expect(idx.indexOf("app.use('/live/:pid'")).toBeGreaterThan(-1);
    expect(idx.indexOf("app.use('/live/:pid'")).toBeLessThan(idx.indexOf('app.get(/^\\/(?!api|ws)'));
    expect(idx).toMatch(/if \(!isLivePath\(req\.url\)\) return;/);
  });
  it('serveStatic never serves a file outside its resolved root, even through a symlinked root', () => {
    expect(proxy).toMatch(/realRoot = realpathSync\(root\);/);
    expect(proxy).toMatch(/if \(real !== realRoot && !real\.startsWith/);
  });
})

describe('a plain chat turn gets its own finished beat', () => {
  // 2026-09-24 (item 25): "a plain-chat turn that ends after real work has no
  // finished beat at all." Triggered by the same evidence the tracker uses
  // -- Done, and the job's last item newer than replay -- never a timer.
  const c = read('web/src/ChatView.tsx');
  it('keys the cheer on the job\'s end index, not a clock', () => {
    // Still keyed on the end index, never a clock; a finished turn is Done
    // (proven) or Your turn (handed back) since 2026-09-25.
    expect(c).toMatch(/const justFinished = \(doneStep\?\.state === 'done' \|\| doneStep\?\.state === 'awaiting'\)[^;]*t\.endIndex > session\.replayedCount;/);
    expect(c).toMatch(/<SpriteAvatar key=\{justFinished \? `f\$\{t\.endIndex\}` : 'w'\} crew=\{walker\} pose=\{pose\}/);
    // Never an empty path: the session's own member stands in until someone speaks.
    expect(c).toMatch(/const walker = t\.who \?\? session\.meta\?\.crew;/);
    expect(c).toMatch(/: justFinished \? \(t\.outcome === 'failed' \? 'think' : 'cheer'\)/);
  });
  it('the beat is a CSS animation, not JS, and stops under reduced motion', () => {
    const css = read('web/src/styles.css');
    expect(css).toMatch(/\.tracker-cheer \{ animation: tracker-cheer-hop/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.tracker-cheer \{ animation: none; \} \}/);
  });
})

describe('the four motions MOTION.md \u00a77 called still open', () => {
  // Reviewed 2026-09-24, then built the same day: the red stamp on failure,
  // the approval ring and haptic, confetti with the whole job's crew, and a
  // caret while a command runs -- items 01, 07 and 08 from the board, plus
  // 05's caret. The idle-breath item was reviewed too and struck, not built
  // (recorded in MOTION.md \u00a77 with why, not silently dropped).
  const css = read('web/src/styles.css');
  const c = read('web/src/ChatView.tsx');

  it("the caret is its own element, not a pseudo-element clipped by .tool-detail's own ellipsis, and is gone the instant the call finishes", () => {
    // .tool-detail truncates with overflow: hidden; a ::after caret inside it
    // would have been invisible on any truncated (i.e. most) command.
    expect(c).toMatch(/\{!item\.done && <span className="tool-caret" aria-hidden="true" \/>\}/);
    expect(css).toMatch(/\.tool-caret \{[\s\S]*?animation: caret-blink 900ms steps\(1, end\) infinite;/);
    const rm = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {\n  .verify-msg.fresh"));
    expect(rm.slice(0, 700)).toMatch(/\.tool-caret \{ animation: none; \}/);
  });

  it('the folded run row also gets the caret -- that row, not the expanded ToolChip, is what a live run actually shows', () => {
    // Consecutive tool calls fold into one line by default (4edc827); a
    // caret only on the hidden, expanded ToolChip would never be seen.
    const run = c.slice(c.indexOf('function ToolRun('), c.indexOf('function ThinkingBlock('));
    expect(run).toMatch(/\{s\.running \? \(/);
    expect(run).toMatch(/<span className="tool-caret" aria-hidden="true" \/>/);
  });

  it('the approval ring is a ONE-SHOT keyed per distinct approval, not a loop, and the haptic fires the same way', () => {
    expect(css).toMatch(/\.approval-ring::before \{[\s\S]*?animation: approval-ring-expand 900ms[^;]*;[\s\S]*?\}/);
    expect(css).not.toMatch(/approval-ring-expand[^;]*infinite/);
    expect(c).toMatch(/if \(session\.pendingApproval\) buzz\('approval'\);/);
    expect(c).toMatch(/\}, \[session\.pendingApproval\?\.requestId\]\);/);
  });

  it('confetti is once, gated on a fresh pass, and never on a fail', () => {
    expect(css).toMatch(/@keyframes confetti-burst \{/);
    expect(css).not.toMatch(/confetti-burst[^;]*infinite/);
    expect(c).toMatch(/\{r\.passed && fresh && <Confetti variant=\{celebrant\} \/>\}/);
  });

  it('everyone who worked the job cheers, not just whoever is live -- falls back to the live one when a chapter is not known', () => {
    expect(c).toMatch(/const cheerers = r\.passed \? \(chapterCrew\?\.length \? chapterCrew : crew \? \[crew\] : \[\]\) : \[\];/);
    expect(c).toMatch(/chapterCrew=\{ch\.crew\}/);
  });

  it('every new one-shot has a reduced-motion rule that turns it off', () => {
    const rm = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {\n  .verify-msg.fresh"));
    const block = rm.slice(0, 700);
    expect(block).toMatch(/\.confetti-piece \{ display: none; \}/);
    expect(block).toMatch(/\.approval-ring::before \{ animation: none; opacity: 0; \}/);
  });

  it('the idle-breath item is a recorded decision, not a silent gap', () => {
    const doc = read('docs/MOTION.md');
    expect(doc).toMatch(/struck, not built/);
  });
})

describe("the bubble tail steps down, not a single square", () => {
  // Direction board: "square bubbles with a stepped pixel tail" -- the first
  // cut was one plain square (2026-09-24 review), this is the staircase.
  const css = read('web/src/styles.css');
  it('three sizes, walking diagonally away from the bubble corner, no blur', () => {
    expect(css).toMatch(/\.crew-row \.msg\.assistant::after,\s*\.crew-row \.consult-msg::after \{[\s\S]*?box-shadow: -4px 4px 0 -1px var\(--surface-2\), -7px 7px 0 -2px var\(--surface-2\);/);
    expect(css).toMatch(/\.msg-row\.user \.msg\.user::after \{[\s\S]*?box-shadow: 4px 4px 0 -1px var\(--accent\), 7px 7px 0 -2px var\(--accent\);/);
  });
})

describe('day and week rows -- the last gap named in MOTION.md \u00a77', () => {
  // \u00a712d's real blocker (transcripts not surviving a restart) was fixed
  // 2026-09-24; this is the grouping UI itself. Client-side only -- it
  // changes what you SEE, exactly like the fold it sits beside, never what
  // the agents remember.
  const c = read('web/src/ChatView.tsx');
  const chapters = read('web/src/chapters.ts');

  it('groupChaptersByDay takes `now` as a parameter and never reads the clock itself', () => {
    // The one function in this file allowed to know about wall-clock time,
    // and even it is handed the time rather than asking for it -- so it stays
    // as testable as every other pure function here.
    const body = chapters.slice(chapters.indexOf('export function groupChaptersByDay'), chapters.indexOf('export function groupChaptersByDay') + 900);
    expect(body).not.toMatch(/Date\.now\(\)/);
    expect(chapters).not.toMatch(/\bnew Date\(\)(?!\.)/); // no argless `new Date()` anywhere in the module
  });

  it('a header only when the thread actually crosses a bucket -- the common single-day thread shows none', () => {
    expect(c).toMatch(/const showDayRows = groups\.length > 1;/);
  });

  it('rows stay in the order chapters already render in -- oldest first, never resorted', () => {
    const body = chapters.slice(chapters.indexOf('export function groupChaptersByDay'));
    expect(body).toMatch(/for \(const ch of chapters\) \{/);
    expect(body).not.toMatch(/\.sort\(/);
  });
})

describe('the crew bubble visits one member at a time', () => {
  // 2026-09-24: "not all at once -- fades in slow on one, stays a little,
  // fades out and comes back in on another." The one timer the roadmap allows
  // on the home screen (§12a): the state it reports (asleep, idle) is real,
  // it just is not reported for everyone simultaneously.
  const sl = read('web/src/SessionList.tsx');
  const css = read('web/src/styles.css');

  it('is literal for sleep and a fixed per-name pick for idle, never Math.random', () => {
    expect(sl).toMatch(/if \(pose === 'sleep'\) return \{ text: SLEEP_BUBBLE \}/);
    expect(sl).not.toMatch(/Math\.random/);
    expect(sl).toMatch(/IDLE_BUBBLES\[h % IDLE_BUBBLES\.length\]/);
  });

  it('says nothing while working -- the typing sprite already reports that', () => {
    expect(sl).toMatch(/if \(pose !== 'idle'\) return null/);
  });

  it('renders exactly one bubble, keyed per visit, and the visit runs once', () => {
    expect(sl).toMatch(/const visiting = bubble && visitable\[visitor\]\?\.name === c\.name;/);
    expect(sl).toMatch(/<span key=\{visit\} className="crew-bubble"/);
    const block = css.slice(css.indexOf('.crew-bubble {'), css.indexOf('.crew-strip-name {'));
    expect(block).toMatch(/animation: bubble-visit [\d.]+s (?:ease-in-out|linear) both;/);
    expect(block).not.toMatch(/infinite/);
    expect(block).toMatch(/prefers-reduced-motion: reduce\) \{ \.crew-bubble \{ animation: none; \}/);
  });

  it('sits beside the head, not on it', () => {
    const block = css.slice(css.indexOf('.crew-bubble {'), css.indexOf('.crew-strip-name {'));
    expect(block).toMatch(/left: 62%;/);
    expect(block).not.toMatch(/translateX\(-50%\)/);
  });
})

describe('no emoji anywhere -- Roost draws its own icons', () => {
  // 2026-09-24. An emoji is the phone vendor's drawing in the phone vendor's
  // style, sat beside sprites drawn by hand. ⚙ and ⚖ render as glossy colour
  // pictures on iOS. icons.tsx holds ours, as 12×12 pixel glyphs.
  const { readdirSync } = require('node:fs') as typeof import('node:fs');
  // The arcade's games live in folders under web/src/games and follow the
  // rule too -- except Daily Word's share text, which is pasted OUTSIDE Roost
  // where the coloured squares are the universal way to share a result.
  const files = (readdirSync(join(root, 'web/src'), { recursive: true }) as string[])
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f) && f !== 'games/wordle/logic.ts');
  // The pictographic block, plus the misc-symbol code points iOS gives emoji
  // presentation (gear, scales, bolt, coffee, sparkles, star). Typographic
  // marks that take the text colour and font stay: ✓ ✗ ✕ ★ ↑ ■ …
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2699}\u{2696}\u{26A1}\u{2615}\u{2728}\u{2B50}\u{231B}\u{23F3}\u{2705}\u{274C}]/u;
  it('web/src carries none', () => {
    for (const f of files) {
      const src = read(`web/src/${f}`);
      const hit = src.match(EMOJI);
      expect(hit, `${f}: ${hit?.[0]}`).toBeNull();
    }
  });
  it('the icons are drawn here, as pixel rows', () => {
    const i = read('web/src/icons.tsx');
    expect(i).toMatch(/shapeRendering="crispEdges"/);
    expect(i).toMatch(/bolt: \[/);
    expect(i).toMatch(/gear: \[/);
    expect(i).toMatch(/scales: \[/);
    expect(i).toMatch(/lock: \[/);
    expect(i).toMatch(/camera: \[/);
  });
})

describe('the composer behaves like Messages', () => {
  // 2026-09-24: "if I type more than a line it pushes it up out of sight."
  const c = read('web/src/ChatView.tsx');
  const css = read('web/src/styles.css');
  it('grows with the text, measured from content, not counted from newlines', () => {
    expect(c).toMatch(/el\.style\.height = 'auto';\s*el\.style\.height = `\$\{el\.scrollHeight\}px`;/);
    expect(css).toMatch(/\.composer textarea \{[^}]*max-height: 140px;/);
  });
  it('keeps ↑ inside the field, not stranded in the corner', () => {
    expect(c).toMatch(/<div className="composer-field">[\s\S]*?<textarea[\s\S]*?className="primary send"[\s\S]*?<\/div>/);
    expect(css).toMatch(/\.composer-field \.send \{ position: absolute; right: 4px; bottom: 4px; \}/);
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

describe('an empty session opens', () => {
  it('never renders a chapter it has not checked exists', () => {
    // 2026-09-24: `renderChapter(chapters[0], 0)` read `.start` off undefined for a
    // session with no messages — a new one, or every one after a restart — and
    // crashed the chat view. From the first restart that morning no session could
    // be opened or started, and because the crash was in the browser the Mac's log
    // stayed silent all day.
    expect(read('web/src/ChatView.tsx')).not.toMatch(/chapters\[0\]/);
  });
})

describe('never dead in the water', () => {
  // 2026-09-24: one bad build crashed every session for a day. Three things would
  // have saved it, and each is pinned here.

  it('the rescue page depends on nothing the front end ships', () => {
    const rescue = read('server/src/rescue.ts');
    const page = rescue.slice(rescue.indexOf('const RESCUE_HTML'));
    for (const dep of ['/assets/', '/fonts/', '/crew/', 'src="', 'rel="stylesheet"', '<link']) {
      expect(page, dep).not.toContain(dep);
    }
  });

  it('the rescue page is registered before the front end catch-all', () => {
    const index = read('server/src/index.ts');
    const rescue = index.indexOf('registerRescue(app');
    const spa = index.indexOf('app.get(/^\\/(?!api|ws)');
    expect(rescue).toBeGreaterThan(-1);
    expect(spa).toBeGreaterThan(rescue);
  });

  it('the server serves the smoke-checked release, not the latest build', () => {
    const index = read('server/src/index.ts');
    expect(index).toContain('const webDist = webRoot()');
    expect(index).not.toMatch(/const webDist = join\(repoRoot, 'web', 'dist'\)/);
  });

  it('a deploy smoke-checks the candidate before promoting it, and rolls back if the live check fails', () => {
    const svc = read('scripts/service.mjs');
    const smokeCandidate = svc.indexOf('serveCandidate(');
    const promoteAt = svc.indexOf('promote()');
    expect(smokeCandidate).toBeGreaterThan(-1);
    expect(promoteAt).toBeGreaterThan(smokeCandidate);
    expect(svc.slice(promoteAt)).toContain('rollback()');
    // A gate that could not look has not passed; and a blocking call would
    // freeze the in-process candidate server so the check never sees it.
    expect(svc).toContain("ROOST_SMOKE_REQUIRED: '1'");
    expect(svc).not.toMatch(/execSync\([^)]*smoke/);
    // A stopped deploy has already overwritten server/dist, which launchd runs.
    expect(svc.match(/restoreServer\(\); console\.error\([^)]*NOT deploying/g)?.length).toBe(2);
  });

  it('a deploy cannot be killed halfway and leave the service unloaded', () => {
    // 2026-09-24, 17:35: a deploy run from inside Roost booted the service out,
    // which killed the deploy before it bootstrapped it again. App down.
    const svc = read('scripts/service.mjs');
    expect(svc).toContain('launchctl kickstart -k');
    expect(svc).toMatch(/if \(unchanged && loaded\(\)\)/);
    expect(svc).toMatch(/'finish-deploy'\], \{[\s\S]*?detached: true/);
  });

  it('a deploy run from inside Roost hands off and returns, instead of waiting to be killed', () => {
    expect(read('server/src/index.ts')).toContain("process.env.ROOST_HOSTED = '1'");
    const svc = read('scripts/service.mjs');
    expect(svc).toMatch(/if \(process\.env\.ROOST_HOSTED\) \{[\s\S]*?process\.exit\(0\);/);
  });

  it('a message that fails to render costs one message, not the chat', () => {
    const chat = read('web/src/ChatView.tsx');
    expect(chat).toMatch(/<Contained[^>]*what="This message"/);
    expect(chat).toMatch(/<Contained[^>]*what="These tool calls"/);
    expect(chat).toMatch(/<Contained[^>]*what="The conversation"/);
  });

  it('the crash screen offers a way out that does not need this app', () => {
    expect(read('web/src/ErrorBoundary.tsx')).toContain('href="/rescue"');
  });
});

describe('the gate refusing looks refused (§12a beyond the eight)', () => {
  // "The gate refusing — a dispatch blocked at 98% quota should *look*
  // refused, not print a sentence." A quota refusal now carries its own
  // error code end to end and renders as a lock, not a plain red sentence.

  it('GateRefused carries which agent refused, and callers can tell it apart from any other failure', () => {
    const gate = read('server/src/gate.ts');
    expect(gate).toMatch(/class GateRefused extends Error/);
    expect(gate).toMatch(/export function isGateRefusal/);
  });

  it('a quota refusal reaches the client tagged, not as an indistinguishable sentence', () => {
    const sessions = read('server/src/sessions.ts');
    expect(sessions).toContain("isGateRefusal(err)");
    // Every place sessions.ts calls reportError with 'gate' pairs with a check.
    expect((sessions.match(/reportError\([^)]*'gate'\)/g) ?? []).length).toBeGreaterThan(0);
  });

  it("'gate' is a real error code end to end, in the protocol and the client's types", () => {
    for (const f of ['server/src/protocol.ts', 'web/src/types.ts']) {
      expect(read(f)).toMatch(/code\?: 'auth' \| 'context' \| 'gate'/);
    }
  });

  it('renders as a lock beside the text, not the plain crash-red error box', () => {
    const chat = read('web/src/ChatView.tsx');
    expect(chat).toMatch(/item\.code === 'gate'/);
    expect(chat).toMatch(/<Icon name="lock"/);
    expect(chat).toMatch(/className="msg error gate-refused"/);
  });

  it('lands with a one-shot settle, never a loop', () => {
    const css = read('web/src/styles.css');
    const block = css.slice(css.indexOf('.gate-lock {'), css.indexOf('@keyframes gate-lock-land'));
    expect(block).toMatch(/animation: gate-lock-land [\d.]+ms [\w().,\s-]+ both;/);
    expect(block).not.toMatch(/infinite/);
  });

  it('has a design-review fixture', () => {
    expect(read('web/src/fixtures.ts')).toContain("'quota-refused':");
  });
});

describe('§12a beyond the eight — motion that reports what Roost already knows', () => {
  const css = () => read('web/src/styles.css');
  const chat = () => read('web/src/ChatView.tsx');
  const motion = () => read('web/src/motion.ts');

  it('a handoff names who stepped back, end to end, and plays the pass only live', () => {
    for (const f of ['server/src/protocol.ts', 'web/src/types.ts']) expect(read(f)).toMatch(/type: 'consult';[^\n]*from\?: CrewInfo/);
    expect(read('server/src/sessions.ts')).toMatch(/from: how === 'handoff' \? fromMember : undefined/);
    expect(read('web/src/useSession.ts')).toContain('from: event.from');
    expect(chat()).toMatch(/<HandoffPass from=\{item\.from\} to=\{item\.crew\} fresh=\{fresh\}/);
    const block = css().slice(css().indexOf('.handoff-pass {'), css().indexOf('/* ---------- the map'));
    expect(block).toMatch(/\.handoff-pass\.live \.handoff-from \{ animation: handoff-step-back \d+ms [^;]*both; \}/);
    expect(block).toMatch(/\.handoff-pass\.live \.handoff-to \{ animation: handoff-step-in \d+ms [^;]*both; \}/);
    expect(block).not.toMatch(/infinite/);
  });

  it('effort is visible as the think beat, from one pure table, and Pip never inherits it', () => {
    expect(motion()).toMatch(/export function thinkBeatMs/);
    expect(motion()).toMatch(/case 'low': return 420;[\s\S]*case 'xhigh': return 1200;/);
    expect(chat()).toMatch(/'--beat': `\$\{thinkBeatMs\(effort\)\}ms`/);
    expect(chat()).toMatch(/const effort = session\.triaging \|\| pose !== 'think' \? '' : session\.meta\?\.effort/);
    expect(css()).toMatch(/\.working-indicator \.crew-sprite\.pose-think \.frame-b \{ animation-duration: var\(--beat, 0\.62s\); \}/);
  });

  it('someone being sent out moves once, live only, and never loops', () => {
    expect(chat()).toMatch(/className=\{fresh \? 'sent-out' : undefined\}/);
    expect(css()).toMatch(/\.crew-sprite\.sent-out \{ animation: sent-out \d+ms [^;]*both; \}/);
    expect(css()).not.toMatch(/sent-out \d+ms[^;]*infinite/);
  });

  it('sleeping on idle is gated on the engine being idle and on quiet you were present for', () => {
    expect(motion()).toMatch(/if \(status !== 'idle' \|\| lastTs == null\) return false;/);
    expect(motion()).toMatch(/QUIET_SLEEP_MS = 20 \* 60_000/);
    // Quiet counts from opening the session or the last item, whichever is later.
    expect(chat()).toMatch(/Math\.max\(session\.openedAt, /);
    // Only the tracker face sleeps; nothing here adds a new keyframe loop.
    expect(chat()).toMatch(/: asleep \? 'sleep'/);
  });

  it('each moment has a design-review fixture', () => {
    const fx = read('web/src/fixtures.ts');
    for (const name of ["handoff:", "'handoff-replayed':", "'effort-low':", "'effort-xhigh':", "asleep:"]) expect(fx).toContain(name);
  });
});

describe('triage that cannot run is not "unparseable"', () => {
  it('an auth failure in the classifier reaches the sign-in card and its own decisions row', () => {
    // 2026-09-24: the only triage-fallback row ever logged had raw
    // "Failed to authenticate: OAuth session expired" — a failed call filed as
    // a model that answered badly, with nobody told.
    expect(read('server/src/router.ts')).toMatch(/if \(isAuthFailure\(out\)\) return \{[^}]*auth: true \}/);
    const s = read('server/src/sessions.ts');
    expect(s).toMatch(/if \(triaged\.auth\) \{[\s\S]*?noteAuthFailure\([\s\S]*?reportError\([^)]*'auth'\)[\s\S]*?stage: 'triage-auth'/);
  });
});

describe('documented once, never done — closed 2026-09-24', () => {
  it('images travel with an @-mention or handoff on both vendors', () => {
    const d = read('server/src/agents/dispatch.ts');
    expect(d).toMatch(/images\?: UserImage\[\];/);
    expect(d).toMatch(/type: 'image', source: \{ type: 'base64'/);
    expect(d).toMatch(/\.\.\.localImages\(spec\.images\)/);
    const s = read('server/src/sessions.ts');
    expect(s).not.toContain('cannot see attached images yet');
    expect(s).toMatch(/agent: suite, model, prompt, images, cwd: this\.cwd/);
  });

  it('pass, fail and approval each have their own haptic pattern, from one table', () => {
    const h = read('web/src/haptics.ts');
    expect(h).toMatch(/approval: \[60\]/);
    expect(h).toMatch(/pass: \[[\d, ]+\]/);
    expect(h).toMatch(/fail: \[[\d, ]+\]/);
    const chat = read('web/src/ChatView.tsx');
    expect(chat).not.toMatch(/navigator\.vibrate\(/); // only haptics.ts touches the API
    expect(chat).toMatch(/buzz\(lastVerify\.passed \? 'pass' : 'fail'\)/);
    // Live only: the search starts at replayedCount, never at 0.
    expect(chat).toMatch(/i >= session\.replayedCount; i--/);
  });

  it('a project can ask for its home-screen scene, and the pin and a tap still win', () => {
    expect(read('server/src/sessions.ts')).toMatch(/sections\.scene\?\.trim\(\)/);
    for (const f of ['server/src/protocol.ts', 'web/src/types.ts']) expect(read(f)).toMatch(/\n  scene\?: string;/);
    const scene = read('web/src/Scene.tsx');
    // Taps no longer cycle the set (item 39: one a day), so the project's
    // scene simply applies; the ?scene= pin still wins.
    expect(scene).toMatch(/const asked = SCENES\.find\(\(s\) => s\.id === projectScene\);/);
    expect(scene).toMatch(/SCENES\.find\(\(s\) => s\.id === pinned\) \?\? asked \?\?/);
  });

  it('the hand-mirrored protocol types have not drifted (§9.7)', () => {
    // protocol.ts ↔ types.ts are kept by hand. Until they are generated, the
    // event unions must be textually identical, whitespace aside.
    const pick = (src: string, name: string) => {
      const m = src.match(new RegExp(`export type ${name} =[\\s\\S]*?;\\n`));
      return m ? m[0].replace(/\s+/g, ' ') : null;
    };
    const p = read('server/src/protocol.ts');
    const t = read('web/src/types.ts');
    for (const name of ['ServerEvent', 'ClientMessage', 'ConsultPhase']) {
      expect(pick(p, name), name).not.toBeNull();
      expect(pick(t, name), name).toBe(pick(p, name));
    }
  });
});

describe('the Control, Context and Roadmap boards (docs/board/), built', () => {
  const chat = () => read('web/src/ChatView.tsx');
  const sessions = () => read('server/src/sessions.ts');

  it('Control: every turn at a set effort carries its meter, and the reason rides the first turn after a move', () => {
    for (const f of ['server/src/protocol.ts', 'web/src/types.ts']) {
      expect(read(f)).toMatch(/effort\?: string;[\s\S]{0,300}effortNote\?: string;/);
    }
    expect(sessions()).toMatch(/effort: this\.effort \|\| undefined, effortNote: this\.effortNote \}/);
    expect(sessions()).toMatch(/this\.effortNote = effortNoteFor\(fromEffort, newEffort, effortPick\.reason\);/);
    expect(chat()).toMatch(/\{crew\.effort && <EffortMeter effort=\{crew\.effort\} \/>\}/);
    // A model that budgets its own thinking has no meter, not a zero.
    expect(chat()).toMatch(/const lit = EFFORT_BLOCKS\[effort\];\s*if \(!lit\) return null;/);
  });

  it('Control: Pip proposes, you dispose — a large message waits on Go ahead / Just chat, nothing runs first', () => {
    const s = sessions();
    const block = s.slice(s.indexOf("triaged?.size === 'large'"), s.indexOf("case 'question_answer'"));
    expect(block).toContain('this.escalationOffer = {');
    expect(block).not.toContain('runConsult(');
    expect(s).toMatch(/case 'escalation_response':\s*await this\.answerEscalation\(!!msg\.go/);
    // Declining delivers the waiting message once, not twice.
    expect(s).toMatch(/this\.echoed = offer\.text;\s*await this\.deliver\(offer\.text\);/);
    expect(chat()).toMatch(/<PipProposes/);
    expect(chat()).toMatch(/>Go ahead<\/button>[\s\S]{0,120}>Just chat<\/button>/);
  });

  it('Context: the agent asks in person, once, with the box that stops it asking; hand-off is its own rung', () => {
    expect(chat()).toMatch(/<CompactAsk/);
    expect(chat()).toContain('Do this automatically from now on');
    expect(chat()).not.toMatch(/className="compact-offer"/);
    expect(chat()).toMatch(/\{session\.context\.pressure === 'critical' && \(\(\) => \{/);
  });

  it('Context: automatic never means silent — it says where it compacted and where it landed', () => {
    const s = sessions();
    expect(s).toMatch(/Compacted automatically' : 'Compacted'\}\$\{where\}/);
    expect(s).toMatch(/is at \$\{event\.context\.percent\}% after compacting \(was \$\{this\.compactedFrom\}%\)/);
  });

  it('Roadmap: the map is read from ROADMAP.md, never typed for the screen, and null reads as "no data"', () => {
    expect(read('server/src/index.ts')).toMatch(/app\.get\('\/api\/roadmap'[\s\S]*?config\.projects\.includes\(cwd\)/);
    const sheet = read('web/src/RoadmapSheet.tsx');
    expect(sheet).toContain("api.roadmap(cwd)");
    expect(sheet).toMatch(/n == null \? 'no data' : n/);
    // 2026-09-27: the home-screen flag is gone -- the map moved into each
    // project's Changes sheet as "What shipped", filled from git.
    expect(read('web/src/SessionList.tsx')).not.toMatch(/<Icon name="flag"/);
    expect(read('web/src/GitSheet.tsx')).toMatch(/<WhatShipped cwd=\{cwd\} \/>/);
    expect(read('server/src/index.ts')).toMatch(/app\.get\('\/api\/git\/history'[\s\S]*?guardProject\(req, res\)/);
  });

  it('each board has a design-review fixture', () => {
    const fx = read('web/src/fixtures.ts');
    for (const name of ['effort:', "'pip-proposes':", "'compact-ask':"]) expect(fx).toContain(name);
  });
});

describe('one agent, one identity (item 32)', () => {
  const s = read('server/src/sessions.ts');
  it('replies and the header are signed from the model actually speaking, alias read through', () => {
    expect(s).toMatch(/const model = this\.speakingModel\(\);/);
    expect(s).toMatch(/crew: crewMember\(this\.agent, this\.speakingModel\(\), this\.currentRole\)/);
    expect(s).toMatch(/return card\?\.resolvedId \|\| m;/);
  });
  it('outside auto there is no routed model to go stale', () => {
    expect(s).toMatch(/if \(this\.autoMode\) this\.routedModel = model;\s*else this\.model = model;/);
    expect(s).toMatch(/if \(!this\.autoMode\) this\.routedModel = undefined;/);
  });
});

describe('percentages that move (item 33)', () => {
  it('context is measured during a turn, throttled, not only at its end', () => {
    expect(read('server/src/agents/claude.ts')).toMatch(/case 'assistant': \{[\s\S]{0,300}if \(Date\.now\(\) - this\.contextAt > 20_000\) void this\.reportContext\(\);/);
  });
  it('the fuel line is read after a turn ends, at most every two minutes, and every session re-sends it', () => {
    expect(read('server/src/usage.ts')).toMatch(/if \(Date\.now\(\) - lastSoon < 120_000\) return false;/);
    const s = read('server/src/sessions.ts');
    expect(s).toMatch(/this\.lastStatus === 'working' && event\.state === 'idle'\) \{\s*void refreshUsageSoon\(this\.cwd\)/);
    expect(s).toMatch(/for \(const s of this\.sessions\.values\(\)\) s\.refreshMeta\(\);/);
  });
});

describe('the light theme gets the design (item 34)', () => {
  const css = read('web/src/styles.css');
  it('the board\'s shapes and type apply to both themes; only colour is per theme', () => {
    // What stays dark-only is colour: syntax highlighting, the wordmark's
    // fills, one monogram background. Everything else is shared.
    const dark = [...css.matchAll(/\[data-theme='dark'\] ([^{,\n]+)/g)].map((m) => m[1].trim());
    expect(dark.filter((sel) => !/^\.(hljs|wm-|me-monogram)/.test(sel)), 'dark-only non-colour rules').toEqual([]);
  });
  it('the dark palette block survives — a bare `{` is how it was lost once', () => {
    expect(css).toMatch(/\[data-theme='dark'\] \{\s*--bg: #0f1729;/);
    expect(css).not.toMatch(/^\s*\{\s*$/m);
  });
  it('square everywhere: no radius of 8px or more; circles are 50%', () => {
    expect(css).not.toMatch(/border-radius: [^;]*\b(?:[89]|[1-9]\d+)px/);
  });
  it('lamp is a fill on paper; accent-coloured TEXT uses the deeper ink', () => {
    expect(css).not.toMatch(/(?<![-\w])color: var\(--accent\)/);
    expect(css).toMatch(/--accent-ink: #8a5a00;/);
  });
  it('crew names are made readable on whichever ground they sit on', () => {
    expect(read('web/src/color.ts')).toMatch(/return readableOn\(color, dark \? ROOST_GROUND : PAPER_GROUND\);/);
  });
});

describe('one status line, not six bars (item 35)', () => {
  const chat = read('web/src/ChatView.tsx');
  it('the bars live behind one tap; the line shows only what is live', () => {
    expect(chat).toMatch(/<StatusStrip session=\{session\} open=\{stripOpen\}/);
    expect(chat).toMatch(/\{stripOpen && \(\s*<div className="status-detail">/);
    // Spend-it and full auto appear on the line only when they are real.
    expect(chat).toMatch(/\{surplus && \(\s*<span className="strip-spend"/);
    expect(chat).toMatch(/\{session\.meta\?\.approvals === 'full-auto' && \(\s*<span className="strip-word lamp">/);
  });
  it('has the screenshot as a fixture', () => {
    expect(read('web/src/fixtures.ts')).toContain("'busy-top':");
  });
});

describe('the rest of the screenshot (item 36)', () => {
  const chat = read('web/src/ChatView.tsx');
  it('the mode badge says what the next message does: a sticky name is "direct", not the mode', () => {
    expect(chat).toMatch(/\{session\.meta\?\.sticky \? \(\s*<span className="mode-tag direct"/);
  });
  it('the header line keeps only what the next message does, and a dropped connection', () => {
    // 2026-09-25: who, on what model, at what effort is on every reply, so
    // repeating it under the title was noise. Never a raw list label either.
    const sub = chat.slice(chat.indexOf('<div className="chat-title-sub">'), chat.indexOf('</button>', chat.indexOf('<div className="chat-title-sub">')));
    expect(sub).not.toMatch(/modelName|modelWords|currentModelLabel/);
    expect(sub).toMatch(/!session\.connected && <span className="chat-title-warn">reconnecting…<\/span>/);
  });
  it('no raw window key reaches the phone', () => {
    const q = read('server/src/quota.ts');
    expect(q).toMatch(/const label = CLAUDE_WINDOW_LABELS\[k\] \?\? `7-day \(\$\{m\[1\]\.replace\(\/_\/g, ' '\)\}\)`;/);
  });
  it('a lone tool call folds like the rest', () => {
    expect(read('web/src/toolruns.ts')).not.toMatch(/if \(j - i >= 2\)/);
  });
  it('the working face always has words', () => {
    expect(chat).toMatch(/session\.statusMessage \?\? doingNow\(crew\.name, last\)/);
  });
  it('narration renders as an aside; the reply keeps its bubble', () => {
    expect(chat).toMatch(/aside=\{isNarration\(session\.items, seg\.index, ch\.end\)\}/);
    expect(chat).toMatch(/if \(aside && item\.complete\) \{/);
  });
});

describe('the crew, alive (items 38–40)', () => {
  const chat = read('web/src/ChatView.tsx');
  const css = read('web/src/styles.css');
  it('a working pose plays four drawings, slower, and falls back to two until all four exist', () => {
    expect(chat).toMatch(/type: \['type', 'type2', 'type3', 'type4'\]/);
    expect(chat).toMatch(/think: \['think', 'think2', 'think3', 'think4'\]/);
    expect(chat).toMatch(/onError=\{\(\) => \(i === 0 \? setFailed\(true\) : setShort\(true\)\)\}/);
    expect(css).toMatch(/\.crew-sprite\.four \{ --frame: 560ms; \}/);
    // one drawing at a time: four windows that tile the cycle
    expect(css).toMatch(/@keyframes work-frame-3 \{ 0%, 74\.99% \{ opacity: 0; \} 75%, 100% \{ opacity: 1; \} \}/);
  });
  it('the scene changes once a day, and a tap no longer cycles it', () => {
    const scene = read('web/src/Scene.tsx');
    expect(scene).not.toMatch(/setTaps/);
    expect(read('web/src/scenes.ts')).toMatch(/return \(\(\(day \+ offset\) % count\) \+ count\) % count;/);
  });
  it('a companion card opens from any face, and reads records, never invents', () => {
    expect(chat).toMatch(/className="crew-row-face"[^>]*onClick=\{\(\) => openCompanion\(crew\)\}/);
    expect(read('web/src/SessionList.tsx')).toMatch(/onClick=\{\(\) => openCompanion\(c\)\}/);
    expect(read('web/src/Scene.tsx')).toMatch(/onClick=\{\(\) => openCompanion\(member\)\}/);
    const sheet = read('web/src/CompanionSheet.tsx');
    expect(sheet).toMatch(/\{n \?\? 'no data'\}/);
    expect(sheet).toMatch(/c\.energy == null \?/);
    expect(read('server/src/sessions.ts')).toMatch(/noteLife\(\{ at: event\.ts, kind: 'verify', names: \[\.\.\.this\.jobCrew\]/);
  });
});

describe('moments in the thread (item 40)', () => {
  const s = read('server/src/sessions.ts');
  it('a level or milestone is said only when THIS event crossed it — never for history', () => {
    expect(s).toMatch(/this\.celebrate\(\[crewMember\(d\.agent, d\.model/);
    expect(s).toMatch(/if \(after\.level > before\.level\)/);
    expect(s).toMatch(/if \(ms\.earnedAt && !before\.milestones\.find\(\(b\) => b\.id === ms\.id\)\?\.earnedAt\)/);
  });
  it('the moment is a real event on both sides of the wire, with a fixture', () => {
    for (const f of ['server/src/protocol.ts', 'web/src/types.ts']) expect(read(f)).toMatch(/type: 'milestone'; crew: CrewInfo; label: string; detail: string/);
    expect(read('web/src/fixtures.ts')).toContain('moments: () =>');
  });
});

describe('forty scenes, one a day (item 39)', () => {
  it('every listed scene has its backdrop, and there are forty', () => {
    const src = read('web/src/scenes.ts');
    const ids = [...src.matchAll(/id: '([a-z]+)'/g)].map((m) => m[1]);
    expect(ids.length).toBe(40);
    expect(new Set(ids).size).toBe(40);
    for (const id of ids) expect(existsSync(join(root, 'web/public/scenes', `${id}.webp`)), id).toBe(true);
  });
});

describe('bugs from the phone, 2026-09-26', () => {
  const s = read('server/src/sessions.ts');

  it('a deploy says what shipped -- read from the marker the deploy wrote, not guessed from timestamps', () => {
    expect(s).toMatch(/export function deployRestart\(/);
    expect(s).toMatch(/const deploy = deployRestart\(\);/);
    expect(s).toMatch(/`Deployed at \$\{at\}: \$\{deploy\.subject\}/);
    expect(s).not.toMatch(/Deployed at[^`]*say "continue"/); // a finished deploy is not a chore to come back for
    // the old line survives as the fallback when the restart was NOT a deploy
    expect(s).toMatch(/Roost restarted at \$\{at\} — the turn that was running was cut off/);
  });

  it('a deploy from inside Roost waits for the crew to finish talking before it restarts', () => {
    const svc = read('scripts/service.mjs');
    const finish = svc.slice(svc.indexOf("case 'finish-deploy': {"), svc.indexOf("case 'rollback': {"));
    expect(finish.indexOf('await waitForQuiet(')).toBeGreaterThan(-1);
    expect(finish.indexOf('await waitForQuiet(')).toBeLessThan(finish.indexOf('start();'));
    expect(finish).toMatch(/restart\.json/);
    expect(svc).toMatch(/busy = list\.some\(\(s\) => s\.state === 'working'\)/);
  });

  it('"don\'t ask again" survives a restart instead of resetting silently', () => {
    // seeded into the adapter from the restored session, and fed back out
    // whenever a new tool is granted, so the next restart has it too
    expect(s).toMatch(/allowedTools: this\.sessionAllowedTools,/);
    expect(s).toMatch(/onAllowedToolsChange: \(tools: string\[\]\) => \{\s*this\.sessionAllowedTools = tools;/);
    expect(s).toMatch(/sessionAllowedTools: s\.sessionAllowedTools,/); // saved
    expect(s).toMatch(/sessionAllowedTools: entry\.sessionAllowedTools,/); // restored
    const claude = read('server/src/agents/claude.ts');
    expect(claude).toMatch(/this\.sessionAllowedTools = new Set\(opts\.allowedTools \?\? \[\]\);/);
    expect(claude).toMatch(/this\.opts\.onAllowedToolsChange\?\.\(\[\.\.\.this\.sessionAllowedTools\]\);/);
  });
});
