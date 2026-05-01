---
name: pre-commit-lint
description: Runs the project linter before every commit and blocks on lint errors.
event: PreToolUse
blocking: true
idempotent: true
metadata:
  version: 1.0.0
---

# Pre-commit lint hook

Blocks commits whose staged files fail the project linter. Skipped if no staged files are lintable.
