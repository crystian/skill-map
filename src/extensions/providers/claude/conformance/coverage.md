# Conformance coverage — `claude` Provider

Authoritative map of the Provider-owned schemas at
[`../schemas/`](../schemas/) to the conformance cases that exercise them.
Phase 5 / A.13 split the original spec-wide matrix in two: spec-owned
rows (kernel-agnostic, listed in [`../../../../../spec/conformance/coverage.md`](../../../../../spec/conformance/coverage.md))
and Provider-owned rows (this file). Every Provider that declares its
own `kinds` map MUST ship a coverage matrix for those kinds before
cutting v1.0 of the Provider; missing case → release blocked.

This file is hand-maintained. CI runs the cases via
`sm conformance run --scope provider:claude`; a separate inventory
check before each Provider release compares the schema set under
`schemas/` against the matrix below and fails on drift.

## Coverage matrix

| # | Schema | Case(s) | Status | Notes |
|---|---|---|---|---|
| 1 | `schemas/skill.schema.json` | `basic-scan`, `rename-high`, `orphan-detection` | 🟢 covered | Exercised end-to-end via the `minimal-claude` and `rename-high-*` / `orphan-*` fixtures. `basic-scan` validates a minimal skill file; `rename-high` covers high-confidence rename detection over a single-skill body; `orphan-detection` covers the deletion branch. |
| 2 | `schemas/agent.schema.json` | `basic-scan` | 🟢 covered | `minimal-claude/agents/reviewer.md` carries the required `model` field. |
| 3 | `schemas/command.schema.json` | `basic-scan` | 🟢 covered | `minimal-claude/commands/status.md` carries minimal required fields. |
| 4 | `schemas/hook.schema.json` | `basic-scan` | 🟢 covered | `minimal-claude/hooks/pre-commit.md` exercises the kind. |
| 5 | `schemas/note.schema.json` | `basic-scan` | 🟢 covered | `minimal-claude/notes/architecture.md` exercises the no-extras kind. |

Status legend: 🟢 covered (at least one case asserts the schema
end-to-end) · 🟡 partial (covered only indirectly or via a sub-shape) ·
🔴 missing.

## Cases shipped with this Provider

| Id | Verifies | Fixture(s) |
|---|---|---|
| `basic-scan` | Scanning the `minimal-claude` corpus detects exactly five nodes (one per kind) with no issues. Implicitly validates each per-kind schema via the kernel's frontmatter-validation flow. | `minimal-claude` |
| `rename-high` | Moving a single `skill` file with identical body across the rename triggers a high-confidence auto-rename: NO issue is emitted, the new path is the only node in the result, and the rename heuristic operates silently. | `rename-high-before` (prior scan) + `rename-high-after` |
| `orphan-detection` | Deleting a `skill` file with no replacement triggers the orphan branch of the rename heuristic: exactly one issue with ruleId `orphan` is emitted, severity `info`. | `orphan-before` (prior scan) + `orphan-after` |

Each case file under [`cases/`](./cases/) is self-describing — see
[`spec/conformance/README.md`](../../../../../spec/conformance/README.md)
for the case format and assertion catalog.

## Release gates

- **Provider v0.x**: partial coverage acceptable. Every case added as
  the Provider lands the kind that makes it runnable.
- **Provider v1.0.0 release**: all rows above MUST be 🟢 covered or
  explicitly 🟠 deferred to a future minor with a linked issue.
- **CI check**: `sm conformance run --scope provider:claude` on every
  PR. A schema without a row here, or a row pointing at a missing
  schema, fails the release gate.
