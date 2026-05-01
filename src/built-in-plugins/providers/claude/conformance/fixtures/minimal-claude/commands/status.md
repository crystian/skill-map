---
name: status
description: Prints a one-line project status (branch, dirty flag, ahead/behind).
args:
  - name: verbose
    type: boolean
    required: false
    description: Include extra git details.
metadata:
  version: 1.0.0
---

# /status command

Prints a concise status line for the current project. Shows the branch name, whether the tree is dirty, and the commit distance from upstream.

With `--verbose`, also lists modified paths.
