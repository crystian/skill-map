# `sm` CLI reference

Generated from `sm help --format md`. Do not hand-edit; CI regenerates this file from the live command surface.

- CLI version: `0.17.0`
- Spec version: `0.17.0`

## Global flags

- `--help` — Print usage and exit.

## Browse

### `sm check`

Print all current issues (reads from DB, faster than sm scan --json | jq).

Loads every row from scan_issues. Exits 1 if any issue has severity `error`, 
otherwise 0. `warn` and `info` do not fail.

Run `sm scan` first to populate the DB.

`--include-prob` is an opt-in flag for probabilistic Rule dispatch (spec § A.7). 
Default is deterministic-only — same CI-safe behaviour as before. With the flag, 
registered prob rules are detected and named in a stderr advisory; full dispatch 
lands when the job subsystem ships at Step 10.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).
- `--node`, `-n` `string` — Restrict to issues whose nodeIds include the given path. Combines with --rules and --include-prob.
- `--rules` `string` — Comma-separated rule ids (qualified or short). Restrict the issue read; with --include-prob, also filters which prob rules surface in the advisory.
- `--include-prob` `boolean` — Detect probabilistic Rules and emit a stub advisory naming them (full dispatch lands at Step 10). Default off → deterministic-only, CI-safe.
- `--async` `boolean` — Reserved companion to --include-prob: once jobs ship, returns job ids without waiting. No effect today.
- `--no-plugins` `boolean` — Skip drop-in plugin discovery; only kernel built-ins participate in the prob detection. Same flag shape as `sm scan`.

**Examples:**

- Print every current issue
  ```
  sm check
  ```
- Machine-readable issue list
  ```
  sm check --json
  ```
- Restrict to a single node
  ```
  sm check -n .claude/agents/architect.md
  ```
- Restrict to specific rules
  ```
  sm check --rules core/broken-ref,core/validate-all
  ```
- Opt in to probabilistic rules (stub until Step 10)
  ```
  sm check --include-prob
  ```
- Check the global scope
  ```
  sm check --global
  ```
- Use a non-default DB file
  ```
  sm check --db /path/to/skill-map.db
  ```

### `sm export`

Filtered export. Query syntax is implementation-defined pre-1.0.

Reads the persisted scan, applies the query filter, and emits the selected 
subset.

Query syntax (v0.5.0): whitespace-separated key=value tokens; AND across keys, 
OR within comma-separated values. Keys: `kind` (skill / agent / command / note), 
`has` (issues), `path` (POSIX glob — `*` matches a single segment, `**` matches 
across segments).

Pass an empty query (`""`) — or omit the argument entirely — to export every 
node.

Run `sm scan` first to populate the DB.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).

**Examples:**

- Whole graph (no query)
  ```
  sm export --format md
  ```
- Every command node
  ```
  sm export "kind=command" --format json
  ```
- Skills + agents with issues
  ```
  sm export "kind=skill,agent has=issues" --format md
  ```
- Files under a path glob
  ```
  sm export "path=.claude/commands/**" --format json
  ```

### `sm findings`

Probabilistic findings: injection, stale summaries, low confidence. (planned)

### `sm graph`

Render the full graph via the named formatter.

Reads the persisted scan and prints a textual rendering. The built-in `ascii` 
formatter is the only format available at v0.5.0; `mermaid` and `dot` are 
deferred to Step 12 and will surface here automatically once they ship as 
built-ins.

Run `sm scan` first to populate the DB.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).
- `--format` `string` — Formatter format. Must match the `formatId` field of a registered formatter. Default: ascii.
- `--no-plugins` `boolean` — Skip drop-in plugin discovery. Only built-in formatters participate.

**Examples:**

- Render the graph as ASCII (default)
  ```
  sm graph
  ```
- Render with an explicit format
  ```
  sm graph --format ascii
  ```
- Use a non-default DB file
  ```
  sm graph --db /path/to/skill-map.db
  ```

### `sm list`

Tabular listing of nodes. --json emits an array conforming to node.schema.json.

Reads from the persisted scan snapshot (scan_nodes). Filters: --kind <k> 
restricts to one node kind; --issue keeps only nodes

that touch at least one current issue.

--sort-by accepts: path, kind, bytes_total, links_out_count,

links_in_count, external_refs_count. Default: path. --limit N caps the result; 
default is no limit.

Run `sm scan` first to populate the DB.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).

**Examples:**

