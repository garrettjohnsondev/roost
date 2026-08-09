# Pocket

Your laptop's coding agents, in your pocket. Pocket is a self-hosted web app that runs on your
Mac and gives you a clean, mobile-first chat UI for **Claude Code** (via the Claude Agent SDK)
and **Codex** (via `codex app-server`) — both operating on the same local repos your editor uses.
Reach it from your phone anywhere over [Tailscale](https://tailscale.com).

## Features

- Chat UI with streaming responses, thinking indicators, and tool-activity chips
- Switch agents per session: Claude Code or Codex, same working directory
- Change **model** and **reasoning effort** mid-session from your phone
- Approval prompts on your phone: **Ask me / Auto-accept edits / Full auto**, plus per-request
  Allow / Deny / "Allow and stop asking this session"
- Paste or attach screenshots from your phone's camera roll
- Live token usage (and dollar cost for Claude)
- Sessions survive phone disconnects — history replays when you reconnect

## Requirements

- Node.js 20+
- `claude` CLI installed and logged in (Pro/Max subscription auth works)
- `codex` CLI installed and logged in (`codex login`) — tested against codex-cli 0.146.0
- Tailscale on the Mac and on your phone (free personal plan)

## Setup

```bash
npm install
npm run build
npm start          # serves UI + API on http://0.0.0.0:8790
```

Then on your phone (with Tailscale connected), open:

```
http://<your-mac-tailscale-name>:8790
```

Find the name with `tailscale status`. Add the page to your home screen for an app-like feel.

### Dev mode

```bash
npm run dev        # server on :8790 with reload + Vite dev server on :5173
```

### Configuration

Edit `pocket.config.json`:

- `projects` — allow-listed directories sessions can run in (add your repos here)
- `claude.models` / `codex.models` — model choices shown in the UI
- `port` — HTTP/WebSocket port

### Keeping the Mac awake

The laptop must stay awake and online. Either:

```bash
caffeinate -dimsu &        # while plugged in, lid open
```

or install [Amphetamine](https://apps.apple.com/us/app/amphetamine/id937984704) (needed for
closed-lid-on-battery use).

## Security

- **Keep this tailnet-only.** Pocket executes commands on your machine by design. Tailscale
  means only your own devices can reach it. Do **not** port-forward it or put it behind a public
  tunnel without real authentication.
- Optional shared secret: start with `POCKET_TOKEN=<secret> npm start`; API and WebSocket
  requests must then carry it (`Authorization: Bearer <secret>` or `?token=`). The bundled web
  UI does not attach the token — it's for locking down non-tailnet setups with a custom client.
- New sessions default to **Ask me** approvals; "Full auto" maps to Claude's
  `bypassPermissions` and Codex's `approval_policy=never` (inside a `workspace-write` sandbox).
  Prefer approvals when you're not watching the terminal.

## Architecture

```
phone browser ── Tailscale/WLAN ──> Express + WebSocket server (server/)
                                      ├─ ClaudeAdapter: @anthropic-ai/claude-agent-sdk
                                      │    streaming input queue, canUseTool -> phone approvals,
                                      │    setModel/setPermissionMode/effort mid-session
                                      └─ CodexAdapter: `codex app-server` (JSON-RPC over stdio)
                                           thread/start + turn/start, approval server-requests,
                                           model/effort per turn
```

- One `Session` per chat; the transcript is kept in memory and replayed to reconnecting clients.
- Wire protocol lives in `server/src/protocol.ts` (mirrored in `web/src/types.ts`).
- Codex wire strings were generated from the installed CLI
  (`codex app-server generate-ts`); if a future Codex release renames methods, regenerate and
  adjust `server/src/agents/codex.ts` (set `DEBUG_CODEX=1` to log raw JSON-RPC traffic).

## Troubleshooting

- **Codex session shows "connecting" forever** — run `DEBUG_CODEX=1 npm start` and watch the
  raw traffic; check `codex login` status.
- **Claude errors immediately** — make sure the `claude` CLI works standalone in that project
  directory first.
- **Phone can't connect** — check `tailscale status` on both devices; the Mac must not be
  asleep.
