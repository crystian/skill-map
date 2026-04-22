---
name: session-greeter
description: Prints a scope-aware welcome line at session start.
type: hook
event: SessionStart
blocking: false
idempotent: true
metadata:
  version: 1.1.0
  stability: stable
  author: acme
  tags: [ux, session]
  created: 2025-09-08
---

# session-greeter

Reads the scope name from `.skill-map.json` and prints "Welcome to <scope>". Idempotent by construction — identical input always produces identical output.
