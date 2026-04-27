# `sm` CLI reference

Generated from `sm help --format md`. Do not hand-edit; CI regenerates this file from the live command surface.

- CLI version: `0.3.3`
- Spec version: `0.6.1`

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

Loads every row from scan_issues. Exits 1 if any issue has severity `error`, 
otherwise 0. `warn` and `info` do not fail.

Run `sm scan` first to populate the DB.

**Examples:**

- Print every current issue
  ```
  sm check
  ```
- Machine-readable issue list
  ```
  sm check --json
  ```

### `sm export`

Filtered export. Query syntax is implementation-defined pre-1.0.

### `sm findings`

Probabilistic findings: injection, stale summaries, low confidence.

### `sm graph`

Render the full graph via the named renderer.

Reads the persisted scan and prints a textual rendering. The built-in `ascii` 
renderer is the only format available at v0.5.0; `mermaid` and `dot` are 
deferred to Step 12 and will surface here automatically once they ship as 
built-ins.

Run `sm scan` first to populate the DB.

**Flags:**

- `--format` `string` — Renderer format. Must match the `format` field of a registered renderer. Default: ascii.

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

Node detail: weight, frontmatter, links, issues, findings, summary.

Loads a single node from the persisted snapshot, plus every link (in and out) 
and every current issue touching it. Findings and summaries are reserved slots 
and remain empty / null until the Step 10 / Step 11 features land.

Run `sm scan` first to populate the DB.

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

### `sm config list`

Print the effective config after layered merge.

Walks defaults → user → user-local → project → project-local and prints the 
merged result. With --json emits the JSON object; otherwise prints flat dot-path 
= value lines (sorted). Exempt from "done in <…>" per spec/cli-contract.md 
§Elapsed time.

### `sm config reset`

Remove a config key from the target file (project default; -g for user).

Strips the key from the target settings.json (lower layers still apply). 
Idempotent — running twice is safe; absent key prints an info note and exits 0.

### `sm config set`

Write a config key. Project file by default; -g writes to user.

Reads the target file (creating it if absent), sets the key at the dot-path, 
validates the result against project-config.schema.json, and writes back. Value 
coercion: JSON-parses the raw string first ("true" → true, "42" → 42, "null" → 
null, arrays / objects natural); unparseable falls through as string. Schema 
violation → exit 2, no write performed.

### `sm config show`

Show a config value with the layer that set it (--source).

Identical to "sm config get" plus optional --source which prefixes the layer 
(defaults / user / user-local / project / project-local / override). With --json 
emits { value, source } when --source is set. Exempt from "done in <…>".

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

Filter execution records. --json emits an array conforming to execution-record.schema.json.

Reads from state_executions. Filters:   -n <path>          restrict to 
executions whose nodeIds[] contains <path>

  --action <id>      restrict to a specific extension (action / audit) id

  --status <s,...>   restrict to one or more of completed,failed,cancelled

  --since <ISO>      lower bound on startedAt (inclusive, ISO-8601)

  --until <ISO>      upper bound on startedAt (exclusive, ISO-8601)

  --limit N          cap result count

Output is most-recent-first. Run `sm scan` first to provision the DB.

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

### `sm help`

Self-describing introspection. --format human|md|json.

Without a verb: overview of every registered command grouped by category. With a 
verb: the detail view for that single command.

Formats:   human (default) — pretty terminal output.   md              — 
canonical markdown. context/cli-reference.md is                     regenerated 
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

Retention GC for completed / failed jobs (per config policy). --orphan-files removes MD files with no DB row.

Reads jobs.retention.completed and jobs.retention.failed from the layered 
config. For each non-null policy, deletes terminal jobs whose finishedAt is 
older than the cutoff and unlinks their MD files in .skill-map/jobs/.

With --orphan-files: ALSO scans .skill-map/jobs/ for MD files not referenced by 
any state_jobs row and deletes them. Both passes run; orphans are scanned AFTER 
retention so freshly-pruned files don't double-count.

With --dry-run: counts and reports what would happen without touching the DB or 
the FS.

Exits 0 on success, 2 on operational failure (missing DB, malformed config, IO 
error).

**Flags:**

- `--orphan-files` `boolean` — Also remove MD files in .skill-map/jobs/ that have no matching state_jobs row.
- `--dry-run`, `-n` `boolean` — Report what would be pruned without touching the DB or filesystem.
- `--json` `boolean` — Emit a structured prune-result document on stdout.

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

Disable a plugin (or --all). Persists in config_plugins; does not delete files.

Writes a row to config_plugins with enabled=0. Discovery still surfaces the 
plugin in sm plugins list, but with status=disabled — its extensions are not 
imported and the kernel will not run them.

### `sm plugins doctor`

Run the full load pass and summarise by failure mode.

Exit code 0 when every plugin loads or is intentionally disabled; 1 when any 
plugin is in an error / incompat state.

### `sm plugins enable`

Enable a plugin (or --all). Persists in config_plugins.

