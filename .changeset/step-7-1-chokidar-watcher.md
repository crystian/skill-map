---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

Step 7.1 — File watcher (`sm watch` / `sm scan --watch`)

Long-running watcher that subscribes to the scan roots, debounces
filesystem events, and triggers an incremental scan per batch. Reuses
the existing `runScanWithRenames` pipeline, the `IIgnoreFilter` chain
(`.skill-mapignore` + `config.ignore` + bundled defaults), and the
`scan.*` non-job events from `job-events.md` — one ScanResult per
batch, emitted as ndjson under `--json`.

**Spec changes (minor)**:

- `spec/schemas/project-config.schema.json` — new `scan.watch` object
  with a single key `debounceMs` (integer ≥ 0, default 300). Groups
  bursts of filesystem events (editor saves, branch switches, npm
  installs) into a single scan pass. Set to 0 to disable debouncing.
- `spec/cli-contract.md` §Scan — documents `sm watch [roots...]` as
  the primary verb and `sm scan --watch` as the alias. Watcher
  respects the same ignore chain as one-shot scans, emits one
  ScanResult per batch (ndjson under `--json`), closes cleanly on
  `SIGINT` / `SIGTERM`, exits 0 on clean shutdown. Exit-code rule
  carved out for the watcher: per-batch error issues do not flip the
  exit code (the loop keeps running); operational errors still exit 2.

No new events. No new ports. The watcher is implementation-defined
inside the kernel package; a future `WatchPort` can be added when /
if a non-Node implementation needs to swap the chokidar wrapper.

**Runtime changes (minor — new verb + new config key)**:

- `chokidar@5.0.0` pinned in `src/package.json` (single new runtime
  dependency, MIT). Chokidar v5 requires Node ≥ 20.19; the project
  already pins `engines.node: ">=24.0"` so this is a no-op for
  consumers. Brings in `readdirp@5` as a transitive.
- `src/kernel/scan/watcher.ts` — `IFsWatcher` interface + concrete
  `ChokidarWatcher` wrapping `chokidar.watch()` with the existing
  `IIgnoreFilter` plumbed through, debouncer, batch coalescing,
  and explicit `stop()` for clean teardown.
- `src/cli/commands/watch.ts` — new `WatchCommand`. `sm scan
  --watch` delegates to the same code path so the two surfaces are
  byte-aligned (no parallel implementations).
- `src/config/defaults.json` — new `scan.watch.debounceMs: 300`
  default.

**Why minor (not patch)**: new public verb (`sm watch`), new public
config key (`scan.watch.debounceMs`), and a new flag on an existing
verb (`sm scan --watch`). All three are surface additions, not bug
fixes — minor under both the spec and the runtime semver policies.
No breaking changes; existing `sm scan` without `--watch` is
byte-identical to before.

**Roadmap**: Step 7 — Robustness, sub-step 7.1 (chokidar watcher).
Trigger normalization is implicit-already-landed (cabled into every
detector at Steps 3–4 with full unit tests in
`src/kernel/trigger-normalize.test.ts`); we do not write a sub-step
for it. Next sub-steps: 7.2 detector conflict resolution, 7.3 `sm
job prune` + retention enforcement.
