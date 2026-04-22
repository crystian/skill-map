---
name: deploy-preflight
description: Runs the gate checks required before any /deploy — migrations present, CI green on HEAD, no pending security findings.
type: skill
inputs:
  - name: env
    type: "enum:staging|production"
    required: true
outputs:
  - name: verdict
    type: "enum:go|no-go"
  - name: reasons
    type: array
metadata:
  version: 1.2.0
  stability: stable
  author: acme
  tags: [deploy, gate, safety]
  created: 2025-11-20
  updated: 2026-03-29
  requires:
    - .claude/agents/security-auditor.md
---

# Deploy Preflight

Blocks on any open @security-auditor finding with severity ≥ high. Green path returns `go` plus a one-line rationale; red path returns `no-go` with the blocking reasons.
