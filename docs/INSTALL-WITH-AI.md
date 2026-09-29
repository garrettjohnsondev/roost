# Installing Roost — a guide for AI assistants

You're an AI coding assistant (Claude Code, Codex, or similar), and someone asked you to install Roost for them — probably with a sentence like *"Install Roost from github.com/gjohnsonmb1-afk/roost"*. They may not be technical. Follow these steps in order, explain each one in a sentence of plain English before you do it, and only ask them for the things marked **ASK**.

Roost is a free, open-source app (MIT). It runs on their computer and lets them drive Claude Code and/or Codex from their phone, through a crew of pixel-art characters. It uses their own Claude or Codex subscription; it never asks for payment or API keys.

## 1. Check what's there

Run and read the output:

```
node --version
git --version
claude --version
codex --version
```

- **Node** must be 20 or newer. If missing or older: on macOS `brew install node` (if Homebrew exists), otherwise point them to https://nodejs.org (LTS installer) and wait. On Windows `winget install OpenJS.NodeJS.LTS`. On Linux use their package manager or nvm.
- **git**: macOS `xcode-select --install` or `brew install git`; Windows `winget install Git.Git`; Linux package manager.
- They need **at least one** of Claude Code or Codex, signed in. You're running inside one of them, so that one is present. Don't install the other unless they ask.

## 2. Get Roost

Clone into their home folder (don't overwrite an existing `~/roost` — if it exists, `git -C ~/roost pull --ff-only` instead):

```
git clone https://github.com/gjohnsonmb1-afk/roost.git ~/roost
cd ~/roost
```

(Windows PowerShell: `git clone https://github.com/gjohnsonmb1-afk/roost.git $HOME\roost`.)

## 3. Tailscale — how their phone reaches this computer

Run `node scripts/setup.mjs --check`. If it says Tailscale isn't running:

- Explain: *"Tailscale is a free private network just for your own devices. It lets your phone reach this computer from anywhere, and nobody else can."*
- Install it: macOS https://tailscale.com/download/mac (or `brew install --cask tailscale`), Windows `winget install Tailscale.Tailscale`, Linux `curl -fsSL https://tailscale.com/install.sh | sh`.
- **ASK** them to open Tailscale and sign in (Google, Apple, Microsoft or GitHub all work), then install the **Tailscale app on their phone** and sign in with the **same account**. Wait until they say it's done.
- Re-run `node scripts/setup.mjs --check` until it shows Tailscale is on.

## 4. Build and start Roost

```
node scripts/setup.mjs
```

This installs dependencies, builds, starts Roost as a background service (it comes back after a reboot) and prints a QR code and an address like `http://their-computer.tailnet-name.ts.net:8790`.

If it fails, read the error, fix the cause (usually a missing tool from step 1), and run it again. Don't edit Roost's source code to make it pass.

## 5. Hand it to them

- **ASK** them to scan the QR code with their phone camera (or type the address into Safari/Chrome on the phone). Tailscale must be on, on the phone.
- On iPhone: Share → **Add to Home Screen**. On Android: menu → **Add to Home screen**.
- Tell them: *"Type a message and Pip will hand it to the right crew member. Type @ to pick someone, or / for quick actions."*

## Rules for you, the assistant

- Never ask for or store passwords, API keys or payment details. Roost doesn't need any.
- Never open Roost to the public internet (no port forwarding, no public tunnels). Tailscale only.
- Keep explanations short and friendly; they may be new to all of this.
- If something is outside your reach (installing an app that needs their click, signing in), explain exactly what to click and wait.
