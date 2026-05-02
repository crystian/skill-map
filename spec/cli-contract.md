# CLI contract

Normative description of the `sm` CLI surface: verbs, flags, exit codes, machine-readable output. Any conforming implementation MUST expose a CLI binary that satisfies this contract. The binary name (`sm`) and long alias (`skill-map`) are normative.

---

## Binary

- Primary: `sm`.
- Long alias: `skill-map`. MUST resolve to the same binary. A symlink, shim, or alias in `bin` field of `package.json` is acceptable.
- Help invocation: `sm`, `sm --help`, `sm -h` MUST all print top-level help and exit with code 0.

---

## Global flags

These flags apply to every verb unless marked otherwise.

| Flag | Shape | Purpose |
|---|---|---|
| `-g` / `--global` | boolean | Operate on the global scope (`~/.skill-map/`) instead of project scope (`./.skill-map/`). |
| `--json` | boolean | Emit machine-readable output on stdout. Suppresses pretty printing. Human progress goes to stderr. |
| `-v` / `--verbose` | count | Increase log level (`-v` = info, `-vv` = debug, `-vvv` = trace). Logs to stderr. |
| `-q` / `--quiet` | boolean | Suppress all non-error stderr output. Does not affect stdout. |
| `--no-color` | boolean | Disable ANSI color codes. Implementations MUST also auto-disable color when stdout is not a TTY. |
| `-h` / `--help` | boolean | Print verb-specific or top-level help, exit 0. |
| `--db <path>` | string | Override the database file location (escape hatch; primarily for debugging). |

Env-var equivalents are normative:

| Env var | Equivalent flag |
|---|---|
| `SKILL_MAP_SCOPE=global` | `-g` |
| `SKILL_MAP_JSON=1` | `--json` |
| `NO_COLOR=1` | `--no-color` (also honored per the NO_COLOR standard) |
| `SKILL_MAP_DB=<path>` | `--db <path>` |

CLI flag wins over env var. Env var wins over config file.

---

## Targeted fan-out flags

`--all` is not global. It is only valid on verbs whose contract explicitly lists it:

- `sm job submit <action> --all`
- `sm job run --all`
- `sm job cancel --all`
- `sm plugins enable --all`
- `sm plugins disable --all`

For those verbs, `--all` means "apply to every eligible target matching the verb's preconditions" and is mutually exclusive with a positional target or `-n <path>` on the same invocation.

Implementations MUST NOT silently accept `--all` on unrelated verbs. Unsupported `--all` usage is an operational error (exit `2`), the same as any other unknown or invalid flag.

---

## Exit codes

All verbs use this shared table. Additional codes MAY be defined per-verb (documented under the verb).

| Code | Meaning | When emitted |
|---|---|---|
| `0` | OK | Command completed, no issues at or above the configured severity threshold. |
| `1` | Issues found | Command completed, but deterministic issues at `error` severity exist. Applies to `sm scan`, `sm check`, `sm doctor`. |
| `2` | Operational error | Bad flags, missing DB, unreadable file, corrupt config, runtime / environment mismatch (e.g. wrong Node version, missing native dependency), unhandled exception. Accompanied by an error message on stderr. |
| `3` | Duplicate conflict | Job submission refused because an active duplicate exists (same `action + version + node + contentHash`). Returned by `sm job submit`. |
| `4` | Nonce mismatch | `sm record` called with an `id`/`nonce` pair that does not match. |
| `5` | Not found | A named resource does not exist (node id, job id, plugin id, config key). |

Codes 6–15 are reserved. Codes ≥ 16 are free for verb-specific use.

---

## Dry-run

A verb that exposes `-n` / `--dry-run` MUST honour the following contract:

