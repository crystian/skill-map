# Conformance coverage

Authoritative map of JSON Schemas in [`../schemas/`](../schemas/) to the conformance cases that exercise them. Every schema MUST have at least one case before spec v1.0.0 ships — missing case → missing release ([`../../AGENTS.md`](../../AGENTS.md) §Rules for AI agents editing spec/).

This file is hand-maintained. A CI check before spec release compares the schema inventory against this table and fails if any schema lacks a case.

## Coverage matrix

| # | Schema | Case(s) | Status | Notes |
|---|---|---|---|---|
| 1 | `node.schema.json` | `basic-scan` | 🟢 covered | Exercised via ScanResult containment. |
| 2 | `link.schema.json` | — | 🔴 missing | Needs fixture with at least one `invokes` + `references` + `mentions` link, both `high`/`medium`/`low` confidence. |
| 3 | `issue.schema.json` | — | 🔴 missing | Needs fixture triggering `trigger-collision` + `broken-ref` + `superseded`. |
| 4 | `scan-result.schema.json` | `basic-scan`, `kernel-empty-boot` | 🟢 covered | Zero-filled (empty-boot) + populated (minimal-claude) both asserted. |
| 5 | `execution-record.schema.json` | — | 🔴 missing | Blocked by Step 5 (history). Needs a case that runs a `deterministic` action and inspects `state_executions` via `sm history --json`. |
| 6 | `project-config.schema.json` | — | 🔴 missing | Case: init a scope, write a partial `.skill-map/settings.json` (optionally with a `.skill-map/settings.local.json` overlay), assert effective config after the layered merge. |
| 7 | `plugins-registry.schema.json` | — | 🔴 missing | Two sub-cases required: (a) `PluginManifest` validation via `sm plugins show --json`; (b) aggregate `PluginsRegistry` via `sm plugins list --json`. |
| 8 | `job.schema.json` | — | 🔴 missing | Blocked by Step 10 (job system). Needs a case that submits a local action (no LLM), inspects `sm job show --json`. |
| 9 | `report-base.schema.json` | — | 🔴 missing | Indirect coverage once any summarizer case lands. Direct contract case: validate a handcrafted minimal report ({confidence, safety}) against the base schema. |
| 10 | `conformance-case.schema.json` | — | 🔴 missing | Self-referential: every `*.json` under `cases/` MUST validate against this schema. Add a meta-case that enumerates + validates all cases. |
| 11 | `frontmatter/base.schema.json` | `basic-scan` (indirect) | 🟡 partial | Covered via every kind schema's `allOf`. Direct case: fixture with min-required frontmatter only. |
| 12 | `frontmatter/skill.schema.json` | `basic-scan` | 🟢 covered | One skill in `minimal-claude`. |
| 13 | `frontmatter/agent.schema.json` | `basic-scan` | 🟢 covered | One agent in `minimal-claude`. |
| 14 | `frontmatter/command.schema.json` | `basic-scan` | 🟢 covered | One command in `minimal-claude`. |
| 15 | `frontmatter/hook.schema.json` | `basic-scan` | 🟢 covered | One hook in `minimal-claude`. |
| 16 | `frontmatter/note.schema.json` | `basic-scan` | 🟢 covered | One note in `minimal-claude`. |
| 17 | `summaries/skill.schema.json` | — | 🔴 missing | Blocked by Step 10 (`skill-summarizer`). Case: submit summarizer, validate report. |
| 18 | `summaries/agent.schema.json` | — | 🔴 missing | Blocked by Step 11. |
| 19 | `summaries/command.schema.json` | — | 🔴 missing | Blocked by Step 11. |
| 20 | `summaries/hook.schema.json` | — | 🔴 missing | Blocked by Step 11. |
| 21 | `summaries/note.schema.json` | — | 🔴 missing | Blocked by Step 11. |
| 22 | `extensions/base.schema.json` | — | 🔴 missing | Meta-case: every manifest under `src/extensions/` validates against the appropriate kind schema (which extends base via `allOf`). |
| 23 | `extensions/provider.schema.json` | — | 🔴 missing | Case: the `claude` Provider manifest validates; a crafted invalid manifest (missing `defaultRefreshAction` or `explorationDir`) fails with `invalid-manifest`. |
| 24 | `extensions/extractor.schema.json` | — | 🔴 missing | Case: `frontmatter` + `slash` + `at-directive` extractor manifests validate; an extractor emitting a disallowed `emitsLinkKinds` value fails. |
| 25 | `extensions/rule.schema.json` | — | 🔴 missing | Case: `trigger-collision`, `broken-ref`, `superseded` manifests validate. |
| 26 | `extensions/action.schema.json` | — | 🔴 missing | Case: a `deterministic` action manifest validates; a `probabilistic` action WITHOUT `promptTemplateRef` fails. |
| 27 | `extensions/formatter.schema.json` | — | 🔴 missing | Case: `ascii` formatter manifest validates. |
| 28 | `history-stats.schema.json` | — | 🔴 missing | Blocked by Step 5 (history). Case: seed `state_executions` with a deterministic fixture, run `sm history stats --json --since <T0> --until <T1> --period month --top 5`, assert the document validates and that `totals.executionsCount == sum(perAction.executionsCount)` and `errorRates.global == totals.failedCount / totals.executionsCount`. Percentiles (`p95`/`p99`) intentionally omitted in v1 — add later as a minor bump without breaking consumers. |

