#!/usr/bin/env bash
# Open Windows Terminal with two split panes (BFF left, UI right).
#
# WSL2 + Windows Terminal only — intended for the Architect's local dev
# environment. If wt.exe isn't on PATH, the script aborts with a hint.
#
# Run from the repo root (npm run start sets that cwd automatically).
# Each pane runs an npm script via the inline PANE command and drops
# to a shell on exit so the last output stays inspectable on failure.

set -e

if ! command -v wt.exe >/dev/null 2>&1; then
  echo "Error: this script requires WSL2 + Windows Terminal (wt.exe)." >&2
  echo "It is meant for the local dev environment; no cross-platform fallback." >&2
  exit 1
fi

# wt.exe -d expects a Windows-style path. `wslpath -w .` is the Windows
# representation of the current working directory.
PROJECT_DIR=$(wslpath -w .)

# Free dev ports if held by orphans from a previous session. fuser
# exits non-zero when nothing is listening; suppress that noise.
fuser -k 4242/tcp 2>/dev/null || true
fuser -k 4200/tcp 2>/dev/null || true

# Per-pane command lives in scripts/start-pane.sh — it cannot be
# inlined here because wt.exe parses `;` as a sub-command separator,
# and the wrapper's `trap; npm; exec` chain contains them.
wt.exe --title skill-map -d "$PROJECT_DIR" wsl zsh ./scripts/start-pane.sh bff:dev \; \
  split-pane -V -d "$PROJECT_DIR" wsl zsh ./scripts/start-pane.sh ui:dev
