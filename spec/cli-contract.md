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
| `1` | Issues found | Command completed, but deterministic issues at `error` severity exist. Applies to `sm scan`, `sm check`, `sm audit run`, `sm doctor`. |
| `2` | Operational error | Bad flags, missing DB, unreadable file, corrupt config, unhandled exception. Accompanied by an error message on stderr. |
| `3` | Duplicate conflict | Job submission refused because an active duplicate exists (same `action + version + node + contentHash`). Returned by `sm job submit`. |
| `4` | Nonce mismatch | `sm record` called with an `id`/`nonce` pair that does not match. |
| `5` | Not found | A named resource does not exist (node id, job id, plugin id, config key). |

Codes 6–15 are reserved. Codes ≥ 16 are free for verb-specific use.

---

## Verb catalog

### Setup & state

#### `sm init`

Bootstrap the current scope.

- Creates `./.skill-map/` (project) or `~/.skill-map/` (global).
- Provisions the database.
- Runs migrations.
- Runs a first scan.

Flags: `--no-scan` (skip the first scan), `--force` (rewrite an existing config).

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
- Orphan job files (count).
- Plugins in error state (list).
- LLM runner availability (`claude` binary on PATH, version).
- Detected platform adapters that matched nothing.

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
| `sm scan --compare-with <path>` | Delta report: compare current state with a saved scan dump. Does not modify the DB. |
| `sm watch [roots...]` | Long-running watcher. Same semantics as `sm scan --watch`, exposed as a top-level verb because the watcher is a loop, not a one-shot scan. |

`--json` output conforms to `schemas/scan-result.schema.json`. `sm watch` (and `sm scan --watch`) emit one ScanResult per batch — under `--json` this is an `ndjson` stream of ScanResult documents.

The watcher subscribes to the same roots that `sm scan` walks and respects `.skill-mapignore` plus `config.ignore` exactly as the one-shot scan does. Filesystem events are grouped using `scan.watch.debounceMs` (default 300ms) before the watcher re-runs the incremental scan and persists. `SIGINT` / `SIGTERM` close the watcher cleanly. Exit code on clean shutdown is 0.

Exit: 0 on clean (or clean watcher shutdown), 1 if error-severity issues exist (one-shot scan only — the watcher does not flip exit code based on per-batch issues), 2 on operational error.

---

### Browse

| Command | Purpose |
|---|---|
| `sm list [--kind <k>] [--issue] [--sort-by ...] [--limit N]` | Tabular listing. `--json` emits an array conforming to `node.schema.json`. |
| `sm show <node.path>` | Node detail: weight (bytes/tokens triple-split), frontmatter, links in/out, issues, findings, summary. `--json` emits a detail object with the raw link rows. Pretty output groups identical-shape links (same endpoint, kind, normalized trigger) onto one line and lists the union of detector ids in a `sources:` field; the section header reports both the raw row count and the unique-after-grouping count, e.g. `Links out (12, 9 unique)`. Storage keeps one row per detector (`scan_links` is unchanged) — the grouping is purely a read-time presentation choice. |
| `sm check` | Print all current issues. Equivalent to `sm scan --json \| jq '.issues'` but faster (reads from DB). |
| `sm findings [--kind ...] [--since ...] [--threshold <n>]` | Probabilistic findings (injection, stale summaries, low confidence). `--json` emits an array of finding objects. |
| `sm graph [--format ascii\|mermaid\|dot]` | Render the full graph via the named renderer. |
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
| `sm job preview <job.id>` | Render the job MD file without executing. |
| `sm job claim [--filter <action>]` | Atomic primitive: return next queued job id, mark it running. Exit 0 with id on stdout; exit 1 if queue empty. |
| `sm job run` | Full CLI-runner loop: claim + spawn + record. Runs one job. |
| `sm job run --all` | Drain the queue (sequential through `v1.0`; in-runner parallelism deferred). |
| `sm job run --max N` | Drain at most N jobs. |
| `sm job status [<job.id>]` | Counts (per status) or single-job status. |
| `sm job cancel <job.id> \| --all` | Force a running job to `failed` state with reason `user-cancelled`. `--all` cancels every `queued` and `running` job. |
| `sm job prune` | Retention GC for completed/failed jobs (per config policy). |
| `sm job prune --orphan-files` | Remove MD files with no matching DB row. |

Submit returns the job id on stdout in pretty mode, or a `Job` object conforming to `job.schema.json` in `--json` mode.

---

### Record (callback)

```
sm record --id <job.id> --nonce <n> --status completed \
         --report <path> \
         --tokens-in N --tokens-out N --duration-ms N \
         --model <name>
```

Closes a running job with success.

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

### Audits

| Command | Purpose |
|---|---|
| `sm audit list` | Registered audits. |
| `sm audit run <id>` | Execute. `--json` emits the audit report per the audit's declared shape. |

Exit: 0 if audit returns "pass"; 1 if audit returns "fail" with at least one error-severity finding; 2 on operational error.

---

### Database

See `db-schema.md` for the table catalog.

| Command | Purpose |
|---|---|
| `sm db reset` | Drop `scan_*` only. Keep `state_*` and `config_*`. Non-destructive — no confirmation required. |
| `sm db reset --state` | Drop `scan_*` AND `state_*` (including `state_plugin_kvs` and every `plugin_<id>_*` table). Keep `config_*`. Destructive. |
| `sm db reset --hard` | Delete the DB file entirely. Keep the plugins folder so the next boot re-discovers them. Destructive. |
| `sm db backup [--out <path>]` | WAL checkpoint + file copy. |
| `sm db restore <path>` | Swap the DB. |
| `sm db shell` | Interactive SQL shell (implementations backed by SQLite use `sqlite3`; others use equivalent). |
| `sm db dump [--tables ...]` | SQL dump. |
| `sm db migrate [--dry-run \| --status \| --to <n> \| --kernel-only \| --plugin <id> \| --no-backup]` | Migration controls. |

Destructive verbs (`reset --state`, `reset --hard`, `restore`) require interactive confirmation unless `--yes` (non-interactive mode for scripts) or `--force` (alias, kept for backward compatibility) is passed. `sm db reset` without a modifier is non-destructive and never prompts.

---

### Server

| Command | Purpose |
|---|---|
| `sm serve [--port N] [--host ...] [--no-open]` | Start Hono + WebSocket for the Web UI. Default port is implementation-defined but MUST be the same across runs. Implementations MUST NOT bind 0.0.0.0 by default. |

---

### Introspection

- `sm help --format json` — structured CLI surface dump.
- `sm help --format md` — canonical markdown, CI-enforced for the reference impl's `context/cli-reference.md`.

These two formats are NORMATIVE: any change to verbs, flags, or exit codes MUST reflect in `--format json` output immediately. Third-party consumers rely on this.

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

**In scope**: any verb that walks the filesystem, hits the DB, spawns a subprocess, or renders a report. Examples: `sm scan`, `sm check`, `sm list`, `sm show`, `sm findings`, `sm history`, `sm history stats`, `sm graph`, `sm export`, `sm audit run`, `sm job submit`, `sm job run`, `sm job claim`, `sm job preview`, `sm record`, `sm doctor`, `sm db backup`, `sm db restore`, `sm db dump`, `sm db migrate`, `sm plugins list`, `sm plugins doctor`, `sm init`.

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
