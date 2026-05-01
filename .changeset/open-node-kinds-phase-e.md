---
"@skill-map/cli": patch
---

Phase E of the open-node-kinds refactor — end-to-end smoke verification baked into the test suite.

Adds `test/external-provider-kind.test.ts`: a fake "Cursor" Provider classifies `.cursor/rules/*.md` into `kind: 'cursorRule'` (a string the built-in Claude Provider does NOT know), and the test runs the full pipeline:

1. `runScanWithRenames` — orchestrator persists the open kind through `IProvider.classify(...) → string`.
2. `persistScanResult` — SQLite adapter writes the row; the dropped `ck_scan_nodes_kind` CHECK no longer rejects.
3. `loadScanResult` — `rowToNode` returns the open string (no `as NodeKind` cast).
4. `applyExportQuery({ kinds: ['cursorRule'] })` — the export query parser accepts the arbitrary kind and filters the snapshot down to the two seeded rows.

If any layer regresses to the closed-enum behaviour (a stray cast, a forgotten CHECK, a renamed column missed by the migration), the test fails before the regression reaches a release.

Audit findings:

- `validate-all` rule's `FRONTMATTER_BY_KIND: Record<NodeKind, …>` map is decorative today (suppressed via `void` to keep the wire ready for when the schema-validators loader exposes per-kind frontmatter validators). It does NOT close the kind set at runtime — the rule validates every node against the `node` schema (which is open post-Phase A). External-Provider kinds pass through unaffected.
- No built-in rule does `switch (node.kind) { case 'skill': ...; default: never }`. The trigger-collision rule's `ADVERTISING_KINDS` is a `Set<string>` that simply doesn't fire for kinds outside it — exactly the right behaviour.

What's done across the whole refactor (Phases A → E):

- Spec (`@skill-map/spec`, minor): JSON Schema + db-schema.md prose + action.schema.json all carry an open string for `kind`.
- TS (`@skill-map/cli`, minor): `Node.kind: string`, `IProvider.classify(...): string`, `TNodeKind = string`. `NodeKind` survives as the Claude Provider catalog alias with a clarifying docstring.
- SQL (`@skill-map/cli`, minor): the closed-kind `CHECK in (...)` constraints are removed from `001_initial.sql` directly (pre-1.0 fold; mirrors how `002_scan_meta` was folded back). Fresh DBs apply the open `kind` column from the first migration; no separate `003_open_node_kinds.sql` is needed.
- Tests: 613 pass; the new `external-provider-kind.test.ts` is the cross-layer guard.
