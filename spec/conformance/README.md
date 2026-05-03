# Conformance suite

Language-neutral test suite the specification demands. A conforming implementation passes every case; failing any case is a conformance bug.

The suite splits across two ownership boundaries:

- **Spec-owned cases** — kernel-agnostic. They live in this directory and ship with `@skill-map/spec`. Today: `kernel-empty-boot` (boot invariant) and the `preamble-bitwise-match` deferred case. The universal preamble fixture (`preamble-v1.txt`) lives here too.
- **Provider-owned cases** — exercise a Provider's own `kinds` catalog. They live next to the Provider's manifest, under `<plugin-dir>/conformance/`. The reference impl ships one such suite at [`src/extensions/providers/claude/conformance/`](../../src/extensions/providers/claude/conformance/) covering Claude's five kinds (`skill` / `agent` / `command` / `hook` / `note`) via cases `basic-scan`, `rename-high`, `orphan-detection`.

The shape below is normative; the case count in either bucket expands before spec-v1.0.0 (see [`../versioning.md`](../versioning.md)). See [`coverage.md`](./coverage.md) for the spec-owned matrix and the Provider's own coverage file (e.g. `src/extensions/providers/claude/conformance/coverage.md`) for the matching Provider-owned matrix.

The reference CLI exposes both buckets via `sm conformance run`:

```
sm conformance run --scope spec               # spec-owned cases only
sm conformance run --scope provider:claude    # the Claude Provider's cases
sm conformance run --scope all                # both (default)
```

External consumers (alt-impl authors, Provider authors validating their own work) can drive the suite without bespoke scripting — the verb provisions the same isolated tmp scope per case as the in-process reference runner does.

---

## Layout

```
spec/conformance/
├── README.md                 ← this file
├── fixtures/
│   └── preamble-v1.txt       ← verbatim preamble text for bitwise-match checks
└── cases/
    └── kernel-empty-boot.json ← declarative case (see "Case format" below)
```

```
src/extensions/providers/<id>/conformance/   ← Provider-owned, mirrors the layout
├── coverage.md
├── cases/
│   └── *.json
└── fixtures/
    └── ...
```

Fixtures are read-only inputs. Cases declare what to invoke and what to assert. A conformance runner is implementation-specific code that:

1. Reads every file under `cases/`.
2. For each case: provisions a clean scope, copies the referenced fixture into it, invokes the implementation as described, compares output against the assertions.
3. Emits a pass/fail summary.

---

## Case format

Cases are validated against [`conformance-case.schema.json`](../schemas/conformance-case.schema.json). That file is the normative shape; this section is the human-readable walkthrough. Include `"$schema": "https://skill-map.dev/spec/v0/conformance-case.schema.json"` in every case file for IDE support.

A case is a JSON document with this shape:

```jsonc
{
  "id": "string — kebab-case, globally unique among cases.",
  "description": "string — one-to-three sentences, what the case verifies.",

  "fixture": "string — folder under fixtures/ used as the scope root.",

  "setup": {
    "disableAllProviders": false,
    "disableAllExtractors": false,
    "disableAllRules": false
  },

  "invoke": {
    "verb": "scan | list | show | check | findings | graph | export | job | record | ...",
    "sub": "submit | run | ...",
    "args": ["positional", "args"],
    "flags": ["--json", "--all", "..."]
  },

  "assertions": [
    { "type": "exit-code", "value": 0 },
    { "type": "json-path", "path": "$.schemaVersion", "equals": 1 },
    { "type": "stdout-contains-verbatim", "fixture": "preamble-v1.txt" }
  ]
}
```

### Field reference

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Stable identifier. Used in reports. MUST match the filename: `cases/<id>.json`. |
| `description` | yes | Human-readable, short. |
| `fixture` | sometimes | Folder name under `fixtures/`. Omit for cases that do not need a corpus (e.g. empty-boot). |
| `setup` | no | Pre-invocation flags. All boolean toggles default to `false`. |
| `invoke.verb` | yes | First-level CLI verb. |
| `invoke.sub` | no | Subcommand for verbs that have them (e.g. `job submit`). |
| `invoke.args` | no | Positional arguments. |
| `invoke.flags` | no | Flags. Order-significant iff the CLI defines it (the reference impl accepts them in any order). |
| `assertions` | yes | Array, ≥ 1 item. Ordering matters for reporting only. |

