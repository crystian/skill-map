---
'@skill-map/cli': minor
---

security: harden CLI/kernel against prototype pollution, ANSI injection, and path-escape attacks (audit findings H1–H3, M1–M6, L1)

- **H1** — `kernel/config/loader.ts` `deepMerge` now skips `__proto__` / `constructor` / `prototype` keys, closing the lane where a hostile config layer (settings.json, overrides) could mutate the merged config's prototype chain via the `additionalProperties: true` opening inside `plugins[*].config`.
- **H2** — `cli/commands/config.ts` `getAtPath` / `setAtPath` / `deleteAtPath` reject pollution-class path segments before walking; `sm config set __proto__.x true` exits 2 with a clear message instead of polluting the running process's prototype chain.
- **H3** — `kernel/orchestrator.ts` `mergeNodeWithEnrichments` filters pollution keys from every source before copying; a malicious extractor can no longer reshape the merged frontmatter's prototype via persisted `enrichments.value`.
- **L2** (defense-in-depth) — claude provider strips pollution keys from parsed YAML frontmatter at parse time so downstream `Object.assign`-style merges remain safe even without per-callsite filters.
- **M1** — new `kernel/util/safe-text.ts` (`stripAnsi`, `sanitizeForTerminal`) wired through ASCII formatter, `sm show`, `sm export`, `sm scan-compare`, `sm conformance`. Disk-sourced strings (titles, paths, issue messages, plugin output) are stripped of ANSI/CSI/OSC escapes and dangerous C0 controls before reaching stdout/stderr.
- **M2 / L1** — `sm db reset` now whitelists + double-quotes table names taken from `sqlite_master`; `sm db dump --tables` rejects non-identifier names with a clean error.
- **M3** — `kernel/adapters/plugin-loader.ts` rejects `extensions[*]` entries and `storage.schema(s)` paths whose resolved form escapes the plugin directory (closes the cross-plugin reference lane).
- **M4** — `conformance/index.ts` validates that case-supplied `fixture` and assertion `path` values stay inside `fixturesRoot` / `scope` before any filesystem read or copy.
- **M5** — `kernel/adapters/sqlite/plugin-migrations-validator.ts` rejects plugin migrations whose string literals contain `--` or `/*`, closing the validator/exec divergence noted in the audit.
- **M6** — `kernel/adapters/sqlite/migrations.ts` asserts `Number.isInteger` on the migration version before interpolating it into `PRAGMA user_version`.

No changes to public APIs; behaviour change is limited to rejecting previously-undefined-but-dangerous inputs.
