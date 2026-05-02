---
name: init-legacy
description: Legacy scaffolder for acme-toolkit scopes. Superseded by /init in toolkit v1.0.
type: command
args:
  - name: target
    type: path
    required: false
shortcut: ctrl+alt+l
metadata:
  version: 0.4.2
  stability: deprecated
  supersededBy: .claude/commands/init.md
  author: acme
  tags: [scaffold, legacy]
  created: 2024-09-15
  updated: 2025-09-30
---

# Init (legacy)

Old scaffolder. Kept around for users still on toolkit 0.x. Use /init from toolkit 1.0+ instead — it produces a `.skill-map.json` with the modern frontmatter shape and integrates with @backend-architect for tooling defaults.
