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

**489 tests green, typecheck clean both workspaces.** <!-- written by scripts/roadmap-stats.mjs on 2026-09-24: server 422/422, web 67/67 — do not edit by hand --> New modules: `pricing.ts` `ledger.ts` `quota.ts` `policy.ts` `routing.ts` `context.ts` `usageDelta.ts` `codexInputSplit.ts`.

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
6. **Concurrency.** Ledger and quota store are process-wide singletons using synchronous appends. Fine at chat scale; a bottleneck once Phase 3 runs parallel dispatches.
7. **Hand-mirrored types.** `server/src/protocol.ts` ↔ `web/src/types.ts` are maintained by hand. Generate before adding many mission events.
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

1. **The app does not look like the boards** *(call-out, 2026-09-23)* — **partially resolved**: Home, Thread and Chapters now match the design canvas (items 2–3 below), verified against real mobile-viewport screenshots. Still open, per 12d: the `Control` (effort) and `Context` (context-window meter) boards, and whatever the `Roadmap` board renders, are not in the app. Blocked mid-session on the Artifact tool being unavailable to re-read those three boards' exact specs — resume by reading them fresh rather than guessing from memory.
2. ~~**The Roost logo is not liked**~~ — done 2026-09-23. Owner chose the direction (a crew member as the mark), four candidates were drawn and each checked at 60, 32 and 16px before being shown, and the owner picked **Ollie on lamp**: the highest-contrast of the four. Originals in `.roost-data/logo-raw`; the canvas has a "The logo, four ways" board.
   - *Home*: done 2026-09-23 — palette, type, crew strip with real sleep/awake state, conversation card, compact fuel.
   - *Thread*: done 2026-09-23 — the face beside the bubble (52px), name and model on one line above it, bubbles with the board's square tails, your square avatar; verified on a live Opus 5.5 turn at a true phone viewport.
