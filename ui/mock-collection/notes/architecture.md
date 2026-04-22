---
name: acme-toolkit-architecture
description: High-level decomposition of the acme-toolkit scope — which kinds exist and how they compose.
type: note
metadata:
  version: 0.2.0
  stability: stable
  author: acme
  tags: [architecture, design]
  created: 2026-01-14
  updated: 2026-04-12
  related:
    - notes/readme.md
    - .claude/agents/backend-architect.md
---

# Architecture

Agents hold long-lived capabilities; skills are single-purpose routines; commands are human-facing entry points; hooks are event reactions; notes are everything else. See @backend-architect for the underlying rationale. External references: https://martinfowler.com/articles/injection.html, https://en.wikipedia.org/wiki/Hexagonal_architecture_(software).
