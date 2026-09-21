# Pocket — Roadmap

*Written for whoever picks this up next: Garrett, or an agent working in this repo. It exists so the reasoning behind each decision survives the chat log it came from. Cited claims are graded **[A]** peer-reviewed/replicated, **[B]** preprint or systematic study, **[C]** vendor claim, **[D]** practitioner anecdote.*

---

## 1. What this is

**One chat, with a project loaded, where a named crew of Claude and Codex agents plan, review, and dispatch the right workers — Haiku to Fable, minimal to Sol — with a transparent fuel gauge across every subscription and routing that spends the right quota at the right time.**

Pocket already had the hard part: a mobile PWA reachable over Tailscale that drives both engines on the *right* transports — Claude in-process via `@anthropic-ai/claude-agent-sdk`, Codex via `codex app-server` JSON-RPC. What it lacked was orchestration. What `agent sync` had was orchestration, buried under 1.34 GB of art and shelling out to CLIs. This repo is the merge, keeping Pocket's transports and porting agent-sync's *ideas* — mostly as prompts and policies, not as code.

### The frame — read this before proposing anything

**"Saving tokens" is the wrong goal, and the right one is better.** On flat-rate plans the marginal cost of another frontier call is zero, which kills the cost argument for orchestration outright ([AkitaOnRails](https://akitaonrails.com/en/2026/04/25/llm-benchmarks-vale-a-pena-misturar-2-modelos/)) **[B]**. What actually binds is **rate limits on one account**. The fix for that is routing through the *other* provider's quota and through cheaper tiers — which a Claude+Codex harness does natively.

So: **this is a rate-limit-management and quality harness.** Every claim the UI makes must be phrased that way. Every figure is an API-list-price *valuation*, labelled **"API value"**, never "spend".

---

## 2. Status

| Phase | What | State |
|---|---|---|
| **0** | Truth — pricing, ledger, quota, policy, correct capture | ✅ **Done, verified live** |
| **4b** | Effort as a routed dimension | ✅ **Done** |
| **4c** | Context metering (three windows) | ✅ **Done** (metering; UI pending) |
| **1** | The crew — personas, roles, avatars | ⬜ Next |
| **2** | Dispatch primitive — `runAgentTask` | ⬜ |
| **3** | The conference — plan → review → reconcile | ⬜ |
| **4** | Quota-aware model routing + budget ceiling | ⬜ |
| **4d** | Modes — chat / auto / plan / build | ⬜ |
| **5** | Verification gate | ⬜ |
| **6** | UI — fuel gauge, crew badges, context meter | ⬜ |

**114 tests green, typecheck clean both workspaces.** New modules: `pricing.ts` `ledger.ts` `quota.ts` `policy.ts` `routing.ts` `context.ts` `usageDelta.ts` `codexInputSplit.ts`.

**Verified live against both real subscriptions:**
```
CLAUDE (max)      5-hour session 23%  ·  7-day (all) 4%  ·  7-day (Fable) 0%
CODEX (prolite)   Primary (7d)   42%
```
Both via **zero-token** reads. One real Codex turn produced exactly one ledger record: model `gpt-6-astra`, 4,738 uncached + 12,928 cached = 17,666 tokens, matching the engine's own cumulative figure to the token.

---

## 3. The loop

```
task typed in one chat (project loaded)
   ↓  TRIAGE (cheap)      tier + task kind + size estimate
small? ──yes──→ one agent, no ceremony              ← the Rails lesson (§5)
   ↓ no
PLAN        primary writes .pocket/plans/<id>.md    ← a FILE, not a chat message
REVIEW      the OTHER vendor, CLEAN context:
            task + plan file + criteria only — never the author's reasoning
RECONCILE   primary filters findings against requirements  ← prevents scope creep
EXECUTE     ONE writer holds the diff;
            read-only helpers dispatched in parallel
VERIFY      harness runs the checks; evidence = command + output + exit code
REVIEW DIFF fresh context, diff + criteria only
```

Every step renders in the one chat as a named, badged turn. Pocket already draws another model's turn inline via `pushEvent({ type: 'consult', phase, agent, text })`.

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

1. **Build in Pocket, not agent-sync.** Every quota bug in agent-sync was downstream of scraping CLIs instead of using supported protocols. Pocket made the other choice.
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

`shouldApplyEffort()` protects the prompt cache — see §7.

### ✅ Phase 4c — Context metering *(metering done, UI pending)*
Three windows, and conflating them is how long sessions rot:
1. **Pocket's transcript** — ours. Currently RAM-only, capped 5,000 events, lost on restart.
2. **Each engine's session** — theirs. Degrades *before* it overflows.
3. **Subagent contexts** — fresh, discarded. Where the savings live.

Metered via Claude `getContextUsage({detail:'summary'})` (a **stable** API) and Codex `modelContextWindow` + per-turn breakdown (free). Thresholds deliberately tighter than any auto-compact trigger. Advice escalates cheapest-first: **dispatch → compact → handoff**.

### ✅ Phase 1 — The crew *(done)*
`personas.js` → `crew.ts`, mapping `(suite, model) → {name, tier, colour}` with user overrides, plus **`role`** as a field distinct from `tier` (`planner | reviewer | executor | explorer | tester | dispatcher`) — persona is *who*, role is *what hat*. `rosterBlock()` injects names into prompts so narration reads *"Sending Larry in to build the UI."* Every chat turn shows avatar + name + role badge + model id.

**Identity keys on `(suite, model-match)`, never on session** — so a crew member keeps their face when the vendor ships a new version underneath them. Sol stays Sol from 5.6 to 5.7. That is the same succession property Phase 7 detects, and it is why the two phases reinforce rather than collide.

**Avatars are generated, not ported.** The original plan — downscale the agent-sync cast art to webp — was replaced on 2026-09-21 for two measured reasons. First, Codex ships a built-in `image_gen` tool requiring **no `OPENAI_API_KEY`**: it runs off the subscription, verified end to end. Second, `sips` reports success on webp export but **writes no file**, so the pool ships as 128px PNG (~24 KB each) unless a real encoder is added as a dependency.

**The cost split is the design constraint.** Images ride the unlimited image quota; the *turn driving them does not*. Measured: **11,866 text tokens for one image, 41,465 for four** — batching saves only ~13%, because each `image_gen` call and its result carry their own weight. So it is **~10–12k text tokens per avatar** however it is arranged.

Hence: the pool is a **build-time asset**. `tools/gen-avatars.mjs` is run by a maintainer, the output is committed, and picking a face costs a user nothing. Generating per user would spend *their* weekly window, take minutes, and require them to have Codex at all. Runtime generation (`POST /api/avatars/generate`) stays available for users who do, with the token cost stated beside the button.

Two details worth keeping: the background colour is **specified in the prompt, not sampled back out of the PNG**, so every chip colour is exact by construction; and the light model drifted to shaded cartoon when asked for flat vector, so the generator uses the default model and passes a **verbatim style clause**, shared with the runtime generator so a custom avatar does not look pasted in beside the pool.

### ⬜ Phase 2 — Dispatch primitive
Generalise `consult.ts`'s `startConsultStep` into `runAgentTask({ type, agent, model, effort, prompt, cwd, capability, background?, resumeFrom? })` — the contract Claude Code and Grok Build independently converged on.

- **Agent types as `.md` files with frontmatter** in `<project>/.pocket/agents/` (same shape as `.claude/agents/`, portable).
- **Capability modes, not tool allowlists**: `read-only | read-write | execute | all`. Stronger and simpler than the Bash-prefix allowlist that bit us in agent-sync.
- Built-ins: `explore` (read-only, cheap), `review` (read-only, frontier), `test` (execute-only), `plan` (read-only, frontier).
- **Treat the other vendor's output as untrusted input** — scan for control-tag and turn-marker imitation at the Claude↔Codex seam, as Claude Code does for subagent output.

### ⬜ Phase 3 — The conference
Extend `runConsult` into a size-gated loop. `composePlannerPrompt` / `composeCriticPrompt` / `composeProceedPrompt` already exist and are close to right. Three changes: **plan to a file**; **starve the reviewer** (plan + criteria only, plus an anti-noise instruction — a reviewer asked for gaps will invent them); **reconcile step** where the primary filters findings against requirements.

### ⬜ Phase 4 — Quota-aware routing + ceiling
`chooseRoute()` as a pure function beside the untouched `triage`/`shouldRetriage`. Scarcity: shift to the roomy suite and step the tier down. **Never route toward an agent with worse-known headroom.** Surplus: the use-it-or-lose-it path (`quota.surplus()` is built) with a one-tap **"Use the good models"** toggle that holds until reset. **A hard budget across the whole agent tree**, not per-agent — per-agent caps don't bound a tree.

### ⬜ Phase 4d — Modes
**Chat** (one agent, no ceremony) · **Auto** (triage → tier → model *and* effort) · **Plan** (read-only: Claude `permissionMode:'plan'`, Codex `sandbox:'read-only'`) · **Build** (the full conference). Per-session, switchable mid-session, persisted.

### ⬜ Phase 5 — Verification gate
Acceptance criteria travel **with the task**, not only the plan — E2EDevBench's Designer failure was executors treating a plan as authority over requirements. The gate is a **script the harness runs**; the executor must not author or edit it. Anti-fabrication is structural, not instructional: a synthetic "screenshot" fails on unique-colour count and file size, and no two frames in a set may be pixel-identical. *(Learned the hard way — a builder in agent-sync fabricated eleven PNGs of vector diagrams and nearly passed a stage with them.)*

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

### ⬜ Phase 6 — UI
Unified fuel gauge across every subscription: all windows both providers, burn rate, projected exhaustion, **per-role and per-persona spend** with the orchestrator's own turns broken out. Context meter per agent. Crew badges on every turn. Honesty rules enforced by types.

---

## 8. Corrections log

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
| 10 | **Planned a free-model planning tier** before checking what free costs. The constraint isn't rate limits, it's that free tiers are paid for in prompts — and this harness runs on private repos. | Dropped entirely. See decision 8. |

---

## 9. Open risks and unverified claims

1. **`SDKRateLimitInfo.utilization` scale is undocumented** (0–1 vs 0–100); Pocket assumes 0–1. `normalizePct` accepts both and warns once in the ambiguous band. *Note: the structured `limits[]` path reports `percent` as plain 0–100, so it has no ambiguity — prefer it.*
2. **Codex `inputTokens` vs `cachedInputTokens` inclusivity is unstated** — up to 10× cost impact. Isolated in `codexInputSplit.ts` with a one-time warning if the exclusive branch is ever taken. *Live evidence so far says inclusive.*
3. **`usage_EXPERIMENTAL_...` is explicitly unstable** — the method name will change on stabilisation. `typeof`-guarded; the haiku probe stays as a permanent fallback.
4. **Codex prices are unknown** and `pocket.config.json`'s two model lists disagree with each other — *and neither lists `gpt-6-astra`, the model actually running*. Codex rows ship as `basis:'unknown'` → no dollar figure until `prices.json` exists. Don't invent rates.
5. **Cross-device blindness.** Provider windows include usage from other machines and the web apps; our ledger sees only Pocket. Window-derived burn is truthful; ledger-derived burn is Pocket-only. Label them distinctly.
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

**Did not port:** `orchestrator.js`'s 1,586-line phase machine (the ceremony cost 28 hours for 2 of 6 stages on its one real run) · `quota.js` (dead pty scrape) · both CLI adapters (superseded by Pocket's transports) · `demo.js` · five orphan office HTML files · 1.34 GB of cinematic plates.
