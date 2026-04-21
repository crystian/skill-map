---
"@skill-map/spec": patch
---

Split `sm db reset` into three explicit levels of destruction, each with distinct semantics.

Before: `sm db reset` dropped BOTH `scan_*` and `state_*` in one command — so a user who wanted "please rescan from scratch" would wipe their job history, summaries, enrichment, and plugin KV data. The "reset" name suggested a soft operation; the behavior was aggressive.

After:

- `sm db reset` — drops `scan_*` only. Keeps `state_*` and `config_*`. Non-destructive, no prompt. Equivalent to asking for a fresh scan.
- `sm db reset --state` — also drops `state_*` and every `plugin_<normalized_id>_*` table (mode B) plus `state_plugin_kv` (mode A). Keeps `config_*`. Destructive; requires confirmation unless `--yes` (or `--force`, kept as an alias).
- `sm db reset --hard` — deletes the DB file entirely. Keeps the plugins folder on disk. Destructive; requires confirmation unless `--yes`.

Updated files:

- `spec/cli-contract.md` §Database — new table rows and a rewritten confirmation paragraph.
- `spec/db-schema.md` §Zones — one-liner rewritten to list all three levels.
- `spec/plugin-kv-api.md` §Scope and lifecycle — three bullets replacing the single prior bullet, explicit about which reset level touches plugin storage.

Classification: patch in intent but **behavior-changing for `sm db reset` without modifier**. Implementations of `v0.x` that currently drop `state_*` on `sm db reset` MUST narrow the behavior; users relying on the old "reset = wipe everything below config" workflow must switch to `sm db reset --state`. Classified as patch because the spec is pre-1.0 and no implementation has shipped the CLI yet (Step 1a lands storage + the `sm db *` verbs together — this is the first time the boundary is normative in code).

Companion prose updates in `ROADMAP.md` §DB management commands and §Step 1a acceptance list.
