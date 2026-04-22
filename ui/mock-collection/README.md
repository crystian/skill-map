---
name: acme-toolkit
description: Fictional developer-assistance scope used by the ui prototype (Step 0c). Spans every node kind defined in the spec — skills, agents, commands, hooks, notes — with realistic frontmatter and cross-references.
metadata:
  version: 0.1.0
  stability: experimental
  created: 2026-04-22
---

# acme-toolkit (mock)

This directory is consumed by the `ui/` prototype at runtime via `fetch('/mock-collection/…')`. It is **not** a real scan input for the kernel — the kernel reads on-disk scopes through its own storage and loader paths. The prototype mocks those paths in-memory.

Every file has frontmatter conforming to `spec/schemas/frontmatter/*.schema.json`. Cross-references use `@agent-name`, `#skill-id`, and `/command` tokens in bodies so later iterations can exercise link detection without changing the fixture.
