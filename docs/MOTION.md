# Motion and design — implementing the board

*How to build the design canvas's look and motion in Roost, with the "Motion that carries information" board in detail. Written 2026-09-24 against the code at `87eb3f2`. The canvas: https://claude.ai/artifact/28CUkGBUQvnBvygnfEJNQn (boards **Direction**, **Motion that carries information**, **The work, folded**, **The thread**).*

This is a working guide for anyone adding to or changing Roost's interface: what the rules are, where each piece lives, how to build the next one, and how to prove it works. Most of the board is already built; §4 says exactly what is and is not, and §7 lists the gaps.

---

## 1. The one rule

> **Motion reports state. It never decorates.**

The Effects board opens with the reason: *"Ambient movement is the commonest tell of a generated interface, so none of these run on their own schedule. Each one answers something you did, or reports a state that changed — and each replaces a sentence you would otherwise have to read."*

Every animation must answer yes to one of these:

1. **Did something just happen?** A gate passed, fuel was spent, a job closed, you opened a session. → a **one-shot**: it plays once, holds its last frame (`animation-fill-mode: both`), and stops.
2. **Is something true right now that will stop being true?** An agent is typing, an approval is waiting, capacity is about to expire. → a **loop**, allowed *only* while that state holds. It stops because its cause stopped, not because a timer ran out.

There are exactly three sanctioned exceptions, each written down and each enforced by a test:

| Exception | Why it is allowed | Where |
|---|---|---|
| **The set moves** — stars, a shooting star, fire, lamps, steam, snow in the home scene | Asked for on 2026-09-24 ("each scene needs something animated"). The *set* moves; the *crew* in it still only move for state. CSS only, off under reduced motion. | `Scene.tsx` `AmbientLayer`, `.amb-*` in `styles.css` |
| **The scene changes on the hour** | A set change, not a loop: `(dayOfYear × 24 + hour) mod 10`. Tapping cycles it. | `Scene.tsx`, `docs/SCENES.md` |
| **The Zzz visits the sleepers** | One bubble moves between sleeping crew every 17s (15s held plus a fade). It reports who is asleep. | `SessionList.tsx` `BUBBLE_VISIT_MS` |

`docs/SCENES.md` says "the fire does not flicker… the scenes are stills". That was **reversed** by `68a6151` at the owner's request, and the `.amb-*` loops are now sanctioned by the loop test. Where the two documents disagree, this one describes the code as it stands.

**One open decision.** The board's footer says *"One thing moves unprompted: the crew's idle breath"*, and the Direction board says *"Idle breathes at 1.5 s; working drops to 420 ms. Speed is the status."* The app does **not** do this: an idle crew member holds one frame, and typing cycles at 0.62s. That was deliberate, because a breathing idle is the ambient motion the rule forbids. But the board asks for it. If it is ever built, it goes in the sanctioned list with its reason, never quietly.

---

## 2. Foundations

### Palette — by role, not just colour

Defined once as the Roost theme's tokens in `web/src/styles.css` (`[data-theme='dark']`). It is the default theme; light remains a choice.

| Token | Value | Role on the board |
|---|---|---|
| `--bg` | `#0f1729` | **roost** — the ground |
| `--surface` | `#131c33` | cards and rows |
| `--surface-2` | `#1c2740` | **bubble** — the crew's side of the thread |
| `--seam` | `#38477a` | **seam** — hairlines, bubble edges |
| `--border` | `#2b3a63` | card edges |
| `--accent` | `#f4b63f` | **lamp** — *you, and attention*: your bubbles, focus, the thing to look at |
| `--accent-text` | `#0f1729` | text on lamp |
| `--text` / `--text-dim` | `#e9edf6` / `#93a3c6` | **chalk** / **chalk dim** |
| `--claude` / `--codex` | `#b85a30` / `#2f8f6b` | vendor fills |
| `--claude-ink` / `--codex-ink` | `#c3734f` / `#399572` | vendor colours **as text**; the fills are 3.7–4.2:1 on a card |
| `--shadow-hard` | `3px 3px 0 #0a1020` | the only shadow |

