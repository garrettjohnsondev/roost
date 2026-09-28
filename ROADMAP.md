# Roost — Roadmap

*Written for whoever picks this up next: Garrett, or an agent working in this repo. It exists so the reasoning behind each decision survives the chat log it came from. Cited claims are graded **[A]** peer-reviewed/replicated, **[B]** preprint or systematic study, **[C]** vendor claim, **[D]** practitioner anecdote.*

---

## 1. What this is

**One chat, with a project loaded, where a named crew of Claude and Codex agents plan, review, and dispatch the right workers — Haiku to Fable, minimal to Sol — with a transparent fuel gauge across every subscription and routing that spends the right quota at the right time.**

Roost already had the hard part: a mobile PWA reachable over Tailscale that drives both engines on the *right* transports — Claude in-process via `@anthropic-ai/claude-agent-sdk`, Codex via `codex app-server` JSON-RPC. What it lacked was orchestration. What `agent sync` had was orchestration, buried under 1.34 GB of art and shelling out to CLIs. This repo is the merge, keeping Roost's transports and porting agent-sync's *ideas* — mostly as prompts and policies, not as code.

### The frame — read this before proposing anything

**"Saving tokens" is the wrong goal, and the right one is better.** On flat-rate plans the marginal cost of another frontier call is zero, which kills the cost argument for orchestration outright ([AkitaOnRails](https://akitaonrails.com/en/2026/04/25/llm-benchmarks-vale-a-pena-misturar-2-modelos/)) **[B]**. What actually binds is **rate limits on one account**. The fix for that is routing through the *other* provider's quota and through cheaper tiers — which a Claude+Codex harness does natively.

So: **this is a rate-limit-management and quality harness.** Every claim the UI makes must be phrased that way. **Dollar figures stay off the UI entirely** (decision 7, correction 14). Where a valuation must appear at all — logs, exports — it is an API-list-price *valuation*, labelled **"API value"**, never "spend".

---

## 2. Status

| Phase | What | State |
|---|---|---|
| **0** | Truth — pricing, ledger, quota, policy, correct capture | ✅ **Done, verified live** |
| **4b** | Effort as a routed dimension | ✅ **Done** |
| **4c** | Context metering (three windows) | ✅ **Done** — metering, and compaction offered with a remembered answer |
| **1** | The crew — personas, roles, avatars | ✅ **Done** |
| **2** | Dispatch primitive — `runAgentTask`, task-shaped definitions, sliced project file | ✅ **Done, verified live** |
| **3** | The conference — plan → review → reconcile → execute → verify | ✅ **Done** |
| **4** | Quota-aware model routing + budget ceiling | ✅ **Done** — routing, gate, boost, task ceiling, and the measured window-weight estimator (null until it has samples) |
| **4d** | Modes — chat / auto / plan / build | ✅ **Done** |
| **5** | Verification gate | ✅ **Done** — gates, evidence, tamper check, image checks, diff reviewer |
| **7** | Model registry and auto-update | ✅ **Done** — roster, succession, audit, the one-tap assign card, and **alias-resolution drift** for Claude |
| **6** | UI — fuel gauge, crew editor, context meter | ✅ **Done** — fuel gauge, window weights, crew editor, context meter with pressure and advice, decisions view, models card |

**650 tests green, typecheck clean both workspaces.** <!-- written by scripts/roadmap-stats.mjs on 2026-09-25: server 550/550, web 100/100 — do not edit by hand --> New modules: `pricing.ts` `ledger.ts` `quota.ts` `policy.ts` `routing.ts` `context.ts` `usageDelta.ts` `codexInputSplit.ts`.

**Verified live against both real subscriptions:**
```
CLAUDE (max)      5-hour session 23%  ·  7-day (all) 4%  ·  7-day (Fable) 0%
CODEX (prolite)   Primary (7d)   42%
```
Both via **zero-token** reads. One real Codex turn produced exactly one ledger record: model `gpt-6-astra`, 4,738 uncached + 12,928 cached = 17,666 tokens, matching the engine's own cumulative figure to the token.

**Reviewed 2026-09-21** by sixteen finders — eight Claude, eight Codex, each blind to the other — over subsystem maps produced by readers who read every file: **243 distinct findings, 66 found independently by both vendors.** Every finding acted on was reproduced against the code and the SDK/protocol types first. P0 (`a31f8c3`), P1 (`621345a`) and the follow-up batch shipped; the unshipped remainder is §12. The review itself produced correction 27.

---

## 3. The loop

```
task typed in one chat (project loaded)
   ↓  TRIAGE (cheap)      tier + task kind + size estimate
small? ──yes──→ one agent, no ceremony              ← the Rails lesson (§5)
   ↓ no
PLAN        primary writes .roost/plans/<id>.md    ← a FILE, not a chat message
REVIEW      the OTHER vendor, CLEAN context:
            task + plan file + criteria only — never the author's reasoning
RECONCILE   primary filters findings against requirements  ← prevents scope creep
EXECUTE     ONE writer holds the diff;
            read-only helpers dispatched in parallel
VERIFY      harness runs the checks; evidence = command + output + exit code
REVIEW DIFF fresh context, diff + criteria only
```

Every step renders in the one chat as a named, badged turn. Roost already draws another model's turn inline via `pushEvent({ type: 'consult', phase, agent, text })`.

---

## 4. Evidence base — build this, not that

| Pattern | Evidence | Verdict |
|---|---|---|
| **Verification the executor cannot author** | Self-Debug 80.4→92.5 pass@1 **[A]**; [Huang et al. ICLR 2024](https://arxiv.org/abs/2310.01798) — self-correction *without* external signal **degrades** reasoning **[A]**; [METR](https://metr.org/blog/2025-06-05-recent-reward-hacking/) — telling a model not to cheat has "nearly negligible effect" **[B]** | **Highest-value item.** |
| **Fresh-context reviewer, starved** | [Cross-Context Review](https://arxiv.org/html/2603.12123) F1 28.6% vs self-review 24.6%; **including the author's prompt made review worse than self-review** **[B]**; [Cognition](https://cognition.com/blog/multi-agents-working) ~2 bugs/PR, 58% severe, better with a *clean* context **[D]** | **Build. Starve it deliberately.** |
| **Externalised plan state** | Magentic-One ablation: **−31% without the ledgers** **[B]**; convergent with Cursor plan files, Windsurf `plan.md`, Devin task ledger | **Plan is a file.** |
| **Context isolation, read-heavy only** | [Context Rot](https://www.trychroma.com/research/context-rot) — all 18 frontier models degrade with length **[B]**; Anthropic subagent read 6,100 tokens, returned 420 **[C]** | **Explore / review / test only.** |
| **Role-based model routing** | [Aider](https://aider.chat/2025/01/24/r1-sonnet.html) 64.0% @ $13.29 vs o1 solo 61.7% @ $186.50 **[B]**; Cline telemetry: plan turn 2–5k vs act turn 8–20k tokens **[C]** | **Cheap models on mechanical work only.** |
| **Single-threaded writes** | Every source agrees; "reads parallelize, writes don't" ([LangChain](https://www.langchain.com/blog/how-and-when-to-build-multi-agent-systems)) | **Non-negotiable.** |
| **Multi-agent *debate*** | Underperforms self-consistency at matched compute **[A]**; plateau at 2–3 rounds then degrades **[B]**; [E2EDevBench](https://arxiv.org/html/2511.04064v1) — adding a Designer dropped 43.0% → **32.8%** **[B]** | **One review pass. Cap at two. Never three.** |
| **Parallel writers on shared scope** | Cognition's Flappy Bird failure **[D]**; produced our own merge-gate thrash in agent-sync | **Do not build.** |

### The uncomfortable summary

**Every benchmark pitting multi-agent orchestration against a strong single coding agent showed orchestration losing or barely tying.** Anthropic's own +90.2% multi-agent figure comes with the caveat that **token usage alone explained 80% of the variance, at 15× the tokens** — mostly bought compute, not architecture **[C]**. The conference is the least-evidenced part of this design, which is why it is built **bounded, size-gated, instrumented and switchable off**.

### Why cross-model review is still defensible

Not because "debate makes it smarter" — that's contested at matched compute. Because **a second vendor's model is external signal**, and [Huang et al.](https://arxiv.org/abs/2310.01798) **[A]** shows intrinsic self-correction *without* external signal actively degrades reasoning. That's the whole mechanism. The accept/reject decision must still rest on a verifier or a human, never on two models agreeing.

---

## 5. Load-bearing decisions

1. **Build in Roost, not agent-sync.** Every quota bug in agent-sync was downstream of scraping CLIs instead of using supported protocols. Roost made the other choice.
2. **One writer, always.** Subagents read or advise. The only supported parallel-write pattern anywhere is a *tournament* (competing implementations, pick one, discard the rest) — not a team.
3. **Size-gate the ceremony.** Below **10+ files or 3+ independent pieces** (Anthropic's published threshold), skip the conference. On a coherent mid-size Rails build, solo Opus scored **97 in 18m for $4** while every mixed config tied or lost, slower and dearer — and the orchestrator's own turns added **~$11 across 14 dispatches**.
4. **Delegation propensity is miscalibrated in both directions.** Given a free choice, models in one study delegated *zero* times; Opus 5 over-delegates enough that Anthropic prompts it down. **Gate on measured size, never on the model's self-assessment.**
5. **Both sides must be frontier.** Cognition's asymmetric "smart friend" failed: the weaker primary set the quality ceiling and couldn't tell when to escalate. Never make a cheap model the primary with a frontier advisor.
6. **Unknown is never headroom.** The single most expensive bug in agent-sync's history. See §8.
7. **No number renders that the data can't support.** `null` is a first-class state everywhere: `usedPercent`, `costUsd`, `SavingsReport`. Any `?? 0` on a cost, percent or savings figure is a bug.

8. **No free-model tier. Rejected 2026-09-21, after research, by Garrett.** The idea was free models for the first planning/triage pass, a free tier for users, and auto-degrade to free at the limit ceiling. It dies on **privacy, not rate limits**. Most free endpoints are paid for with your prompts: Gemini's free tier states human reviewers may read input and warns against submitting confidential data; Mistral's free tier requires opting into training; and OpenRouter returns **404 on every `:free` model if you disable prompt logging** — free access is *conditional* on letting them train. For private repos the safe set collapses to Groq (contractual no-training + self-serve ZDR, but ~8K TPM), Cloudflare Workers AI, and local Ollama — too narrow to plan with. The quality evidence points the same way: free models are adequate for triage, classification and labelling, never for patch generation. **Do not revive this without a no-training provider that can hold a real planning context.** Related dead ends: `cheahjs/free-llm-api-resources` (~29.4k★) is **deleted — 404**, mirrors are stale; GitHub Models was **fully retired 2026-07-30**; `zukixa/cool-ai-stuff` routes through paywall-circumventing reverse proxies. If a free path is ever wanted, use **LiteLLM**'s `fallbacks` + `allowed_fails` + `cooldown_time` rather than building rotation, and resolve model ids at runtime — every hardcoded free list in the wild is already stale.

9. **One subscription is a first-class configuration.** Only cross-vendor review and cross-quota routing need both; verification, effort routing, context metering, dispatch and the fuel gauge all work alone — and the fuel gauge matters *more* without a fallback window. See §6.

---

## 6. Operating on one subscription

**A single-subscription user is a first-class configuration, not a degraded one.** Everything above is written in terms of two flagships talking, which reads as though both are required. They are not, and being precise about this matters: most people have one subscription, not two.

**Exactly two things need both vendors:**

1. **Cross-vendor review** — a second vendor's model as genuinely independent external signal.
2. **Cross-quota routing** — spending the other provider's window when yours is tight.

**Everything else works untouched**, including the two most important things in this document:

| Feature | One subscription? |
|---|---|
| **Verification gate** (§4's highest-evidence item) | ✅ Unaffected — a harness-run script does not care who wrote the code |
| **Effort routing** (the novel item, §10) | ✅ Unaffected — entirely within one vendor |
| Honest fuel gauge, burn rate, surplus detection | ✅ **Matters *more*** — with no second window to fall back on |
| Context metering and the dispatch→compact→handoff ladder | ✅ Unaffected |
| Tier routing (light/standard/heavy) | ✅ Unaffected — each vendor ships 4–5 distinct models |
| Model registry and auto-update (Phase 7) | ✅ Unaffected |
| Crew identity, avatars, roles | ✅ Unaffected |
| Subagent dispatch — where the token savings actually live | ✅ Unaffected |
| Size-gated ceremony, plan-as-file | ✅ Unaffected |

Read against §4's own uncomfortable summary, this is a better story than it first appears: **the single-subscription user loses the least-evidenced feature (the conference) and keeps the best-evidenced one (verification).**

### Review without a second vendor

The mechanism in §4 is **fresh context**, not vendor diversity. [Cross-Context Review](https://arxiv.org/html/2603.12123) measured *same-model* fresh-context review beating self-review (F1 28.6% vs 24.6%), and found that including the author's prompt made it **worse than self-review**. Vendor diversity strengthens the signal; it is not what creates it.

So `reviewerFor(planner)` picks, in order:

1. **The other vendor** — strongest. Independent training, independent blind spots.
2. **A different model, same vendor** — Opus plans, Fable reviews; Sol plans, Astra reviews. Both vendors now ship 4–5 genuinely distinct models, so this is real diversity inside one subscription.
3. **Same model, fresh context, plan and criteria only** — weakest. Shares every blind spot with the author.

**Label the strength in the UI; never present tier 3 as equivalent to tier 1.** Same-family models share training lineage, so they share failure modes — a reviewer that cannot see the author's mistake is worth less than one that can, and pretending otherwise is the "smart friend" error in §5.4 wearing a different hat.

### What changes elsewhere

- **Detection is already free.** `refreshRegistry()` fetches both rosters with `Promise.allSettled`; a vendor that fails to answer is a vendor the user does not have. No extra probe, no extra prompt for credentials.
- **Never offer what isn't there.** One fuel gauge, not two greyed ones. No cross-vendor review promised in the UI. An absent vendor is absent, not "unknown" — this is the one place where missing data has an unambiguous meaning.
- **Scarcity routing degrades to tier and effort only.** With nowhere to route, §7's ladder still steps *down* within the vendor; it simply cannot step *across*. `policy.ts` already distinguishes these — `hardstop` requires that there be nowhere to route, which is exactly the single-subscription condition.
- **Surplus still applies**, and is arguably the bigger win: burning an about-to-reset window at a higher tier is pure profit when there is no second account to spend instead.

---

## 7. Phases

### ✅ Phase 0 — Truth *(done)*
`pricing.ts` (no catch-all row) · `ledger.ts` (per-call, role + persona attribution, `savings()` returns null) · `quota.ts` (expired windows **purge to unknown**, Codex snapshots merge) · `policy.ts` (75/90/98) · per-call delta capture at both adapters · `usage.ts` as a facade · zero-token structured Claude usage read.

**The gate, now a permanent test:** Σ per-call tokens === the engine's cumulative total, exactly.

### ✅ Phase 4b — Effort as a routed dimension *(done)*
`chooseEffort(tier, kind, headroom, surplus, supported, adaptive, configured)`. Mechanical work capped low regardless of tier. **Trims thinking before downgrading the model** under pressure; **raises thinking first** under surplus. Three refusals to guess: never override an explicit human choice; defer to `supportsAdaptiveThinking`; clamp explicitly to `supportedEffortLevels` rather than let the SDK downgrade silently.

`shouldApplyEffort()` protects the prompt cache — see §8, correction 4. It was defined but **never called from live routing** until 2026-09-21 (correction 26).

### ✅ Phase 4c — Context metering *(done)*
Three windows, and conflating them is how long sessions rot:
1. **Roost's transcript** — ours. Currently RAM-only, capped 5,000 events, lost on restart.
2. **Each engine's session** — theirs. Degrades *before* it overflows.
3. **Subagent contexts** — fresh, discarded. Where the savings live.

Metered via Claude `getContextUsage({detail:'summary'})` (a **stable** API) and Codex `modelContextWindow` + per-turn breakdown (free). Thresholds deliberately tighter than any auto-compact trigger. Advice escalates cheapest-first: **dispatch → compact → handoff**.

**Compaction is offered, never silent.** At `degrading` the meter asks, with a *Keep doing this automatically* checkbox; answer once and it persists across restarts, and the switch is two-way from the meter itself. Only compaction is ever one-tap — `dispatch` needs a task and `handoff` costs continuity, so those stay advice. The mechanisms differ and the code says so rather than pretending otherwise: Codex has a real `thread/compact/start` RPC (verified against `codex app-server generate-json-schema`, codex-cli 0.154.0), Claude has no programmatic compaction at all, only `/compact` plus observation, and that command is pushed to the input stream *without* emitting a `user_message` so the transcript never claims you typed it. `unknown` is never pressure — a null percent can only act on an explicit `overLimit`.

### ✅ Phase 1 — The crew *(done)*
`personas.js` → `crew.ts`, mapping `(suite, model) → {name, tier, colour}` with user overrides, plus **`role`** as a field distinct from `tier` (`planner | reviewer | executor | explorer | tester | dispatcher`) — persona is *who*, role is *what hat*. `rosterBlock()` injects names into prompts so narration reads *"Sending Larry in to build the UI."* Every chat turn shows avatar + name + role badge + model id.

**Identity keys on `(suite, model-match)`, never on session** — so a crew member keeps their face when the vendor ships a new version underneath them. Sol stays Sol from 5.6 to 5.7. That is the same succession property Phase 7 detects, and it is why the two phases reinforce rather than collide.

**Avatars are generated, not ported.** The original plan — downscale the agent-sync cast art to webp — was replaced on 2026-09-21 for two measured reasons. First, Codex ships a built-in `image_gen` tool requiring **no `OPENAI_API_KEY`**: it runs off the subscription, verified end to end. Second, `sips` reports success on webp export but **writes no file**, so the pool ships as 128px PNG (~24 KB each) unless a real encoder is added as a dependency.

**On cost — and the mistake worth keeping.** The turn reports real text tokens (**11,866 for one image, 41,465 for four**; batching saves only ~13%), and I first treated that as weekly-window burn, calling a 30-avatar pool "a meaningful slice". **Measured, it is not:** a clean before/after over the 26-avatar build run moved the Codex weekly window **43% → 44%**, about **0.04% per generation**. Reported tokens say ~270k for that run; the window says 1%. Image generation is close to free in the currency that actually binds. See correction 14 — this is the proof case for §10's whole argument.

The pool is still a **build-time asset**, but for different and better reasons than cost: it is instant, it requires no Codex subscription to *use*, and it gives the app a consistent art direction rather than whatever each user's prompt produced. `tools/gen-avatars.mjs` is run by a maintainer and its output is committed. Runtime generation (`POST /api/avatars/generate`) is available to anyone with Codex and should be presented as ordinary, not as an expensive escape hatch.

Two details worth keeping: the background colour is **specified in the prompt, not sampled back out of the PNG**, so every chip colour is exact by construction; and the light model drifted to shaded cartoon when asked for flat vector, so the generator uses the default model and passes a **verbatim style clause**, shared with the runtime generator so a custom avatar does not look pasted in beside the pool.

### ✅ Phase 2 — Dispatch primitive *(done)*

`runAgentTask()` in `agents/dispatch.ts` — one throwaway agent, clean context, cancel handle, ledger attribution. Generalizes `startConsultStep`, which was hardcoded read-only and plan/critique-only.

**Capability modes, not tool allowlists.** `read-only | read-write | execute | all`, each mapping onto the vendor's own enforcement: Claude's `canUseTool` gate, Codex's sandbox. agent-sync gated on Bash command prefixes, which is leakier (prefix matching is a parsing problem) and weaker (says nothing about file writes). Writing and executing are **separate** capabilities, so a planner can edit without running and a test runner can run without rewriting what it tests. **`danger-full-access` is unreachable from a dispatch** — nothing the orchestrator decides alone should escape the workspace.

**Dispatched output is untrusted input.** `sanitize.ts` defangs control tags, turn markers, tool-call envelopes and foreign chat templates before the text enters another model's context. Neutralized rather than stripped, so a human reading the transcript still sees what was said. This does not require the other agent to be malicious — a reviewer quoting a file containing these markers is enough.

**Verified live, both vendors:** Claude and Codex each read the repo and answered correctly; a write attempt under `read-only` returned `BLOCKED` and created no file; per-call ledger deltas captured on both sides.

Two things the live run caught that unit tests could not. Codex usage arrives on its **own `thread/tokenUsage/updated` notification**, not on `turn/completed` — reading it off the completion params produced no ledger entry at all, silently. And the first real dispatch showed `in=14,088` against `cacheRead=13,056`: the subagent re-paying its system prompt, confirming risk 4 — **dispatch saves context reliably and tokens only sometimes.**

#### How agents are classified — and why there is no PM/Architect/UX roster

Asked directly whether each role needs its own skills and memory, the evidence says no, and says it loudly. **E2EDevBench added a Designer agent to a working pipeline and the score fell 43.0% → 32.8%**, with executors deferring to the specialist's plan over the actual requirements. Meanwhile **SWE-agent gained 3.8% → 12.5% from tool design alone** — larger than any orchestration gain measured on coding.

So an agent is strong because of **what it is given, what it may touch, what shape it must return, and what checks its output** — never because it was told it is a senior architect. The model already knows how to architect; it does not know *this project's* constraints.

Three layers, and only the third carries behaviour:

| Layer | Example | Purpose |
|---|---|---|
| **Persona** — who | Sol, Larry, Astra | Legibility; narration reads "Sending Larry in" |
| **Role** — what hat this turn | planner, reviewer, executor | Badge and routing |
| **Definition** — the contract | capability, context slice, return shape, gate | **Where strength lives** |

Definitions are therefore named for **tasks, not jobs**: `explore`, `plan`, `review`, `ui-review`, `test-runner`, `implement`. Each carries a `hat` (`scout`, `architect`, `designer`, `QA`, `lead dev`) that is **display only** — the crew still reads as a team, without the measured harm of making job titles load-bearing. An unrecognised capability **fails closed** to `read-only`.

**Project knowledge lives in one file, sliced per dispatch.** `<project>/.roost/project.md`, split on H2 headings; each definition names the sections it receives. Generic role knowledge is what the specialist experiments showed adds nothing — what is genuinely missing from a model's context is *this* project's conventions, commands, done-definition, constraints and tokens. Slicing matters as much as content: a test runner has no use for design tokens, and handing every agent the whole file is how context rot starts.

**Acceptance criteria travel with the task and are stated to outrank the plan**, because E2EDevBench's failure was executors treating a plan as authority over requirements.

**Dogfooded:** with Roost's own `project.md`, a `review` dispatch on `` `${used ?? 0}%` `` was correctly rejected for conflating missing data with zero — **by Haiku**, the cheapest model available, because it was handed the criterion rather than a job title.

### ✅ Phase 3 — The conference *(done)*
The loop in §3, wired end to end in `runConsult`:

1. **Plan** — the session's own model, read-only one-shot, required sections including **`## Acceptance criteria`**: 3–7 statements that can be *checked*, not restated steps. The plan is written to **`.roost/plans/<taskId>.md`** and the criteria are extracted from it.
2. **Review** — the most independent reviewer available (§6), **starved**: task, plan and criteria only, never the author's context. Asked for correctness problems and requirement gaps only; "no problems found" is a valid answer. Skipped by the size gate for small tasks.
3. **Reconcile** — the author filters each finding against the task and the criteria, **ACCEPT** (amend) or **REJECT** (out of scope, contradicts criteria, taste), and writes the amended plan back to the file. Without this step review findings become scope creep. **Capped at `consult.maxReviewRounds`** (default 1, hard maximum 2): a second review runs only on `NEEDS CHANGES`.
4. **Proceed** — the human, by default. `consult.autoProceed` exists for build mode and is off, because the accept/reject decision rests on a verifier or a person, never on two models agreeing. Execution gets the reconciled plan **and the criteria, stated to outrank it**.
5. **Verify** — armed on Proceed, fired when the executor's turn ends: the project gates always, and in build mode the fresh-context diff reviewer with the criteria. The report lands in the transcript and, if nobody is watching, on the phone.

Every stage logs a decision (`plan`, `reconcile`, `execute`, `verify`) with the task id, so the decisions view can answer whether the conference earns its keep.

**Dogfooded 2026-09-22** on a real three-piece task in this repo (a `--json` flag, a doc change, a unit test): **116 s** end to end — Sonnet planned, Codex gpt-5.6-terra reviewed — cross-vendor via the configured standard model, because that process had never fetched the roster (see correction 29), verdict `NEEDS CHANGES`, one reconcile round: **1 findings accepted, 0 rejected**. Five acceptance criteria were extracted, every one a command or an observable — e.g. *"`node tools/gen-avatars.mjs --json --limit 0` prints valid JSON to stdout and does not modify `pool.json` (verify via `git status`/mtime)"*. The plan file carried all five sections; both stages landed in the decisions log.

### 🟨 Phase 4 — Quota-aware routing + ceiling *(routing, gate, boost shipped)*
`route.ts` — `chooseRoute()`, pure. **Scarcity steps the tier down** (tight: one tier; gated: light only) and, for dispatch, **prefers the vendor with better *known* headroom**; **unknown and stale rank last and never win a move** — missing data is never a reason to move work. A chat session is bound to one adapter, so under pressure it gets a **suggestion** (notice + ntfy, once per state) rather than a switch. **Surplus + the user's boost toggle steps up** to the heavy tier, and boost holds (does not fire) when the window is under pressure. `chooseEffort` (Phase 4b) is now on the live path: thinking is trimmed before the model is downgraded and raised first under boost.

`gate.ts` — `guardDispatch()`, in front of **every** `runAgentTask` and every consult, *before* a process exists: vendor present, quota not exhausted, and the task inside its ceiling (`budget.maxDispatchesPerTask`, default 40; `budget.maxTaskTokens`, null by default because there is no honest universal number). `policy.ts` computed levels that nothing consulted; this is the call site. Every refusal, gated allowance and boost toggle lands in the decisions log.

**The estimator** (`quotaWeights.ts`) fits percent-of-window per million tokens, per model, from the quota history against the ledger: every pair of consecutive observations of one window is an interval; calls inside it on a single model are a sample; sums, not means of ratios, so intervals that moved 0% still count as "below the window's resolution"; resets and long gaps are skipped. **Null below three samples — never a guess.** Shown under each vendor in the fuel gauge with its confidence. Until this batch the one-shots (triage, plan, review, reconcile, diff review) never reached the ledger at all — the orchestrator's own turns were not merely unbudgeted, they were uncounted — so the estimator had nothing to fit against.

~~Still open: cross-vendor *candidates* per tier in the shipped config~~ — done, found stale 2026-09-23: `DEFAULTS.autoRoute` in `config.ts` names candidates for `light` and `standard` on both vendor profiles (commit `5e99643`, "Cross-vendor candidates, actually reachable"); `heavy` deliberately has none — moving hard reasoning between engines mid-task costs more than the quota it saves, per the comment in `config.ts`. This line was left behind after that commit shipped; corrected here rather than repeated.

### ✅ Phase 4d — Modes *(done)*
**`auto` is the default** (`consult.defaultMode`), and in it a `large` task escalates to the conference on its own — see correction 30 for why that is not a nicety. Per session, switchable, persisted: **chat** (one agent, no ceremony), **auto** (triage picks model and effort per message), **plan** (read-only — every message becomes a plan file; nothing executes; Proceed is still offered), **build** (the full conference, then the Proceed gate, then execute, then verify). Switching to auto or build puts the model on `auto`; switching back restores the last routed model.

### ✅ Phase 5 — Verification gate *(done)*
`verify.ts`. Three rules, all **structural**, none of them instructions to the model:

1. **The gate is a script the harness runs**, read from maintainer-authored sources — the project file's `## gates` or explicit checks. Agent output is never a command. The gates are **fingerprinted when the session begins**; an executor that edits them mid-task produces a report marked `tampered`, which fails regardless of what the commands then say.
2. **Evidence is command + exit code + output.** "The tests pass" is a claim; `npm test` exiting 0 with its output attached is evidence. Every run is appended to `.roost-data/evidence/<task>.jsonl` and to the decisions log.
3. **Anti-fabrication is measured.** A "screenshot" with fewer than 64 distinct colours is a flat rectangle, not a screenshot; two frames that are pixel-identical fail each other; an image that cannot be decoded is *unchecked*, never passed. This is the August lesson, mechanised.

**No gates means not verified** — a report with nothing to check is `passed: false`, because "nothing failed" is not the same as "it works".

**The diff reviewer runs last**, in a fresh context, on the diff and the acceptance criteria only — never the executor's reasoning — and picks the most independent reviewer available (§6), labelling its strength. Its findings go to the human; the accept/reject decision rests on the gates or the person, never on two models agreeing.

**In the UI:** "Run gates" and "Gates + review diff", moved 2026-09-23 from a permanent two-chip bar above every thread (user-reported: took hero space for an action that was not always relevant) into the git sheet, beside the diff they check — hidden entirely on the home screen's unattached git peek, which has no live session to act on. The report renders with the badge, each command's exit code and output tail, image verdicts, and the review.

**Dogfooded** on Roost's own `## gates` (`npm run typecheck`, `npm test -w server`).

### 🟨 Phase 7 — Model registry and auto-update *(core done)*

**The goal, in the user's words:** *"new Opus 5.5 gets released and current model is 5.4. I don't want to have to come here to Visual Studio Code and code for it."*

**The roster is data, not code.** The app must never rewrite its own source — that is unauditable and unrevertable. A registry refreshed from supported protocol calls needs no code change for a new model, ever.

Both vendors expose a live roster, and both hand us succession directly:

| | Claude | Codex |
|---|---|---|
| Listing | `query.supportedModels()` → `ModelInfo[]` | `model/list` JSON-RPC → `data[]` |
| Succession signal | `resolvedModel` drift under a stable alias (`opus` → `claude-opus-5` → `-5-5`) | `upgrade` — the vendor names the successor outright |
| Effort rungs | `supportedEffortLevels` | `supportedReasoningEfforts[]` + `defaultReasoningEffort` |
| Vendor default | — | `isDefault` |

**What the first live probe found (2026-09-21, codex 0.154.0) — all three configured Codex tiers were wrong:**

| Configured | Reality |
|---|---|
| `light: gpt-5.4-mini` | **absent from `model/list`** — deleted, not hidden |
| `standard: gpt-5.5` | **`upgrade: gpt-5.6-sol`** — vendor-flagged superseded |
| `heavy: gpt-5.6-sol` | valid, but `gpt-6-astra` is `isDefault` and "our most capable" |

The hardcoded `EFFORT_LADDER` was fiction at both ends: **no** Codex model exposes `minimal`, and four of five support `max` and `ultra`, two rungs above where the ladder stopped. This is the argument for the phase — the config rotted silently and nothing said a word.

Done: `registry.ts` — `ModelCard` normalization for both vendors, `classify()` (tier from vendor description, `null` rather than a guess), `clampEffort()`, `diffRegistry()` (added / vanished / superseded / resolved-moved / efforts-changed / default-moved), `auditRoutes()`, persisted to `models.json`. 21 tests, built from the verbatim live payload.

Pending: fetch on startup and on a timer; ntfy on change; crew persona continuity across a succession (Sol stays Sol); UI review card for an unclassified model; routing reads `efforts` instead of `EFFORT_LADDER`.

**Succession is auto-adopted; a new family is not.** Same family, higher version ⇒ same tier, same persona, adopt silently. An unrecognized model surfaces for one-tap assignment and is never routed to unreviewed — routing an unvetted model is how a weekly window disappears by surprise.

### ✅ Phase 6 — UI
Unified fuel gauge across every subscription: all windows both providers, burn rate, projected exhaustion, **per-role and per-persona spend** with the orchestrator's own turns broken out. Context meter per agent. Crew badges on every turn. Honesty rules enforced by types.

---

## 8. Corrections log

**2026-09-23 — stranded on the phone, and a probe that signed in by itself.** A Claude turn failed with an OAuth error on the phone and there was no way to recover without a terminal on the Mac: Roost used the Mac's shared interactive login — the one four separate `claude` binaries on the machine refresh — and had no sign-in of its own. Probing `claude setup-token` to see whether it could be driven headlessly, the CLI opened a browser on the Mac; the Mac was signed in to claude.ai, so the flow completed with nobody present, minted a real one-year token and printed it into the session. The owner was told immediately and asked to revoke it. The fix carries the lesson in code: the phone sign-in sets `BROWSER=/usr/bin/true` (the CLI runs `$BROWSER <url>`), so only a code the person pastes can complete it; and every test of the flow runs against a stand-in program, never the real CLI.

**2026-09-22 — a release the registry could not see.** Claude Opus 5.5 shipped and Roost's roster was byte-identical before and after, because Claude exposes ALIASES: `opus` quietly started resolving to a new model and no id changed. Phase 7's roster diff is built for Codex, whose ids are versioned and carry succession pointers, and it structurally cannot catch this. `aliasDrift.ts` closes it by diffing what an alias RESOLVES to, observed from the engine's own report of what it just ran — first sight is never announced, a pinned id never drifts against itself, and one release is announced once. Found by being told the model existed and then checking the docs rather than the roster; checking also exposed a price table that overstated Opus by nearly 4x and an adaptive-thinking branch that had been unreachable since Phase 4b.

*Mistakes made and fixed. Kept so they aren't repeated.*

| # | What went wrong | Fix |
|---|---|---|
| 1 | **"Unknown reads as headroom."** agent-sync did `if (w.resetsAt && now > w.resetsAt) continue`, so an account with only stale windows read as having room. Every stored window had been expired for six weeks; quota gating was **100% inert**. | Expired windows **purge to `unknown`**, and unknown is never headroom. `unknown`/`stale` on both suites ⇒ reprioritize, not ok. |
| 2 | **Cumulative logged as per-call.** Both engines report running totals. agent-sync recorded Codex's thread-cumulative counter verbatim — single calls at 15–18M tokens, $1,193 of fictional "spend", a "saved 86%" badge that was pure fiction. | `usageDelta.ts` is the one place cumulative becomes per-call. Permanent test: Σ per-call === final cumulative, exactly. |
| 3 | **A catch-all price row.** `{match:/./, input:3, output:15}` meant every unmatched Codex model (all recorded with `model:''`) priced as Sonnet. | **No catch-all.** A miss returns `basis:'unknown'` and `costUsd: null` — never `0`, never a guess. |
| 4 | **Effort routing destroys the prompt cache.** My first cut varied effort per message. Changing top-level effort mid-conversation invalidates the cache on most models; cache reads bill at ~1/10 of input, so the router could cost more than it saved. | `shouldApplyEffort()` — free on fresh contexts and dispatches, free with per-message effort support, otherwise only for a >1-rung jump, never after flapping. |
| 5 | **Hardcoded effort tiers overrode user config**, and the two ladders aren't aligned (Codex has an extra `minimal` rung), so a shared index put heavy at `high` on Codex and `xhigh` on Claude. | Base effort comes from `autoRoute[agent][tier].effort`. Routing *modulates* the user's config. |
| 6 | **Topping out at `xhigh` by default.** Anthropic warns `max` causes overthinking on structured work; [When More Thinking Hurts](https://arxiv.org/abs/2604.10739) **[A]** documents an inverted-U where extended reasoning abandons correct answers. | Fallback defaults stop at `high`. Bias up for hard tasks; don't top out. |
| 7 | **Blind iteration invented phantom windows.** Iterating `rate_limits` treated `spend`, `extra_usage`, `seven_day_breakdown` and null codename keys as windows. | Only rows with a numeric percent are windows. `limits[]` is the authoritative array. |
| 8 | **Non-hermetic test** — pricing read `~/.agent-sync/prices.json` from `$HOME`, so assertions depended on the machine. | `POCKET_LEGACY_PRICES` makes the legacy path explicit and disableable. |
| 9 | **Filed `personas.js` as fiction to drop.** It is the crew feature. | Ported as `crew.ts` (Phase 1). |
| 11 | **The same Claude limit stored under two keys.** The streaming `rate_limit_event` keys on `rateLimitType` (`five_hour`, `seven_day`, plus raw codenames like `nimbus_quill`); the structured usage read keys on `kind` (`session`, `weekly_all`, `weekly_scoped`). Three real windows were stored as **seven**, and the two seven-day rows *disagreed* — 3% vs 4% — so `headroom()` gated on whichever landed last. Correction 7's phantom-window bug, recurring through the other ingest path. | `canonicalClaudeKey()` maps both vocabularies onto one key per limit. The authoritative usage read (`percent`, unambiguously 0-100) beats the event's ambiguous `utilization` for 10 min. An unrecognized kind is **kept** as `claude:other:<kind>` — dropping it would over-report headroom — but labelled so it can't pass as a known window. |
| 12 | **`.unref()` on the save timer dropped the last observation.** `persist()` debounces 2s and unrefs, so the timer never holds the process open: any exit within 2s of a quota read discarded it. Observed live — 8 Claude windows in `quota-history.jsonl`, `claude.windows` empty in `windows.json`. Since `load()` purges on restart (correctly), Claude quota came back `unknown` on **every** boot, leaving the fuel gauge blank exactly when you'd open the app to check it. Failed safe, per decision 6, but blind. | `flush()` writes synchronously; `index.ts` calls it on `SIGINT`/`SIGTERM`/`beforeExit`. |
| 14 | **Read token counts as window burn.** A Codex image-generation turn reports ~11.9k tokens, so I extrapolated a 30-avatar pool to ~290k tokens and told Garrett it was a meaningful slice of his weekly window, gating the feature and asking him to pick a smaller pool. Measured against the actual limit, a clean before/after over the 26-avatar build run moved the weekly window **43% → 44%** — about **0.04% per generation**, or roughly 2,600 generations to exhaust it. **Tokens reported by a turn are not proportional to the rate-limit window they consume.** | Never quote a token count as if it were window cost. The percent-of-window-per-1k-token estimator (§7, Phase 4) is not a nicety — it is the only honest way to price anything here, and this is its proof case. |
| 13 | **Reintroduced the Codex stdin hang that agent-sync had already fixed.** The avatar generator shelled out with `execFile(..., { stdio: ['ignore','pipe','pipe'] })` — but **`stdio` is not a supported `execFile` option and is silently ignored**, so stdin stayed an open pipe. Codex drains stdin before starting work, so it sat there: 8½ minutes, exit code 0, zero images, no error. The identical bug cost 25-minute silent hangs in agent-sync. | `runCodex()` in both `tools/gen-avatars.mjs` and `server/src/avatars.ts` uses `spawn` with `stdio: ['ignore', ...]`, which actually honours it, plus a hard timeout so a hang fails loudly instead of quietly. |
| 15 | **A 1% window stored as 100%.** The structured usage read's `percent` is documented 0–100, but it went through `normalizePct`, whose `v > 1` branch skips exactly 1 and treats it as a fraction. 1% is what every window shows right after a reset; the authority guard then protected the wrong number for ten minutes. | `clampPct()` for documented scales; the heuristic serves only the streaming event. Boundary test at 1. |
| 16 | **Denials hidden.** The authority guard dropped a `status:'rejected'` event behind a fresh "allowed"; `headroom()` returned `unknown` for a denial with no percentage and for `usageAllowed=false` with no windows; `upsert()` re-stamped `observedAt` on a carried-over percent so stale read as live; `surplus()` never checked age. | Denials outrank everything and land immediately; observation time survives sparse updates; surplus honours `staleAfterMins`. |
| 17 | **Read `pricingBasis`, a field that does not exist.** The SDK's `costBasis:'unknown'` means *costUSD is a guess at the default model's rate*; every guess was recorded as authoritative `'sdk'` cost, summed into session totals, and counted in savings — the catch-all-price-row bug (correction 3) through a different door. The test fixture had invented the same wrong name. | `(costBasis ?? 'list') !== 'unknown'`; a session total is emitted only when every call was priced; `savings()` is all-or-nothing. |
| 18 | **Claude context meter never emitted once.** `getContextUsage()` resolves a camelCase response (`totalTokens`, `rawMaxTokens`); the reader checked `total_tokens`, which exists only on `/context` slash-command messages, and returned `null` on every real call. The fixture used the invented shape. | Both shapes accepted; fixture is the real camelCase payload. |
| 19 | **Codex context double-counted the cache.** `inputTokens` already includes `cachedInputTokens` (`codexInputSplit.ts` is the one place that assumption lives); `context.ts` added them on top and disagreed with the `contextPct` emitted from the same notification. The test encoded the double count as expected. | One split, one assumption. |
| 20 | **"Allow for this session" escalated the whole session to `bypassPermissions`**, silently widening every later permission; a malformed approval decision resolved as ALLOW on both adapters. | Remember the *tool*; validate decisions once, at the session boundary; adapters decline anything not affirmative. |
| 21 | **Consult and dispatch capability gates were advisory.** `settingSources` omitted ⇒ the SDK loads every filesystem settings file, whose `permissions.allow` rules approve tools without consulting `canUseTool`. | `settingSources: []` on every one-shot; guarded by a doctrine test. |
| 22 | **Stop did nothing, and failure looked like success.** `turn/interrupt` omitted the required `turnId` (`TurnInterruptParams = {threadId, turnId}`), the rejection was swallowed, idle emitted. A `turn.status:'failed'`, an `ErrorNotification`, and Claude's `error_*` result subtypes all resolved as ordinary completion; a declined command showed a green check. | `turnId` sent, failures reported, statuses read. |
| 23 | **Orphaned timers and a hanging cancel.** A rejected `turn/start` left the completion promise's timer to reject unobserved — an `unhandledRejection`, fatal to the server; cancelling a Codex one-shot killed the process but the promise waited the full timeout. | Observe, clear, and settle on cancel. |
| 24 | **No Origin/Host check.** Without `ROOST_TOKEN` the API and WebSocket accepted any browser origin; a page on any tailnet device, or a DNS-rebound one, could drive the server — and "drive" means agents in full-auto. Custom avatars were served with no auth at all; agent subprocesses inherited the token. | Same-origin enforced on the socket and mutating routes; avatars behind auth; token scrubbed from subprocess env. |
| 25 | **Three tests went red by themselves.** The quota fixture carried absolute `resets_at` timestamps that expired mid-afternoon, so every window purged on read — a wall-clock dependency, the non-hermetic class correction 8 forbids. | Relative timestamps. |
| 26 | **Defined but never called.** `shouldApplyEffort()` (correction 4) existed and was tested, but live auto-routing re-applied effort on every retriage without it, paying a prompt-cache reset each time — and skipped both the effort and the `routed` event when two tiers shared a model. Likewise `reviewerFor()` (§6) was never wired into the consult, which stayed hard-wired to the other vendor and simply failed on a single subscription. | Both wired. A rule without a live call site is a rule that has drifted. |
| 27 | **The review orchestrator rate-limited itself.** The first review workflow lost all eight finders, the synthesizer and the critic to the Claude 5-hour session limit mid-run, with no quota awareness at all. The rerun routed the finders to Codex (47% weekly) and verified on Claude after the reset — the harness's own thesis, performed by hand. | Recorded as the justification for Phase 4: dispatch must read the gauge before spawning. |
| 28 | **Committed with a red test — and the new gate caught it.** The Phase 5 commit chain piped the suite through `grep \| head` and took *grep's* exit status, so a failing image-fixture test did not stop the commit. Roost's own verification gate, run in the same chain, reported **"FAILED · 1/2 gates passed"** correctly; the shell ignored it. The fixture bug underneath was an LCG's low byte (period ≤ 256) posing as noise. | Commit chains gate on the suite's and the gate's *real* exit codes (`pipefail`). Which is also the point of Phase 5: the check has to be in the way, not merely reported. |
| 29 | **A cross-vendor review logged as "no reviewer".** The Phase 3 dogfood ran in a process that had never fetched the model roster, so `reviewerFor()` returned `none`; `runConsult` then silently fell back to the other vendor's configured model — which reviewed the plan perfectly well — while the decision log and the turn label said no reviewer was available. A fresh server has the same window before its first roster fetch lands. | `resolveReviewer()` makes the fallback explicit and labels it *"cross-vendor — roster not fetched, using the configured model"*, logged as `cross-vendor-unverified`. Found by reading the dogfood's own decision log — which is what the log is for. |
| 30 | **Everything was opt-in, so nobody ever saw the product.** `this.mode = restore?.mode ?? (this.model === 'auto' ? 'auto' : 'chat')` — mode became `auto` only if the model was the literal string `'auto'`, and a new session's model is `defaultModel` (`'sonnet'`). So **every session defaulted to plain chat**: no triage, so the light tier was never used; no conference, unless the user found the ⚖ button; and a resumed session simply continued on whatever heavy model it was last on. Garrett picked up a chat and got Opus answering directly — "it doesn't feel like agents… what about conversation between the two, the whole point of the app?" Correct. The routing, the crew, the conference and the gate were all built, tested, and unreachable by default. | Default mode is `auto` (`consult.defaultMode`), and auto/build coerce the model to the routing sentinel while keeping the concrete model as the router's starting point. A stored mode now sticks only if the *person* chose it (`modeExplicit`). In auto mode a task triage sizes `large` **escalates to the conference automatically** (`consult.escalateToConference`) — the size gate read the other way. **A feature that is off by default is a feature nobody has.** |
| 10 | **Planned a free-model planning tier** before checking what free costs. The constraint isn't rate limits, it's that free tiers are paid for in prompts — and this harness runs on private repos. | Dropped entirely. See decision 8. |

---

## 9. Open risks and unverified claims

1. **`SDKRateLimitInfo.utilization` scale is undocumented** (0–1 vs 0–100); Roost assumes 0–1. `normalizePct` accepts both and warns once in the ambiguous band. *Since correction 15 the structured `limits[]`/flat-key path uses `clampPct` (documented 0–100); the heuristic serves only the streaming event.* *Note: the structured `limits[]` path reports `percent` as plain 0–100, so it has no ambiguity — prefer it.*
2. **Codex `inputTokens` vs `cachedInputTokens` inclusivity is unstated** — up to 10× cost impact. Isolated in `codexInputSplit.ts` with a one-time warning if the exclusive branch is ever taken. *Live evidence so far says inclusive.*
3. **`usage_EXPERIMENTAL_...` is explicitly unstable** — the method name will change on stabilisation. `typeof`-guarded; the haiku probe stays as a permanent fallback.
4. **Codex prices are unknown.** Codex rows ship as `basis:'unknown'` → no dollar figure — and after correction 14 there is no dollar figure anywhere on the UI regardless. The config now routes light/standard/heavy to `gpt-5.6-luna` / `gpt-5.6-terra` / `gpt-6-astra` from the live `model/list` roster (Phase 7), which resolves the earlier note about disagreeing model lists. Phase 4's estimator prices in percent-of-window per 1k tokens and needs no price table.
5. **Cross-device blindness.** Provider windows include usage from other machines and the web apps; our ledger sees only Roost. Window-derived burn is truthful; ledger-derived burn is Roost-only. Label them distinctly.
6. **Concurrency.** Ledger and quota store are process-wide singletons using synchronous appends. Fine at chat scale; a bottleneck once Phase 3 runs parallel dispatches. *Checked 2026-09-24: both already buffer (`unflushed`, `historyBuf`) and retry, and an append is one small line; a parallel conference has run through it without a stall. Kept as a note, no longer a risk.*
7. **Hand-mirrored types.** `server/src/protocol.ts` ↔ `web/src/types.ts` are maintained by hand. Generate before adding many mission events. *Guarded 2026-09-24: a doctrine test fails if `ServerEvent`, `ClientMessage` or `ConsultPhase` differ between the two files.*
8. **ACI beats orchestration where cleanly measured** — SWE-agent went 3.8% → 12.5% from *tool design alone*, larger than any orchestration gain on coding. If effort is scarce, spend it on the helpers' tools before the conversation between flagships.

---

## 10. On the effort-routing novelty claim

Researched rather than assumed. **Not a novel idea; plausibly a novel product.**

- **No shipping harness auto-selects effort per task.** Claude Code, Codex CLI, Amp, Aider, OpenHands, Cline/Roo, Windsurf, OpenCode — all expose effort as *static* config. Amp's "Dial" is closest: it already treats effort as a routing dimension separate from model, but leaves the choice to the human.
- **Below: vendors already do it inside the model** — Anthropic adaptive thinking, Gemini `thinkingBudget: -1`, the GPT-5 router.
- **Above: academia did it with numbers.** [ARES](https://arxiv.org/abs/2603.07915) **[B]** routes effort per *step* and reports 52.7% reasoning-token reduction on τ-Bench, 41.8% on BrowseComp, accuracy maintained.
- **Open requests, not features:** codex #8649 / #38487, claude-code #72596 (you *cannot* set effort per subagent dispatch today), pydantic-ai-harness #84.

**The defensible claim:** cross-engine, quota-state-aware, decided at the orchestrator layer *where the kind of work is known before dispatch*. ARES routes per step from observation history; a mission orchestrator knows the task kind up front.

**The finding that shapes it:** Opus 4.5 at *medium* effort matched Sonnet 4.5's best SWE-bench score using **76% fewer output tokens** **[C]**. Model choice dominates effort choice — effort's real job is harvesting savings on the *good* model, not rescuing a weak one. Which is exactly why the router trims thinking before it downgrades the model.

---

## 11. Provenance — what came from `agent sync`

**Ported as code:** `personas.js` → `crew.ts` · pricing / policy / opportunity mechanisms from `usage.js` · cast avatars · `worktrees.js` *only if* the tournament pattern is ever added.

**Ported as prompts and policies:** charter acceptance criteria and done-definition · fresh-context critic · evidence-before-acceptance · bounded rounds.

**Did not port:** `orchestrator.js`'s 1,586-line phase machine (the ceremony cost 28 hours for 2 of 6 stages on its one real run) · `quota.js` (dead pty scrape) · both CLI adapters (superseded by Roost's transports) · `demo.js` · five orphan office HTML files · 1.34 GB of cinematic plates.

---

## 12. Open — what is not built yet

### 12.0 Where we are — the working order

Kept here so a fix never becomes a detour that loses the thread. Work top to bottom; add call-outs here the moment they are raised, not after.

1. ~~**The app does not look like the boards**~~ *(call-out, 2026-09-23)* — **done 2026-09-25**, the last three boards read from the local copy in `docs/board/` (the Artifact tool is off inside Roost sessions; see its README). Before that: Home, Thread and Chapters now match the design canvas (items 2–3 below), verified against real mobile-viewport screenshots. Still open, per 12d: the `Control` (effort) and `Context` (context-window meter) boards, and whatever the `Roadmap` board renders, are not in the app. Blocked mid-session on the Artifact tool being unavailable to re-read those three boards' exact specs — resume by reading them fresh rather than guessing from memory.
2. ~~**The Roost logo is not liked**~~ — done 2026-09-23. Owner chose the direction (a crew member as the mark), four candidates were drawn and each checked at 60, 32 and 16px before being shown, and the owner picked **Ollie on lamp**: the highest-contrast of the four. Originals in `.roost-data/logo-raw`; the canvas has a "The logo, four ways" board.
   - *Home*: done 2026-09-23 — palette, type, crew strip with real sleep/awake state, conversation card, compact fuel.
   - *Thread*: done 2026-09-23 — the face beside the bubble (52px), name and model on one line above it, bubbles with the board's square tails, your square avatar; verified on a live Opus 5.5 turn at a true phone viewport.
3. ~~**Chapters**~~ — done 2026-09-23. A job runs from its first message until a verify passes, then folds into its named row (faces, name after the work, who and how many turns, status). A job that closes live stays open 1.8s so the stamp and cheer are seen, then folds; replayed history arrives folded. Client-side only: it changes what you see, never what the agents remember. The board's day grouping and week-folding are not built — transcripts do not survive a restart, so a thread rarely spans days yet. `?fixture=chapters` and `?fixture=chapters-live` render it on demand.
4. ~~**Faces for the other eight**~~ (12b) — done 2026-09-23. All twelve crew (plus Pip the dispatcher) now have drawn sprite sets: Ollie, Moss, Juno, Pip shipped earlier; **Wren, Otto, Tuck, Bly, Rue, Nell, Bram** and **Fig** followed this pass, one at a time, each verified against the full crew sheet before shipping. Two real defects found and fixed along the way, not just eight faces drawn: Juno's later frames had drifted ~10° yellower than its first three (two generation batches) — recoloured to Juno's idle. Rue drifted worse, 26.5° max pairwise — a first recolour pass over-corrected and bled green into its brown basket feet; refined to a hue-windowed recolour that only touches pixels already in the target hue family, down to 0.3°. Bram's first generation broke house style outright (soft gradient shading, no crisp pixel edges) — the hue-spread check alone would have passed it; only the visual crew-comparison sheet caught it, fixed with a strengthened style prompt. Full detail per character is in the commit history and `.roost-data/sprite-raw/*-gen/`. The `sprite: '` completeness check in `doctrine.test.ts` no longer pins a count — it asserts every built-in roster row has one, so it stays true automatically as the roster changes.
5. ~~**Triage is failing to parse**~~ — reopened and closed 2026-09-24. The watch paid off: the first real `triage-fallback` row arrived with raw `"Failed to authenticate: OAuth session expired and could not be refreshed"`. It was never a parse failure — the result text of a *failed call* was being parsed as if a model had written it, the turn silently defaulted to standard, and nobody was told Claude was signed out. Now `triage()` recognises an auth failure (`isAuthFailure`), the session reports it with the `auth` code so the sign-in card appears, and the decisions log files it as `triage-auth`, apart from genuine parse failures. `triage-fallback` stays worth watching; there has still not been a real one.
6. ~~**"Allow and stop asking this session" does not stop asking**~~ — done 2026-09-23. User chose the fuller fix: a real full-auto switch, not just a copy fix. The per-tool remember-choice button now says what it actually does ("Allow — and stop asking for this tool"), and a genuinely session-wide **"Turn on full auto for this session"** action sits beside it — it turned out the mechanism already existed (`ApprovalSetting`'s `full-auto`, wired to Claude's `bypassPermissions` and Codex's `never` policy) but was buried in a settings sheet nobody would find mid-prompt. Surfaced it at the point of friction instead: the approval sheet itself. Full auto now shows a persistent amber banner ("Full auto on — nothing in this session will ask before it runs") for as long as it's on, with its own off switch, deliberately not reusing boost's green "good news" styling since this is a risk state, not a reward. Three doctrine tests pin the labels, the two-message resolve-then-switch behavior, and the persistent banner.
7. ~~**Verify buttons took hero space for no reason**~~ *(call-out, 2026-09-23)* — done same day. User: "seem out of place and I don't know what the point is for that much of a hero space." Right call — "Run gates" / "Gates + review diff" sat as a permanent two-chip bar above every thread, on every session, whether or not there was anything to verify. Moved into the git sheet, next to the diff they actually check; hidden entirely on the home screen's unattached git peek rather than wired to a session that does not exist there. Two doctrine tests pin the removal and the conditional rendering.
8. ~~**A whole batch of asks vanished mid-work**~~ *(recovered 2026-09-24)* — done same day, five commits. The message ("Don't stop your initial plan, these are additions") was sent while a plan was being built. Pip triaged it — it survives only inside the triage prompt in `~/.claude/projects/-Volumes-PortableSSD-remote/` — and it reached nobody: not delivered, not planned, no error. Fixed the drop first, then did the seven asks in it: (1) **never silent** — a `user_message` now ends delivered (mid-build additions join the worker's turn), held-with-notice (mid-plan, folded into Proceed), or as an error naming it undelivered; (2) **the pizza tracker** — Plan → Review → Build → Verify → Done above the thread, derived from the items like chapters, evidence-only, no estimate, lit not animated; (3) **scroll pin** — the thread follows only while you're at the bottom, "↓ N new" pill otherwise; (4) **tool runs fold** — "read 4 files, ran 2 commands, edited 1", calls behind a tap, the running call named on the line; (5) **the conference announces itself** — Plan / Review / Reconciled plan badge on every named consult turn; (6) **Proceed** — bar clears before the triage round trip, button says Proceeding…, louder color; (7) **composer** — the confusing hint is gone, Stop is far left, away from Send. Nineteen doctrine tests and eighteen unit tests pin the batch. Lesson written into the code: a message that can be triaged can be lost, and the composer had been promising otherwise.

**Batch of eighteen, raised 2026-09-24 after the recovered seven shipped.** Written here first, before any of it was started, because of item 8. Grouped by what they are, worked small-to-large so a big one never hides a quick one.

*Bugs — first:*
9. ~~**Context alert stays up after auto-compact.**~~ — done 2026-09-24. Only the tap path cleared the offer; the auto path never did. Both clear it now, and `runCompaction` clears it again on success.
10. ~~**Session vanished on return; a "picking up from before" recap with no characters took its place.**~~ — done 2026-09-24. Cause: transcripts were RAM-only and the server was restarted (by me, at 12:16) under the running job. The thread is now written to `.roost-data/transcripts/<id>.jsonl` as it happens and read back on restore, with a line naming the restart and the cut-off turn. Closing a session on purpose removes the file; a restart does not. Live since the next deploy that day.
11. ~~**No Codex models in a session's settings.**~~ — done 2026-09-24, as part of 19. A session runs on one vendor, so the other vendor's models are not a picker; the settings now say how to reach that crew — by name.
12. ~~**Pip's sprite lands after Pip's text.**~~ — done 2026-09-24. His two frames are preloaded from `index.html`.
13. ~~**Routed chip text collides with its rounded corners.**~~ — done 2026-09-24. A 999px pill radius on a two-row box is a half-circle; 12px now.
14. ~~**Settings: "generate your own image" 400s**~~ — done 2026-09-24. The generator works (52s, measured); the 400 was the colour check refusing a persona with no colour yet. The house blue stands in; the button counts the seconds while Codex draws. The unplaced-model chips now say they are placements; "Refresh roster" became "Check for new models".

*Small UI:*
15. ~~**No emoji anywhere.**~~ — done 2026-09-24. `web/src/icons.tsx`: 12×12 pixel glyphs drawn as rows of `#` in the source (bolt, gear, scales, lock, camera, six idle thoughts). A doctrine test sweeps `web/src` for emoji and the misc-symbol code points iOS gives emoji presentation.
16. ~~**Zzz bubbles: off to the side, and one at a time.**~~ — done 2026-09-24. One bubble visits the crew in turn (3.6s), upper right of the head with a tail, fade-in / hold / fade-out keyed per visit, none under reduced motion. The first cut called the hook after an early return and the home screen threw React #310 — caught by a screenshot, not a test; the measuring script below came out of that.
17. ~~**Home header, and the logo.**~~ — done 2026-09-24. Spacing: the subtitle sits under the name, more air before the crew. The logo was revisited once the scenes existed (26), so the mark and the scenes share a language: the icon is three of the crew asleep shoulder to shoulder on a branch under a full moon, picked from ten candidates across two rounds (the first round's places and faces -- a birdhouse, a nest, Pip's face -- said "cosy" but never "Roost"; the second round asked what a roost literally is). The wordmark is hand-drawn, not the display font plus an overlay: the two O's are an owl's eyes, a pupil and a glint each, with an ear tuft on each outer corner, the whole word one 42x14 pixel sprite so both themes render from a single drawing (moonlight letters/white eyes in dark, indigo letters/moonlight eyes in light) rather than two that could drift apart. The header shows the wordmark alone, left-aligned -- the icon and the wordmark are two faces, and side by side they competed. `.brand-icon`, now unused, removed.
18. ~~**The composer should behave like iPhone Messages.**~~ — done 2026-09-24. Grows with the text to ~5 lines (measured from content), + at the left, ↑ inside the field at its bottom-right.

*Features:*
19. ~~**@-mention a crew member.**~~ — done 2026-09-24. `@Nell …` sends the turn to Nell: same vendor switches the session's model for the turn; other vendor runs a one-shot with the recent thread as context and full capability, landing as her own turn badged "Asked by name". Composer completes names on `@`. `mentions.ts` is pure and unit-tested. Images could not travel the cross-vendor way at first; since the evening of 2026-09-24 they go with the prompt on both vendors (`dispatch.ts`).
20. ~~**Session naming that you can find things by.**~~ — done 2026-09-24. Named after the jobs, open one first then closed ones newest first, with the same regexes as the Chapters board (pinned to each other). A typed title sticks.
21. ~~**Fuel: cleaner at rest, collapsible when opened, and smart.**~~ — done 2026-09-24. "Less" closes the opened card; the weights sentence is in plain words under the windows it describes; the planner is told both vendors' tightest windows and asked for a `## Fit` line with a First slice and a Remainder; and when a plan names a Remainder the consult bar offers **Park the remainder**, which appends it, dated and with its task, to the project's `ROADMAP.md`.
22. ~~**Contexts per agent / the handoff**~~ — done 2026-09-24. Yes, each engine session is its own context (§4c). Once the meter reads degrading or critical the bar offers "Hand off to <other vendor's flagship>": briefed from the plan file (pending, or last written) and the recent thread, told to check git state before trusting the summary, continuing with a clean window, badged "Handoff". Same machinery as 19.
23. ~~**Pip is too conservative, and Codex is under-used.**~~ — done 2026-09-24, both halves. *Root cause:* the Claude reading had been dark for 31 hours (it only arrived from live sessions' rate-limit events) and every route said "no move on missing data" — blind, not conservative; the probe is now asked every 20 minutes. *Structural:* a consulted plan is built by **the vendor with more headroom** — the other vendor builds as a one-shot briefed with the same Proceed prompt, announced by Pip with the reason, gates armed before and run after the same way — moving only when the other vendor's headroom is strictly better *and known*. **Who builds** in session settings pins Auto / Claude / Codex, persisted. The decisions log gets a `route · build` row per Proceed; after a week of fresh readings it will show how often the build actually crosses.
24. ~~**"What the crew decided" is not earning its place.**~~ — done 2026-09-24. The card is gone; the numbers are one line under the fuel ("Today: 7 routes · 3 reviews").
25. ~~**The animations from the vision board**~~ — *audited 2026-09-24, nothing missing, one real gap named.* All eight §12a demos are in the app (the fold shipped with Chapters). Why a normal session sees few: **the stamp, the cheer and the fold fire only on a passing verify**, which only happens in build mode after Proceed, or from the git sheet — a plain auto/chat session never produces one. **Fuel draining and use-it-or-lose-it** need a reading that moved between two looks, and the Claude reading had not moved in 31 hours (item 23). **Peek** needs an approval, which full-auto removes. **Context rot** needs the meter past 60%. That leaves the wake-up, the typing commands and the working sprites as the everyday set — which matches what was seen. The gap worth closing: a plain-chat turn that ends after real work has no "finished" beat at all; the honest trigger is the same evidence the tracker uses (tool runs happened, the turn ended idle), not a timer. Done 2026-09-24: a plain chat turn now gets a finished beat -- a keyed cheer hop on the tracker's face, triggered by the tracker's own Done evidence (work happened, the engine went idle) and a fresh end-index vs. replay, never a timer or a clock.

*Big:*
26. ~~**Scenes.**~~ — done 2026-09-24, one sitting. `docs/SCENES.md` is the board (move it to the canvas when the Artifact tool is back). The home screen's main area is a drawn scene holding the awake crew in seats (place, pose, optional prop, optional flip); the bunks below hold the sleepers stacked with the one visiting Zzz; a working member sits in the scene and types with a laptop; the set changes on the hour and on a tap (`?scene=<id>` pins one); nothing inside a scene moves on a timer. **All ten scenes** drawn and seated (campfire, card table, ball and bucket, picnic, stargazing, kitchen, library, workshop, rooftop, snow day); **all thirteen characters** in the four scene poses (sit, side — flipped in CSS —, hold with empty paws, dance), 52 frames, every one within 7.4° of hue of its idle and most under 2°, because each was drawn from the idle frame as a reference — the recolour passes of the first crew set were not needed once; **thirteen props** drawn once each. Pipeline: `scripts/scenes/gen.mjs` (codex exec + image_gen, the crew's STYLE block, `-i` reference), `convert.py` (hue check, BOX to 256 webp, `sheet` for the eye). ~75 drawings at ~80s each, run detached in three parallel jobs. Still to do from the design: the logo revisit (17) in the scenes' language; project-tied scenes, later.
27. ~~**See the pictures on the phone.**~~ — done 2026-09-24. "I'm on my phone. I can't click the link" — and earlier, a tapped image in a tool chip that showed nothing. Any absolute image path an agent mentions (in prose, in backticks, as a markdown image or link, or in a tool call like a Read of a screenshot) now shows as a thumbnail under the turn; a tap opens a full-screen viewer (tap for full size and pan, pinch works, ✕ or tap outside to close). A temp file that has been cleared says "no longer on the Mac" instead of a broken box. Served by `/api/image`, which is narrow on purpose (`server/src/images.ts`): png/jpg/gif/webp only — no SVG, it runs script —, the real path after resolving symlinks must be inside a project, Roost's data folder or a temp folder, 25 MB cap. Unit-tested against a symlink named `.png` pointing at a key, traversal, and a vanished file.
28. ~~**Preview: see the project you are building, from anywhere**~~ — done 2026-09-24. `docs/PREVIEW.md`, built. A project's `## preview` section names a command (`npm run dev -- --port {port} --host 127.0.0.1`) or `static: dist` for a built site. The Live preview button in the session header starts it on demand -- one per project, a free port picked, the process's own stdout/stderr kept so a failed start says why -- and stops it after 20 idle minutes (`server/src/live.ts`). Reached same-origin through `/live/<pid>/`, pid the project path itself, base64url, so no id table needs keeping in sync (`server/src/liveProxy.ts`); the phone needs nothing new open on the tailnet, and hot reload works because the websocket upgrade is proxied too, byte for byte. The in-app sheet shows Starting / a running frame with Reload, Desktop-width and Open-in-a-tab, or the failure with its own output; never a file outside a static build's root, even through a symlinked one. Named `Live`, not `Preview` -- that word already means the read-only recap of a past session. 19 tests exercise it against a real spawned process and a real HTTP proxy, not mocks.
29. ~~**The animation panel ("I've been looking at it for an hour and it's just fun")**~~ — answered and built 2026-09-24. The question was which moments a chat session actually reaches deserve motion; the answer was the five §12a listed "beyond the eight", all of which report something Roost already knew and rendered as text. Built, each with a fixture: **the handoff** (`?fixture=handoff`) — a consult turn now carries who stepped *back* as well as who stepped in, and the thread shows the pass: the outgoing member steps back and dims, the incoming one steps forward, once, then both hold; replayed history shows the line static. **Effort, visible** (`?fixture=effort-low`, `effort-xhigh`) — the working sprite's think beat is the session's effort: 420ms at low, 1.2s at xhigh, 1.5s at max, from one pure table (`thinkBeatMs`), with "· quick" / "· thinking hard" after the status; Pip's triage keeps the house beat because it is not the session's effort. **Someone being sent out** (`?fixture=routed`) — on a live routed turn the worker's sprite takes one step toward the work and settles. **The gate refusing** (`?fixture=quota-refused`) — a lock that lands once, amber boundary register, not a crash-red sentence. **Sleeping on idle** (`?fixture=asleep`) — after twenty quiet minutes with the engine idle, the tracker's face drifts back to the sleep pose and the line says "· asleep"; the quiet counts from the later of the last item and *when this phone opened the session*, so the crew wake when you arrive and only drift off after a spell you were present for — the one place the doctrine lets a clock in, because the quiet is the state. Every one is one-shot with `both`, static under reduced motion, and pinned in `doctrine.test.ts`.
30. ~~**Dead in the water — the app was giving an error all day, no way to fix it without the Mac.**~~ — done 2026-09-24, three parts, all verified live. (1) `/rescue`: plain HTML served by the server before the SPA catch-all, no dependency on the React bundle, fonts or `/assets` — from the phone it shows server/release/auth status and recent warnings, and can roll back, restart, sign in to Claude, or start a fresh session, all through `/api/rescue/*`. (2) Gated releases (`scripts/releases.mjs`): the server now serves `.roost-data/releases/current`, not whatever was last built — a deploy (`npm run service:install`) smoke-checks the candidate on a spare port before promoting, and the live app again after restart, auto-rolling back on failure; a skipped check now fails the gate rather than passing silently (the check had been using a blocking `execSync`, which froze the event loop the in-process candidate server needed to answer on); a stopped deploy restores `server/dist` so a crash-restart can't pick up unchecked code. (3) `Contained` (`web/src/ErrorBoundary.tsx`): each message, tool run, and the chapter computation itself has its own boundary, so one bad row costs one row, not the whole chat; the smoke gate fails on a contained crash too, so a partial breakage can't ship either. Verified: a deliberately broken build was refused (14/18 pages) with the live release untouched; a real rollback and a real restart both round-tripped through `/rescue`.



**The thread screen, from a phone screenshot — raised 2026-09-25.** "There's a ton of things that can be improved." Diagnosed against the live session's own transcript before anything was changed; worked in this order.

31. ~~**Jobs end at the right place.**~~ — done 2026-09-25. Every message now starts a new job once the current one has had a crew turn, unless it is plainly a continuation (a go-ahead, an agreement, a short question about the work) — or it comes after 45 quiet minutes. Checked against the real 2026-09-24 transcript: 861 items that were one job became 28, each a real ask. A job whose opener names nothing takes the next ask that does, then the crew's own first line. The same rule on the server names the session (`startsNewJob`, `isWeakName`, pinned to each other). Found on the way: a quota test with a hard-coded reset date that expired today — now relative. A job only closed on a *passing* verify. One verify failed early on 2026-09-24 and nothing passed after it, so ~1,300 events — a whole day of different tasks — were one job, named after the message that opened it ("Bram proceed with the remaining"). The tracker froze on it: Bram's name, a stale failed Verify, steps lit out of order. A job should end when the next task starts; a failed verify stays on its job without holding the rest hostage; the name comes from the work.
32. ~~**One agent, one identity.**~~ — done 2026-09-25. Three causes, all fixed: `modelForPersona` took the first card whose *resolved* id matched, and the roster lists `default` (resolves to Opus) before `opus[1m]` — so "Ollie, …" switched the session to `default`, Fig's id; asking by name outside auto wrote `routedModel`, which nothing cleared; and replies were signed from `routedModel` even when auto was off. Now a card that names the model wins, outside auto only the session's model changes (and a restored leftover is dropped), and replies and header are signed from one `speakingModel()` that reads aliases through to what the engine resolved. Replies already in the history keep the label they were given. Replies said Fig, the header and sprite said Ollie, the sticky chip said Ollie, the command said Bram. Cause: `routedModel` held the literal string `"default"` left over from auto-routing, and replies are labelled from it — `"default"` maps to Fig, and prints as "default · Chat". Clear it whenever the model is set by hand; never label from a non-model.
33. ~~**Percentages that move.**~~ — done 2026-09-25. Context is now measured during a turn as well as at its end (throttled to one reading per 20 seconds of streaming), so a long turn climbs instead of freezing and jumping. The fuel line is read when a turn ends — the zero-token probe, at most every two minutes across all sessions — and every open session re-sends its fuel and Spend-it the moment the reading lands, instead of on the 20-minute timer. Context arrives only when a turn ends — a 20-minute turn reads frozen, then jumps (23% → 33%). Spend-it refreshes on its own schedule, not with the work. Update context during a turn; update the fuel line when a reading lands.
34. ~~**The light theme gets the design.**~~ — done 2026-09-25. Light is now the same room by day: paper ground, navy ink, lamp amber fills, a deeper amber (`--accent-ink`, 5.6:1) for accent-coloured *text*, Silkscreen for names and labels, hard shadows. The board's 76 dark-only rules were shape and type, not colour — all but the four genuinely colour-specific ones now apply to both themes. Every radius of 8px or more is 2px in both themes (52 of them: the pills, the soft cards, the rounded composer). Crew names are made readable against whichever ground they sit on (`readableOn` now darkens on paper as well as lightening on navy). Found in the doing: the unscoping script also stripped the dark palette's own selector and dark mode rendered light — caught in the side-by-side screenshot, fixed, and now pinned by a test. The boards are the navy lamp theme; the light theme never got them — blue accent, rounded pills, rounded bubbles, no display font. Amber, square edges, hard shadows, Silkscreen, in both themes.
35. ~~**Six bars before the first word.**~~ — done 2026-09-25. One status line under the header: context as a small meter and its percent (red once degrading), Spend-it as its expiring blocks with percent and countdown, Boost and Full auto as lit words — each shown only when live, and no bar at all when there is no context reading. A tap opens the full detail (the old bars, unchanged) and the choice is remembered per phone. With the screenshot's state (`?fixture=busy-top`) the conversation now starts at 151px instead of 339px. Header, Spend-it (three lines plus a paragraph), Full auto, a raw token line, the context bar, the tracker — the conversation starts 40% down the screen. Fold to one status strip that opens on a tap.
36. ~~**The rest of the screenshot.**~~ — done 2026-09-25. The header says who and on what in words ("Ollie · Opus 5.5 1M · high"), not the list label of an alias ("claude · Default (recomme…"). The mode badge says what the next message does: with a name stuck, it reads **direct**, because a named member's messages go around plan and build. `seven_day_overage_included` reads "7-day (with extra usage)" and any unknown window key becomes words, never a raw key. A lone tool call folds into a run row like the rest. The working face always has words ("Ollie is running a command…"), from the last item when the server has not said. Spend-it's button keeps to one line, dropping under the text on a phone. What the crew say on the way to more work is a quiet aside; the turn's last word keeps its bubble.
37. **Plan mode and a name you asked for — your call.** Found while fixing the PLAN badge: this session was set to Plan on purpose, and since "Ollie, …" the messages have gone straight to Ollie, around plan mode, with full auto on — so files were edited under a PLAN badge all day. The badge now tells the truth (**direct**). What is not decided: should plan mode *hold* for a named member (Ollie plans but cannot edit until you switch to Build), or is talking to someone by name meant to override it? The Control board says Plan means "nothing executes, ever"; the way this session has actually been used says otherwise. Not changed until you choose.

**The crew, alive — raised 2026-09-25.** "Consider this a character animation update… like the tamagotchi digital pets but these are the agents. I want people to talk about them."

38. ~~**Four frames of work, slower.**~~ — done 2026-09-25. Every character now has four typing drawings (paws together, left paw, right paw, a pause to read back) and four thinking drawings (chin, tilt, fold, the idea) — 72 new frames, each drawn from the character's idle as reference, hue-checked (worst 11.7°, under the 12° line) and aligned to its pose's frame on the foot line so the cut never jitters (7 resized). Played one at a time: 560ms a drawing while typing (2.24s a cycle, was 0.62s), the effort beat per drawing while thinking. Until all four exist, or if one fails to load, the old two-frame cut. Wren's and Rue's original typing frames are a touch chunkier than their new ones.
39. ~~**Thirty more scenes, one a day.**~~ — done 2026-09-25. Forty scenes, one a day, turning at local midnight; taps no longer change it. Each new one seated by eye from a gridded contact sheet, checked with the crew in place, and given something alive — a flickering fire, steam, torches, string lights, a glowing porthole, fireflies.
40. ~~**The crew as companions.**~~ — done 2026-09-25. Tap any face — home crew, a scene, a thread row — for their card: mood in their own words, energy (what is left of their subscription), level, calls, tokens written, longest think, streak, jobs shipped and failed, and nine milestones with what each takes. All a pure function of the call ledger, a new life log (whose job a gate passed or failed on; asked for by name) and live state; no record, no number. Levels and milestones crossed on a live turn are said in the thread with a hop and confetti — never for history. Coming back after six hours, the busiest member tells you what the crew did while you were away.

Written 2026-09-22, after the rename. Everything above this line ships; everything in it does not.

#### Games and crew customization — agreed 2026-09-29
Waves, one deploy at the end:
1. Economy: coins (from game runs, achievements, ghosts, finished jobs), Roost Crates (season series + seasonal holiday items + free drops; Rare 55 / Very Rare 28 / Import 12 / Exotic 4 / Black Market 1; Painted and Certified variants; 5-for-1 trade-up), keys from the daily crew challenge and ghosts, coins buy crates, no real money ever. Deep crew customization (hats, props, paints, auras, frames, titles, celebrations) reflected everywhere the crew appears. Rare work-earned pieces (crown, robe) stay work-only.
2. Arcade hub (overall level, achievements, bests, coins), pixel-art logos on tiles (no crew on tiles), the coding crew member in a safe corner of every game with a speech bubble for big phases (tap opens the message they just finished), rotate-your-phone prompt, landscape Roost Birds / Flap / Home Run Derby.
3. Every game: three new things + a visual upgrade; ghosts (see-through, toggle, strength matches the model, unique rewards); quiet chiptune sound off by default; haptic patterns (iPhone: ticks only, no strength control).
4. Two new big games: Bug Siege (tower defense) and Crew Kart (top-down racer).
Rejected: "fits the wait" prompts. Someday: a native app for true haptic strength.

#### The overnight run — 2026-09-28 (decisions logged in NIGHT-DECISIONS.md)
Order: deploy card + rocket pulse → #44 plan setting + advisor → #46 where we left off → #47 per-project usage → #48 haptics → #50/#51 scenes + pixel avatars → #55 games (Snake, Minesweeper, Battleship, Solitaire, 2048, daily word, Flappy, Breakout, Sudoku, memory match, stack; then sports pack and Roost Birds) → #57 level-up accessories → #49 fun layer → #45 new project → #52 dev mode → #56 onboarding → #53 provider research. One deploy at the end.

#### The next working order — agreed 2026-09-28

Shipped 2026-09-27/28 and not repeated below: the code map (Claude + Codex, `codemap.ts`), per-turn measurement (`turns.jsonl`, `npm run codemap:report`), the UX sweep part 1 (celebration, living crew, plain words), preset-based session settings, the crew's last word outliving the fold, "What shipped" in the Changes sheet, the chat reading like a chat (every crew line a message, optimistic send, replies growing out of the typing bubble, gliding scroll), deploys that wait for the crew to finish, and the Codex 1%→100% misread (`4ac8698`).

41. **The reply that blinked out on a deploy.** After a job verified, the reply showed as a blank space, "reconnecting…", then the message two seconds later. Two causes: the last word under a folding job reserved its space invisibly for 5.7s, and a deploy waiting for "quiet" restarted Roost ~4s after the checks passed -- mid-celebration. *In progress 2026-09-28.*
42. **Two quick fixes.** VERIFIED is stamped over Test *and* the last stop says Verified -- say it once. The scales (Consult) button beside Send: the Careful preset now covers most of it; decide whether it stays, moves, or goes.
43. **Who's in this chat.** The crew in this conversation as faces in the top bar, right of the context meter (collapsed), separate from what the meter expands.
44. **Pip stops handing real work to Haiku** (agreed). Haiku only for tiny chores (lookups, renames); Sonnet for normal work, Opus for big. A **crew quality** setting ("token saver" … "best") with defaults for the $20 / $100 / $200 plans turns Haiku back on for people who need it.
    - Agreed 2026-09-28: a "Your plan" setting ($20 / $100 / $200). $20: chores Haiku, everyday Sonnet, hard Opus at lower effort. $100: chores Sonnet, everyday Opus, hard Opus full effort. $200: chores Sonnet, everyday Opus high, hard Opus deepest. Codex mirrors it.
    - Grown into a smart advisor: explain each plan, recommend one, and adjust to the project, how the person works, and how much is left (for example a $20 plan on auto trying to save tokens).
    - Also: the "With Ollie, messages go to them until you clear this" line above the message box feels noisy; move it, while keeping it obvious you can pick your own crew or go back to Pip.
45. **A new project from the phone.** Name it, public or private, Roost creates the folder, the GitHub repo (`gh` is signed in on this Mac as gjohnsonmb1-afk), the first commit, and adds it to Roost's projects.
46. **Where we left off, on the home screen.** Each project card: the last thing done, what is left or on deck, and a Continue button -- no opening the chat to ask "what's next?". The crew writes what's left at the end of every job so it is always ready. The per-project roadmap lives here.
47. **Per-project usage** (agreed: read from the vendors' own local logs -- `~/.claude/projects`, `~/.codex/sessions` -- so it includes terminal and VS Code work on this Mac and history from before the feature; other computers stay invisible). "yayo bay · ~30% of your Claude week · 5% of Codex", and who spent it and on what (building, reviews, Pip's routing, asking by name). Beside #46 on each card.
48. **Haptics on iPhone.** iOS ignores `navigator.vibrate`; iOS 18+ taps when a hidden `<input type="checkbox" switch>` toggles. Pass, fail, an approval waiting, a message arriving.
49. **The fun layer.** Builds on item 40's away greeting: the crew greets you by name, remembers streaks, celebrates work that finished while you were away, reacts to you.
50. **Morning and evening scenes.** Each daily scene gets an AM and a PM painting ("Picnic in the park" by day and by night). Art via Codex `image_gen` (Codex has room: 1% used, resets Oct 4). *Art started in the background 2026-09-28.*
51. **Pixel-art avatars.** The avatar pool is flat clip-art beside pixel crew; redraw it in the crew's style. *Art started in the background 2026-09-28.*
52. **Dev mode.** For people who want to see the machinery: diffs of each edit, full commands and their output, model ids and cost per turn -- shown in place instead of folded.
53. **More providers, more crew.** Roost drives only Claude and Codex. Research ACP (Agent Client Protocol) -- one adapter for Gemini CLI and others -- then a crew of 4-5 per new provider, drawn like the rest.
54. **Carried over.** The code map savings report (needs a few days of turns), more code-map languages (after #53), light/dark parity (MOTION.md §7.9), and #37 (plan mode vs a name you asked for) still undecided.
55. **Mini games (added 2026-09-28).** Something to play while the crew works: Roost-themed Snake, Minesweeper, Battleship and Solitaire, all using the crew and scenes. Stretch goal: an Angry Birds-style launcher, Roost edition. Needs a design talk first (where the games live, whether they pause when the crew needs you).
    - Agreed: when the crew needs you mid-game, a banner slides in over the paused game; one tap answers, one tap returns.
    - Game saves live on the Mac with the rest of Roost (agreed). Every game resumes exactly where you left it (a phone in line gets interrupted a lot).
    - For the player: high scores, personal bests, and achievements (Roost-themed, crew hands them out).
    - Stretch: a sports pack of simple flick games: field-goal football, baseball (timing swing), soccer (penalty kicks), basketball (flick shots).
    - Agreed extras: 2048, Wordle-style daily word, Flappy-style (a crew bird), Breakout, Sudoku, memory match with crew cards, Stack/tower drop. Rule: every game is playable one-handed in under two minutes.
56. **Onboarding (added 2026-09-28).** Roost has never been set up from scratch by anyone new. Two halves:
    - Computer: one install command for Mac, Windows and Linux (agreed: Windows is in; the background service needs a Windows equivalent of the Mac LaunchAgent). It checks for Node, Claude Code / Codex logins and git, starts Roost as a background service, and shows a QR code to open on the phone.
    - Reaching the phone: today that's Tailscale (free, but a second app plus an account on both devices). Options to weigh: guide people through Tailscale, same Wi-Fi only, or a built-in tunnel (e.g. Cloudflare Tunnel) with a login in front. Agreed: Tailscale, with the installer walking people through it and ending on a QR code.
    - App: first-run welcome that meets the crew, picks a plan (feeds #44), adds a first project (#45), and shows how to add Roost to the home screen.
    - Note: the "Pocket" home-screen name was the app's old name; iOS keeps the name and icon from when the shortcut was added. Remove it and add it again to get Roost.
    - Sharing: point people to the GitHub repo with a README that starts with the install command.
57. **Crew level-ups you can see (added 2026-09-28).** As you use a crew member they earn accessories and props: sash, hat, necklace, sunglasses, crown, staff, crystal ball, wizard robe. After two months your most-used one (e.g. Ollie on Opus) is visibly decked out, so when a plainer crew member shows up you notice and can tap to see why Pip picked them. Needs image generation: accessory layers or re-drawn sprite frames per level. Ties into #47 (usage) and #49 (the fun layer).
    - Also in this batch: the deploy offer becomes a pinned card that waits for you ("Checks passed. Put these changes live?" Deploy / Not now), and the top-bar rocket gets a subtle colour and pulse whenever there are changes ready to deploy.

### 12a. Motion — the stream with the most pull behind it

**The `Effects` board was a proposal; it is now a feature.** It demonstrates eight pieces of information-carrying motion, and all eight are in the app (the table is kept as the record of what each one reports):

| # | Board demo | What it would report | In app |
|---|---|---|---|
| 1 | The stamp | a verify gate passing, landing with weight instead of appearing | ✅ |
| 2 | Fuel actually draining | a quota window moving, animated from the real delta | ✅ |
| 3 | Use it or lose it | a window about to reset with headroom left | ✅ |
| 4 | Context rot, visible | colour draining from a crew member as their context fills | ✅ |
| 5 | Commands type themselves | a dispatched command arriving character by character | ✅ |
| 6 | The job folds | a finished chapter collapsing into its named row | ✅ |
| 7 | An agent that needs you | an approval waiting — the `peek` pose | ✅ |
| 8 | Finishing is worth something | a verify passing — the `cheer` pose | ✅ |

**All eight ship** (the fold arrived with Chapters, item 3). Every one-shot fires only for items that arrived LIVE: opening a session replays its history, and a stamp and a cheer for every past verify the moment you open it would be motion reporting yesterday. Where history ends comes from the replay itself (`replayedCount`), not a clock — the phone's and the Mac's need not agree.

**The constraint that makes this good rather than noisy**, and it is not negotiable: *motion reports state, it never decorates.* Every animation in the app is tied to something that actually happened, holds when it is done, and does not loop. Ambient movement on its own schedule is the commonest tell of a generated interface, and `doctrine.test.ts` fails the build on `infinite` in the wake-up block for exactly this reason. Fun and honest are not in tension here — the wake-up is the proof. What makes it land is that the crew really was idle and really did just get woken by you.

**Beyond the eight** — all five built 2026-09-24 (working-order item 29 has the detail and the fixtures):
- ~~**A handoff between vendors**~~ — the pass is shown: who stepped back, who stepped in.
- ~~**Effort, visible**~~ — the think beat is the effort.
- ~~**Someone being sent out**~~ — one step toward the work on a live routed turn.
- ~~**The gate refusing**~~ — a lock that lands, not a red sentence.
- ~~**Sleeping on idle**~~ — after twenty quiet minutes you were present for, with the engine idle. The one sanctioned clock, gated on state.

### 12b. ~~Faces for the other eight~~ — done 2026-09-23

Every built-in persona now has a drawn sprite set (idle/type/think/blink/sleep/cheer/peek): **Ollie, Moss, Juno, Pip** shipped first; **Wren** (Claude suite default), **Otto** (Codex suite default), **Tuck** (`mini`/`nano`), **Bly** (`luna`), **Rue** (`terra`), **Nell** (`astra`, flagship), **Bram** (`fable`, flagship) and **Fig** (Claude suite default worker) followed, one at a time, each checked against the full crew-comparison sheet before shipping. Twelve drawn crew total. No pool avatars remain in the built-in roster; a user's own custom persona (via a `crew.json` override) can still lack a sprite and correctly falls back to `CrewAvatar`.

### 12c. ~~The design canvas is stale~~ — done 2026-09-23

Version 16 says Roost throughout. Every "Larry" was renamed by what the row DOES rather than by find-and-replace: the one sizing the job is now **Pip** — with Pip's face and colour on the rows where the name is a label — and the one doing work is **Moss**. The Codex reviewer is **Juno** on `gpt-5.6-sol` rather than on Nell's model, and Ollie's model line reads `opus 5.5`. The first pass reported "no retired names left" and was wrong: it matched case-sensitively and the boards set names in Silkscreen capitals.

### 12c′. Legacy ideas, reconciled — nothing older than a week is this app

*2026-09-24. Owner's rule: anything captured more than a week ago is from an older version and vision of the app.* The one such document still pointed at from memory was `agent sync/docs/NEXT-BIG-IDEAS.md` (2026-08-01, "the next big three", written for the office that the Pocket plan deleted). Reconciled here so it stops being carried:

- **Wayfinder** (a persistent decision map with a frontier) — the parts that mattered became Roost's plan files on disk, the reconcile step and the decisions log. The one idea not built is a standing *frontier* — what is still undecided, across sessions. Not scheduled; `ROADMAP.md §12` does that job by hand today and it is enough.
- **The sticky wall** (the map as a draggable PM board) — this is the `Roadmap` board on the design canvas, i.e. §12d, under its current name. Nothing separate survives.
- **Rooms / the Design Room** (your live app on a projector inside a fiction) — the real half shipped as **Live preview** (item 28): the app, on the phone, from anywhere. The fiction half (rooms, walking in, the office) is the old vision and is not coming back. The "Focus / just code" rung it insisted on is simply what Roost is.

The old doc stays where it is as history. It is not a backlog.

### 12d. ~~The reference boards' language is not in the app~~ — done 2026-09-25

Read from `docs/board/Control.dc.html`, `Context.dc.html` and `Roadmap.dc.html` — the local copy of the canvas, because the Artifact tool is switched off for sessions inside Roost. Each checked at 390px against its fixture.

- **Control** (`?fixture=effort`, `?fixture=pip-proposes`). Every turn that ran at a set effort carries six blocks and the word; a model that budgets its own thinking has none, not a zero. The first turn after effort moves carries the reason under the name — "Stepped down from xhigh. …" — `chooseEffort`'s reason, spent where the turn is (`effortNoteFor`). **Pip proposes, you dispose**: a message triage sizes as large no longer starts the plan-and-review at once; Pip says so in the thread and waits on **Go ahead / Just chat** — nothing expensive runs until you answer, and a new message answers "just chat". The think beat (low fidgets, max sits with it) shipped with §12a.
- **Context** (`?fixture=compact-ask`). The compaction offer is no longer a bar pinned above the work: the agent whose context it is asks in the thread, face already greying, with a small meter, in the first person, with **Do this automatically from now on**. Automatic never means silent: the notice says where it compacted, and the next real reading says where it landed ("at 22% after compacting (was 64%)"). Hand-off is its own rung at 80% and asks on its own.
- **Roadmap** — the flag in the home header. `server/src/roadmap.ts` reads a project's `ROADMAP.md`: phases from the status table, tests from the machine-written line, corrections from the log, what is in hand from §12's unstruck items. Only projects that have a ROADMAP.md are offered. A missing section reads "no data", never zero; a phase node opens its evidence. Nothing on it is typed for the screen.

The earlier note, kept for the record:

`Home`, `Thread` and `Chapters` shipped 2026-09-23 (working order items 2–3) — palette, type, crew strip, the fuel gauge, the folded chapter are now live, checked against real mobile-viewport screenshots. **Still not in the app: `Control` (the effort control) and `Context` (the context meter) and `Roadmap`** — the app has no per-task effort UI, no visible context-window meter, and nothing rendering the roadmap itself. Picking this back up needs a fresh read of those three boards from the design canvas (`https://claude.ai/artifact/28CUkGBUQvnBvygnfEJNQn`; a local copy is in `docs/board/`, readable from inside Roost) — not done yet in this pass because the Artifact tool was unavailable in-session when this was reached; do not guess at their specifics from memory. *Reached again 2026-09-24 evening: the tool was off again, so this stays open for exactly the same reason. What the app does have today, for the record: an effort chip row in session settings and a context bar under the header with a percentage, pressure word and the handoff offer — neither checked against its board.*

### 12e. ~~The roadmap still drifts by hand~~ — done 2026-09-23

`npm run roadmap` writes the status line from both suites and the typecheck, with a provenance comment, and writes "N passing, M FAILING" and exits 1 rather than claiming green over a red suite. A doctrine test fails if the machine marker is missing. The phases table and corrections log are still hand-kept; the count was the part that kept lying.

## 13. Review backlog — what shipped, what remains

From the 2026-09-21 review. Confirmed findings that were neither silent data corruption nor unsafe actions, so they followed the P0/P1 batches rather than led them.

**Shipped 2026-09-22:**
- **Conference size gate** (decision 3): triage now returns a `size`; a `small` task keeps the plan and skips the cross-model review, labelled on the turn. Unknown size runs the full conference — the gate never skips on a guess. `consult.sizeGate` in config.
- **Every assistant turn carries a crew badge** (Phase 1's promise), attached in `pushEvent` from the session's routed model and current role.
- **First run defaults to a configured project**, not the external volume's root.
- **Approvals are a queue**, so concurrent requests no longer strand all but the latest; the bar shows how many are waiting.
- **A draft survives a disconnected send**: `send()` reports whether the socket was open and the composer keeps the text until it was.
- **Resumed Codex threads no longer ledger their history as the first call** — with no baseline, the first notification records `last`, not `total`.
- **One writer is warned, not just decided**: opening a second session on a project posts a notice and logs a gate decision. (Blocking followed in the second pass: `guards.oneWriter: 'block'`.)
- **Vendor presence is the last fetch's outcome**, not the presence of a cached roster (`registry.presence()`), and `reviewerFor` honours it.
- **Preview and git parsing**: string-content user messages kept; Codex patch paths with spaces kept; only the engine's XML wrappers skipped; git's C-escaped quoted paths decoded.
- **Notification "test" reports delivery, not attempt**; project add/remove persists before mutating live state.
- **Built-in defaults** no longer point a fresh install at deleted Codex models or a `minimal` effort rung.
- **Decisions log** (`.roost-data/decisions.jsonl`): every route, reviewer choice, size-gate outcome, one-writer gate and dispatch, with timing — the record Phase 4's "does the conference earn its keep" needs.
- **The web workspace has tests**: the chat reducer is exported and covered; `npm test` runs both workspaces.

**Shipped 2026-09-22, second pass:**
- **`guards.oneWriter: 'block'`** refuses a second session on a project with a 409 and the reason, checked *before* an agent process is spawned. Default stays `'warn'`.
- **The composer says why a send did nothing** — "Not connected — your message is kept here until the session reconnects."
- **The session hook is a pure reducer** (`reduceSessionEvent`) over items, meta, status, usage and the approval queue, tested without a DOM; a session switch is exactly `initialCore()`. The fuel gauge's pure parts (`usageView.ts`) are tested the same way.
- **The decisions log has a reader**: `GET /api/decisions` summarises the last 24 hours — routes, dispatches with success rate and mean time (null, never 0, when there are none), reviews by strength and size-gate skips, one-writer gates — and the home screen shows it.

**Nothing from the review remains unshipped.** This line used to point at Phase 3/4/5 as "what comes next" — stale as of 2026-09-23: all three are already built (see §Phase 3, §Phase 4, §Phase 5 above, marked ✅/🟨) with plan files, size gates, reconcile, quota routing, the verification gate and anti-fabrication checks all wired and tested. Confirmed by a fresh code audit rather than re-reading old status lines — which caught its own near-miss: the audit's first pass also flagged "cross-vendor candidates unconfigured" as an open gap, repeating a ROADMAP line that was itself stale; `config.ts` has shipped real candidates for `light`/`standard` on both vendors since commit `5e99643`, corrected above rather than propagated further. The one real open item is Phase 4's concurrency note in §7: the ledger and quota store are process-wide singletons with synchronous appends, a bottleneck once the conference runs parallel dispatches, not yet addressed.