- List every node
  ```
  sm list
  ```
- List only agents
  ```
  sm list --kind agent
  ```
- Top 5 by total bytes
  ```
  sm list --sort-by bytes_total --limit 5
  ```
- Only nodes with issues, machine-readable
  ```
  sm list --issue --json
  ```

### `sm orphans`

List orphan / auto-rename issues from the last scan. --json emits an array conforming to issue.schema.json.

Surfaces every active issue with ruleId in (orphan, auto-rename-medium, 
auto-rename-ambiguous) so the user can decide whether to reconcile (forward) or 
undo-rename (reverse).

Filter with --kind: orphan | medium | ambiguous.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).

**Examples:**

- List every orphan / auto-rename issue
  ```
  sm orphans
  ```
- Just the ambiguous ones, JSON
  ```
  sm orphans --kind ambiguous --json
  ```

### `sm orphans reconcile`

Migrate state_* FKs from an orphan path to a live node, resolving the orphan issue.

Forward direction: when the rename heuristic could not find a match (e.g. 
semantic-only rename, body rewrite), use this verb to attach the orphan's 
history to a live node.

Validates that <new.path> exists in scan_nodes (exit 5 otherwise) and that an 
active orphan issue exists for <orphan.path> (exit 5 otherwise). Migration is 
atomic via a single transaction.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).

**Examples:**

- Reattach orphan history
  ```
  sm orphans reconcile skills/old.md --to skills/new.md
  ```

### `sm orphans undo-rename`

Reverse a medium- or ambiguous-confidence auto-rename. Migrates state_* FKs back, emits a new orphan on the prior path.

Use when the rename heuristic auto-migrated history to a node that turned out to 
be unrelated.

For an active auto-rename-medium issue on <new.path>, the prior path is read 
from issue.data.from — omit --from. For an active auto-rename-ambiguous issue, 
--from <old.path> is REQUIRED to pick a candidate from data.candidates.

Destructive (changes FK ownership). Prompts for confirmation unless --force.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).

**Examples:**

- Undo a medium-confidence auto-rename
  ```
  sm orphans undo-rename skills/new.md
  ```
- Undo an ambiguous, picking a candidate
  ```
  sm orphans undo-rename skills/new.md --from skills/old-a.md
  ```

### `sm show`

Node detail: weight, frontmatter, links, issues.

Loads a single node from the persisted snapshot, plus every link (in and out) 
and every current issue touching it. Step 10 (findings) and Step 11 (summary) 
will add fields when their backing tables ship.

Run `sm scan` first to populate the DB.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).

**Examples:**

- Show a single node
  ```
  sm show .claude/agents/architect.md
  ```
- Machine-readable detail
  ```
  sm show .claude/agents/architect.md --json
  ```

## Config

### `sm config get`

Read a single config value by dot-path key.

Loads the layered config and prints the final value. Unknown key → exit 5. 
Exempt from "done in <…>".

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).

### `sm config list`

Print the effective config after layered merge.

Walks defaults → user → user-local → project → project-local and prints the 
merged result. With --json emits the JSON object; otherwise prints flat dot-path 
= value lines (sorted). Exempt from "done in <…>" per spec/cli-contract.md 
§Elapsed time.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).

### `sm config reset`

Remove a config key from the target file (project default; -g for user).

Strips the key from the target settings.json (lower layers still apply). 
Idempotent — running twice is safe; absent key prints an info note and exits 0.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).

### `sm config set`

Write a config key. Project file by default; -g writes to user.

Reads the target file (creating it if absent), sets the key at the dot-path, 
validates the result against project-config.schema.json, and writes back. Value 
coercion: JSON-parses the raw string first ("true" → true, "42" → 42, "null" → 
null, arrays / objects natural); unparseable falls through as string. Schema 
violation → exit 2, no write performed.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).

### `sm config show`

Show a config value with the layer that set it (--source).

Identical to "sm config get" plus optional --source which prefixes the layer 
(defaults / user / user-local / project / project-local / override). With --json 
emits { value, source } when --source is set. Exempt from "done in <…>".

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).

## Database

### `sm db backup`

WAL checkpoint + copy the DB file to a backup.

Default output: <db-dir>/backups/<timestamp>.db. Use --out to override. scan_* 
is regenerated on demand and is NOT excluded from the raw file copy, but 
restoring a backup over a live DB is the expected use — running sm scan 
afterwards refreshes scan_*.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).

