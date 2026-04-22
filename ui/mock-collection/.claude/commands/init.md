---
name: init
description: Scaffolds a new acme-toolkit scope in the current directory. Creates .claude/ structure and a starter .skill-map.json.
type: command
args:
  - name: target
    type: path
    required: false
    description: Destination directory. Defaults to CWD.
  - name: preset
    type: "enum:minimal|full"
    required: false
    default: minimal
shortcut: ctrl+alt+i
metadata:
  version: 1.0.0
  stability: stable
  author: acme
  tags: [scaffold, onboarding]
  created: 2025-10-01
---

# /init

Scaffolds the scope. For reference architecture, consult @backend-architect first. Safe to re-run — idempotent.
