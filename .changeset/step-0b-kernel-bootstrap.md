---
"skill-map": minor
---

Step 0b — Implementation bootstrap:

- `src/` workspace scaffolded (TypeScript strict, Node ESM, tsup build, tsx test loader).
- Hexagonal skeleton: 5 ports (`StoragePort`, `FilesystemPort`, `PluginLoaderPort`, `RunnerPort`, `ProgressEmitterPort`) + `Registry` covering the six extension kinds + kernel shell + `runScan` stub that returns a well-formed empty `ScanResult`.
- CLI (Clipanion v4): `sm --version`, `sm --help`, `sm scan [roots...] [--json]`. Binary wrapper at `bin/sm.mjs`.
- Contract test runner (`src/conformance/index.ts`): loads a case JSON, provisions a tmp scope, invokes the binary, evaluates 5 of 6 assertion types (`file-matches-schema` marked NYI — lands with Step 2 when ajv is introduced).
- Unit + integration tests with `node:test`: 13 tests covering the Registry, kernel, CLI surface, and conformance runner.
- CI extended with `build-test` job (typecheck + tsup + tests).

First cut of the reference implementation.
