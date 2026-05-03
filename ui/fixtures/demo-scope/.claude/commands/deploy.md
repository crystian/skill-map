---
name: deploy
description: Asks for confirmation, then invokes the CI deploy workflow. Reviews are delegated to #code-review.
type: command
args:
  - name: env
    type: "enum:staging|production"
    required: true
    description: Target environment.
shortcut: ctrl+alt+d
metadata:
  version: 2.1.0
  stability: stable
  author: acme
  priority: 10
  tags: [deploy, cicd]
  created: 2025-08-22
  updated: 2026-03-18
  requires:
    - .claude/skills/code-review/SKILL.md
---

# /deploy

Runs #code-review on the staged diff first. Production deploys require a green review and an explicit confirmation prompt. Triggered after a successful build via @backend-architect's release checklist.
