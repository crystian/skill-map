# Open `Node.kind` to External Providers — Item 7 from `cli-architect` audit (2026-05)

**Status**: planned, not started.
**Decision**: open `kind` from a closed 5-value enum to an open string, end-to-end (spec → kernel → DB).
**Estimated effort**: 3-4h, split across 5 sequential commits.
**Scope**: `spec/` (normative — schema + prose), `src/kernel/` + `src/cli/` (TS), `src/migrations/` (new SQL migration).

## Background

The audit (item 7, also tagged D6 / SD1) flagged that the kernel violates its own spec:

- The spec **already accepts** that providers can declare their own kinds: per spec 0.8.0 Phase 3, "per-kind frontmatter schemas live with the Provider that emits them" (`spec/conformance/coverage.md:36`). The `IProvider` interface even comments that `kinds: Record<string, IProviderKind>` is "open by design — a future Cursor Provider could declare `rule`, an Obsidian Provider could declare `daily`" (`src/kernel/extensions/provider.ts:103-108`).
- But **5 layers still close it** to the original 5 values (`skill` / `agent` / `command` / `hook` / `note` — the Claude Provider's catalog).

A Cursor Provider that wants to emit `kind: 'cursorRule'` today has only bad options:
1. Classify as `'note'` — loses semantics, the rule shows up as a generic note in UI / queries / filters.
2. `as NodeKind` cast — lies to the type system; runtime works but filters (`kind=cursorRule`) match nothing the kernel knows about.
3. Fork the kernel — unsustainable, every Cursor / Obsidian / Roo user would need their own fork.

The kernel currently rejects external providers despite the spec permitting them.

## Inventory — the 5 layers

### Layer 1 — JSON Schema (normative, in spec)

`spec/schemas/node.schema.json:16`:
```json
"kind": {
  "type": "string",
  "enum": ["skill", "agent", "command", "hook", "note"]
}
```
This validates the persisted `Node` shape that the kernel exports / loads. AJV-rejects any external kind today.

### Layer 2 — Spec prose (normative)

`spec/db-schema.md:75` (table `scan_nodes`):
```
| `kind` | TEXT | NOT NULL, CHECK in (`skill`, `agent`, `command`, `hook`, `note`) | |
```

`spec/db-schema.md:277` (table `state_summaries`):
```
| `kind` | TEXT | NOT NULL, CHECK in kind enum |
```
(References the same enum from line 75.)

### Layer 3 — TypeScript runtime (kernel)

- `src/kernel/types.ts:56` — `export type NodeKind = 'skill' | 'agent' | 'command' | 'hook' | 'note';`
- `src/kernel/types.ts:101` — `Node.kind: NodeKind` (the domain type the orchestrator passes around).
- `src/kernel/extensions/provider.ts:134` — `classify(path, frontmatter): { kind: NodeKind; title?: string }` (the contract external providers must implement — closed).

Other call sites that reference `NodeKind` and may need adjustment (~25 sites total found via `grep -rn "NodeKind" src/kernel/ src/cli/ src/extensions/ src/test/`):
- Switch / filter sites in CLI (`list.ts` filters, `show.ts`, `export.ts`, `graph.ts`).
- Built-in claude provider `kinds` record.
- Tests with hard-coded kind expectations.

### Layer 4 — Kysely schema (TypeScript view of the DB)

`src/kernel/adapters/sqlite/schema.ts:25,57,227`:
```ts
export type TNodeKind = 'skill' | 'agent' | 'command' | 'hook' | 'note';

interface IScanNodesTable { kind: TNodeKind; ... }
interface IStateSummariesTable { kind: TNodeKind; ... }
```

`src/kernel/adapters/sqlite/scan-load.ts:156` casts the DB string to the closed type:
```ts
kind: row.kind as NodeKind,
```

### Layer 5 — SQL CHECK constraints

`src/migrations/001_initial.sql:28`:
```sql
CONSTRAINT ck_scan_nodes_kind CHECK (kind IN ('skill','agent','command','hook','note'))
```

`src/migrations/001_initial.sql:135`:
```sql
CONSTRAINT ck_state_summaries_kind CHECK (kind IN ('skill','agent','command','hook','note'))
```

Both run today in every existing DB. SQLite has no `ALTER TABLE DROP CONSTRAINT` — removing them requires the **table-recreate dance** (create new table without the CHECK, copy rows, drop old, rename new), being careful with foreign keys that point at `scan_nodes(path)` (`scan_links`, `scan_issues_nodes`, `state_enrichments`, etc.).

## Proposed approach

`kind` becomes an open `string` end-to-end. `NodeKind` survives as a **typed shorthand for the built-in Claude Provider's catalog**, used only by code that legitimately wants to switch on those 5 specific kinds (filter widgets, claude-specific UI cards). It is no longer the type of `Node.kind` itself.

### After the change

- `Node.kind: string` — accepts anything an enabled Provider emits.
- `IProvider.classify(...): { kind: string; title?: string }` — Cursor / Obsidian providers can return their own kinds without TS workarounds.
- `TNodeKind = string` (Kysely schema).
- `node.schema.json#/properties/kind` — `{ "type": "string", "minLength": 1 }` (no `enum`).
- `db-schema.md` — `kind` is `TEXT NOT NULL` (no CHECK).
- `001_initial.sql` left untouched (history); a new `002_open_node_kinds.sql` recreates `scan_nodes` and `state_summaries` without the CHECK and bumps the schema version.
- `NodeKind` stays exported as `type NodeKind = 'skill' | 'agent' | 'command' | 'hook' | 'note'`, with a docstring clarifying it is the Claude Provider's catalog (not the kernel-wide kind type). Filter widgets and the Inspector UI can still narrow on it where they want to.

## Phased execution plan

Phases run in order — each phase must be green (build + lint + tests) before the next.

| Phase | Scope | Files | Cost | Risk |
|---|---|---|---|---|
| **A — Spec changes** | Update `spec/schemas/node.schema.json` (drop enum), `spec/db-schema.md` (drop CHECK rows), `spec/CHANGELOG.md` (entry under `[Unreleased]`, classification: minor pre-1.0 per `versioning.md` § Pre-1.0). Run `npm run spec:index`. | spec only | 30min | low |
| **B — TS layer** | Open `Node.kind` and `IProvider.classify` to `string`. Add docstring on `NodeKind` clarifying its post-change meaning. Audit every `NodeKind` reference; most stay (claude-specific switches), some need to widen to `string` (everything coming from `Provider.classify` / `loadScanResult`). | `kernel/types.ts`, `kernel/extensions/provider.ts`, `kernel/adapters/sqlite/scan-load.ts`, ~20 reference sites | 1h | medium (~25 sites to audit) |
| **C — Kysely schema** | `TNodeKind = string` in `kernel/adapters/sqlite/schema.ts`. Drop the `as NodeKind` cast in `scan-load.ts`. | `adapters/sqlite/schema.ts`, `adapters/sqlite/scan-load.ts` | 15min | low |
| **D — SQL migration** | New `src/migrations/002_open_node_kinds.sql`: SQLite table-recreate dance for `scan_nodes` and `state_summaries`. Preserve every column, FK, index. Bump `db-schema` version to `3`. Add migration test. | `migrations/002_open_node_kinds.sql`, `kernel/adapters/sqlite/migrations.ts` (if version is hard-coded), `test/migrations.test.ts` (new case) | 1-1.5h | **high** (touches persistence; FK preservation is delicate) |
| **E — Cleanup + verification** | Run conformance suite (`npm run spec:check` + Provider conformance). Smoke test with a fake "external" provider that emits a non-claude kind end-to-end (scan → persist → load → filter). | tests + smoke fixtures | 30min | low |

**Total: ~3.5h across 5 commits.**

Phase D is the load-bearing one; if it goes wrong in production it corrupts persisted data. Strategy: write the migration, run on a copy of a populated DB, verify counts + FK integrity before committing. The CI suite already covers schema migrations.

## Constraints from `AGENTS.md` to respect

- **Spec first**: Phase A MUST land before B-E. The whole refactor exists to honor `versioning.md` § Pre-1.0 + the `IProvider.kinds` open-by-design comment.
- **Pre-1.0 → minor bump**: this is breaking for anyone consuming the JSON Schema or relying on `Node.kind: NodeKind` via the public kernel API, but pre-1.0 these go as minor (never major).
- **Spec changes need `spec/CHANGELOG.md` entry** under `[Unreleased]`, classified per `spec/versioning.md`.
- **`npm run spec:index` after Phase A** — CI runs `spec:check` and fails on drift.
- **Each phase needs `.changeset/*.md`**: A → minor for `@skill-map/spec`. B-D → minor for `@skill-map/cli` (kernel TS contract change + DB schema bump). E → patch.
- **Migration version bump**: `db-schema` is currently `2`. Phase D bumps to `3`; verify the version constant is updated wherever it lives (scripts/build-spec-index, tests, `sm version` output).
- **Lint invariants**: nothing in this refactor touches the kernel-isolation / no-console / no-process.* rules. Should pass without disable-inline.

## Open questions to resolve at start of next session

1. **Should `NodeKind` survive as a type alias, or be moved to `claude` namespace?** The audit suggested keeping it as "kinds the kernel hard-codes for the built-in claude provider", but a stricter reading would move it under `src/extensions/providers/claude/types.ts` (or wherever the claude provider lives, which the audit also flagged as ambiguous in D4). Suggestion: keep it at `kernel/types.ts` for now, document it clearly, revisit when D4 (rename `extensions/`) lands.

2. **What happens to existing DBs in the field?** The migration runs automatically when a v2-schema DB is opened by the new kernel. Acceptance test: take the project's own `.skill-map/skill-map.db`, run `sm version` (should report schema 3), `sm scan` (should still pass on existing rows), then plant a fixture with `kind: 'cursorRule'` and verify it persists + loads.

3. **Does the JSON Schema enum drop break existing exports?** `sm export --format json` outputs `nodes[].kind` — consumers of that JSON who validate against the old `node.schema.json` will fail to validate any export from a graph that contains an external-kind node. **This is inherent to the change, not a bug — flag it in the changeset summary so consumers know to update.**

4. **Does any built-in Rule assume the closed kind set?** The orchestrator's rule pipeline filters issues by node kind in some paths. A rule that says "this only applies to skills" still works (string equality), but a rule that does `switch (node.kind) { case 'skill': ...; case 'agent': ...; default: never }` would silently miss external kinds. Audit the rules in `src/extensions/rules/` (or wherever they live) before Phase E.

## Resuming this task

1. Re-read this file end to end.
2. Confirm the shape with the Architect (priorities may have shifted; specifically Open Question 1 is a design decision that didn't get pre-resolved).
3. **Phase A is independent and standalone** — you can land it as a single spec-only commit and pause indefinitely without breaking anything. The TS keeps closing kinds; nothing changes at runtime. This is a safe checkpoint if the session runs short.
4. Phase D is the only high-risk step. Test it on a copy of the project's own DB before committing. If you have any doubt about FK preservation, run `PRAGMA foreign_key_check;` on the migrated DB and assert empty.
5. After Phase E, write a short release note for the changeset summary mentioning external kind support is now possible. This is the kind of change consumers want to know about.
