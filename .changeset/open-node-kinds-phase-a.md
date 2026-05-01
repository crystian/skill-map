---
"@skill-map/spec": minor
---

Open `Node.kind` to any Provider-declared string (Phase A — spec only).

The kernel always documented `IProvider.kinds` as "open by design" so future Cursor / Obsidian / Roo Providers can declare their own kinds. The spec, however, had three layers underneath that closed it back to the original five-value Claude Provider catalog (`skill` / `agent` / `command` / `hook` / `note`):

- `node.schema.json#/properties/kind` carried `enum: [<5 values>]` — AJV-rejected anything else.
- `db-schema.md` § `scan_nodes` and § `state_summaries` mandated `CHECK in (<5 values>)` SQL constraints.
- `extensions/action.schema.json#/.../filter/kind` had the same closed list for the per-action applicability filter.

This phase opens the spec end:

- `node.schema.json#/properties/kind` → `{ "type": "string", "minLength": 1 }` with a description naming the built-in Claude catalog so consumers know the default contract.
- `db-schema.md` drops both `CHECK in (...)` constraint rows. Both columns stay `TEXT NOT NULL`.
- `extensions/action.schema.json#/.../filter/kind` widens to `{ items: { "type": "string", "minLength": 1 } }`.

The TS side (`Node.kind: string`, `IProvider.classify(...): { kind: string; ... }`, Kysely `TNodeKind = string`) and the SQL `002_open_node_kinds` migration that drops the live CHECK constraints land in follow-up phases under `@skill-map/cli`. Phase A is a safe checkpoint: shipping the spec change alone changes nothing at runtime (the kernel still emits closed kinds, the live DB still enforces the existing CHECK), but it unblocks the rest of the refactor and aligns the source-of-truth artifact with the design intent.

Migration for consumers:

- Anyone validating an exported `Node` JSON against `node.schema.json` now accepts external-Provider kinds.
- Any UI / dashboard / script that hard-coded the closed enum elsewhere (filter chips, assertion sets) needs to widen to `string` and accept whatever an enabled Provider declares.

Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0 (this is breaking for consumers that relied on the enum, but pre-1.0 breakings ship as minor).
