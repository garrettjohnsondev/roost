# Preview — see the thing you are building, from the phone

*Design, 2026-09-24. Not built yet.*

> Let's say we are building a website. I can code all day in Roost, but I
> eventually want to see an actual live version in the app — and I may not be
> on my computer or on the same network as my computer.

## The network part is already solved

Roost is reached over Tailscale. The phone joins the tailnet from any network
(cellular, a café, another city), so "not on the same network" is not a
problem this feature has to solve. What is missing is only that Roost exposes
nothing but itself: a project's dev server listens on the Mac's
`localhost:5173`, and the phone cannot see `localhost`.

## The shape

1. **Each project says how it runs**, in its project file, beside `## gates`:

   ```
   ## preview
   - `npm run dev -- --port {port} --host 127.0.0.1`
   ```

   Or `static: dist/` for a built site. Written by the person (or proposed by
   an agent and accepted by the person, the same rule as gates: agent output
   is never a command).

2. **Roost starts it on demand.** A Preview button in the session header.
   Roost picks a free port, runs the command in the project's directory,
   waits for the port to answer, and keeps it running while anyone is
   looking (stopped after 20 idle minutes). One preview per project.

3. **Roost proxies it under its own address**: `/preview/<project>/…` →
   `http://127.0.0.1:<port>/…`, including websockets, so hot reload works.
   Same origin as Roost, so the phone needs nothing new: no second port, no
   second Tailscale rule. Dev servers that assume they own `/` get a
   `--base /preview/<project>/` flag (Vite, Next and Astro all take one); the
   project file can say what flag to use.

4. **An in-app viewer**: a full-screen sheet with the page in a frame, a
   refresh button, a phone/desktop width toggle, and "open in Safari" for when
   the frame is not enough. The image viewer (ImageView.tsx) is the pattern.

5. **The agents can use it too.** Once a preview is running, an agent can be
   told its URL and screenshot it (scripts/shoot.mjs already does this for
   Roost itself) — which is also how a visual check becomes a gate.

## What it is not

- Not public hosting. The preview is only reachable on the tailnet, like
  Roost. Sharing with someone outside is a deploy, and out of scope.
- Not a build system. Roost runs the project's own command; it does not guess.

## Order of work

1. `## preview` in the project file and the start/stop/port logic (server).
2. The proxy, with websockets (server) — the risky part; test with a Vite
   project and hot reload.
3. The viewer sheet and the header button (web).
4. The agent-facing URL and the screenshot-as-gate.
