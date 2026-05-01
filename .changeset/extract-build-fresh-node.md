---
"@skill-map/cli": patch
---

Extract `buildFreshNodeAndValidateFrontmatter` from `walkAndExtract` (orchestrator). Internal-only refactor — moves the `else` branch (no cache hit: build a fresh `Node` and run frontmatter validation) into a focused helper. `walkAndExtract` complexity drops from 35 to 33. No public API change; behaviour preserved.