**Crew names are coloured through `nameColor()`** (`web/src/color.ts`), never with the raw persona colour. Persona colours were chosen for light chips, and Ollie's `#2f3a72` is 1.7:1 on the ground. `readableOn()` lightens a colour only until it reaches WCAG 4.5:1 and leaves colours that already pass untouched. Computed, never hand-picked.

### Type

- **Silkscreen** for names, labels, headings and quota figures. The crew are bitmap characters, so their names are too.
- **Atkinson Hyperlegible** for everything you read. It is built to be read at arm's length on a phone.
- Both are **self-hosted** (`web/public/fonts/`, `web/src/fonts.css`, latin subset, 41 KB). The phone reaches Roost over the tailnet and should not need a third party to render it.

### Surfaces

**This whole section is `[data-theme='dark']`-scoped in the code, and that is deliberate, not a bug** — checked directly against the CSS while reviewing this doc. `--shadow-hard`, `--seam` and `--font-display` (Silkscreen) are only defined inside the dark theme's custom properties; `:root` (light) has none of them. Light mode's `.card` keeps `border-radius: 16px` and a soft blurred shadow, and its bubbles have no tail. The board's actual look — sharp corners, the hard shadow, the square tail, Silkscreen for names and labels — currently exists **only in dark mode**, which §2's Palette paragraph already says is the default and the one the board describes; light is a plainer fallback, not a second faithful skin. Unifying them is a real, separate, cross-cutting project (every card, sheet, bubble and heading, not one rule) — tracked as roadmap work, not folded into this pass.

- Dark mode: corners are `2px`; bubbles are `3px`. No `16px` radius, no pill cards.
- **Hard offset shadow only**, in dark mode. From the board: *"A 3px offset in deeper indigo, never a blurred grey one. Soft shadow under every card is the SaaS-kit tell."*
- Bubbles have a **square tail** in dark mode: a 6px square hanging off the crew's bottom-left and off your bottom-right, so it points at the speaker.

> **Resolved.** The Direction board lists "Keeping the cards" under *what I threw out* ("Sections are divided by a seam now"), but the Effects board's footer describes hard shadows under cards. The app follows Effects: cards with hard shadows, in dark mode. Seam-divided sections were not built and are not planned against this doc.

### Layout that must not break on a phone

- Verify at a **true** 390px mobile viewport (§6). Desktop Chrome will not make a window that narrow, so a `--window-size=390` screenshot is laid out wider and cropped.
- **A flex child will not shrink below its content unless told to.** Every text container inside a flex row that should truncate needs `min-width: 0`. Without it, a long auto-title made the page 504px wide, and the phone zoomed the whole thread out to fit.

---

## 3. The crew as animation

### The frame set

Each drawn crew member has up to eleven 256px transparent webp frames in `web/public/crew/<name>-<pose>.webp`:

| Pose | Used for |
|---|---|
| `idle` | resting; the frame every cycle returns to |
| `type` | a reply streaming (two-frame cycle with `idle`) |
| `think` | reasoning (two-frame cycle with `idle`); the thinking bubble |
| `blink` | the middle beat of waking |
| `sleep` | asleep on home; the first beat of waking |
| `cheer` | a gate passed; the tracker reaching Done |
| `peek` | an approval waiting |
| `sit`, `side`, `hold`, `dance` | seats in a scene (`docs/SCENES.md`) |

All twelve personas got this seven-frame set as of `62ff2d0`. (`0e38199` is a later, different milestone: the four *scene* poses below, for all thirteen including Pip.)

### Rules for drawing them on screen — each one learned from a bug

1. **One drawing on screen at a time.** The frames are transparent, so a frame stacked over another does *not* hide it. The first version kept `idle` under the typing frame, and a typing owl had four wings. A two-frame pose alternates both frames in **exact antiphase** (`sprite-cut` / `sprite-cut-a`). A held pose draws **only itself**. The wake-up gives each frame its own exclusive window. Enforced: *"one drawing on screen at a time"*.
2. **Cut, never fade.** Two pixel-art frames have no drawn in-between, so a cross-fade shows a smudge. Every frame change is `steps(1, end)`. Enforced: *"the crew animates by cutting, not fading"*.
3. **`image-rendering: pixelated`** on every sprite `<img>`.
4. **Never scale a sprite by a non-integer factor, even for 300ms.** It blurs every frame. Motion on a sprite is `transform: translateY/rotate`; anything that needs to *land* (the stamp) scales the text badge beside the sprite, never the sprite.
5. **An eased filter is the one exception.** Context rot eases `saturate()` and `brightness()`, because it grades a single drawn frame and invents no in-between drawing.
6. **No sprite, no stand-in art.** `SpriteAvatar` falls back to the persona's avatar, never to someone else's frames. A missing frame degrades by *shortening* the sequence (missing `sleep` → the wake-up starts at `blink`), never to a broken-image icon.

