# `sm` CLI reference

Generated from `sm help --format md`. Do not hand-edit; CI regenerates this file from the live command surface.

- CLI version: `0.2.0`
- Spec version: `0.4.0`

## Global flags

- `--help` — Print usage and exit.

## Actions

### `sm actions list`

Registered action types (manifest view).

### `sm actions show`

Full action manifest, including preconditions and expected duration.

## Audits

### `sm audit list`

Registered audits.

### `sm audit run`

Execute an audit. --json emits the audit report per its declared shape.

## Browse

### `sm check`

Print all current issues (reads from DB, faster than sm scan --json | jq).

### `sm export`

Filtered export. Query syntax is implementation-defined pre-1.0.

### `sm findings`

Probabilistic findings: injection, stale summaries, low confidence.

### `sm graph`

Render the full graph via the named renderer.

### `sm list`

Tabular listing of nodes. --json emits an array conforming to node.schema.json.

### `sm orphans`

History rows whose target node is missing.

### `sm orphans reconcile`

Migrate history rows from an orphan path to a live node.

### `sm orphans undo-rename`

Reverse a medium- or ambiguous-confidence auto-rename.

### `sm show`

Node detail: weight, frontmatter, links, issues, findings, summary.

## Config

### `sm config get`

Read a single config value.

### `sm config list`

Effective config after layered merge.

### `sm config reset`

Remove user override; revert to default or higher-scope value.

### `sm config set`

Write to user config. Scope-aware: -g writes to the global layer.

### `sm config show`

Reveal config source: default / project / global / env / flag.

## Database

### `sm db backup`

WAL checkpoint + copy the DB file to a backup.

Default output: <db-dir>/backups/<timestamp>.db. Use --out to override. scan_* 
is regenerated on demand and is NOT excluded from the raw file copy, but 
restoring a backup over a live DB is the expected use — running sm scan 
afterwards refreshes scan_*.

### `sm db dump`

SQL dump to stdout.

Read-only. Use --tables <names...> to limit the dump to specific tables.

### `sm db migrate`

Apply pending kernel migrations (default) or inspect plan.

--dry-run   show pending migrations without applying.

--status    print applied vs pending summary and exit.

--to <n>    apply up to (and including) version N.

--no-backup skip the pre-apply backup.

### `sm db reset`

Drop scan_* (default), optionally state_*, or delete the DB entirely.

Without flags: drops scan_* tables only. Non-destructive — no prompt. With 
--state: also drops state_* tables. Destructive — requires confirmation unless 
--yes / --force. With --hard: deletes the DB file entirely. Destructive — 
requires confirmation unless --yes / --force.

### `sm db restore`

Replace the active DB file with a backup.

Destructive. Requires interactive confirmation unless --yes / --force is passed. 
scan_* will be re-populated by the next sm scan.

### `sm db shell`

Open an interactive sqlite3 shell on the DB file.

Spawns the system sqlite3 binary. If sqlite3 is not on PATH, a clear error 
points at the two workarounds: install sqlite3, or use sm db dump for a 
read-only inspection.

## History

### `sm history`

Filter execution records.

### `sm history stats`

Aggregates over state_executions: totals, tokens, periods, top N nodes, error rates.

## Introspection

### `sm help`

Self-describing introspection. --format human|md|json.

Without a verb: overview of every registered command grouped by category. With a 
verb: the detail view for that single command.

Formats:   human (default) — pretty terminal output.   md              — 
canonical markdown. docs/cli-reference.md is                     regenerated 
from this and CI fails on drift.   json            — structured surface dump per 
spec/cli-contract.md.

## Jobs

### `sm job cancel`

Force a running job to failed with reason user-cancelled.

### `sm job claim`

Atomic primitive: return next queued job id, mark it running.

### `sm job list`

List jobs.

### `sm job preview`

Render the job MD file without executing.

### `sm job prune`

Retention GC for completed/failed jobs. --orphan-files removes MD files with no DB row.

### `sm job run`

Full CLI-runner loop: claim + spawn + record.

### `sm job show`

Job detail: state, claim time, TTL, runner, content hash.

### `sm job status`

Counts (per status) or single-job status.

### `sm job submit`

Enqueue a single job or fan out to every matching node (--all).

### `sm record`

Close a running job with success or failure. Nonce is the sole credential.

## Plugins

### `sm plugins disable`

Toggle plugin off. Does not delete the plugin directory.

### `sm plugins doctor`

Run the full load pass and summarise by failure mode.

Exit code 0 when every plugin loads; 1 when any plugin is not loaded.

### `sm plugins enable`

Toggle plugin on. Persists in config_plugins. --all applies to every discovered plugin.

### `sm plugins list`

List discovered plugins and their load status.

Scans <scope>/.skill-map/plugins and ~/.skill-map/plugins (or --plugin-dir 
<path>).

### `sm plugins show`

Show a single plugin's manifest + loaded extensions.

## Scan

### `sm scan`

Scan roots for markdown nodes, run detectors and rules.

Walks the given roots, classifies files as nodes, runs all registered detectors 
and rules, and emits a scan result.

In Step 0b this command returns an empty scan result regardless of input, 
confirming the kernel's boot invariant (zero extensions → empty graph).

**Flags:**

- `--json` `boolean` — Emit a machine-readable ScanResult document on stdout.

**Examples:**

- Scan the current directory
  ```
  sm scan
  ```
- Scan multiple roots and print JSON
  ```
  sm scan ./docs ./skills --json
  ```

## Server

### `sm serve`

Start Hono + WebSocket for the Web UI. Single-port mandate: SPA + REST + WS under one listener.

## Setup

### `sm doctor`

Diagnostic report: DB integrity, pending migrations, orphan rows, plugin status, runner availability.

### `sm init`

Bootstrap the current scope — create .skill-map/, provision DB, first scan.

Creates ./.skill-map/ (project) or ~/.skill-map/ (global, with -g). Provisions 
the database, runs migrations, runs a first scan. Flags: --no-scan skips the 
first scan, --force rewrites existing config.

## Setup & state

### `sm version`

Print the CLI / kernel / spec / runtime / db-schema version matrix.