Status legend: 🟢 covered (at least one case asserts the schema end-to-end) · 🟡 partial (covered only indirectly or via a sub-shape) · 🔴 missing.

## Non-schema normative artifacts

These have their own conformance cases even though they are not JSON Schemas.

| # | Artifact | Case | Status | Notes |
|---|---|---|---|---|
| A | Preamble verbatim text | `preamble-bitwise-match` | 🟠 deferred | Deferred to Step 10 (needs `sm job preview` to render a job file). Fixture: `fixtures/preamble-v1.txt` (already present, byte-identical to `prompt-preamble.md` source). |
| B | Kernel empty-boot invariant | `kernel-empty-boot` | 🟢 covered | All extensions disabled → empty ScanResult. |
| C | Atomic-claim race safety | — | 🔴 missing | Blocked by Step 10. Two concurrent `sm job claim` invocations against a single queued row — exactly one MUST succeed. |
| D | Duplicate detection | — | 🔴 missing | Blocked by Step 10. Two `sm job submit` with same `(action, version, node, contentHash)` — second exits 3. |
| E | `--force` bypass | — | 🔴 missing | Blocked by Step 10. |
| F | Nonce mismatch | — | 🔴 missing | Blocked by Step 10. `sm record` with wrong nonce → exit 4. |
| G | Reap | — | 🔴 missing | Blocked by Step 10. Set TTL to 1s; claim; wait; next `sm job run` reaps with reason `abandoned`. |
| H | `run.*` event envelope for Skill agent | — | 🔴 missing | Blocked by Step 10. Skill-agent flow emits synthetic `r-ext-*` run envelope around one job. |
| I | Rename heuristic | `rename-high`, `orphan-detection` | 🟢 covered | High-confidence rename emits no issue and the new path is the sole node. Orphan branch emits exactly one `orphan` issue (severity `info`) when a deleted node has no replacement. Medium / ambiguous branches are exercised by `src/test/rename-heuristic.test.ts` until the conformance schema grows richer assertions. |
| J | Plugin DDL rejection | — | 🔴 missing | Blocked by Step 9. Plugin migration referencing `state_jobs` → disabled with `invalid-manifest`. |
| K | Plugin prefix injection | — | 🔴 missing | Blocked by Step 9. Plugin declares `CREATE TABLE foo` → kernel applies as `plugin_<id>_foo`. |
| L | Elapsed-time reporting | — | 🔴 missing | Blocked by Step 4 (first real verb work). Run any in-scope verb; stderr last line MUST match `/^done in (\d+ms\|\d+\.\d+s\|\d+m \d+s)$/`. In-scope verb with `--json` returning an object MUST carry `elapsedMs`. Exempt verb (`sm version`) MUST NOT emit the line. |

## Release gates

- **spec v0.x**: partial coverage acceptable. Every case added as the reference impl lands the verb that makes it runnable.
- **spec v1.0.0 release**: all rows above MUST be 🟢 covered or explicitly 🟠 deferred to v1.1 with a linked issue.
- **CI check**: [`scripts/check-coverage.mjs`](../../scripts/check-coverage.mjs) compares `spec/schemas/**/*.schema.json` against the matrix above on every PR. A schema without a row here, or a row pointing at a missing schema, fails CI (exit 1 with a `::error::` annotation). Wired into `ci.yml` §validate and into `npm run spec:check`.
