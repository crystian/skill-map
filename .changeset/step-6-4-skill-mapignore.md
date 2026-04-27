---
"@skill-map/cli": patch
---

Step 6.4 — `.skill-mapignore` parser + scan walker integration.
Layered ignore filter composes bundled defaults + `config.ignore`
(from `.skill-map/settings.json`) + `.skill-mapignore` file content;
the walker honours it so reorganising `node_modules`, `dist`, drafts,
or any user-defined private dir keeps them out of the scan in one
predictable place.

**New dependency**: `ignore@7.0.5` (zero-deps, MIT, gitignore-spec
compliant — same library used by eslint, prettier). Pinned exact per
AGENTS.md.

**Runtime change**:

- `src/config/defaults/skill-mapignore` — bundled defaults file shipped
  with the CLI (`.git/`, `node_modules/`, `dist/`, `build/`, `out/`,
  `.next/`, `.cache/`, `.tmp/`, `.skill-map/`, `*.log`, `.DS_Store`,
  `Thumbs.db`, `*.swp`, `*~`). Copied into `dist/config/defaults/` by
  tsup `onSuccess`.
- `src/kernel/scan/ignore.ts` — `buildIgnoreFilter({ configIgnore?,
  ignoreFileText?, includeDefaults? })` returns an `IIgnoreFilter` with
  one method, `ignores(relativePath)`. Layer order is fixed: defaults
  → `configIgnore` → `ignoreFileText`. Bundled defaults loaded once
  (module-level cache); resolves a small candidate-list of paths to
  cover both the dev layout (`src/`) and the bundled layout (`dist/`).
- `src/kernel/scan/ignore.ts` also exports `readIgnoreFileText(scopeRoot)`
  — convenience to read `<scopeRoot>/.skill-mapignore` and feed it to
  `buildIgnoreFilter`.
- `src/kernel/extensions/adapter.ts` — `IAdapter.walk` signature
  changes: `options.ignore?: string[]` → `options.ignoreFilter?:
  IIgnoreFilter`. The old shape was unused (no caller passed it), so
  no compat shim ships.
- `src/extensions/adapters/claude/index.ts` — walker tracks the
  current relative path during recursion and consults the filter for
  every directory and file. The previous hard-coded `DEFAULT_IGNORE`
  set is removed; the bundled defaults provide the same baseline.
  Adapters that omit `ignoreFilter` get the bundled-defaults filter as
  a defensive fallback, so kernel-empty-boot and direct adapter tests
  still skip `.git` / `node_modules` / `.tmp`.
- `src/kernel/orchestrator.ts` — `RunScanOptions.ignoreFilter?:
  IIgnoreFilter` plumbed through to every `adapter.walk(...)` call.
- `src/cli/commands/scan.ts` — `ScanCommand` loads layered config and
  composes the filter from `cfg.ignore` + the project's
  `.skill-mapignore`, then passes it via `runOptions.ignoreFilter`.

**Tests**: `src/test/scan-ignore.test.ts` — 14 tests covering filter
defaults (skip / preserve / empty path), `configIgnore` patterns and
directory globs, ignore-file text parsing with comments and blanks,
three-layer combination including negation that respects gitignore's
"can't re-include from excluded directory" rule, `includeDefaults:
false` opt-out, `readIgnoreFileText` present / missing, plus four
end-to-end runScan integrations (`.skill-mapignore` excludes drafts,
`config.ignore` excludes a private dir, defaults still skip
`node_modules` / `.git` without extra config, file-glob negation
re-includes a single file inside an otherwise-excluded directory).

Test count: 252 → 266 (+14).