`SpriteAvatar` (`web/src/ChatView.tsx`) is the only component that draws a crew member. Use it; don't hand-write `<img src="/crew/…">`.

### Adding a character or a pose

The pipeline that shipped every current frame:

1. Generate at 1024px with Codex `image_gen`, **one image per invocation**. Batches have silently written zero files and exited 0.
2. **Count the files and hash them.** Nine byte-identical "new" frames once shipped because a run wrote nothing and the previous directory was reused.
3. **Look at them**, beside the existing crew, at 52px and 34px. Measuring proves a change, not that it is correct.
4. **Check framing.** Character height as a share of the frame should sit in the crew's 89–99% range, or the idle↔type cut jumps in size.
5. **Check colour with a *circular* hue mean over body pixels only** (saturation ≥ 0.25, value ≥ 0.25). Averaging hue as a plain number is wrong, because red outline pixels near 360° drag it. The crew's spread across poses is 1.7–6.1°. Juno's later batch measured about 10° yellower and was recoloured to its idle.
6. Downscale with an exact 4× **BOX** reduction to 256px lossless webp. Keep the 1024px original in `.roost-data/sprite-raw`.
7. Add `sprite: '<name>'` to the persona in `server/src/crew.ts`.

---

## 4. Motion that carries information — the eight

| # | Board demo | Reports | Built | Where |
|---|---|---|---|---|
| 01 | **The stamp** | a gate passed or failed | ✅ pass · ✅ fail | `.verify-msg.{pass,fail}.fresh .verify-badge` → `stamp-land` |
| 02 | **Fuel actually draining** | quota was spent | ✅ | `UsagePanel.tsx` `FuelSummary`, `motion.ts` `fuelBlocks` |
| 03 | **Use it or lose it** | capacity will expire unused | ✅ | `ChatView.tsx` `SpendIt`, `motion.ts` `expiringBlocks` |
| 04 | **Context rot, visible** | the context is degrading | ✅ | `motion.ts` `rotFor`, `--rot` on `.messages` and `.context-face` |
| 05 | **Commands type themselves** | a command is being run | ✅ tool chips · ✅ caret | `ToolChip`, `ToolRun`, `.tool-caret`, `motion.ts` `typeSteps`/`typeDurationMs` |
| 06 | **The job folds** | a job closed | ✅ | `chapters.ts`, `ChatView.tsx` `ChapterFold` |
| 07 | **An agent that needs you** | an approval is waiting | ✅ pose · ✅ ring · ✅ haptic (Android) | `.crew-sprite.pose-peek`, `.approval-ring`, `navigator.vibrate` |
| 08 | **Finishing is worth something** | a whole job verified | ✅ cheer (whole crew) · ✅ confetti | `Confetti`, `chapterCrew`, `.verify-msg.fresh .crew-sprite.pose-cheer`, `tracker-cheer` |

Every one-shot above plays **only for items that arrived live** (§5, *Freshness*).

### 01 · The stamp

- **Board:** *"A gate passing is the highest-evidence moment in the product. It lands with weight and carries the exit code, not an adjective. Failure stamps red and unfurls the output."*
- **Built:** on a live passing verify, the `PASSED` badge lands: `stamp-land`, 420ms, `scale(1.8) → 0.94 → 1`, overshoot easing, `both`. It scales the **text badge only**; the cheering sprite beside it is never scaled. Each gate row shows the command and `exit N`. A failing gate's `<details>` opens by itself, which unfurls its output.
- **Built, 2026-09-24:** `.verify-msg.fail.fresh .verify-badge` shares the same `stamp-land` rule; the badge is already `--danger` on a failure, so no new colour was needed.

