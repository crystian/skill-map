---
name: deploy
description: Runs the deploy-preflight skill, asks for confirmation, then invokes the CI deploy workflow.
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
  tags: [deploy, cicd]
  created: 2025-08-22
  updated: 2026-03-18
  requires:
    - .claude/skills/deploy-preflight/SKILL.md
---

# /deploy

Runs #deploy-preflight first. Production deploys require a green preflight and an explicit confirmation prompt. Rollback path documented in /rollback.
