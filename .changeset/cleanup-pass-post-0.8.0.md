---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

Cleanup pass post-v0.8.0 — finishing the renames and wiring the
conformance kill-switches.

**Pre-1.0 minor bump** per `spec/versioning.md` § Pre-1.0. The schema
field rename below is technically breaking, but ships as a minor while
the spec stays `0.Y.Z`.

## Spec changes (`@skill-map/spec`)

### Breaking — `conformance-case.schema.json`

- **Rename `setup.disableAllDetectors` → `setup.disableAllExtractors`.**
  Finishes the kind rename Detector → Extractor introduced in 0.8.0
  (Phase 2 of the plug-in model overhaul). The previous name was the
  last residue and it never reached a release where anything consumed
  it.
- **`setup.disableAll{Providers,Extractors,Rules}` are now consumed
  end-to-end.** Until this release the three toggles were declared in
  the schema and accepted by the runner, but the runner never threaded
  them anywhere — the `kernel-empty-boot` case happened to pass
  because its fixture is empty. The runner now injects
  `SKILL_MAP_DISABLE_ALL_{PROVIDERS,EXTRACTORS,RULES}=1` into the
  child process environment when the matching toggle is `true`, and
  the CLI's scan composer drops every extension of the disabled kind
  from the in-scan pipeline regardless of granularity gates and
  `--no-built-ins`. Each toggle now has a docstring on the schema
  property pointing at the env-var convention.
- `kernel-empty-boot` case updated for the rename.
- `conformance/README.md` example updated.

### Non-breaking — copy fixes

- Comments and docstrings across `architecture.md` and friends already
  refer to "Extractor" everywhere; only the schema field stayed on the
  old name. No prose changes in this bump.

## CLI changes (`@skill-map/cli`)

### Breaking — `IDiscoveredPlugin.status` enum

- **Rename `'loaded'` → `'enabled'`.** The schema enum
  (`plugins-registry.schema.json`) already used `enabled` since 0.8.0;
  the runtime drifted to `loaded` and has now been pulled back so the
  runtime status matches the spec contract. `'disabled'`, the
  semantic pair, was already aligned. Every consumer (`sm plugins
  list`, `sm plugins doctor`, `sm db prune` plugin filter, runtime
  plugin composer) updated. No published consumers exist.

### Non-breaking — sweep cleanup

- Old `Detector` / `detector` references (kind name, manifest field
  names, JSDoc, comments, test fixture filenames, test variable
  names) replaced with `Extractor` / `extractor` across the
  production code and test suite. Excludes historical CHANGELOG
  entries, explicit migration notes ("Renamed from Detector"), and
  test data strings whose semantics are independent of the kind
  name (e.g. `'@FooDetector'` in trigger normalization tests).
- A residual reference to "an audit reading `ScanResult.issues`" in
  `validate-all`'s docstring rewritten without the removed kind name.

## Tests

- `plugin-runtime-branches.test.ts` — five new unit tests covering
  the env-var kill-switch in `composeScanExtensions` (per kind, all
  three together, and stray-value resilience).
- `conformance-disable-flags.test.ts` — four new e2e tests pointing
  the runner at a populated fixture with each toggle in turn (and a
  baseline) so a regression in the env-var pipeline shows up
  structurally rather than relying on the empty-fixture coincidence.