### 02 · Fuel actually draining

- **Board:** *"The block you just spent flares, then goes dim. An abstract percentage becomes a thing you watched leave."*
- **Built:** the gauge is 20 blocks. `UsagePanel` keeps the **previous snapshot beside the current one**, and `fuelBlocks(prev, now)` marks `spent` only for the difference between two real readings of the same window. `.fuel-block.spent` plays `fuel-flare` (1.6s: brightness 2.2 and a 2px lift, settling to the used colour). The row is keyed on the reading, so a new spend replays the flare, and it plays exactly once. There is no timer.
- **Rules (tested):** no flare on first sight, since there is no "before" to spend from; no flare on a reset, since a drop isn't spending; no blocks at all when there is no reading. Unknown renders "no data", never an empty, reassuring bar.

### 03 · Use it or lose it

- **Board:** *"Capacity that expires unused pulses; capacity you keep sits still."* It shows the label *4 BLOCKS EXPIRE IN 40M*.
- **Built:** in the "Spend it" banner, `expiringBlocks(headroomPct)` of 10 blocks breathe (`expire-breathe`, 1.7s, opacity 1 → 0.28). The spent blocks sit still.
- **Why it may loop:** the risk persists until the window resets or you take the boost. Either one removes the surplus from the session meta and unmounts the banner, so the pulse ends because its cause ended. It is on the sanctioned-loop list.
- **Partial:** the board's terse block-count label was replaced by the weekly-windows copy in `6824f6a`. Keep the blocks; the wording is a copy decision.

### 04 · Context rot, visible

- **Board:** *"As the window fills past degrading, the agent dims and desaturates. You feel quality dropping before a number says so."*
- **Built:** `rotFor(percent)` is 0 up to 60% (`ROT_START`, the `degrading` threshold) and 1 at 90% (`ROT_FULL`), linear between. It is set as `--rot` on the thread and on the context bar's face. The live engine's sprites get `saturate(1 − rot × 0.85) brightness(1 − rot × 0.3)`, eased over 1.4s. Only the **live engine's** faces drain (`[data-live-agent] .crew-sprite[data-agent]`), because a Codex reviewer's context is not this session's. The colour comes back when the context drains after a compaction. The drained face sits directly above the compaction offer it leads to.
- **Rule (tested):** a `null` reading drains nothing. A character going grey because the meter is offline would be a lie. This is the same rule that keeps "unknown" from ever counting as pressure.

### 05 · Commands type themselves

- **Board:** *"Gate output is terminal text, so it arrives like terminal text."*
- **Built:** a live tool chip reveals its detail with a stepped clip: `type-in`, `clip-path: inset(0 100% 0 0) → inset(0 0 0 0)` over `steps(n)`, with `n = min(48, length)` and duration `min(900ms, 22ms × length)`. Using a clip rather than a width works on any font and leaves the chip's truncation alone. The chip shows **what the call is doing** via `toolDetail()` (`server/src/toolDetail.ts`): the command for Bash, the path for a file tool, the pattern for a search. It used to show raw JSON, which the animation then typed out punctuation first.
- **Built, 2026-09-24:** `.tool-caret`, rendered only while `!item.done` and removed the instant it flips -- the element's presence is the gate, not the loop. Deliberately NOT a `::after` on `.tool-detail`: that span truncates with `overflow: hidden`, so a pseudo-element caret inside it is clipped away on any truncated (i.e. most) command -- found while building it, not guessed. It lives in **two** places: the plain `ToolChip` for a single call, and the folded `ToolRun`'s summary row, which is the one actually on screen during a live run (calls fold into prose by default, `4edc827`) -- a caret only on the hidden, expanded chip would never be seen.

### 06 · The job folds

