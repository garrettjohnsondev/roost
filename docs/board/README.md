# The design canvas: a local copy

A copy of the design canvas at <https://claude.ai/artifact/28CUkGBUQvnBvygnfEJNQn>
("Roost UI rework — a group chat with your crew"), saved 2026-09-24 from
version `1790288358-2f21`.

**Why a copy:** agents running inside Roost can't open that link. The Artifact
tool is switched off for Agent SDK sessions (`CLAUDE_CODE_ENTRYPOINT=sdk-ts`),
and the page is private to a claude.ai account, so a plain web fetch can't read
it either. Read the specs from here instead.

**This copy does not update itself.** If the canvas changes, save it again
from a Claude Code session outside Roost (VS Code or the terminal), where the
Artifact tool works.

## What's here

| File | Board | Size |
|---|---|---|
| `Main.dc.html` | Direction: palette, type, what was thrown out | 1160 × 1363 |
| `Effects.dc.html` | Motion that carries information | 1160 × 1305 |
| `Logo.dc.html` | The logo, four ways | 1160 × 880 |
| `Home.dc.html` | Home (phone) | 390 × 962 |
| `Chat.dc.html` | The thread, watch it play (phone) | 390 × 1140 |
| `Chapters.dc.html` | The work, folded (phone) | 390 × 1026 |
| `Crew.dc.html` | Who's in the thread (phone) | 390 × 962 |
| `Control.dc.html` | Effort and who decides | 1160 × 1305 |
| `Roadmap.dc.html` | The map, as it stands | 1160 × 1305 |
| `Context.dc.html` | When a context fills | 1160 × 1305 |
| `canvas.json` | The index: each board's position, size and title, plus the canvas notes | |
| `assets/` | The 18 sprite and logo images the boards use (referenced as `assets/<id>.png`/`.webp`) | |

Each `.dc.html` is the board's full source: inline styles, CSS and
keyframes. Exact colours, sizes, timings and copy can be read straight from it.
The files need the canvas's own runtime to render exactly as on claude.ai.
Opened directly in a browser, the static boards look close, but interactive
parts (`<sc-for>`, `{{holes}}`) won't run. For how to build these into the
app, see [../MOTION.md](../MOTION.md).
