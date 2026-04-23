# Spec versioning

The skill-map **spec** and the skill-map **reference CLI** evolve on independent semver tracks. A spec version and a CLI version are related through a `specCompat` range declared by each implementation and each plugin.

## Two tracks

| Track | Example tag | Semver meaning |
|---|---|---|
| Spec | `spec-v1.2.0` | Schemas + contracts in `spec/`. Consumed by any implementation. |
| Reference CLI | `cli-v0.8.3` | The `sm` binary and its built-in extensions in `src/`. |

A given CLI release declares the spec range it implements (e.g. `"specCompat": "^1.0.0"`). A plugin declares the spec range it targets. At load time the implementation runs `semver.satisfies(specVersion, plugin.specCompat)`; mismatch → plugin disabled with reason `incompatible-spec`.

## Semver for the spec

Patch, minor, major have precise meaning for a specification — different from code.

| Bump | Allowed changes | Examples |
|---|---|---|
| **Patch** (`1.0.0 → 1.0.1`) | Editorial only. No normative change. | Typo fixes, clarified wording, examples added, non-binding notes. |
| **Minor** (`1.0.0 → 1.1.0`) | Backward-compatible additions. Existing conforming implementations remain conforming. | New optional field, new optional schema, new optional CLI flag, new extension kind capability that is opt-in, new conformance case that tests a new optional feature. |
| **Major** (`1.0.0 → 2.0.0`) | Any change that can break a conforming implementation. | Remove a field, rename a field, change a field's type, tighten an enum, make an optional field required, change an exit code's meaning, change an event's payload shape, change a verb's default behavior. |

Rule of thumb: if a strict v1 implementation could fail a v1.X conformance run, the change is major.

## What counts as normative

All of the following are normative and governed by this policy:

- Every JSON Schema in `schemas/` (fields, types, required, enums, defaults, `additionalProperties`).
- Every MUST / SHOULD / MAY statement in prose documents ([`architecture.md`](./architecture.md), [`cli-contract.md`](./cli-contract.md), [`job-events.md`](./job-events.md), [`prompt-preamble.md`](./prompt-preamble.md), [`db-schema.md`](./db-schema.md), [`plugin-kv-api.md`](./plugin-kv-api.md), [`job-lifecycle.md`](./job-lifecycle.md)).
- Exit codes, verb names, required flags, canonical error messages marked "normative".
- Conformance fixtures and cases — removing or tightening a case is major.

The following are **non-normative** and can change at any time without a version bump:

- Editorial prose, examples, diagrams.
- README layout, cross-link structure.
- Filenames inside `../src/` (reference impl) — never referenced from spec normatively.
- Internal commentary inside `../ROADMAP.md` and `../CLAUDE.md`.

## Stability tags

Fields and features inside the spec carry a stability tag. Tag drives what the version policy allows.

| Tag | Meaning | Policy |
|---|---|---|
| `experimental` | Under design. May change without warning. | Minor and major bumps can change or remove. Plugins using an experimental field must tolerate breakage. |
| `stable` | Default. Governed by the semver rules above. | Changes follow the table at the top of this doc. |
| `deprecated` | Being removed in a future major. | Stays functional until the next major. `deprecated` notice must include the target removal version and a migration hint. |

Tags live inline in schema `description` fields and in prose via a leading `**Stability: experimental**` line.

## Deprecation window

- `stable` → `deprecated` requires a minor bump.
- `deprecated` → removed requires a major bump.
- Between the two, at least three minor releases must ship with the field marked `deprecated`. This gives plugin authors a release window to migrate.
- Rationale for the deprecation and the replacement field/flag must live in `CHANGELOG.md`.

## Pre-1.0

While the spec is `0.Y.Z`:

- Minor bumps may contain breaking changes (documented as such in `CHANGELOG.md`).
- Conformance is advisory — failing a conformance case is a bug report, not a spec violation.
- `specCompat` in plugins should pin a minor range (`"^0.3.0"` means `>=0.3.0 <0.4.0`), not a major range.

The first stable commitment is `spec-v1.0.0`. In the current reference roadmap, that tag ships with `cli-v1.0.0`.

## Independence in practice

- **Spec `1.0.0` + CLI `0.1.0`** — spec is stabilized before the CLI ships its v1. Normal case during early life of the project.
- **Spec `1.2.0` + CLI `0.8.0`** — spec gained an optional feature; CLI hasn't implemented it yet. Fine. Plugins needing that feature must declare `"specCompat": "^1.2.0"`.
- **Spec `2.0.0` + CLI `1.4.0`** — CLI still targets spec v1. Operator must upgrade CLI before installing v2-targeting plugins.

## Change process

1. PR proposes a spec change. Include rationale and classification (patch/minor/major).
2. If major, PR includes a migration note draft for [`CHANGELOG.md`](./CHANGELOG.md).
3. If the change affects reference-impl behavior, a companion PR in `src/` lands the implementation behind the bumped `specCompat`.
4. Merge order: spec change first, implementation second. An implementation MUST NOT ship a feature that is not yet in the spec (see [`../AGENTS.md`](../AGENTS.md): "Every feature: update spec/ first, then src/").
5. Tag spec release (`spec-vX.Y.Z`) independent from any CLI tag.

## Canonical URLs

Once the domain is live, schemas resolve at stable URLs:

```
https://skill-map.dev/spec/v1/node.schema.json
https://skill-map.dev/spec/v1.2/node.schema.json
```

Major version is always present in the path. Implementations MUST NOT rely on `latest`.
