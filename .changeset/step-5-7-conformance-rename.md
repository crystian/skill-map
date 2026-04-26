---
"@skill-map/spec": minor
"@skill-map/cli": patch
---

Step 5.7 — Conformance coverage for the rename heuristic.

**Spec change (additive, minor)**:

- `spec/schemas/conformance-case.schema.json` gains
  `setup.priorScans: Array<{ fixture, flags? }>` — an ordered list of
  staging scans the runner executes BEFORE the main `invoke`. Each
  step replaces every non-`.skill-map/` directory in the scope with
  the named fixture and runs `sm scan` (with optional flags). The DB
  persists across steps because `.skill-map/` is preserved between
  swaps. After the last step, the runner copies the top-level
  `fixture` and runs the case's `invoke`.

  Required to express scenarios that need a prior snapshot (rename
  heuristic, future incremental cases). The schema is purely
  additive — every existing case keeps passing without modification.

- Two new conformance cases under `spec/conformance/cases/`:
  - **`rename-high`** — moving a single file with identical body
    triggers a high-confidence auto-rename. Asserts:
    `stats.nodesCount === 1`, `stats.issuesCount === 0`,
    `nodes[0].path === skills/bar.md`. Verifies the spec invariant
    that high-confidence renames emit NO issue.
  - **`orphan-detection`** — deleting a file with no replacement
    emits exactly one `orphan` issue (severity `info`). Asserts the
    `ruleId` and `severity` directly.

- Four new fixture directories under `spec/conformance/fixtures/`:
  `rename-high-before/`, `rename-high-after/`,
  `orphan-before/`, `orphan-after/`.

- `spec/conformance/coverage.md`: row I (Rename heuristic) flips
  from `🔴 missing` to `🟢 covered`. Notes the medium / ambiguous
  branches stay covered by `src/test/rename-heuristic.test.ts` for
  now (assertion vocabulary in the schema is not rich enough to
  express "the issues array contains an item with ruleId X and
  data.confidence === 'medium'" — when the conformance schema gains
  array-filter assertions, those branches can land here too).

**Runtime change**:

- `src/conformance/index.ts` runner: implements `setup.priorScans`.
  Helper `replaceFixture(scope, specRoot, fixture)` clears every
  top-level entry in the scope except `.skill-map/`, then copies the
  named fixture on top. Used by both staging steps and the main
  `fixture` phase.
- `src/test/conformance.test.ts`: includes the two new cases in the
  Step-0b subset. Total conformance cases passing in CI: 1 → 3.

**`spec/index.json`** regenerated (50 → 57 files). `npm run spec:check`
green.

Test count: 201 → 203 (+2 conformance cases). The Step 5 totals close
at: 151 → 203 (+52 across 7 sub-steps).