Writes a row to config_plugins with enabled=1. Takes precedence over the 
team-shared baseline at settings.json#/plugins/<id>/enabled. Use sm plugins 
disable to flip; sm config reset plugins.<id>.enabled drops the settings.json 
baseline.

### `sm plugins list`

List discovered plugins and their load status.

Scans <scope>/.skill-map/plugins and ~/.skill-map/plugins (or --plugin-dir 
<path>).

### `sm plugins show`

Show a single plugin's manifest + loaded extensions.

## Scan

### `sm scan`

Scan roots for markdown nodes, run detectors and rules.

Walks the given roots with the built-in claude adapter, runs the frontmatter / 
slash / at-directive / external-url-counter detectors per node, then the 
trigger-collision / broken-ref / superseded rules over the full graph. Emits a 
ScanResult conforming to scan-result.schema.json.

The result is persisted into <cwd>/.skill-map/skill-map.db (replace-all over 
scan_nodes/links/issues). Pass --no-built-ins to skip both the pipeline and the 
persistence step (kernel-empty-boot parity).

Pass -n / --dry-run to skip every DB operation (the result is computed in memory 
and emitted to stdout). Pass --changed to load the prior snapshot from the DB, 
reuse unchanged nodes, and only reprocess new / modified files.

**Flags:**

- `--json` `boolean` — Emit a machine-readable ScanResult document on stdout.
- `--no-built-ins` `boolean` — Skip the built-in extension set. Yields a zero-filled ScanResult (kernel-empty-boot parity); skips DB persistence.
- `--no-tokens` `boolean` — Skip per-node token counts (cl100k_base BPE). Leaves node.tokens undefined; spec-valid since the field is optional.
- `--dry-run`, `-n` `boolean` — Run the scan in memory and skip every DB write. Combined with --changed, still opens the DB read-side to load the prior snapshot.
- `--changed` `boolean` — Incremental scan: reuse unchanged nodes from the persisted prior snapshot. Degrades to a full scan if no prior snapshot exists.
- `--allow-empty` `boolean` — Allow a zero-result scan to wipe an already-populated DB (replace-all replace by zero rows). Off by default to avoid the typo-trap where an invalid root silently clears your data.
- `--strict` `boolean` — Promote frontmatter-validation findings from warn to error (exit code 1 on any violation). Overrides scan.strict from config when both are set.
- `--watch` `boolean` — Long-running mode: watch the roots and trigger an incremental scan after each debounced batch of filesystem events. Alias of `sm watch`.
- `--compare-with` `string` — Run a fresh scan in memory and emit a delta against the saved ScanResult dump at <path>. Does NOT touch the DB. Exit 0 on empty delta, 1 if anything diverges, 2 on dump load / validation errors.

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

### `sm watch`

Watch roots and run an incremental scan after each debounced batch of filesystem events.

Long-running version of 'sm scan --changed'. Subscribes to the given roots via 
chokidar, applies the same ignore chain (.skill-mapignore + config.ignore + 
bundled defaults), and triggers an incremental scan after each debounced batch.

Default debounce is 300ms; configure via 'scan.watch.debounceMs' in 
.skill-map/settings.json. SIGINT / SIGTERM stop the watcher cleanly and exit 0.

Under --json, every batch emits one ScanResult as ndjson on stdout. Without 
--json, every batch prints one summary line.

'sm scan --watch' is an alias and shares the same flag surface.

**Flags:**

- `--json` `boolean` — Emit one ScanResult document per batch as ndjson on stdout.
- `--no-tokens` `boolean` — Skip per-node token counts (cl100k_base BPE).
- `--strict` `boolean` — Promote frontmatter-validation findings from warn to error inside each batch. Does not change the watcher exit code.

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

## Server

### `sm serve`

Start Hono + WebSocket for the Web UI. Single-port mandate: SPA + REST + WS under one listener.

## Setup

### `sm doctor`

Diagnostic report: DB integrity, pending migrations, orphan rows, plugin status, runner availability.

### `sm init`

Bootstrap the current scope: scaffold .skill-map/, provision DB, run first scan.

Project scope (default): creates ./.skill-map/ with settings.json, 
settings.local.json, and skill-map.db. Drops a starter .skill-mapignore at the 
scope root and appends the DB + local settings to .gitignore.

Global scope (-g): same scaffolding under ~/.skill-map/. No .gitignore is 
touched; "$HOME" isn't a repo.

Re-running over an existing scope errors with exit 2 unless --force is passed. 
--no-scan skips the first scan; useful in CI

where the operator wants to provision before populating roots.

**Flags:**

- `--global`, `-g` `boolean` — Initialise ~/.skill-map/ instead of ./.skill-map/.
- `--no-scan` `boolean` — Skip the first scan after scaffolding.
- `--force` `boolean` — Overwrite an existing settings.json / settings.local.json / .skill-mapignore.
- `--strict` `boolean` — Strict mode: fail on any layered-loader warning AND promote frontmatter warnings to errors during the first scan. Same flag as sm scan / sm config.

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

## Setup & state

### `sm version`

Print the CLI / kernel / spec / runtime / db-schema version matrix.

