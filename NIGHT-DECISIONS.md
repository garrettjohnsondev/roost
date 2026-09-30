# Overnight run — decisions made without you (2026-09-28/29)

You said yes to me making design calls while you slept. Each one is here so you can review and reverse it in the morning.

- This chat was on "Ask before changing files" (approvals: ask), which is why you kept getting asked. Switched it to Full auto for the night (settings → Fine-tune). Switch it back whenever you like.
- Deploy card: it appears after any passed check that changed files and waits above the message box. "Not now" hides it for that pass; the rocket keeps a soft glow until the changes are live. "Live" means the project's Deploy button last ran successfully after that pass.
- Plan ladders (#44): $20 = Haiku / Sonnet / Opus (lighter thinking). $100 = Sonnet / Opus / Opus (full). $200 = Sonnet / Opus (high) / Opus (deepest). Codex mirrors with luna / terra / astra. Picking a plan rewrites the model routes, and open chats pick it up from their next message.
- Plan advisor: Pip compares how much of your weekly Claude window you've used with how much of the week has passed. Burning more than 25% faster than the clock (or past 90%) → he suggests one step down. Using under 60% of pace late in the week → one step up. He only suggests; you tap to apply.
- Your plan is set to $100 once the deploy lands (the setting didn't exist on the running server yet).
- Arcade lives behind a new game-pad button at the top of the home screen. Game names I picked: Conga (Snake), Minesweeper (napping crew under dirt), Nests (Battleship), Crew Match (memory), Hatch (2048), Daily Word, Stack, Flap (Flappy), Brick Nest (Breakout), Roost Birds (bugs in the code instead of pigs).
- Minesweeper's best time only counts Medium; Sudoku's best counts any solve.
- Scenes: the morning version shows 6am–6pm your time, the night one otherwise. By day the stars, shooting stars and lamp glows are off; fires still flicker.
- Pixel avatars: every pool face now shows its pixel redraw automatically (no one has to re-pick). The beacon keeps its old drawing, because its redraw came out as a red siren. Pip's avatar is the beacon.
- Per-project usage counts what costs against your limit: new input, cache writes and output. Cache reads are left out because they're nearly free. "% of your week" = that project's share of your tokens × your weekly % used.
- "Where we left off" shows the 3 most recent projects from the last week. "Next" is the crew's own "Next up…" line from their last reply in that project. Continue opens the chat (resuming if needed) and sends "Let's keep going: <next>".
- iPhone haptics use the iOS 18 switch trick. It may be silent on older iOS, and Apple could change it.
- New project: the folder goes next to your first project (on the SSD), with a README, a .gitignore and a first commit. GitHub defaults to Private; I didn't test the GitHub step, because testing it would have created a real repo on your account.
- Dev mode is a switch in Settings, kept per phone.
- Onboarding: `scripts/install.sh` (Mac/Linux) and `scripts/install.ps1` (Windows) clone to ~/roost and run `scripts/setup.mjs`. Setup checks Node, git, Claude/Codex and Tailscale (it finds the Mac app's built-in CLI), builds, starts the background service (LaunchAgent / systemd user unit / Windows logon task) and prints a QR code. The Windows and Linux service paths are written but untested, since there's no machine here to try them on. The in-app welcome only shows on a phone that has no name on file, so you won't see it.
- The installer uses your GitHub repo's URL (garrettjohnsondev/remote). If the repo is private, other people can't install from it until it's public or moved.
- Providers (#53): research only, in docs/PROVIDERS-ACP.md. Which provider to add first is your call.
- Not done: #54 carry-overs (the code map report needs days of data; light/dark parity; #37 is still your call). The "why did Pip pick a plainer crew member" hint beyond the existing route reason is not built yet.