### `sm db browser`

Open the DB in DB Browser for SQLite (sqlitebrowser GUI).

Default: read-only (-R), so a concurrent `sm scan` writer is safe. Pass --rw to 
enable writes.

Resolution order for the DB path: positional arg > --db <path> > -g/--global > 
project default (cwd/.skill-map/skill-map.db).

Spawns sqlitebrowser detached so the terminal stays usable. If sqlitebrowser is 
not on PATH, a clear error points at the install hint (Debian/Ubuntu: sudo apt 
install -y sqlitebrowser).

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).
- `--rw` `boolean` — Open in read-write mode. Default is read-only so a concurrent `sm scan` writer is safe.

**Examples:**

- Open the project DB read-only
  ```
  sm db browser
  ```
- Open the project DB read-write
  ```
  sm db browser --rw
  ```
- Open an arbitrary DB file
  ```
  sm db browser path/to/other.db
  ```

### `sm db dump`

SQL dump to stdout.

Read-only. Pure node:sqlite — no external `sqlite3` binary required. Use 
--tables <names...> to limit the dump to specific tables.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).

### `sm db migrate`

Apply pending kernel + plugin migrations (default) or inspect plan.

--dry-run       show pending migrations without applying.

--status        print applied vs pending summary and exit.

--to <n>        apply up to (and including) version N (kernel only).

--no-backup     skip the pre-apply backup.

--kernel-only   skip plugin migrations entirely.

--plugin <id>   run only that plugin's migrations (skips kernel migrations).

Plugin migrations live under <plugin-dir>/migrations/ and follow the same 
NNN_snake_case.sql convention as kernel migrations. Each migration is gated by a 
triple-protection rule: every object it creates / alters / drops MUST live in 
the namespace `plugin_<normalizedId>_*`. Layer 1 validates every pending file 
before anything runs; Layer 2 re-validates immediately before apply; Layer 3 
sweeps sqlite_master after apply and reports any object outside the prefix.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).

### `sm db reset`

Drop scan_* (default), optionally state_*, or delete the DB entirely.

Without flags: drops scan_* tables only. Non-destructive — no prompt. With 
--state: also drops state_* tables. Destructive — requires confirmation unless 
--yes / --force. With --hard: deletes the DB file entirely. Destructive — 
requires confirmation unless --yes / --force. With --dry-run: previews what 
would be cleared / deleted without touching the DB. Bypasses the confirmation 
prompt entirely (the preview itself is non-destructive).

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).
- `--dry-run`, `-n` `boolean` — Preview the reset without dropping any tables or unlinking any files.

### `sm db restore`

Replace the active DB file with a backup.

Destructive. Requires interactive confirmation unless --yes / --force is passed. 
scan_* will be re-populated by the next sm scan. With --dry-run: previews the 
swap (source size, target overwrite status, sidecars to drop) without copying or 
deleting anything. Dry-run bypasses the confirmation prompt.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).
- `--dry-run`, `-n` `boolean` — Preview the restore without overwriting the live DB.

### `sm db shell`

Open an interactive sqlite3 shell on the DB file.

Spawns the system sqlite3 binary. If sqlite3 is not on PATH, a clear error 
points at the two workarounds: install sqlite3, or use sm db dump for a 
read-only inspection.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).

## History

### `sm history`

Filter execution records. --json emits an array conforming to execution-record.schema.json.

Reads from state_executions. Filters:   -n <path>          restrict to 
executions whose nodeIds[] contains <path>

  --action <id>      restrict to a specific action extension id

  --status <s,...>   restrict to one or more of completed,failed,cancelled

  --since <ISO>      lower bound on startedAt (inclusive, ISO-8601)

  --until <ISO>      upper bound on startedAt (exclusive, ISO-8601)

  --limit N          cap result count

Output is most-recent-first. Run `sm scan` first to provision the DB.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).

**Examples:**

- Recent executions
  ```
  sm history --limit 10
  ```
- Failures in the last week
  ```
  sm history --status failed --since 2026-04-19T00:00:00Z
  ```
- Machine-readable, scoped to one node
  ```
  sm history -n skills/foo.md --json
  ```

### `sm history stats`

Aggregate counts, tokens, periods, top nodes, and error rates over state_executions. --json conforms to history-stats.schema.json.

Defaults: --period month, --top 10, all-time when --since omitted.

Window: --since is inclusive, --until is exclusive. Both ISO-8601.

