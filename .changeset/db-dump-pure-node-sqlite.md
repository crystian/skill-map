---
'@skill-map/cli': patch
---

`sm db dump` no longer requires the external `sqlite3` binary. Reimplemented on top of `node:sqlite` (already a dep via the storage adapter), so the verb works on any host that can run sm without an extra install step. The output format mirrors sqlite3's `.dump` closely enough to round-trip into a fresh DB via either `node:sqlite` or the system `sqlite3` if present (`PRAGMA foreign_keys=OFF;` + `BEGIN TRANSACTION;` + schema objects in `rootpage` order + per-table `INSERT INTO …` + `COMMIT;`).

Fixes a tester-reported `SQLITE_CANTOPEN (14)` from the spawned sqlite3 binary in environments where the binary's read-only mode could not co-exist with the kernel's WAL setup. The `sm db shell` verb still requires the external `sqlite3` binary because it spawns an interactive REPL — that escape hatch stays unchanged.