- **Board:** *"When gates pass the chapter collapses into its named row, so you see where it went and nothing feels lost."* The Chapters board adds: *named after the work, not the date*, and *this only changes what you see, never what the agents remember.*
- **Built:** `chaptersOf(items)` is a pure function. A job runs from its first message until a verify **passes**. A failed verify leaves it open as *needs work*. Chapters tile the thread exactly, with nothing lost or duplicated (tested). `chapterName()` drops the preamble and the leading verb: "Add a --json flag to the avatar generator" becomes *--json flag to the avatar*. A verified job folds into a row with faces, name, who and how many turns, and status.
- **The fold itself:** `grid-template-rows: 1fr → 0fr` on the body, **never a pixel height**. The board's own fold tile clipped its name because a Silkscreen row measured 36.2px against a 36px cap. A job that closes **live** waits **1.8s** before folding, so the stamp and the cheer are seen first. Measured: 355px open through 1.6s, 210px at 2.2s, 0 at 2.7s. Replayed history arrives already folded.
- **Not built:** the board's day grouping and week rows. Transcripts don't survive a server restart, so a thread rarely spans days yet.

### 07 · An agent that needs you

- **Board:** *"Approval turns the sprite toward you with one ring of attention. Paired with a haptic tap you can feel it without looking."*
- **Built:** the approval sheet shows the asking crew member in the `peek` pose with a slow lean (`peek-lean`, 2.4s, ±3°). It is the persisting-state loop the whole rule set was written around: it waits until you answer. The sheet names the crew member ("Wren wants to use Bash") via `crewAsking()`, not the vendor.
- **Built, 2026-09-24.** The ring: `.approval-ring::before`, a one-shot expanding `box-shadow`-style border, keyed on `session.pendingApproval.requestId` rather than the item-replay `.fresh` flag -- an approval has no replay/live distinction the way a chat item does (it is either pending or it is not), so a new `requestId` mounting the element IS the "arrived" event. The haptic: `navigator.vibrate(60)` fires once per new `requestId`, in a `useEffect`. **iOS Safari does not implement `navigator.vibrate`**, confirmed unchanged; those readers get the visual ring and the existing ntfy push when nobody is watching, not a silent failure.
- **Not built:** one distinct vibration *pattern* each for pass, fail and approval, as the board's footer asks -- today every haptic is the same single 60ms pulse.

### 08 · Finishing is worth something

