---
'@skill-map/cli': minor
---

Step 9.2 — plugin migrations + triple protection. Plugins declaring
`storage.mode === 'dedicated'` can now ship their own SQL migrations
under `<plugin-dir>/migrations/NNN_<name>.sql`, and `sm db migrate`
applies them after the kernel pass. Two new flags from
`spec/cli-contract.md:304` light up:

- `--kernel-only` — skip plugin migrations entirely.
- `--plugin <id>` — run migrations for one plugin (skips the kernel
  pass; assumes kernel is already up to date). Mutually exclusive
  with `--kernel-only`.

Triple-protection rule (every object a plugin migration touches MUST
live in the namespace `plugin_<normalizedId>_*`):

- **Layer 1 — discovery**: every pending file is parsed + validated
  before any of them run. Failure aborts the whole batch with no DB
  writes.
- **Layer 2 — apply**: same validator runs immediately before
  `db.exec(sql)`, defending against TOCTOU edits between discovery
  and apply.
- **Layer 3 — post-apply catalog assertion**: after each plugin's
  batch commits, `sqlite_master` is compared against a pre-batch
  snapshot. Any new object outside the prefix is reported as an
  intrusion (exit code 2; ledger row still written for whatever
  applied cleanly so the breach is loud).

Implementation: pragmatic regex parser per the Arquitecto's pick.
Whitelist of allowed DDL (`CREATE` / `DROP` / `ALTER` over `TABLE` /
`INDEX` / `TRIGGER` / `VIEW`) + DML (`INSERT` / `UPDATE` / `DELETE`)
on prefixed objects. Forbidden keywords (`BEGIN` / `COMMIT` /
`ROLLBACK` / `PRAGMA` / `ATTACH` / `DETACH` / `VACUUM` / `REINDEX` /
`ANALYZE`) abort validation. Schema qualifiers other than `main.`
are rejected. Comments are stripped first so `-- CREATE TABLE evil;`
and `/* … */` blocks can't smuggle hidden DDL past the regex.

Lights up `storage.mode === 'dedicated'` end-to-end: the existing
`config_schema_versions` table records plugin migrations under
`(scope='plugin', owner_id=<plugin-id>)`. Plugins with `mode === 'kv'`
or no `storage` field are skipped silently — the kernel-owned
`state_plugin_kvs` table is already there. Each migration runs in
its own transaction with the ledger insert in the same transaction
so partial failures roll back cleanly.

New modules:

- `src/kernel/adapters/sqlite/plugin-migrations-validator.ts` —
  `normalizePluginId`, `stripComments`, `splitStatements`,
  `validatePluginMigrationSql`, `snapshotCatalog`,
  `detectCatalogIntrusion`, `assertNoNormalizationCollisions`. Pure,
  no IO.
- `src/kernel/adapters/sqlite/plugin-migrations.ts` —
  `discoverPluginMigrations`, `planPluginMigrations`,
  `applyPluginMigrations`, `readPluginLedger`. Mirrors the kernel
  runner shape for consistency.

CLI surface:

- `DbMigrateCommand` learns `--kernel-only` and `--plugin <id>`. The
  `--status` summary now lists kernel + per-plugin ledgers.
- Plugin discovery uses the `loadPluginRuntime` helper from 9.1, so
  the resolver layering (settings.json + DB override) stays in
  lock-step with `sm plugins list`.

43 new tests across two files (`plugin-migrations-validator.test.ts`,
`plugin-migrations.test.ts`) cover id normalization, comment stripping,
statement splitting, prefix enforcement (green path + 9 violation
shapes), catalog intrusion detection, runner integration (green path,
Layer 1 abort, idempotent re-run, dry-run), and the CLI flag matrix
(`--kernel-only`, `--plugin <id>`, missing-id exit 5, mutual exclusion,
`--status` formatting). Test count 394 → 437.