The --json output ALWAYS includes the full per-failure-reason key set 
(zero-filled if a reason has no occurrences) so dashboards see a predictable 
shape.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).

**Examples:**

- All-time stats
  ```
  sm history stats
  ```
- Last 30 days, daily buckets
  ```
  sm history stats --since 2026-03-26T00:00:00Z --period day
  ```
- Top 5 nodes, JSON
  ```
  sm history stats --top 5 --json
  ```

## Introspection

### `sm conformance run`

Run the conformance suite — spec-owned cases plus every built-in Provider.

Drives the conformance runner shipped at `@skill-map/cli/conformance` against 
the cases bundled with this CLI install. Each case provisions an isolated tmp 
scope, seeds the appropriate fixture, runs an `sm` invocation, and asserts the 
requested predicates.

Scope selection:

  --scope spec               only spec-owned, kernel-agnostic cases

                              (default fixture: `preamble-v1.txt`,               
                case: `kernel-empty-boot`).   --scope provider:<id>      only 
the named built-in Provider's

                              cases. Today: `provider:claude`                    
           (`basic-scan`, `rename-high`,                               
`orphan-detection`).   --scope all (default)      every scope, in registry 
order.

Exit codes mirror the rest of the verb catalog: 0 on a clean sweep, 1 if any 
case failed, 2 on a configuration error (unknown scope, missing binary).

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).
- `--scope` `string` — Suite selector: 'all' (default), 'spec', or 'provider:<id>'.

**Examples:**

- Run every conformance suite
  ```
  sm conformance run
  ```
- Run only the spec suite
  ```
  sm conformance run --scope spec
  ```
- Run only the Claude Provider suite
  ```
  sm conformance run --scope provider:claude
  ```

### `sm help`

Self-describing introspection. --format human|md|json.

Without a verb: overview of every registered command grouped by category. With a 
verb: the detail view for that single command.

Formats:   human (default) — pretty terminal output.   md              — 
canonical markdown. context/cli-reference.md is                     regenerated 
from this and CI fails on drift.   json            — structured surface dump per 
spec/cli-contract.md.

### `sm version`

Print the CLI / kernel / spec / runtime / db-schema version matrix.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).

## Jobs

### `sm actions list`

Registered action types (manifest view). (planned)

### `sm actions show`

Full action manifest, including preconditions and expected duration. (planned)

### `sm job cancel`

Force a running job to failed with reason user-cancelled. (planned)

### `sm job claim`

Atomic primitive: return next queued job id, mark it running. (planned)

### `sm job list`

List jobs. (planned)

### `sm job preview`

Render the job MD file without executing. (planned)

### `sm job prune`

Retention GC for completed / failed jobs (per config policy). --orphan-files removes MD files with no DB row.

Reads jobs.retention.completed and jobs.retention.failed from the layered 
config. For each non-null policy, deletes terminal jobs whose finishedAt is 
older than the cutoff and unlinks their MD files in .skill-map/jobs/.

With --orphan-files: ALSO scans .skill-map/jobs/ for MD files not referenced by 
any state_jobs row and deletes them. Both passes run; orphans are scanned AFTER 
retention so freshly-pruned files don't double-count.

With --dry-run: counts and reports what would happen without touching the DB or 
the FS.

Exits 0 on success, 5 if the DB is missing (run `sm init` first), 2 on any other 
operational failure (malformed config, IO error).

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).
- `--orphan-files` `boolean` — Also remove MD files in .skill-map/jobs/ that have no matching state_jobs row.
- `--dry-run`, `-n` `boolean` — Report what would be pruned without touching the DB or filesystem.

**Examples:**

- Apply retention policy
  ```
  sm job prune
  ```
- Apply retention + clean orphan files
  ```
  sm job prune --orphan-files
  ```
- Preview without touching the DB
  ```
  sm job prune --dry-run --json
  ```

### `sm job run`

Full CLI-runner loop: claim + spawn + record. (planned)

### `sm job show`

Job detail: state, claim time, TTL, runner, content hash. (planned)

### `sm job status`

Counts (per status) or single-job status. (planned)

### `sm job submit`

Enqueue a single job or fan out to every matching node (--all). (planned)

### `sm record`

Close a running job with success or failure. Nonce is the sole credential. (planned)

## Plugins

### `sm plugins disable`

Disable a plugin (or --all). Persists in config_plugins; does not delete files.

