---
"@skill-map/cli": patch
---

Three follow-up tests for the open-node-kinds refactor — close gaps the Phase E smoke test left implicit.

- `external-provider-kind.test.ts` gains two cases: (a) a Provider declares `cursorRule` with a strict per-kind frontmatter schema → the kernel emits `frontmatter-invalid` for any node whose frontmatter does not match, exactly as it does for the built-in claude catalog; (b) a misbehaving Provider whose `classify(...)` returns a kind absent from its `kinds` map → the kernel reports the mismatch via `frontmatter-invalid` with `data.errors === 'no-schema'` instead of crashing.
- `scan-readers.test.ts` (`sm list --kind <external>`) — pins that the verb's `WHERE kind = ?` filter accepts external-Provider kinds end-to-end. Plants a `kind: 'cursorRule'` row alongside the claude fixtures and asserts the listing surfaces only it under `--kind cursorRule`. Catches a regression where someone retypes the column to `NodeKind` and quietly drops external rows.
- `node-enrichments.test.ts` (`sm refresh` Test (f.5)) — pins that `sm refresh <external-kind-path>` exits 0 without rejecting the kind. Built-in extractors don't declare `applicableKinds: ['cursorRule']`, so the applicable set is empty and refresh persists zero det enrichments — but it MUST get there without a cast failure or filter rejection.

These tests add 0 production code and 3 cases to the suite. 617 tests pass; npm run validate exit 0.