- **Board:** *"Gates green on a whole job and the crew celebrates, once, briefly. The only unprompted delight in the app, and it has to be earned."*
- **Built:** on a live passing verify, the crew member hops in the `cheer` pose (`cheer-hop`, 620ms, `translateY 4 → −7 → 1 → 0`, `both`). It fires **only on a pass**, because a failed gate getting a celebration would undo the point of having a gate. The job tracker cheers when it reaches Done (`tracker-cheer-hop`), and a plain chat turn gets its own finished beat (`4734539`).
- **Built, 2026-09-24.** `<Confetti>`: 5 absolutely positioned pieces in lamp, claude and codex colours, staggered 70ms apart, rising 26px and fading over 1.4s, `both`, once, gated on `r.passed && fresh`, hidden under reduced motion. Every member of `chapter.crew` takes the `cheer` pose (`ChatView.tsx` threads `chapterCrew={ch.crew}` from the render loop's own chapter down through `Message` to the verify case), falling back to the single live `crew` when no chapter is known (a bare fixture, for instance).

---

## 5. Mechanics every animation uses

### Freshness: replayed history does not perform

Opening a session **replays** its transcript. Without a guard, every past verify would stamp and cheer, and every past command would type itself, the moment you opened the thread. That is motion reporting yesterday.

- `SessionCore.replayedCount` (`web/src/useSession.ts`) is the number of items the replay produced. **Items at or past that index arrived live.**
- `ChatView` passes `fresh={i >= session.replayedCount}` to each item. One-shots are scoped to `.fresh`.
- **Never use a clock for this.** The phone's clock and the Mac's need not agree closely enough to tell "just now" from "before you opened this".

### One-shots and loops

- A one-shot is `animation: <name> <duration> <easing> both` with **no iteration count**. It holds its last frame.
- A loop is `infinite` **and** appears in the sanctioned list in `server/tests/doctrine.test.ts` ("the only things that repeat are states that persist"). The test enumerates every `infinite` selector in the stylesheet and fails on any without a stated cause. As of this writing it finds: `frame-a`/`frame-b` (typing, thinking), `pose-peek`, `expiry-block.expiring`, `typing-dots`, the spinners, and `.amb-*`.

### Reduced motion

Every effect has a `prefers-reduced-motion: reduce` rule. The board's standard is *"Every effect collapses to its final frame. The stamp still reads VERIFIED; it just doesn't land."* In practice: `animation: none`, with the end state held (the fold stays folded, the wake-up shows the idle frame, the sprite shows its pose frame). A new effect is not done until it has one. The doctrine test checks the named selectors.

### Collapse without pixel heights

Anything that collapses uses a one-row grid (`grid-template-rows: 1fr → 0fr`) with `overflow: hidden; min-height: 0` on the child. A `max-height` tuned to today's font is a clip waiting for the next type change.

### Timing reference

| Effect | Duration | Easing |
|---|---|---|
| Typing / thinking frame cut | 0.62s cycle | `steps(1, end)` |
| Wake-up (sleep → blink → idle) | 900ms, 220ms stagger per member | `steps(1, end)`; rise on `cubic-bezier(0.22, 1.3, 0.36, 1)` |
| Stamp | 420ms | `cubic-bezier(0.2, 1.6, 0.4, 1)` |
| Cheer hop | 620ms | `cubic-bezier(0.3, 1.5, 0.5, 1)` |
| Fuel flare | 1.6s | `cubic-bezier(0.2, 0.8, 0.3, 1)` |
| Expiry breathe | 1.7s loop | `ease-in-out` |
| Peek lean | 2.4s loop | `ease-in-out` |
| Command typing | ≤ 900ms | `steps(n)` |
| Chapter fold | 700ms after a 1.8s delay | `cubic-bezier(0.6, 0, 0.3, 1)` |
| Context rot | 1.4s transition | `ease` |
| Zzz visit | 17s | — |
| Approval ring | 900ms, once | `cubic-bezier(0.15, 0.8, 0.3, 1)` |
| Confetti rise | 1.4s, once, 70ms stagger | `cubic-bezier(0.15, 0.7, 0.3, 1)` |
| Command caret | 900ms loop, while running | `steps(1, end)` |

---

## 6. Proving it works

Most motion bugs in this project were caught by rendering, not by reading. The four-winged owl, the ghost ears, the clipped fold name and the 504px page were all reasoned correct before they were seen.

1. **Doctrine tests** (`server/tests/doctrine.test.ts`) pin the rules above against the source: cut-not-fade, one drawing at a time, wake-up runs once, the sanctioned loops, freshness gating, grid-track collapse, and the chapter rules. Add one for any new rule. Then **break the code and watch the test fail**, because a test that passes with the guard deleted is not a guard.
2. **Pure functions are unit-tested** in `web/src/motion.test.ts`, `chapters.test.ts` and `color.test.ts`.
3. **Fixtures** render canned threads through the real `ChatView`, with no socket and no server calls: `/?fixture=<name>` for `chapters`, `chapters-live`, `signed-out`, `approval`, `full-auto`, `triage`, `routed`, `toolrun`, `mention` and `tracker` (`web/src/fixtures.ts`). Use them for states that are expensive or impossible to reach live, like a verify that passes. Don't spin up real sessions: they spend quota and touch real repos.
4. **Look at it on a real phone viewport**, with `scripts/shoot.mjs` (Playwright, the system Chrome via `channel: 'chrome'` — not puppeteer-core, which is not a dependency here): `node scripts/shoot.mjs <out-dir> name=/path ...`. It measures `document.documentElement.scrollWidth` and reports every element that pokes past the viewport, so "it overflows" is a measurement, not an impression. `window.innerWidth` becomes the *zoomed-out* width when something overflows, so the script compares against the real device width, not `innerWidth`.
5. **Freeze animations to inspect a single frame.** Iterate `el.getAnimations()`, then `a.pause(); a.currentTime = t`, then list which frames have `opacity > 0`. This is how the one-drawing-at-a-time fix was proved: typing @100ms shows idle only, @400ms type only; wake @250ms sleep, @600ms blink, @880ms idle.
6. **Measure motion over time**, not from one screenshot. Sample a bounding box at intervals (the fold: 355 → 355 → 355 → 210 → 0px).

### Mistakes this project has already made

| Mistake | What it looked like | The rule now |
|---|---|---|
| Idle kept under the typing frame | a typing owl with four wings | one drawing at a time |
| Cross-fading two frames | a sprite "fading into" another | `steps(1)` |
| Collapsing to a fixed `max-height` | the fold clipped its own name | grid `1fr → 0fr` |
| One-shots on replayed items | every past verify stamps on open | gate on `replayedCount` |
| Flaring on the first reading | fuel "spent" on page load | no flare without a real previous reading |
| Treating `null` as pressure | a character greys when the meter is offline | unknown drains nothing |
| Plain mean of hue | a phantom 28° shift between two identical frames | circular mean, body pixels only |
| Trusting `--window-size=390` | a sideways overflow that wasn't real | device emulation |
| A flex child without `min-width: 0` | a real 504px page and a zoomed-out thread | truncate inside flex rows |

---

## 7. What's left from the board

In rough order of value:

1. ~~**The approval ring and a haptic**~~ (07) — done. The ring: a keyed one-shot `box-shadow` expansion on the asking crew member's face, keyed on `requestId` (an approval has no replay/fresh distinction the way a chat item does — it is either pending or it is not — so a new `requestId` mounting is the trigger). The haptic: `navigator.vibrate()` fires once per new `requestId`, Android-only by the platform's own limits; iOS gets no vibration from a page, and still gets the existing ntfy push when nobody is watching.
2. ~~**The red stamp on failure**~~ (01) — done. `.verify-msg.fail.fresh .verify-badge` gets the same `stamp-land`; the badge is already `--danger` on a failure.
3. ~~**Confetti and the whole crew cheering**~~ (08) — done. On a fresh pass, every member of `chapter.crew` takes the `cheer` pose (not only the live one), and 5 small squares in lamp/claude/codex colours rise and fade once from the verify head, gated on `.fresh`, off under reduced motion.
4. ~~**The idle breath decision**~~ (§1) — struck, not built. It is exactly the ambient motion §1's rule forbids — reporting nothing that changed — and the board's own footer calls it *"the only unprompted delight"*, a claim item 08 (cheering) already earns honestly. Recorded here so it is a decision, not a silent gap.
5. ~~**A caret while a command runs**~~ (05) — done. `.tool-chip.running .tool-detail` gets a blinking block caret; it stops the instant `item.done`.
6. ~~**Day and week rows for chapters**~~ (06) — done, 2026-09-24. `chapters.ts` gains `dayLabel`/`groupChaptersByDay`, pure functions taking `now` as a parameter; `ChatView` renders a `.day-row` divider only when the thread actually crosses a bucket (Today / Yesterday / a weekday / "Week of <date>"), so the common single-day thread shows none of it. `?fixture=chapters-days`.
7. ~~**Seams versus cards**~~ (§2) — resolved in §2: cards, in dark mode, stay.
8. ~~**The stepped pixel tail.**~~ Done, 2026-09-24. Three diminishing squares (6px flush with the corner, 4px, 2px) marching diagonally off the bubble, one rule via stacked `box-shadow` copies of the existing tail pseudo-element (offset walks each copy further out, negative `spread` shrinks it) rather than new elements.
9. **Light and dark parity** (§2, new). The board's actual surface language — hard shadow, sharp corners, the tail, Silkscreen — is dark-mode-only. Unifying light mode to match is real, cross-cutting work: every card, sheet, bubble and heading, not one selector. Tracked here, not attempted in this pass.

### Checklist for a new animation

- [ ] It answers *what just happened* (a one-shot) or *what is true until it isn't* (a loop tied to that state).
- [ ] One-shots use `both` and no iteration count, and are gated on `.fresh`.
- [ ] Loops are added to the sanctioned list with the reason they end.
- [ ] Sprites cut with `steps(1)`, show one drawing at a time, are never scaled by a non-integer factor, and use `pixelated`.
- [ ] Nothing collapses to a pixel height.
- [ ] Unknown data produces no motion.
- [ ] There is a reduced-motion rule, and it holds the final frame.
- [ ] A doctrine test pins the rule, and breaking the code makes the test fail.
- [ ] It has been seen at a true 390px viewport, frozen at its key frames.