Writes a row to config_plugins with enabled=0. Discovery still surfaces the 
plugin in sm plugins list, but with status=disabled — its extensions are not 
imported and the kernel will not run them.

Granularity: a bundle-granularity plugin (default for user plugins, and the 
built-in 'claude' bundle) accepts only the bundle id. An extension-granularity 
plugin (the built-in 'core' bundle) accepts only qualified ids 
'<bundle>/<ext-id>'. Mismatches are rejected with directed guidance.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).

### `sm plugins doctor`

Run the full load pass and summarise by failure mode.

Exit code 0 when every plugin loads or is intentionally disabled; 1 when any 
plugin is in an error / incompat state.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).

### `sm plugins enable`

Enable a plugin (or --all). Persists in config_plugins.

Writes a row to config_plugins with enabled=1. Takes precedence over the 
team-shared baseline at settings.json#/plugins/<id>/enabled. Use sm plugins 
disable to flip; sm config reset plugins.<id>.enabled drops the settings.json 
baseline.

Granularity: a bundle-granularity plugin (default for user plugins, and the 
built-in 'claude' bundle) accepts only the bundle id. An extension-granularity 
plugin (the built-in 'core' bundle) accepts only qualified ids 
'<bundle>/<ext-id>'. Mismatches are rejected with directed guidance.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).

### `sm plugins list`

List discovered plugins and their load status.

Scans <scope>/.skill-map/plugins and ~/.skill-map/plugins (or --plugin-dir 
<path>). Built-in bundles (claude, core) are listed alongside user plugins.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).

### `sm plugins show`

Show a single plugin's manifest + loaded extensions.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).

## Scan

### `sm refresh`

Refresh enrichment rows: granular (single node) or batch (every stale row).

Re-runs Extractors against the node(s) and upserts their outputs into the 
universal enrichment layer (`node_enrichments`). Deterministic Extractors run 
for real and persist; probabilistic Extractors require the job subsystem (Step 
10) and are stubbed for now — they emit a stderr advisory and skip without 
touching their stale rows.

Layer separation: enrichments live separately from the author's frontmatter, 
which is immutable from any Extractor. Probabilistic enrichments track 
`body_hash_at_enrichment`; when the scan loop sees a body change, those rows are 
flagged `stale = 1` (NOT deleted, so the LLM cost is preserved) and surface here 
for refresh.

Pass `--stale` to refresh every node carrying a stale row. Pass a positional 
`<node.path>` to refresh just that node. The two are mutually exclusive.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).
- `--stale` `boolean` — Refresh every node whose probabilistic enrichment row is flagged stale=1.
- `--no-plugins` `boolean` — Skip drop-in plugin discovery; use only the built-in extractor set.

**Examples:**

- Refresh a single node
  ```
  sm refresh .claude/agents/architect.md
  ```
- Refresh every node with stale enrichments
  ```
  sm refresh --stale
  ```

### `sm scan`

Scan roots for markdown nodes, run extractors and rules.

Walks the given roots with the built-in claude Provider, runs the frontmatter / 
slash / at-directive / external-url-counter extractors per node, then the 
trigger-collision / broken-ref / superseded rules over the full graph. Emits a 
ScanResult conforming to scan-result.schema.json.

The result is persisted into <cwd>/.skill-map/skill-map.db (replace-all over 
scan_nodes/links/issues). Pass --no-built-ins to skip both the pipeline and the 
persistence step (kernel-empty-boot parity).

Pass -n / --dry-run to skip every DB operation (the result is computed in memory 
and emitted to stdout). Pass --changed to load the prior snapshot from the DB, 
reuse unchanged nodes, and only reprocess new / modified files.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).
- `--no-built-ins` `boolean` — Skip the built-in extension set. Yields a zero-filled ScanResult (kernel-empty-boot parity); skips DB persistence.
- `--no-plugins` `boolean` — Skip drop-in plugin discovery. Only the built-in set runs. Combine with --no-built-ins for a fully empty pipeline.
- `--no-tokens` `boolean` — Skip per-node token counts (cl100k_base BPE). Leaves node.tokens undefined; spec-valid since the field is optional.
- `--dry-run`, `-n` `boolean` — Run the scan in memory and skip every DB write. Combined with --changed, still opens the DB read-side to load the prior snapshot.
- `--changed` `boolean` — Incremental scan: reuse unchanged nodes from the persisted prior snapshot. Degrades to a full scan if no prior snapshot exists.
- `--allow-empty` `boolean` — Allow a zero-result scan to wipe an already-populated DB (replace-all replace by zero rows). Off by default to avoid the typo-trap where an invalid root silently clears your data.
- `--strict` `boolean` — Promote frontmatter-validation findings from warn to error (exit code 1 on any violation). Overrides scan.strict from config when both are set.
- `--watch` `boolean` — Long-running mode: watch the roots and trigger an incremental scan after each debounced batch of filesystem events. Alias of `sm watch`.