3. ~~**Chapters**~~ — done 2026-09-23. A job runs from its first message until a verify passes, then folds into its named row (faces, name after the work, who and how many turns, status). A job that closes live stays open 1.8s so the stamp and cheer are seen, then folds; replayed history arrives folded. Client-side only: it changes what you see, never what the agents remember. The board's day grouping and week-folding are not built — transcripts do not survive a restart, so a thread rarely spans days yet. `?fixture=chapters` and `?fixture=chapters-live` render it on demand.
4. ~~**Faces for the other eight**~~ (12b) — done 2026-09-23. All twelve crew (plus Pip the dispatcher) now have drawn sprite sets: Ollie, Moss, Juno, Pip shipped earlier; **Wren, Otto, Tuck, Bly, Rue, Nell, Bram** and **Fig** followed this pass, one at a time, each verified against the full crew sheet before shipping. Two real defects found and fixed along the way, not just eight faces drawn: Juno's later frames had drifted ~10° yellower than its first three (two generation batches) — recoloured to Juno's idle. Rue drifted worse, 26.5° max pairwise — a first recolour pass over-corrected and bled green into its brown basket feet; refined to a hue-windowed recolour that only touches pixels already in the target hue family, down to 0.3°. Bram's first generation broke house style outright (soft gradient shading, no crisp pixel edges) — the hue-spread check alone would have passed it; only the visual crew-comparison sheet caught it, fixed with a strengthened style prompt. Full detail per character is in the commit history and `.roost-data/sprite-raw/*-gen/`. The `sprite: '` completeness check in `doctrine.test.ts` no longer pins a count — it asserts every built-in roster row has one, so it stays true automatically as the roster changes.
5. **Triage is failing to parse** *(found 2026-09-23; pulled forward because if it were routine, auto-routing would be silently off)*: one sample only — the decisions log holds a single route. A direct call to the classifier WORKS (Haiku thinks, then replies with fenced JSON the parser handles), so it did not reproduce. Made diagnosable instead of guessed at: a fallback now logs the model's raw reply, an empty reply reports "returned nothing" rather than "unparseable", and the SDK's final `result` text is used when no text block arrives. Reopen when a `triage-fallback` row appears in the decisions log.
6. ~~**"Allow and stop asking this session" does not stop asking**~~ — done 2026-09-23. User chose the fuller fix: a real full-auto switch, not just a copy fix. The per-tool remember-choice button now says what it actually does ("Allow — and stop asking for this tool"), and a genuinely session-wide **"Turn on full auto for this session"** action sits beside it — it turned out the mechanism already existed (`ApprovalSetting`'s `full-auto`, wired to Claude's `bypassPermissions` and Codex's `never` policy) but was buried in a settings sheet nobody would find mid-prompt. Surfaced it at the point of friction instead: the approval sheet itself. Full auto now shows a persistent amber banner ("Full auto on — nothing in this session will ask before it runs") for as long as it's on, with its own off switch, deliberately not reusing boost's green "good news" styling since this is a risk state, not a reward. Three doctrine tests pin the labels, the two-message resolve-then-switch behavior, and the persistent banner.
7. ~~**Verify buttons took hero space for no reason**~~ *(call-out, 2026-09-23)* — done same day. User: "seem out of place and I don't know what the point is for that much of a hero space." Right call — "Run gates" / "Gates + review diff" sat as a permanent two-chip bar above every thread, on every session, whether or not there was anything to verify. Moved into the git sheet, next to the diff they actually check; hidden entirely on the home screen's unattached git peek rather than wired to a session that does not exist there. Two doctrine tests pin the removal and the conditional rendering.
8. ~~**A whole batch of asks vanished mid-work**~~ *(recovered 2026-09-24)* — done same day, five commits. The message ("Don't stop your initial plan, these are additions") was sent while a plan was being built. Pip triaged it — it survives only inside the triage prompt in `~/.claude/projects/-Volumes-PortableSSD-remote/` — and it reached nobody: not delivered, not planned, no error. Fixed the drop first, then did the seven asks in it: (1) **never silent** — a `user_message` now ends delivered (mid-build additions join the worker's turn), held-with-notice (mid-plan, folded into Proceed), or as an error naming it undelivered; (2) **the pizza tracker** — Plan → Review → Build → Verify → Done above the thread, derived from the items like chapters, evidence-only, no estimate, lit not animated; (3) **scroll pin** — the thread follows only while you're at the bottom, "↓ N new" pill otherwise; (4) **tool runs fold** — "read 4 files, ran 2 commands, edited 1", calls behind a tap, the running call named on the line; (5) **the conference announces itself** — Plan / Review / Reconciled plan badge on every named consult turn; (6) **Proceed** — bar clears before the triage round trip, button says Proceeding…, louder color; (7) **composer** — the confusing hint is gone, Stop is far left, away from Send. Nineteen doctrine tests and eighteen unit tests pin the batch. Lesson written into the code: a message that can be triaged can be lost, and the composer had been promising otherwise.

**Batch of eighteen, raised 2026-09-24 after the recovered seven shipped.** Written here first, before any of it was started, because of item 8. Grouped by what they are, worked small-to-large so a big one never hides a quick one.

*Bugs — first:*
9. ~~**Context alert stays up after auto-compact.**~~ — done 2026-09-24. Only the tap path cleared the offer; the auto path never did. Both clear it now, and `runCompaction` clears it again on success.
10. ~~**Session vanished on return; a "picking up from before" recap with no characters took its place.**~~ — done 2026-09-24. Cause: transcripts were RAM-only and the server was restarted (by me, at 12:16) under the running job. The thread is now written to `.roost-data/transcripts/<id>.jsonl` as it happens and read back on restore, with a line naming the restart and the cut-off turn. Closing a session on purpose removes the file; a restart does not. *Not yet live*: the running server predates the fix, so the thread it holds will be lost once more at the next restart.
11. ~~**No Codex models in a session's settings.**~~ — done 2026-09-24, as part of 19. A session runs on one vendor, so the other vendor's models are not a picker; the settings now say how to reach that crew — by name.
12. ~~**Pip's sprite lands after Pip's text.**~~ — done 2026-09-24. His two frames are preloaded from `index.html`.
13. ~~**Routed chip text collides with its rounded corners.**~~ — done 2026-09-24. A 999px pill radius on a two-row box is a half-circle; 12px now.
14. ~~**Settings: "generate your own image" 400s**~~ — done 2026-09-24. The generator works (52s, measured); the 400 was the colour check refusing a persona with no colour yet. The house blue stands in; the button counts the seconds while Codex draws. The unplaced-model chips now say they are placements; "Refresh roster" became "Check for new models".

*Small UI:*
15. ~~**No emoji anywhere.**~~ — done 2026-09-24. `web/src/icons.tsx`: 12×12 pixel glyphs drawn as rows of `#` in the source (bolt, gear, scales, lock, camera, six idle thoughts). A doctrine test sweeps `web/src` for emoji and the misc-symbol code points iOS gives emoji presentation.
16. ~~**Zzz bubbles: off to the side, and one at a time.**~~ — done 2026-09-24. One bubble visits the crew in turn (3.6s), upper right of the head with a tail, fade-in / hold / fade-out keyed per visit, none under reduced motion. The first cut called the hook after an early return and the home screen threw React #310 — caught by a screenshot, not a test; the measuring script below came out of that.
17. **Home header:** ~~spacing~~ done 2026-09-24 (subtitle sits under the name; more air before the crew). The logo is still not loved — item 2 picked "Ollie on lamp" from four; revisit with fresh candidates once the scenes (26) exist, since the mark and the scene should share a language.
18. ~~**The composer should behave like iPhone Messages.**~~ — done 2026-09-24. Grows with the text to ~5 lines (measured from content), + at the left, ↑ inside the field at its bottom-right.

