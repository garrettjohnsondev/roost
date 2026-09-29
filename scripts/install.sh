#!/usr/bin/env bash
# One-line install for Mac and Linux (roadmap #56):
#   curl -fsSL https://raw.githubusercontent.com/gjohnsonmb1-afk/roost/main/scripts/install.sh | bash
set -euo pipefail
REPO="${ROOST_REPO:-https://github.com/gjohnsonmb1-afk/roost.git}"
DIR="${ROOST_DIR:-$HOME/roost}"
command -v git >/dev/null || { echo "Roost needs git: https://git-scm.com/downloads"; exit 1; }
command -v node >/dev/null || { echo "Roost needs Node 20+: https://nodejs.org"; exit 1; }
if [ -d "$DIR/.git" ]; then
  echo "Updating Roost in $DIR"; git -C "$DIR" pull --ff-only
else
  echo "Downloading Roost to $DIR"; git clone --depth 1 "$REPO" "$DIR"
fi
cd "$DIR"
node scripts/setup.mjs