- **No observable side effects.** The command MUST NOT mutate the database, the filesystem, the config, the network, or spawn external processes. Read-only operations needed to compute the preview (e.g. loading the prior `ScanResult`, reading existing config files, listing FS entries) ARE permitted.
- **No auto-provisioning.** A dry-run MUST NOT create directories, schema files, or DBs that would not exist after the command. If the operation would create a `.skill-map/` scope, dry-run only previews the creation; the directory must NOT appear on disk.
- **Output mirrors the live mode** — same shape, same fields, same `--json` schema — except that human-readable output explicitly indicates the dry-run state ("would persist …", "would create …", "would delete …", or a clear "(dry-run)" suffix) and machine-readable output sets a top-level `dryRun: true` field where applicable.
- **Exit codes mirror the live mode.** Same exit code table; the dry-run posture does not introduce new codes. A dry-run that surfaces an error severity (e.g. "scan would emit an error-severity issue") still exits `1`; a dry-run that fails to read the input still exits `2`.
- **Dry-run MUST NOT depend on `--yes` / `--force`.** Verbs that offer interactive confirmation for destructive operations MUST allow `--dry-run` to bypass the prompt entirely (no confirmation needed when nothing is being destroyed).

Dry-run is **per-verb opt-in**. The flag is not global; verbs that do not declare it MUST reject `--dry-run` as an unknown option (exit `2`), the same as any other unknown flag. The verb catalog below names every verb that exposes the flag and what its preview looks like.

---

## Verb catalog

### Setup & state

#### `sm init`

Bootstrap the current scope.

- Creates `./.skill-map/` (project) or `~/.skill-map/` (global).
- Provisions the database.
- Runs migrations.
- Runs a first scan.

Flags: `--no-scan` (skip the first scan), `--force` (rewrite an existing config), `-n` / `--dry-run` (preview the scope provisioning — would-create lines for every directory and file the live invocation would write — without touching the filesystem; respects `--force` for the "would-overwrite" preview).

Exit: 0 on success, 2 on failure.

#### `sm version`

Prints version matrix:

```
sm           <cli version>
kernel       <kernel version>
spec         <spec version implemented>
db-schema    <applied migration version>
```

`--json` emits `{ sm, kernel, spec, dbSchema }`.

#### `sm doctor`

Diagnostic report:

- DB file integrity (PRAGMA quick_check equivalent).
- Pending migrations (count + list).
- Orphan history rows (count).
- `state_jobs` rows whose `content_hash` is missing from `state_job_contents` (corrupt-state count).
- `state_job_contents` GC stragglers (count of rows referenced by zero `state_jobs` rows; `sm job prune` collects these).
- Plugins in error state (list).
- LLM runner availability (`claude` binary on PATH, version).
- Detected Providers that matched nothing, or whose `explorationDir` does not exist on disk (non-blocking warning).

Exit: 0 if all green, 1 if warnings, 2 if any `error`-level problem.

#### `sm help [<verb>] [--format human|md|json]`

Self-describing introspection.

- `human` (default): pretty terminal output.
- `md`: canonical markdown for documentation sites. Implementations MUST NOT hand-maintain equivalent markdown; `context/cli-reference.md` (in the reference impl) is regenerated from this output in CI.
- `json`: structured surface dump. Shape:

```json
{
  "cliVersion": "0.1.0",
  "specVersion": "0.1.0",
  "globalFlags": [ { "name": "--json", "type": "boolean", "description": "..." } ],
  "verbs": [ {
    "name": "scan",
    "description": "...",
    "flags": [ ... ],
    "subcommands": [ ... ],
    "exitCodes": [ 0, 1, 2 ]
  } ]
}
```

Consumers: docs generator, shell completion, Web UI form generation, IDE extensions, test harness, agent-skill integrations (`sm-cli` skill).

---

### Config

| Command | Purpose |
|---|---|
| `sm config list` | Effective config after layered merge. |
| `sm config get <key>` | Single value. |
| `sm config set <key> <value>` | Write to user config (scope-aware: `-g` writes to global). |
| `sm config reset <key>` | Remove user override; revert to default or higher-scope value. |
| `sm config show <key> --source` | Reveals origin: `default` / `project` / `global` / `env` / `flag`. |

Config precedence (lowest → highest): library defaults → user config → env vars → CLI flags.

Keys are dot-paths (`jobs.minimumTtlSeconds`, `scan.tokenize`). Unknown keys → exit 5.

---

### Scan

