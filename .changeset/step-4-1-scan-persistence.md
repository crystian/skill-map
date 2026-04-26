---
"@skill-map/cli": patch
---

Persist scan results to SQLite (scan_nodes/links/issues).

`sm scan` now writes the ScanResult into `<cwd>/.skill-map/skill-map.db`
with replace-all semantics across `scan_nodes`, `scan_links`, and
`scan_issues`. The DB is auto-migrated on first run. Persistence is
skipped under `--no-built-ins` so the kernel-empty-boot conformance
probe cannot wipe an existing snapshot.

Also fixes the bundled-CLI default migrations directory: the prior
resolver assumed an unbundled `kernel/adapters/sqlite/` path layout,
which silently missed `dist/migrations/` in the tsup-bundled CLI.