**Examples:**

- Scan the current directory
  ```
  sm scan
  ```
- Scan multiple roots and print JSON
  ```
  sm scan ./docs ./skills --json
  ```
- Empty-pipeline conformance
  ```
  sm scan --no-built-ins --json
  ```
- Dry-run, no DB writes
  ```
  sm scan -n --json
  ```
- Incremental scan against prior snapshot
  ```
  sm scan --changed
  ```
- What would the next incremental scan persist?
  ```
  sm scan --changed -n --json
  ```

### `sm scan compare-with`

Run a fresh scan in memory and emit a delta against the saved ScanResult dump at <dump>. Read-only.

Loads the JSON dump at <dump>, AJV-validates it against scan-result.schema.json, 
runs a fresh scan over [roots...] (default: current directory) using the same 
pipeline as 'sm scan' (built-ins + plugin runtime + layered config + ignore 
filter), and emits the delta between the dump and the fresh scan. The DB is 
NEVER touched — this verb is read-only.

Exit 0 on empty delta (state matches the dump), exit 1 on any drift (added / 
removed / changed nodes, links, or issues), exit 2 on operational error (missing 
or malformed dump, schema violation, config / scan failure).

Typical use case: CI guard. Freeze a baseline at merge to main:   sm scan --json 
> .skill-map/baseline.json And on every PR, before the merge:   sm scan 
compare-with .skill-map/baseline.json Any drift trips the build.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).
- `--no-tokens` `boolean` — Skip per-node token counts during the fresh scan.
- `--strict` `boolean` — Promote layered-config warnings and frontmatter-validation findings from warn to error.
- `--no-plugins` `boolean` — Skip drop-in plugin discovery.

**Examples:**

- Compare against a baseline
  ```
  sm scan compare-with .skill-map/baseline.json
  ```
- Compare a specific subtree
  ```
  sm scan compare-with baseline.json src/
  ```
- JSON output for tooling
  ```
  sm scan compare-with baseline.json --json
  ```

### `sm watch`

Watch roots and run an incremental scan after each debounced batch of filesystem events.

Long-running version of 'sm scan --changed'. Subscribes to the given roots via 
chokidar, applies the same ignore chain (.skillmapignore + config.ignore + 
bundled defaults), and triggers an incremental scan after each debounced batch.

Default debounce is 300ms; configure via 'scan.watch.debounceMs' in 
.skill-map/settings.json. SIGINT / SIGTERM stop the watcher cleanly and exit 0.

Under --json, every batch emits one ScanResult as ndjson on stdout. Without 
--json, every batch prints one summary line.

'sm scan --watch' is an alias and shares the same flag surface.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).
- `--no-tokens` `boolean` — Skip per-node token counts (cl100k_base BPE).
- `--strict` `boolean` — Promote frontmatter-validation findings from warn to error inside each batch. Does not change the watcher exit code.
- `--no-plugins` `boolean` — Skip drop-in plugin discovery for the watcher session.
- `--max-consecutive-failures` `string` — Shut down with exit 2 after N consecutive batch failures (default 5; 0 disables the breaker).

**Examples:**

- Watch the current directory
  ```
  sm watch
  ```
- Watch multiple roots
  ```
  sm watch ./docs ./skills
  ```
- Stream ScanResult per batch as ndjson
  ```
  sm watch --json
  ```

## Setup

### `sm doctor`

Diagnostic report: DB integrity, pending migrations, orphan rows, plugin status, runner availability. (planned)

### `sm init`

Bootstrap the current scope: scaffold .skill-map/, provision DB, run first scan.

Project scope (default): creates ./.skill-map/ with settings.json, 
settings.local.json, and skill-map.db. Drops a starter .skillmapignore at the 
scope root and appends the DB + local settings to .gitignore.

Global scope (-g): same scaffolding under ~/.skill-map/. No .gitignore is 
touched; "$HOME" isn't a repo.

