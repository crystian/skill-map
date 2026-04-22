# Conformance suite

Language-neutral test suite the specification demands. A conforming implementation passes every case; failing any case is a conformance bug.

This directory is **stub-level** as of spec v0.1.0. Two cases ship (`basic-scan`, `kernel-empty-boot`) with a single shared fixture (`minimal-claude`). The shape below is normative; the case count expands before spec-v1.0.0 (see `versioning.md`).

---

## Layout

```
spec/conformance/
├── README.md                 ← this file
├── fixtures/
│   ├── minimal-claude/       ← controlled MD corpus (5 nodes, one per kind)
│   │   ├── skills/hello.md
│   │   ├── agents/reviewer.md
│   │   ├── commands/status.md
│   │   ├── hooks/pre-commit.md
│   │   └── notes/architecture.md
│   └── preamble-v1.txt       ← verbatim preamble text for bitwise-match checks
└── cases/
    └── basic-scan.json       ← declarative case (see "Case format" below)
```

Fixtures are read-only inputs. Cases declare what to invoke and what to assert. A conformance runner is implementation-specific code that:

1. Reads every file under `cases/`.
2. For each case: provisions a clean scope, copies the referenced fixture into it, invokes the implementation as described, compares output against the assertions.
3. Emits a pass/fail summary.

---

## Case format

Cases are validated against [`schemas/conformance-case.schema.json`](../schemas/conformance-case.schema.json). That file is the normative shape; this section is the human-readable walkthrough. Include `"$schema": "https://skill-map.dev/spec/v0/conformance-case.schema.json"` in every case file for IDE support.

A case is a JSON document with this shape:

```jsonc
{
  "id": "string — kebab-case, globally unique among cases.",
  "description": "string — one-to-three sentences, what the case verifies.",

  "fixture": "string — folder under fixtures/ used as the scope root.",

  "setup": {
    "disableAllAdapters": false,
    "disableAllDetectors": false,
    "disableAllRules": false
  },

  "invoke": {
    "verb": "scan | list | show | check | findings | graph | export | audit | job | record | ...",
    "sub": "submit | run | ...",
    "args": ["positional", "args"],
    "flags": ["--json", "--all", "..."]
  },

  "assertions": [
    { "type": "exit-code", "value": 0 },
    { "type": "json-path", "path": "$.schemaVersion", "equals": 1 },
    { "type": "file-exists", "path": ".skill-map/jobs/*.md" },
    { "type": "file-contains-verbatim", "path": ".skill-map/jobs/*.md", "fixture": "preamble-v1.txt" }
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

| Id | Verifies |
|---|---|
| `basic-scan` | Scanning `minimal-claude` detects one node per kind with no issues. |
| `kernel-empty-boot` | With every adapter/detector/rule disabled, scanning an empty scope returns a valid empty graph. |

Cases explicitly referenced elsewhere in the spec (landing before v1.0):

| Id | Source | Verifies |
|---|---|---|
| `preamble-bitwise-match` | `prompt-preamble.md` | Rendered job files contain `preamble-v1.txt` byte-for-byte. Deferred to Step 10 (requires `sm job preview`). |

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

The reference implementation's runner will ship under `src/conformance/` during Step 0b; until then, the spec treats this suite as a schema (shape contract) rather than an executable test target.

---

## Stability

- The **case format** above is stable as of the first spec release that includes the suite. Adding an assertion type is a minor bump. Removing or changing one is a major bump.
- Adding a case is a minor bump (new case required by a new conforming implementation → compat break).
- Removing or tightening a case is a major bump.
- Changing a fixture's contents is a major bump iff the fixture is referenced by any case.
