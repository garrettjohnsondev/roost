# Project knowledge

Facts a model cannot infer from the code alone. Each H2 is a section an agent
definition asks for by name.

## conventions

TypeScript throughout, ESM with `.js` import specifiers. Pure, unit-testable
modules in `server/src/`; adapters in `server/src/agents/`.

`null` is a first-class state. Any figure the data cannot support renders as
"no data", never as `0` and never as a full bar. **Any `?? 0` on a cost,
percent or savings figure is a bug.** Unknown is never treated as headroom.

Cumulative engine counters are converted to per-call deltas in exactly one
place (`usageDelta.ts`). Never log a running total as a call.

Comments explain why, not what. Prefer a comment that records a mistake and
its cause over one that restates the code.

## commands

- `npm test -w server` — vitest
- `npm run typecheck` — both workspaces
- `npm run dev -w server` — tsx watch

## done-definition

Typecheck clean, tests pass, and any behaviour change carries a test that
would have failed before it. A bug found in a live run is also recorded in
the ROADMAP corrections log with its cause, not just its fix.

## constraints

Dollar figures stay off the UI: these are flat-rate subscriptions, so cost is
measured in tokens and percent-of-rate-limit-window, never in currency.

Never scrape a CLI when a supported protocol exists. Codex is reached through
`codex app-server` JSON-RPC, Claude through the Agent SDK.

`danger-full-access` must never be selectable by an automated dispatch.

## design-tokens

Crew colours live in `server/src/crew.ts`. The avatar pool palette is twelve
colours in `tools/avatars/palette.json`; avatars are 128px PNGs under
`web/public/avatars/`.
