# More providers via ACP — research (roadmap #53, overnight 2026-09-28)

## The short answer
One new adapter speaking the **Agent Client Protocol (ACP)** would let Roost drive a long list of coding agents the same way, instead of writing a bespoke adapter per vendor like we did for Claude (Agent SDK) and Codex (app-server).

## What ACP is
- JSON-RPC 2.0 over stdio, originally from Zed, now used by JetBrains, Neovim, Emacs and others. The client (Roost) launches the agent as a subprocess and talks to it over stdin/stdout.
- Methods Roost would need: `initialize`, `session/new` (with a cwd), `session/prompt`, streaming `session/update` notifications (message chunks, tool calls, plans), `session/request_permission` (maps straight onto Roost's approval cards), and `session/cancel` (our Stop).
- That matches Roost's existing adapter shape (server/src/agents/*): messages, tool starts/ends, approvals, interrupt.

## Who speaks it (agentclientprotocol.com agent list, Sept 2026)
Gemini CLI (`gemini --experimental-acp`), GitHub Copilot (preview), Cursor, Goose, OpenCode, OpenHands, Kiro CLI, Kimi CLI, Qwen Code, Mistral Vibe, Factory Droid, Junie and more. Codex CLI also has an ACP mode, but our native Codex adapter is richer (rate limits, MCP config), so keep it.

## Caveat found
Google moved unpaid and Google One users from Gemini CLI to "Antigravity CLI" on 2026-06-18, so check which CLI a Gemini subscriber actually has before drawing a Gemini crew.

## Proposed plan (needs your call on which provider first)
1. `server/src/agents/acp.ts`: one generic adapter, configured per provider with a command line (`{ id: 'gemini', cmd: ['gemini', '--experimental-acp'] }`).
2. Usage and limits: ACP has no rate-limit reporting, so the plan advisor and meters would show "no reading" for ACP providers until a vendor-specific reader is added.
3. Crew: 4–5 new birds per provider, drawn with the same pipeline (scripts/scenes/gen.mjs + convert.py), named and coloured like the rest.
4. Code map (#54) comes along for free: the stdio MCP server already works for any agent that accepts MCP config (ACP's `session/new` takes `mcpServers`).

## Sources
- https://agentclientprotocol.com/get-started/agents
- https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md
- https://zed.dev/docs/ai/external-agents
