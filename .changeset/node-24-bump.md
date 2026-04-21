---
"skill-map": minor
---

Bump minimum Node version to **24+** (active LTS since October 2025).

- `engines.node: ">=24.0"` in the reference-impl package.json (root + `src/`).
- `@types/node` bumped to `^24.0.0`.
- ROADMAP Decision #1, Stack conventions, and AGENTS.md aligned.

Rationale: Node 22.5 gave us stable `node:sqlite` but 24 is now the active LTS (Node 22 enters maintenance Oct 2026). The jump buys built-in WebSocket (unblocks Step 12 without a `ws` dependency), the modern ESM loader API, and several runtime improvements Kysely / Clipanion already rely on. No known dependency blocks the bump. Users still on Node 20 are already outside LTS and are not supported.
