---
'@skill-map/cli': minor
---

Introduce `LoggerPort` on the kernel and a concrete CLI `Logger`
adapter, replacing the last direct `console.error` write inside the
kernel.

**Why.** The kernel must not write to stdout/stderr directly — that's
an adapter concern. Until now the orchestrator's probabilistic-hook
deferral notice was a `console.error` call, which made kernel output
untestable, unconfigurable, and impossible to silence from an embedded
host.

**What.**

- New `LoggerPort` (`trace` / `debug` / `info` / `warn` / `error`)
  with `LogLevel` (incl. `silent` sentinel), `LogRecord`, and helpers
  (`parseLogLevel`, `logLevelRank`, `isLogLevel`, `LOG_LEVELS`).
- New `SilentLogger` no-op default — equivalent in spirit to
  `InMemoryProgressEmitter`.
- New module-level singleton (`log` proxy + `configureLogger` /
  `resetLogger` / `getActiveLogger`). Imports made before bootstrap
  see the new impl on every call — no captured-stale-logger bugs.
- New CLI `Logger` (level + stream + format), default formatter
  `HH:MM:SS | LEVEL | message [| ctx]` (local time, stderr).
- `entry.ts` pre-parses `--log-level` (flag wins over
  `SKILL_MAP_LOG_LEVEL` env var, fallback `warn`) before Clipanion
  sees argv, then calls `configureLogger(...)`.
- Orchestrator's `console.error` → `log.warn(...)` with structured
  `{ hookId, mode }` context; the `logger` knob on `runScan` /
  `makeHookDispatcher` is gone (singleton replaces it).

Tests that previously monkey-patched `console.error` now install an
in-test `LoggerPort` via `configureLogger(...)` and restore via
`resetLogger()` in `finally`.
