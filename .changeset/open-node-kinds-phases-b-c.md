---
"@skill-map/cli": minor
---

Open `Node.kind` and `IProvider.classify` to `string` end-to-end on the TS side (Phases B + C).

Phase A (spec) shipped the contract; this lands the TypeScript runtime to match. Three layers move:

- **`Node.kind: string`** (was `NodeKind`). The orchestrator, persistence layer, and every renderer accept whatever an enabled Provider classifies into — built-in Claude catalog kinds (`skill` / `agent` / `command` / `hook` / `note`) plus anything an external Provider declares.
- **`IProvider.classify(...) → string`** (was `→ NodeKind`). Cursor / Obsidian / Roo Providers can return their own kinds without the `as NodeKind` cast that previously lied to the type system.
- **`TNodeKind = string`** in `kernel/adapters/sqlite/schema.ts` (was the closed five-value union). The `as NodeKind` cast in `rowToNode` (`scan-load.ts`) is gone.

`NodeKind` survives as an exported type alias for the **built-in Claude Provider catalog only**, with a docstring clarifying it is no longer the kernel-wide kind type. Code that intentionally narrows on the five claude kinds (the `validate-all` rule's per-kind frontmatter schema map, the `KIND_ORDER` rendering arrays, claude-aware UI cards) keeps using it. Code that handles arbitrary kinds widens to `string`.

Side effects:

- **`sm export`'s query parser drops the closed-enum check** for `kind=...` clauses. `kind=widget` is now structurally valid (open-by-design); it matches zero nodes if no Provider classifies into `widget`. Empty values (`kind=`) still error. Matches `node.schema.json#/properties/kind`.
- **`ascii` formatter and `sm export`'s markdown renderer**: nodes are bucketed by an open string. Built-in Claude catalog renders first in canonical order; external-Provider kinds append after, alphabetically sorted, so output stays deterministic across runs.
- **`built-in-plugins/rules/trigger-collision`**: `ADVERTISING_KINDS` is now `ReadonlySet<string>` (still containing the same three claude kinds); the rule applies if `node.kind` is in the set, and external Providers can extend the set in a future release without touching the rule.

Tests: `extractor-applicable-kinds.test`, `self-scan.test`, and `export-cli.test` updated where they pinned `NodeKind`-typed accumulators. The "rejects unknown kind value" parser test became "accepts arbitrary kind tokens" (the parser no longer enforces a closed enum); the "invalid query → exit 2" verb test was rewritten to use `confidence=high` (an actually-unknown key) instead of `kind=widget`.

What's still pending:

- **Phase D** — the SQL `CHECK in (<5 values>)` constraints on `scan_nodes.kind` and `state_summaries.kind` are still live in `001_initial.sql`. They run on every existing DB. Pre-1.0 the right move is a fold of the change directly into `001_initial.sql` (no separate migration), mirroring how `002_scan_meta` was folded back; that lands in a follow-up commit.
- **Phase E** — smoke test with a fake external Provider end-to-end, conformance suite re-run.

Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0 (technically breaking for code that imported `NodeKind` and assumed it was the kernel-wide kind type, but pre-1.0 these go as minor).
