#!/usr/bin/env zsh
# Pane wrapper used by start.sh — runs an npm script and drops to a
# shell on exit so the last output remains visible.
#
# Why this file exists separately: wt.exe parses ';' as a sub-command
# separator. Inlining a multi-statement string like
# `trap "" INT; npm run "$1"; exec zsh` into the wt.exe invocation
# breaks the parser — the `;` inside the string get treated as new tab
# / split-pane delimiters. Keeping the multi-statement command in its
# own file (passed as a single argument to wsl zsh) sidesteps that
# entirely.
#
# Usage: start-pane.sh <npm-script-name>
#
# `trap '' INT` swallows Ctrl+C at this wrapper level so the dev
# script below receives the signal cleanly and exits on its own; the
# wrapper then falls through to the shell instead of disappearing.

trap '' INT
npm run "$1"
exec $SHELL
