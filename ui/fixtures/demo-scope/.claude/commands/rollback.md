---
name: rollback
description: Reverts the last deploy. Idempotent against the recorded deploy ledger.
type: command
args:
  - name: env
    type: "enum:staging|production"
    required: true
  - name: to
    type: string
    required: false
    description: Explicit build id. Omit to revert to the prior entry.
metadata:
  version: 1.0.3
  stability: stable
  author: acme
  tags: [deploy, rollback, safety]
  created: 2025-10-11
  related:
    - .claude/commands/deploy.md
---

# /rollback

Consumes the deploy ledger written by /deploy. Never runs a fresh build; always re-promotes an existing artifact.
