---
"@skill-map/cli": patch
---

Step 6.5 — `sm init` scaffolding. Replaces the
"not-implemented" stub with a real bootstrap verb that provisions
everything Step 6 has built so far in one command:

  - `<scopeRoot>/.skill-map/` directory.
  - `settings.json` with `{ "schemaVersion": 1 }` (minimal, validated
    against `project-config.schema.json`).
  - `settings.local.json` with `{}` (placeholder for personal overrides;
    appended to `.gitignore` so it never gets committed).
  - `.skill-mapignore` at the scope root, copied byte-for-byte from
    `src/config/defaults/skill-mapignore`.
  - `<scopeRoot>/.skill-map/skill-map.db` provisioned via
    `SqliteStorageAdapter.init()` (auto-applies kernel migrations).
  - First scan: walks the scope, persists `scan_*` tables. Exit code
    mirrors `sm scan` — 1 if any `error`-severity issues land.

Project scope (default = cwd): also appends two entries to
`<cwd>/.gitignore` (`.skill-map/settings.local.json`,
`.skill-map/skill-map.db`); creates the file if missing, leaves
existing entries untouched, never duplicates. Comments and blank
lines in an existing `.gitignore` survive.

Global scope (`-g`): same scaffolding under `$HOME/.skill-map/`. No
`.gitignore` is written — `$HOME` isn't a repo.

Re-running over an existing scope errors with exit 2 unless `--force`
is passed. `--no-scan` skips the first scan (useful in CI where the
operator wants to provision before populating roots). `--force`
overwrites `settings.json`, `settings.local.json`, and `.skill-mapignore`
but keeps the DB and any other state in `.skill-map/`.

**Runtime change**:

- `src/cli/commands/init.ts` — new file. The `runFirstScan` helper
  loads the layered config, builds the ignore filter
  (defaults + `config.ignore` + the `.skill-mapignore` it just wrote),
  runs `runScanWithRenames`, and persists. Inline (not subprocess) so
  the parent owns the elapsed line and stdio cleanly.
- `src/cli/commands/stubs.ts` — `InitCommand` removed; replaced-at-step
  comment kept.
- `src/cli/entry.ts` — registers the new `InitCommand`.
- `src/kernel/scan/ignore.ts` — new `loadBundledIgnoreText()` export;
  re-uses the module-level cache so `sm init` reads the defaults file
  once across the process lifetime.
- `context/cli-reference.md` — regenerated; init's flag table and
  examples block now appear in the reference.

**Tests**: `src/test/init-cli.test.ts` — 7 tests through the real
binary covering project-scope scaffolding (files present, schemaVersion
set, ignore template populated), `.gitignore` create-when-missing,
`.gitignore` merge without duplicating an existing entry, re-init
blocked without `--force`, `--force` overwrites, default first-scan
finds and counts a seeded `.claude/agents/foo.md`, global scope under
`HOME/.skill-map/` with no `.gitignore` written and no leakage into
`cwd`.

Test count: 266 → 273 (+7).