| Command | Purpose |
|---|---|
| `sm scan` | Full scan. Truncates `scan_*` and repopulates. |
| `sm scan -n <node.path>` | Partial scan: one node. |
| `sm scan --changed` | Incremental: only files changed since last scan (mtime heuristic). |
| `sm scan --watch` | Long-running: watch the roots and trigger an incremental scan after each debounced batch of filesystem events. Alias of `sm watch`. |
| `sm scan compare-with <dump> [roots...]` | Delta report: run a fresh scan in memory and compare against the saved `ScanResult` dump at `<dump>`. Read-only — does not modify the DB. Exit `0` on empty delta, `1` on any drift, `2` on operational error (missing or malformed dump, schema violation). |
| `sm watch [roots...]` | Long-running watcher. Same semantics as `sm scan --watch`, exposed as a top-level verb because the watcher is a loop, not a one-shot scan. |
| `sm refresh <node.path>` | Re-run Extractors against a single node and upsert their outputs into the universal enrichment layer (`node_enrichments`, see [`db-schema.md`](./db-schema.md#node_enrichments)). Stub state until the job subsystem ships at Step 10: deterministic Extractors run for real and persist; probabilistic Extractors emit a stderr advisory and skip without touching their stale rows. Exit `0` on success (with possible stub advisory), `2` on failure, `5` if the node is not in the persisted scan. |
| `sm refresh --stale` | Batch form of `sm refresh <node>` — refreshes every node carrying at least one stale probabilistic enrichment row. Same stub caveat: deterministic Extractors persist; probabilistic Extractors skip with a stderr advisory. Exit `0` (including when the stale set is empty — prints a "nothing to do" advisory). |

`--json` output conforms to `schemas/scan-result.schema.json`. `sm watch` (and `sm scan --watch`) emit one ScanResult per batch — under `--json` this is an `ndjson` stream of ScanResult documents.

The watcher subscribes to the same roots that `sm scan` walks and respects `.skill-mapignore` plus `config.ignore` exactly as the one-shot scan does. Filesystem events are grouped using `scan.watch.debounceMs` (default 300ms) before the watcher re-runs the incremental scan and persists. `SIGINT` / `SIGTERM` close the watcher cleanly. Exit code on clean shutdown is 0.

Exit: 0 on clean (or clean watcher shutdown), 1 if error-severity issues exist (one-shot scan only — the watcher does not flip exit code based on per-batch issues), 2 on operational error.

---

### Browse

| Command | Purpose |
|---|---|
| `sm list [--kind <k>] [--issue] [--sort-by ...] [--limit N]` | Tabular listing. `--json` emits an array conforming to `node.schema.json`. |
| `sm show <node.path>` | Node detail: weight (bytes/tokens triple-split), frontmatter, links in/out, issues, findings, summary. `--json` emits a detail object with the raw link rows. Pretty output groups identical-shape links (same endpoint, kind, normalized trigger) onto one line and lists the union of extractor ids in a `sources:` field; the section header reports both the raw row count and the unique-after-grouping count, e.g. `Links out (12, 9 unique)`. Storage keeps one row per extractor (`scan_links` is unchanged) — the grouping is purely a read-time presentation choice. |
| `sm check [-n <node.path>] [--rules <ids>] [--include-prob] [--async]` | Print all current issues. Equivalent to `sm scan --json \| jq '.issues'` but faster (reads from DB). `-n` restricts to issues whose `nodeIds` include the path; `--rules <ids>` accepts a comma-separated list of qualified or short rule ids and restricts the issue read accordingly. Default behaviour is deterministic-only (CI-safe, status quo). `--include-prob` is the opt-in flag for probabilistic Rule dispatch (spec § A.7): the verb loads the plugin runtime, finds Rules with `mode === 'probabilistic'` (filtered by `--rules` if set), and emits a stderr advisory naming the rule ids. Full prob dispatch requires the job subsystem (Step 10); until then `--include-prob` is a stub — prob rules never produce issues, never alter the exit code, and `--async` (reserved companion: returns job ids without waiting once jobs land) is a no-op the advisory simply mentions. The flag does NOT extend to `sm scan` or `sm list`. |
| `sm findings [--kind ...] [--since ...] [--threshold <n>]` | Probabilistic findings (injection, stale summaries, low confidence). `--json` emits an array of finding objects. |
| `sm graph [--format ascii\|mermaid\|dot]` | Render the full graph via the named formatter. |
| `sm export <query> --format json\|md\|mermaid` | Filtered export. Query syntax is implementation-defined pre-1.0. |
| `sm orphans` | History rows whose target node is missing. |
| `sm orphans reconcile <orphan.path> --to <new.path>` | Migrate history rows from the old path to the new one after a rename. Use case: the scan's rename heuristic missed a match (semantic-only rename, body rewrite) and the user wants to stitch history manually. |
| `sm orphans undo-rename <new.path> [--from <old.path>] [--force]` | Reverse a medium- or ambiguous-confidence auto-rename. Requires an active `auto-rename-medium` or `auto-rename-ambiguous` issue on `<new.path>`. For `auto-rename-medium`, omit `--from` — the previous path is read from `issue.data_json`. For `auto-rename-ambiguous`, `--from <old.path>` is REQUIRED to pick one of the candidates listed in `data_json.candidates`. Migrates `state_*` FKs back and resolves the issue; the previous path becomes an `orphan` (its file no longer exists in FS). Destructive; prompts for confirmation unless `--force`. Exit `5` if no active auto-rename issue targets `<new.path>`, or if `--from` references a path not in `data_json.candidates`. |

---

### Actions

| Command | Purpose |
|---|---|
| `sm actions list` | Registered action types (manifest view). |
| `sm actions show <id>` | Full manifest, including declared `preconditions`, `expectedDurationSeconds`, report schema ref. |

Actions are not invoked via `sm actions`; invocation is via `sm job submit` (see below).

---

### Jobs

See `job-lifecycle.md` for the state machine; this table is the CLI surface.

| Command | Purpose |
|---|---|
| `sm job submit <action> -n <node.path>` | Enqueue a single job. |
| `sm job submit <action> -n <node.path> --run` | Enqueue + spawn subprocess runner immediately. |
| `sm job submit <action> --all` | Fan out to every node matching the action's preconditions. |
| `sm job submit ... --force` | Bypass duplicate detection. |
| `sm job submit ... --ttl <seconds>` | Override computed TTL. |
| `sm job submit ... --priority <n>` | Override job priority. Integer; higher runs first. Default `0`. Negative allowed (deprioritize). Frozen on `state_jobs.priority` at submit time. |
| `sm job list [--status ...] [--action ...] [--node ...]` | List jobs. |
| `sm job show <job.id>` | Detail: current state, claim timestamp, TTL remaining, runner, content hash. |
| `sm job preview <job.id>` | Print the rendered MD content of the job without executing. Reads from `state_job_contents`; there is no on-disk artifact. |
| `sm job claim [--filter <action>]` | Atomic primitive: return next queued job id, mark it running. Exit 0 with id on stdout; exit 1 if queue empty. `--json` returns `{id, nonce, content}` — drivers that intend to call `sm record` afterwards MUST use the `--json` form to receive the nonce. |
| `sm job run` | Full CLI-runner loop: claim + spawn + record. Runs one job. |
| `sm job run --all` | Drain the queue (sequential through `v1.0`; in-runner parallelism deferred). |
| `sm job run --max N` | Drain at most N jobs. |
| `sm job status [<job.id>]` | Counts (per status) or single-job status. |
| `sm job cancel <job.id> \| --all` | Force a running job to `failed` state with reason `user-cancelled`. `--all` cancels every `queued` and `running` job. |
| `sm job prune` | Retention GC: deletes terminal jobs past the configured retention window AND collects orphaned `state_job_contents` rows in the same transaction. |

Submit returns the job id on stdout in pretty mode, or a `Job` object conforming to `job.schema.json` in `--json` mode.

---

### Record (callback)

```
sm record --id <job.id> --nonce <n> --status completed \
         --report <path-or-dash> \
         --tokens-in N --tokens-out N --duration-ms N \
         --model <name>
```

Closes a running job with success. `--report` accepts either a filesystem path the kernel reads, or `-` to read the JSON payload from stdin. The kernel stores the parsed JSON inline on `state_executions.report_json`; the path / stdin source is ingestion-only and not retained.

```
sm record --id <job.id> --nonce <n> --status failed --error "..."
```

Closes a running job with failure. The `--error` value is stored verbatim in the execution record.

Exit: 0 on success; 4 on nonce mismatch; 5 if job id is not `running`; 2 otherwise.

Authentication: the nonce is the sole credential. An implementation MUST reject a mismatched or absent nonce.

---

### History

| Command | Purpose |
|---|---|
| `sm history [-n <node.path>] [--action <id>] [--status ...] [--since <date>] [--until <date>]` | Filter execution records. `--json` emits an array of `execution-record.schema.json` objects. |
| `sm history stats [--since <date>] [--until <date>] [--period day\|week\|month] [--top N]` | Aggregates over `state_executions` in the window. `--json` emits a document conforming to `history-stats.schema.json`: totals, tokens per action, executions per period (granularity from `--period`, default `month`), top N nodes by frequency (default 10), error rates (global + per-action + per failure reason). |

---

### Plugins

| Command | Purpose |
|---|---|
| `sm plugins list` | Auto-discovered plugins with status. `--json` emits an array of `DiscoveredPlugin`. |
| `sm plugins show <id>` | Full manifest + compat detail. |
| `sm plugins enable <id> \| --all` | Toggle on. Persists in `config_plugins`. `--all` applies to every discovered plugin. |
| `sm plugins disable <id> \| --all` | Toggle off; does not delete the plugin directory. `--all` applies to every discovered plugin. |
| `sm plugins doctor` | Revalidate all plugins against current spec version; update `status` fields. |

---

### Database

See `db-schema.md` for the table catalog.

| Command | Purpose |
|---|---|
| `sm db reset [-n / --dry-run]` | Drop `scan_*` only. Keep `state_*` and `config_*`. Non-destructive — no confirmation required. `--dry-run` prints the row counts that would be deleted per `scan_*` table without touching the DB. |
| `sm db reset --state [-n / --dry-run]` | Drop `scan_*` AND `state_*` (including `state_plugin_kvs` and every `plugin_<id>_*` table). Keep `config_*`. Destructive. `--dry-run` previews the deletion without touching the DB. |
| `sm db reset --hard [-n / --dry-run]` | Delete the DB file entirely. Keep the plugins folder so the next boot re-discovers them. Destructive. `--dry-run` reports the file path and size that would be deleted without unlinking it. |
| `sm db backup [--out <path>]` | WAL checkpoint + file copy. |
| `sm db restore <path> [-n / --dry-run]` | Swap the DB. Destructive. `--dry-run` validates the source file (existence, header, schema version) and reports what would be overwritten without touching the live DB. |
| `sm db shell` | Interactive SQL shell (implementations backed by SQLite use `sqlite3`; others use equivalent). |
| `sm db dump [--tables ...]` | SQL dump. |
| `sm db migrate [--dry-run \| --status \| --to <n> \| --kernel-only \| --plugin <id> \| --no-backup]` | Migration controls. |

Destructive verbs (`reset --state`, `reset --hard`, `restore`) require interactive confirmation unless `--yes` (non-interactive mode for scripts) or `--force` (alias, kept for backward compatibility) is passed. `sm db reset` without a modifier is non-destructive and never prompts. **`--dry-run` short-circuits the confirmation prompt entirely** (per §Dry-run rule: dry-run MUST NOT depend on `--yes` / `--force`).

---

### Server

| Command | Purpose |
|---|---|
| `sm serve [--port N] [--host ...] [--scope project\|global] [--db <path>] [--no-built-ins] [--no-plugins] [--open\|--no-open] [--dev-cors] [--ui-dist <path>]` | Start Hono + WebSocket for the Web UI. Single-port mandate: SPA + REST + WS under one listener. Default port 4242, default host 127.0.0.1 (loopback-only through v0.6.0; multi-host deferred — see §Server). |

#### Server

*(Stability: experimental — locks at v0.6.0.)*

The reference implementation ships a Hono BFF rooted at `src/server/`. One Node process serves the Angular SPA, the REST API under `/api/*`, and the WebSocket at `/ws` — single-port mandate, no proxy. Loopback-only assumption through v0.6.0: no per-connection auth on `/ws`; combining `--dev-cors` with a non-loopback `--host` is rejected (exit 2).

**Boot resilience**: `sm serve` boots even when the project DB is missing. `/api/health` reports `db: 'missing'` so the SPA can render an empty-state CTA instead of failing the connection. Explicit `--db <path>` that doesn't exist is the exception — that exits 5 (NotFound) per `§Exit codes`.

**Endpoints (v14.1 surface)**:

| Path | Status | Shape |
|---|---|---|
| `GET /api/health` | implemented | `{ ok: true, schemaVersion, specVersion, implVersion, scope: 'project'\|'global', db: 'present'\|'missing' }` |
| `ALL /api/*` (other) | reserved | structured 404 envelope (see below); real endpoints land at v14.2 |
| `GET /ws` | upgrade-only | accepts WebSocket upgrade and immediately closes; broadcaster lands at v14.4 |
| `GET *` | implemented | static asset from the resolved UI bundle, falling back to `index.html` for SPA deep links |

**Error envelope** (mirrors `§Machine-readable output rules`):

```json
{
  "ok": false,
  "error": {
    "code": "not-found" | "bad-query" | "db-missing" | "internal",
    "message": "<human-readable>",
    "details": { ... } | null
  }
}
```

HTTP status mapping: `400` → `bad-query`, `404` → `not-found`, `500` → `internal` / `db-missing`.

**Flag surface**:

| Flag | Default | Purpose |
|---|---|---|
| `--port N` | `4242` | Listening port. `0` = OS-assigned (handle reports the bound port). |
| `--host <ip>` | `127.0.0.1` | Listening host. Implementations MUST NOT bind `0.0.0.0` by default. |
| `--scope project\|global` | `project` | Effective scope for `/api/*` reads. Alias for `-g/--global`. |
| `--db <path>` | resolved per spec § Global flags | Override the DB file location. Missing explicit `--db` exits 5. |
| `--no-built-ins` | off | Skip built-in plugin registration (parity with `sm scan --no-built-ins`). |
| `--no-plugins` | off | Skip drop-in plugin discovery. |
| `--open` / `--no-open` | `--open` | Auto-open the SPA in the user's default browser after listen. |
| `--dev-cors` | off | Enable permissive CORS for the Angular dev-server proxy workflow. Loopback-only when set. |
| `--ui-dist <path>` | auto | Override the UI bundle directory. Hidden flag — used by the demo build pipeline + tests; everyday users never need it. |

**Graceful shutdown**: SIGINT / SIGTERM trigger a graceful close; the verb returns exit 0 on clean shutdown. Bind failure (port in use, EACCES) returns exit 2.

---

### Introspection

- `sm help --format json` — structured CLI surface dump.
- `sm help --format md` — canonical markdown, CI-enforced for the reference impl's `context/cli-reference.md`.

These two formats are NORMATIVE: any change to verbs, flags, or exit codes MUST reflect in `--format json` output immediately. Third-party consumers rely on this.

### Conformance

| Command | Purpose |
|---|---|
| `sm conformance run [--scope spec\|provider:<id>\|all]` | Run the conformance suite. `--scope spec` runs only the kernel-agnostic cases bundled with `@skill-map/spec` (default fixture: `preamble-v1.txt`, case: `kernel-empty-boot`). `--scope provider:<id>` runs only the named built-in Provider's suite (today: `provider:claude`). `--scope all` (default) runs every visible scope in registry order. Exit 0 on a clean sweep; exit 1 if any case failed; exit 2 on a configuration error (unknown scope, missing binary). |

Per-Provider conformance suites live next to the Provider's manifest under `<plugin-dir>/conformance/{cases,fixtures}/`. The verb discovers them by walking the built-in Provider directory (and, post-job-subsystem, the plugin loader's discovery output). External consumers — alt-impl authors, Provider authors validating their own work — drive the same suite via this verb without reaching into bespoke scripts.

---

## Machine-readable output rules

When `--json` is set:

1. Stdout contains ONLY the JSON document (or ndjson lines, for streaming verbs like `sm job run`).
2. Stderr carries logs, progress, and errors.
3. Non-zero exit codes still apply; consumers MUST NOT infer success from the presence of stdout.
4. Error payloads on stdout (when the verb emits structured errors) conform to:

   ```json
   {
     "ok": false,
     "error": {
       "code": "<short-code>",
       "message": "<human-readable>",
       "details": { ... }
     }
   }
   ```

5. Streaming verbs MUST flush after each line (ndjson).

---

## Elapsed time

Every verb that does non-trivial work MUST report its own wall-clock duration. Coverage is broad on purpose — operators and agents need to notice regressions without instrumenting the host.

### Scope

**In scope**: any verb that walks the filesystem, hits the DB, spawns a subprocess, or renders a report. Examples: `sm scan`, `sm check`, `sm list`, `sm show`, `sm findings`, `sm history`, `sm history stats`, `sm graph`, `sm export`, `sm job submit`, `sm job run`, `sm job claim`, `sm job preview`, `sm record`, `sm doctor`, `sm db backup`, `sm db restore`, `sm db dump`, `sm db migrate`, `sm plugins list`, `sm plugins doctor`, `sm init`, `sm conformance run`.

**Exempt**: informational verbs that return in well under a millisecond and would clutter the output — `sm --version`, `sm --help`, `sm version`, `sm help`, `sm config get`, `sm config list`, `sm config show`.

### Pretty output (TTY)

The last line written to stderr MUST be `done in <formatted>` where `<formatted>` is:

- `< 1000ms` → `<N>ms` (integer, no decimals).
- `≥ 1s` and `< 60s` → `<N.N>s` (one decimal).
- `≥ 60s` → `<M>m <S>s` (integer minutes + integer seconds).

Examples: `done in 34ms`, `done in 2.4s`, `done in 1m 42s`.

The line is suppressed by `--quiet`. It goes to stderr so it never pollutes stdout, including in `--json` mode.

### JSON output (`--json`)

When the verb's `--json` output is a top-level **object**, the schema includes an `elapsedMs` top-level field (integer, milliseconds). Stdout then carries the timing inside the document. Stderr still emits the `done in …` line unless `--quiet`.

When the verb's `--json` output is a top-level **array** or an **ndjson stream**, the schema does NOT include `elapsedMs` (there is no object to attach it to). Stderr is the sole carrier of the timing line.

Schemas that already express the command's wall-clock under a nested field (e.g. `scan-result.schema.json` → `stats.durationMs`) MUST treat that field as the elapsed time of the scan command itself. Adding a top-level `elapsedMs` to those schemas for redundancy is a minor bump and MAY happen later for consistency; until then, consumers read the nested field.

### Implementations

Implementations MUST measure from the moment the verb starts its own work (after Clipanion / arg-parsing overhead) to the moment before writing the terminal output. Sub-millisecond verbs exempt per §Scope MAY skip the measurement entirely.

### Stability

The `done in …` stderr line, its format grammar, and the `elapsedMs` field contract are **stable** as of spec v1.0.0. Changing the grammar, the time units, or the location (stderr ↔ stdout) is a major bump. Adding `elapsedMs` to a schema that previously omitted it is a minor bump.

---

## See also

- [`architecture.md`](./architecture.md) — CLI as a driving adapter; kernel-first design; dependency rules.
- [`job-lifecycle.md`](./job-lifecycle.md) — state machine behind `sm job` verbs.
- [`job-events.md`](./job-events.md) — event stream emitted via `--json` and `--stream-output`.
- [`db-schema.md`](./db-schema.md) — tables behind `sm db` verbs.
- [`../context/cli-reference.md`](../context/cli-reference.md) — auto-generated reference from `sm help --format md`.
- [`conformance/`](./conformance/README.md) — test suite exercising CLI behavior.

---

## Stability

The **verb list** is stable as of spec v1.0.0. Adding a verb is a minor bump. Removing a verb is a major bump.

**Adding** a flag is a minor bump. Changing a flag's type or removing a flag is a major bump. Changing a flag's default is a major bump.

**Exit codes 0–5** are stable. Redefining any of these meanings is a major bump. Adding codes in the reserved range (6–15) is a minor bump.

`--json` output shapes conform to the schemas under `schemas/`. Shape changes follow schema versioning (see `versioning.md`).