*Features:*
19. ~~**@-mention a crew member.**~~ — done 2026-09-24. `@Nell …` sends the turn to Nell: same vendor switches the session's model for the turn; other vendor runs a one-shot with the recent thread as context and full capability, landing as her own turn badged "Asked by name". Composer completes names on `@`. `mentions.ts` is pure and unit-tested. Images cannot travel the cross-vendor way yet and the thread says so.
20. ~~**Session naming that you can find things by.**~~ — done 2026-09-24. Named after the jobs, open one first then closed ones newest first, with the same regexes as the Chapters board (pinned to each other). A typed title sticks.
21. **Fuel: cleaner at rest, collapsible when opened, and smart.** — *mostly done 2026-09-24*: "Less" closes the opened card; the planner is told both vendors' tightest windows with reset times and asked for a `## Fit` line (first slice + remainder, and whether the other vendor could take it). Still open: the expanded card's readability, and the "park the remainder on the roadmap" tap — the plan names the remainder; nothing yet writes it anywhere.
22. ~~**Contexts per agent / the handoff**~~ — done 2026-09-24. Yes, each engine session is its own context (§4c). Once the meter reads degrading or critical the bar offers "Hand off to <other vendor's flagship>": briefed from the plan file (pending, or last written) and the recent thread, told to check git state before trusting the summary, continuing with a clean window, badged "Handoff". Same machinery as 19.
23. **Pip is too conservative, and Codex is under-used.** — *root cause found and fixed 2026-09-24; the structural half stays open.* The log said it: every route for 31 hours read "claude: last observed 1,000+ minutes ago — no move on missing data". The Claude reading only arrived from live sessions' rate-limit events and nothing else asked; the router refuses to move on stale data, by design. Blind, not conservative. The probe is now asked every 20 minutes (and at boot). **Still true, and structural:** a session is bound to one vendor's adapter, so even a fresh gauge can only *suggest* the other vendor for a whole turn (`chooseRoute` runs with `lockAgent`); `candidates` in the route config cross vendors only for the triage call itself. The cross-vendor paths that now exist are 19 (@-mention: a one-shot with context) and 22 (the handoff). Next, in order: (a) in build mode, make the conference's *builder* the vendor with more headroom, not always the session's — the Proceed prompt can go to a one-shot on the other vendor the same way a mention does; (b) a per-session "prefer Codex / alternate" switch that biases (a); (c) look again after a week of fresh readings — the log will show whether the scarcity policy ever fires now that it can see.
24. ~~**"What the crew decided" is not earning its place.**~~ — done 2026-09-24. The card is gone; the numbers are one line under the fuel ("Today: 7 routes · 3 reviews").
25. **The animations from the vision board** — *audited 2026-09-24, nothing missing, one real gap named.* All eight §12a demos are in the app (the fold shipped with Chapters). Why a normal session sees few: **the stamp, the cheer and the fold fire only on a passing verify**, which only happens in build mode after Proceed, or from the git sheet — a plain auto/chat session never produces one. **Fuel draining and use-it-or-lose-it** need a reading that moved between two looks, and the Claude reading had not moved in 31 hours (item 23). **Peek** needs an approval, which full-auto removes. **Context rot** needs the meter past 60%. That leaves the wake-up, the typing commands and the working sprites as the everyday set — which matches what was seen. The gap worth closing: a plain-chat turn that ends after real work has no "finished" beat at all; the honest trigger is the same evidence the tracker uses (tool runs happened, the turn ended idle), not a timer. Not done yet; it belongs with the scenes work (26), where the crew's states get a home.

