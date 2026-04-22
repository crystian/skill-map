---
name: pre-commit-lint
description: Runs #lint-fixer before every commit. Blocks the commit on unresolved errors.
type: hook
event: PreToolUse
condition: "tool == 'Bash' && command.startsWith('git commit')"
blocking: true
idempotent: true
metadata:
  version: 1.0.0
  stability: stable
  author: acme
  priority: 5
  tags: [git, lint, hook]
  created: 2025-10-15
  requires:
    - .claude/skills/lint-fixer/SKILL.md
---

# pre-commit-lint

Fires on PreToolUse when the pending tool call is a `git commit`. Blocks the call until #lint-fixer returns clean. Declared idempotent so the runner can dedupe retries.
