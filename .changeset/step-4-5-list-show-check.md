---
"@skill-map/cli": patch
---

Promote `sm list`, `sm show`, `sm check` from stubs to real
implementations backed by the persisted `scan_*` snapshot.

`sm list [--kind <k>] [--issue] [--sort-by <field>] [--limit N] [--json]`
emits a tabular view (PATH / KIND / OUT / IN / EXT / ISSUES / BYTES) of
every node in `scan_nodes`. `--kind` and `--issue` filter rows; the
issue filter uses a SQL `EXISTS` over `scan_issues` so the work stays
in the DB. `--sort-by` is whitelisted (`path`, `kind`, `bytes_total`,
`links_out_count`, `links_in_count`, `external_refs_count`) — anything
else exits 2 with a clear stderr message. Numeric columns sort
descending by default so `--sort-by bytes_total --limit N` returns the
heaviest nodes; textual columns sort ascending. `--json` emits a flat
array conforming to `node.schema.json`.

`sm show <node.path> [--json]` prints the per-node detail view: header
with kind / adapter, optional title / description / stability /
version / author lines, the bytes (and tokens, when present) triple
split, the parsed frontmatter, links out, links in, and current
issues. `--json` emits `{ node, linksOut, linksIn, issues, findings,
summary }`; `findings` is reserved as `[]` and `summary` as `null`
until Step 10 (`state_findings`) and Step 11 (`state_summaries`) ship.
A missing path exits 5 with `Node not found: <path>` on stderr.

`sm check [--json]` reads every row from `scan_issues`, prints them
grouped by severity (errors first, then warns, then infos) as
`[<severity>] <ruleId>: <message> — <node-paths>`, and exits 1 if any
issue carries severity `error`, otherwise 0. Equivalent to
`sm scan --json | jq '.issues'` but without the walk-and-detect cost.
`--json` emits an `Issue[]`.

All three verbs honor the `-g/--global` and `--db <path>` global flags,
and exit 5 with `DB not found at <path>; run \`sm scan\` first.` when
the snapshot has not been persisted yet.

Internals: extracted the `resolveDbPath` and DB-existence guard from
`sm db` into a shared `cli/util/db-path.ts` so the read-side commands
and the lifecycle commands stay byte-aligned on path resolution.
Promoted the row→Node / row→Link / row→Issue mappers in
`scan-load.ts` from private helpers to module exports so the readers
reuse the exact mapping the incremental loader uses, keeping the
read-side aligned with the spec schemas.