### Assertion types (stub-level — expansion before v1.0)

| `type` | Fields | Meaning |
|---|---|---|
| `exit-code` | `value: integer` | Exit code of the invocation MUST equal `value`. |
| `json-path` | `path: string`, one of `equals` / `greaterThan` / `lessThan` / `matches` | JSONPath (RFC 9535 subset) evaluated against stdout (parsed as JSON); the extracted value MUST satisfy the comparator. `matches` uses ECMAScript regex. |
| `file-exists` | `path: string` | Path (glob permitted) MUST exist after invocation, relative to the scope root. |
| `file-contains-verbatim` | `path: string`, `fixture: string` | File at `path` (glob permitted; resolves to exactly one) MUST contain the bytes of `fixtures/<fixture>` verbatim. Used for preamble checks. |
| `file-matches-schema` | `path: string`, `schema: string` | File at `path` (glob permitted; resolves to exactly one) MUST be valid JSON and MUST validate against `schemas/<schema>`. |
| `stderr-matches` | `pattern: string` | stderr MUST match the regex (ECMAScript). |

Assertion types beyond this list MAY be proposed via spec-vX.Y.Z minor bumps. Implementations MUST reject unknown assertion types loudly — silently skipping a check is a conformance violation in itself.

---

## Current case inventory

### Spec-owned (this directory)

| Id | Verifies |
|---|---|
| `kernel-empty-boot` | With every Provider/Extractor/Rule disabled, scanning an empty scope returns a valid empty graph. |

Cases explicitly referenced elsewhere in the spec (landing before v1.0):

| Id | Source | Verifies |
|---|---|---|
| `preamble-bitwise-match` | `prompt-preamble.md` | Rendered job content (printed by `sm job preview`) contains `preamble-v1.txt` byte-for-byte. Deferred to Step 10 (requires `sm job preview`). |

### Provider-owned (per `<plugin-dir>/conformance/`)

| Provider | Id | Verifies |
|---|---|---|
| `claude` | `basic-scan` | Scanning the `minimal-claude` corpus detects exactly five nodes (one per kind) with no issues. Implicitly validates each per-kind schema. |
| `claude` | `rename-high` | High-confidence rename emits no issue; the new path is the sole node. |
| `claude` | `orphan-detection` | Deletion with no replacement triggers exactly one `orphan` issue (severity `info`). |

---

## Runner (reference pseudocode)

Implementations are free to write their runner in any language. A minimal Node ESM version looks like:

```js
import { readdir, readFile, cp, rm, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

for (const caseFile of await readdir('spec/conformance/cases')) {
  const c = JSON.parse(await readFile(`spec/conformance/cases/${caseFile}`, 'utf8'));
  const scope = await provisionTmpScope(c.fixture);
  const result = spawnSync('sm', [c.invoke.verb, ...(c.invoke.flags ?? [])], { cwd: scope });
  const passed = c.assertions.every((a) => evaluate(a, result, scope));
  report(c.id, passed);
  await rm(scope, { recursive: true });
}
```

A Provider-owned runner mirrors the loop with a different cases / fixtures root — `<plugin-dir>/conformance/cases/` and `<plugin-dir>/conformance/fixtures/`. The reference CLI ships both as `sm conformance run`; the verb resolves the spec scope via `@skill-map/spec` and discovers Provider scopes by walking each built-in plugin's `conformance/` directory.

The reference implementation's runner ships under `src/conformance/index.ts`; the verb lives at `src/cli/commands/conformance.ts` and uses the runner one case at a time.

---

## See also

- [`coverage.md`](./coverage.md) — schema-to-case coverage matrix and release gates.
- [`../versioning.md`](../versioning.md) — what constitutes a major/minor/patch change to the suite.
- [`../architecture.md`](../architecture.md) — kernel empty-boot invariant exercised by `kernel-empty-boot`.
- [`../prompt-preamble.md`](../prompt-preamble.md) — verbatim text checked by `preamble-bitwise-match` (deferred).

---

## Stability

- The **case format** above is stable as of the first spec release that includes the suite. Adding an assertion type is a minor bump. Removing or changing one is a major bump.
- Adding a case is a minor bump (new case required by a new conforming implementation → compat break).
- Removing or tightening a case is a major bump.
- Changing a fixture's contents is a major bump iff the fixture is referenced by any case.
