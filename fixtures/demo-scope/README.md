---
name: acme-toolkit
description: Fictional developer-assistance scope used by the ui prototype (Step 0c). Spans every node kind defined in the spec — skills, agents, commands, hooks, notes — with realistic frontmatter and cross-references.
metadata:
  version: 0.1.0
  stability: experimental
  created: 2026-04-22
---

# acme-toolkit (demo fixture)

Fictional scope used as the build-time input for the SPA's static demo bundle (Step 14.3.b). The pipeline at `scripts/build-demo-dataset.js` runs `sm scan --json` over this directory and emits `web/demo/data.json` + `web/demo/data.meta.json`, which the `StaticDataSource` (demo-mode adapter) serves from the deployed bundle. The kernel itself is **not** swapped — `sm scan` runs as it would against any other scope.

Every file has frontmatter conforming to `spec/schemas/frontmatter/*.schema.json`. Cross-references use `@agent-name`, `#skill-id`, and `/command` tokens in bodies so the demo exercises link detection without manual editing.