*Big:*
26. **Scenes.** Sleeping crew bunch together in one corner, stacked, with one Zzz; the active members (recent chapters) get the main area as a **scene** — around a table playing a game, throwing a ball in a bucket, a campfire with guitar and flute and one dancing. Ten scenes, each with props, each character pluggable into any seat — which means new angles for every character. Image generation is near-free; the constraint is house style and pixel consistency (see item 4's hue-drift lessons). Comes with its own board on the canvas before any pixels: the ten scenes, the seats, the props, and how a member is plugged in. Then the logo (17) revisited in the same language.



Written 2026-09-22, after the rename. Everything above this line ships; everything in it does not.

### 12a. Motion — the stream with the most pull behind it

**The `Effects` board is a proposal, not a feature.** It demonstrates eight pieces of information-carrying motion. Roost's stylesheet contains **six** `@keyframes` — `spin`, `pulse`, and the four added with the crew (`sprite-cut`, `wake-rise`, `wake-hide`, `wake-hide-late`). **None of the eight board demos exist in the app.** The gap, named honestly:

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

**Seven of the eight ship.** The eighth, the fold, is blocked on something real rather than on effort: the app has no chapters to fold — turns are one flat list — so it waits for 12d. Every one-shot fires only for items that arrived LIVE: opening a session replays its history, and a stamp and a cheer for every past verify the moment you open it would be motion reporting yesterday. Where history ends comes from the replay itself (`replayedCount`), not a clock — the phone's and the Mac's need not agree.

**The constraint that makes this good rather than noisy**, and it is not negotiable: *motion reports state, it never decorates.* Every animation in the app is tied to something that actually happened, holds when it is done, and does not loop. Ambient movement on its own schedule is the commonest tell of a generated interface, and `doctrine.test.ts` fails the build on `infinite` in the wake-up block for exactly this reason. Fun and honest are not in tension here — the wake-up is the proof. What makes it land is that the crew really was idle and really did just get woken by you.

**Beyond the eight**, motion that would carry information Roost already has and currently renders as text:
- **A handoff between vendors** — the Claude member stepping back as the Codex member steps in, on a cross-vendor review. Roost does this several times a task and it reads as a flat list of turns.
- **Effort, visible** — the `think` pose held longer and heavier at `xhigh` than at `low`. The chooser's reason is now in the transcript; the body language is not.
- **Someone being sent out** — a dispatched subagent leaving the roll-call and returning with something.
- **The gate refusing** — a dispatch blocked at 98% quota should *look* refused, not print a sentence.
- **Sleeping on idle** — the crew drifting back to the `sleep` pose after a long quiet spell, so waking them means something. This is the one case where a timer is arguably legitimate; it needs care, because it is also the one closest to ambient decoration.

### 12b. ~~Faces for the other eight~~ — done 2026-09-23

Every built-in persona now has a drawn sprite set (idle/type/think/blink/sleep/cheer/peek): **Ollie, Moss, Juno, Pip** shipped first; **Wren** (Claude suite default), **Otto** (Codex suite default), **Tuck** (`mini`/`nano`), **Bly** (`luna`), **Rue** (`terra`), **Nell** (`astra`, flagship), **Bram** (`fable`, flagship) and **Fig** (Claude suite default worker) followed, one at a time, each checked against the full crew-comparison sheet before shipping. Twelve drawn crew total. No pool avatars remain in the built-in roster; a user's own custom persona (via a `crew.json` override) can still lack a sprite and correctly falls back to `CrewAvatar`.

### 12c. ~~The design canvas is stale~~ — done 2026-09-23

Version 16 says Roost throughout. Every "Larry" was renamed by what the row DOES rather than by find-and-replace: the one sizing the job is now **Pip** — with Pip's face and colour on the rows where the name is a label — and the one doing work is **Moss**. The Codex reviewer is **Juno** on `gpt-5.6-sol` rather than on Nell's model, and Ollie's model line reads `opus 5.5`. The first pass reported "no retired names left" and was wrong: it matched case-sensitively and the boards set names in Silkscreen capitals.

### 12d. The reference boards' language is not in the app

`Home`, `Thread` and `Chapters` shipped 2026-09-23 (working order items 2–3) — palette, type, crew strip, the fuel gauge, the folded chapter are now live, checked against real mobile-viewport screenshots. **Still not in the app: `Control` (the effort control) and `Context` (the context meter) and `Roadmap`** — the app has no per-task effort UI, no visible context-window meter, and nothing rendering the roadmap itself. Picking this back up needs a fresh read of those three boards from the design canvas (`https://claude.ai/artifact/28CUkGBUQvnBvygnfEJNQn`) — not done yet in this pass because the Artifact tool was unavailable in-session when this was reached; do not guess at their specifics from memory.

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
- **One writer is warned, not just decided**: opening a second session on a project posts a notice and logs a gate decision. Blocking remains a config choice to add.
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
