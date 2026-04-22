---
name: code-review
description: Reviews a diff against the project's house rules. Flags violations, suggests minimal fixes, and defers architecture questions to @backend-architect.
type: skill
inputs:
  - name: diffPath
    type: path
    required: true
    description: Path to a unified diff file or git ref range.
  - name: strict
    type: boolean
    required: false
    default: false
outputs:
  - name: findings
    type: array
    description: One entry per violation, each with severity, cite, and proposed patch.
metadata:
  version: 3.2.0
  stability: stable
  author: acme
  tags: [review, quality]
  created: 2025-05-18
  updated: 2026-04-05
---

# Code Review skill

Reads the diff with `Read`, groups hunks by file, applies rule packs. Escalates to @security-auditor on any auth/crypto hunk. See https://google.github.io/eng-practices/review/ for the underlying principles.
