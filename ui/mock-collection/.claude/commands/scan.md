---
name: scan
description: Walks the current scope and emits a scan-result document. Thin wrapper over `sm scan`.
type: command
args:
  - name: changed
    type: boolean
    required: false
    default: false
    description: Only scan files changed since HEAD.
shortcut: ctrl+alt+s
metadata:
  version: 0.8.2
  stability: stable
  author: acme
  priority: 6
  tags: [scan, diagnostics]
  created: 2025-12-05
  related:
    - .claude/skills/code-review/SKILL.md
---

# /scan

Delegates to the kernel's scanner. Feeds the output into #code-review when `--changed` is passed.
