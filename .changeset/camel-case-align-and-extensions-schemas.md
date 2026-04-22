---
"@skill-map/spec": minor
---

Audit-driven alignment pass. Multiple normative additions and a casing cleanup:

- **Extension schemas**: add `spec/schemas/extensions/{base,adapter,detector,rule,action,audit,renderer}.schema.json` (7 new files). `architecture.md` §Extension kinds now points to them and mandates manifest validation at load time. Unblocks the "contract tests for the 6 kinds" invariant.
- **Adapter `defaultRefreshAction`**: normatively required on every `Adapter` extension. Maps node `kind` → `actionId` and drives the UI's `🧠 prob` button. Previously mentioned only in ROADMAP (Decision #45); now part of the schema.
- **Triple protection for mode B**: `db-schema.md` now specifies the exact order — parse → DDL validation → prefix injection → scoped connection. Validation runs **before** the rewrite so kernel-table references are caught under their authored names.
- **Automatic rename heuristic**: new `db-schema.md` §Rename detection. On scan, `body_hash` match → high-confidence auto-rename with `state_*` FK migration; `frontmatter_hash` match → medium-confidence, same migration + `auto-rename-medium` issue; no match → orphan with issue. Replaces the prior "scan emits orphans, user runs `sm orphans reconcile` manually" flow.
- **Skill agent envelope**: `job-events.md` now mandates a synthetic `r-ext-<ts>-<hex>` run envelope (`run.started mode=external` → `job.claimed` → `job.callback.received` → `job.completed|failed` → `run.summary`) around jobs claimed by a Skill agent without entering `sm job run`. Keeps the WebSocket broadcaster contract ("every job event inside a run envelope") intact across both runner paths.
- **"Skill runner" → "Skill agent"**: `architecture.md` and `job-lifecycle.md` clarify that the Skill path is a peer driving adapter (alongside CLI and Server), NOT a `RunnerPort` implementation. Only `ClaudeCliRunner` and its test fake implement the port. Name was misleading; structure unchanged.
- **Casing**: `db-schema.md` `auto_migrate` → `autoMigrate`; `README.md` prose mention `spec-compat` → `specCompat`. Brings prose into sync with the camelCase rule already enforced by the schemas.
- **Coverage matrix**: new `spec/conformance/coverage.md` tracks each schema (and each non-schema normative artifact) against its conformance case. 28 schemas + 11 artifact invariants catalogued; 19 schemas and 10 artifacts flagged as missing, each with a step-blocker note. Release gate: v1.0.0 requires every row 🟢 or explicitly deferred.

Classification: minor per §Pre-1.0 (`0.Y.Z`). The new required field `defaultRefreshAction` on the Adapter kind is technically breaking — no conforming Adapter ships in the reference impl yet, so the impact is zero. Post-1.0 the same change would be major.
