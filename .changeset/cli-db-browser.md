---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Add a `sm db browser` sub-command that opens the project's SQLite DB in DB Browser for SQLite (sqlitebrowser GUI). Read-only by default; pass `--rw` to enable writes. Replaces the previous `scripts/open-sqlite-browser.js` standalone script.

The root `npm run sqlite` shortcut now invokes the project-built CLI binary (`node src/bin/sm.js db browser`) instead of the standalone script. This guarantees the locally compiled CLI is used, not whichever `sm` resolves on PATH (a globally installed `@skill-map/cli` would otherwise shadow the in-development version).

Spec: `cli-contract.md` documents the new sub-command in the verb table and the §Database section.
