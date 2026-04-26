---
"@skill-map/cli": patch
---

Two more fixes from the Step 4 end-to-end validation pass:

- `trigger-collision` rule now also detects cases where two nodes advertise
  the same trigger via their `frontmatter.name` (e.g. two commands both
  named `deploy` in different files — the canonical example in the rule's
  own doc comment). Previously the rule only fired on case-mismatch
  invocations between different sources; commands competing for a
  namespace silently passed because the implementation iterated `links`
  alone and never looked at `nodes`. The rule now buckets two kinds of
  claims on each normalized trigger — advertisements (`'/' +
  frontmatter.name` for `command` / `skill` / `agent` nodes) and
  invocations (raw `link.target`) — and emits one `error` issue per
  bucket with two or more distinct advertiser paths, two or more distinct
  invocation forms, or one advertiser plus a non-canonical invocation
  (e.g. an upper-cased trigger against a lower-cased advertiser name).
  Issue payload exposes
  `{ normalizedTrigger, invocationTargets, advertiserPaths }` so callers
  can render either side.
- `sm scan` now runs `PRAGMA wal_checkpoint(TRUNCATE)` after persisting,
  so external read-only tools (sqlitebrowser, DBeaver, ad-hoc `sqlite3`
  clients) see fresh state without manual intervention. Previously the
  main `.db` could lag the `.db-wal` arbitrarily — for typical small-repo
  scans the WAL never crossed the 1000-page auto-checkpoint threshold,
  so the canonical snapshot stayed in the sidecar indefinitely. The
  checkpoint runs on the top-level Kysely handle (not inside the
  transaction); cost is `~ms` on small DBs and there are no concurrent
  readers to contend with.
