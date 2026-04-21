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
- `md`: canonical markdown for documentation sites. Implementations MUST NOT hand-maintain equivalent markdown; `docs/cli-reference.md` (in the reference impl) is regenerated from this output in CI.
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
| `sm scan --compare-with <path>` | Delta report: compare current state with a saved scan dump. Does not modify the DB. |

`--json` output conforms to `schemas/scan-result.schema.json`.

Exit: 0 on clean, 1 if error-severity issues exist, 2 on operational error.

---

### Browse

| Command | Purpose |
|---|---|
| `sm list [--kind <k>] [--issue] [--sort-by ...] [--limit N]` | Tabular listing. `--json` emits an array conforming to `node.schema.json`. |
| `sm show <node.path>` | Node detail: weight (bytes/tokens triple-split), frontmatter, links in/out, issues, findings, summary. `--json` emits a detail object. |
| `sm check` | Print all current issues. Equivalent to `sm scan --json \| jq '.issues'` but faster (reads from DB). |
| `sm findings [--kind ...] [--since ...] [--threshold <n>]` | Probabilistic findings (injection, stale summaries, low confidence). `--json` emits an array of finding objects. |
| `sm graph [--format ascii\|mermaid\|dot]` | Render the full graph via the named renderer. |
| `sm export <query> --format json\|md\|mermaid` | Filtered export. Query syntax is implementation-defined pre-1.0. |
| `sm orphans` | History rows whose target node is missing. |
| `sm orphans reconcile <orphan.path> --to <new.path>` | Migrate history rows from the old path to the new one after a rename. |

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
| `sm job list [--status ...] [--action ...] [--node ...]` | List jobs. |
| `sm job show <job.id>` | Detail: current state, claim timestamp, TTL remaining, runner, content hash. |
| `sm job preview <job.id>` | Render the job MD file without executing. |
| `sm job claim [--filter <action>]` | Atomic primitive: return next queued job id, mark it running. Exit 0 with id on stdout; exit 1 if queue empty. |
| `sm job run` | Full CLI-runner loop: claim + spawn + record. Runs one job. |
| `sm job run --all` | Drain the queue (MVP: sequential). |
| `sm job run --max N` | Drain at most N jobs. |
| `sm job status [<job.id>]` | Counts (per status) or single-job status. |
| `sm job cancel <job.id>` | Force a running job to `failed` state with reason `user-cancelled`. |
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
| `sm history [-n <node.path>] [--action <id>] [--status ...] [--since <date>]` | Filter execution records. `--json` emits an array of `execution-record.schema.json` objects. |
| `sm history stats` | Aggregates: tokens per action, executions per month, top nodes by frequency, error rates. |

---

### Plugins

| Command | Purpose |
|---|---|
| `sm plugins list` | Auto-discovered plugins with status. `--json` emits an array of `DiscoveredPlugin`. |
| `sm plugins show <id>` | Full manifest + compat detail. |
| `sm plugins enable <id>` | Toggle on. Persists in `config_plugins`. |
| `sm plugins disable <id>` | Toggle off; does not delete the plugin directory. |
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
| `sm db reset` | Drop `scan_*` + `state_*`, keep `config_*`. |
| `sm db reset --hard` | Delete the DB file entirely. |
| `sm db backup [--out <path>]` | WAL checkpoint + file copy. |
| `sm db restore <path>` | Swap the DB. |
| `sm db shell` | Interactive SQL shell (implementations backed by SQLite use `sqlite3`; others use equivalent). |
| `sm db dump [--tables ...]` | SQL dump. |
| `sm db migrate [--dry-run \| --status \| --to <n> \| --kernel-only \| --plugin <id> \| --no-backup]` | Migration controls. |

All destructive verbs (`reset`, `reset --hard`, `restore`) require interactive confirmation unless `--force`.

---

### Server

| Command | Purpose |
|---|---|
| `sm serve [--port N] [--host ...] [--no-open]` | Start Hono + WebSocket for the Web UI. Default port is implementation-defined but MUST be the same across runs. Implementations MUST NOT bind 0.0.0.0 by default. |

---

### Introspection

- `sm help --format json` — structured CLI surface dump.
- `sm help --format md` — canonical markdown, CI-enforced for the reference impl's `docs/cli-reference.md`.

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

## Stability

The **verb list** is stable as of spec v1.0.0. Adding a verb is a minor bump. Removing a verb is a major bump.

**Adding** a flag is a minor bump. Changing a flag's type or removing a flag is a major bump. Changing a flag's default is a major bump.

**Exit codes 0–5** are stable. Redefining any of these meanings is a major bump. Adding codes in the reserved range (6–15) is a minor bump.

`--json` output shapes conform to the schemas under `schemas/`. Shape changes follow schema versioning (see `versioning.md`).
