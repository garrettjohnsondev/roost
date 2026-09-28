# Arcade games brief (wave 3/4, 2026-09-29)

Roost is a phone web app (React + Vite, TypeScript) where a pixel-art bird crew runs coding agents; the arcade is what you play while they work, one-handed, in a line or between meetings.

## Setup in a worktree
- First: `git reset --hard main` (worktrees can start on an old commit). The arcade lives in `web/src/games/`.
- To run checks, symlink node_modules from the main checkout: `ln -s /Volumes/PortableSSD/remote/node_modules node_modules; ln -s /Volumes/PortableSSD/remote/web/node_modules web/node_modules; ln -s /Volumes/PortableSSD/remote/server/node_modules server/node_modules` — remove the links before committing.
- Verify from the repo root: `npm run typecheck` and `npm test` must pass. Commit ONLY your game folders (explicit `git add web/src/games/<id>`), message ending with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Never deploy or push.

## The contract (read these files)
- `web/src/games/types.ts`: GameMeta / GameProps / Ghost / GHOSTS / sprite() / seeded() / dayNumber().
- `web/src/games/Arcade.tsx`: the host (saves, scores, achievements, ghosts, corner crew, rotate prompt).
- A game is `web/src/games/<id>/index.tsx` exporting `meta` and `Game`. Don't edit shared files.

## What every game now needs
1. **Three new things + a visual upgrade.** Real gameplay additions (modes, power-ups, levels, combos, streaks…), not cosmetic only. Visual upgrade: richer pixel look, juicier animation (squash/stretch, particles, screen shake that respects prefers-reduced-motion), clearer UI.
2. **Ghosts.** Set `meta.ghostScore = (strength) => number` — the score a ghost of that strength posts (strength 0.2 ≈ Haiku, easy; 0.95 ≈ Astra, very hard). Calibrate so 0.2 is beatable by a casual player and 0.95 needs real skill. When `props.ghost` is set, draw the ghost in-game **see-through** (their crew sprite at ~40% opacity with a soft white glow, floaty bob) showing their pace/target (e.g. a racing marker, a target line, their score ticking up). The host awards the win; you only draw.
3. **Sound.** `import { sfx } from '../../economy/sound'` and call `sfx('tap'|'hit'|'bounce'|'score'|'coin'|'win'|'lose'|'crash'|'whoosh')` at moments. It's off by default and quiet; never assume it plays.
4. **Haptics.** `import { ticks, buzz } from '../../haptics'`. iPhone can only vary the NUMBER/rhythm of ticks, not strength: a bat hitting a ball = `ticks(1)`, a big collapse = `ticks(n)` with n scaled by how much fell (up to 12), a win = `buzz('pass')`, a loss = `buzz('fail')`. Don't spam: at most a few per second.
5. **Safe corner.** Set `meta.safeCorner` ('tl'|'tr'|'bl'|'br') to the corner your game never needs — a 40px crew face sits there.
6. **Landscape** (only where noted): `meta.orientation = 'landscape'`; lay out to fill `window.innerWidth × innerHeight` minus a ~36px header when the phone is sideways (listen to resize). The host shows a turn-your-phone prompt when upright.
7. Rules: no emoji anywhere in code (Roost draws its own icons; use `Icon` from `web/src/icons.tsx` or canvas drawing). CSS classes namespaced `.game-<id>-*`, border-radius < 8px (or 50%). Honor `paused`. Pure logic in logic.ts with vitest tests (add tests for the new mechanics). Crew sprites: `/crew/<name>-<pose>.webp` (names: pip ollie bram wren moss fig nell juno rue bly tuck otto; poses: idle blink cheer dance hold peek side sit sleep think look1 look2 type). Game logo art arrives at `/games/logos/<id>.webp` (not your job).

When done, reply with the commit hash, branch, and for each game: the 3 new things, the visual upgrade, and the ghost calibration.