Re-running over an existing scope errors with exit 2 unless --force is passed. 
--no-scan skips the first scan; useful in CI

where the operator wants to provision before populating roots.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).
- `--no-scan` `boolean` — Skip the first scan after scaffolding.
- `--force` `boolean` — Overwrite an existing settings.json / settings.local.json / .skillmapignore.
- `--strict` `boolean` — Strict mode: fail on any layered-loader warning AND promote frontmatter warnings to errors during the first scan. Same flag as sm scan / sm config.
- `--dry-run`, `-n` `boolean` — Preview the scope provisioning without touching the filesystem or the DB. Honours --force for the would-overwrite preview. Skips the first scan unconditionally — dry-run never persists.

**Examples:**

- Initialise the current project
  ```
  sm init
  ```
- Provision the global scope
  ```
  sm init -g
  ```
- Bootstrap without running the first scan
  ```
  sm init --no-scan
  ```
- Force-overwrite an existing scope
  ```
  sm init --force
  ```
- Preview what would be created
  ```
  sm init --dry-run
  ```

### `sm serve`

Start the Hono BFF (single-port: REST + WebSocket + SPA bundle).

Boots the skill-map Web UI's backing server. One Node process serves the Angular 
SPA, the REST API under /api/*, and the WebSocket at /ws — single-port mandate, 
no proxy.

Default port is 4242, default host is 127.0.0.1. The server boots even when the 
project DB is missing — /api/health reports 'db: missing' so the SPA renders an 
empty-state CTA instead of failing the connection.

Loopback-only assumption through v0.6.0 (no per-connection auth on /ws). 
Combining --dev-cors with a non-loopback --host is rejected.

SIGINT / SIGTERM trigger a graceful shutdown.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).
- `--port` `string` — Listening port (default 4242). 0 = OS-assigned.
- `--host` `string` — Listening host (default 127.0.0.1). Loopback-only enforced when --dev-cors is set.
- `--scope` `string` — project | global. Alias for -g/--global. Default: project.
- `--no-built-ins` `boolean` — Skip built-in plugin registration (parity with sm scan --no-built-ins).
- `--no-plugins` `boolean` — Skip drop-in plugin discovery.
- `--open` `boolean` — Auto-open the SPA in the user's default browser after listen. --no-open opts out.
- `--dev-cors` `boolean` — Enable permissive CORS for the Angular dev-server proxy workflow.
- `--no-ui` `boolean` — Don't serve the Angular UI bundle. Use this when running the BFF alongside `ui:dev` (Angular dev server with HMR). The root `/` then renders an inline placeholder pointing the user at the dev server.
- `--no-watcher` `boolean` — Disable the chokidar-fed scan-and-broadcast loop. Use only for CI / read-only deployments.

**Examples:**

- Start on the default port and open the browser
  ```
  sm serve
  ```
- Custom port, no browser auto-open
  ```
  sm serve --port 5000 --no-open
  ```
- Use the global scope DB
  ```
  sm serve --scope global
  ```
- Point at a pre-built UI bundle
  ```
  sm serve --ui-dist ./ui/dist/browser
  ```

### `sm tutorial`

Materialize the interactive tester tutorial (sm-tutorial.md) in the current directory.

Drops the canonical SKILL.md content as ./sm-tutorial.md so a tester can open 
Claude Code in the cwd and load the file as a skill by typing "ejecutá 
@sm-tutorial.md". Top-level only — no subdirectory is created.

Does NOT require an initialized .skill-map/ project. Refuses to overwrite an 
existing sm-tutorial.md unless --force is passed.

**Flags:**

- `--global`, `-g` `boolean` — Operate on ~/.skill-map/ instead of ./.skill-map/.
- `--json` `boolean` — Emit machine-readable output on stdout. Suppresses pretty printing.
- `--quiet`, `-q` `boolean` — Suppress non-error stderr output (including "done in <…>").
- `--no-color` `boolean` — Disable ANSI color codes.
- `--verbose`, `-v` `boolean` — Increase log level (-v=info, -vv=debug, -vvv=trace).
- `--db` `string` — Override the database file location (escape hatch).
- `--force` `boolean` — Overwrite an existing sm-tutorial.md without prompting.

**Examples:**

- Materialize the tutorial in the cwd
  ```
  sm tutorial
  ```
- Overwrite an existing sm-tutorial.md
  ```
  sm tutorial --force
  ```

