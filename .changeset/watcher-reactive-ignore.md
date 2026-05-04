---
'@skill-map/cli': minor
---

`sm serve` and `sm watch` now react in-flight to edits of `.skill-mapignore` and `.skill-map/settings.json`. Previously, both verbs loaded the ignore filter once at startup and required a restart for new patterns to take effect — invisible to the user except via stale results. After this change, a secondary chokidar watcher monitors both meta-files; on change, the watcher rebuilds the filter from disk, re-reads `config.ignore` / `scan.tokenize` / `scan.strict` from settings, and dispatches a fresh scan so the DB and `/ws scan.completed` reflect the new state.

Kernel API is additively extended: `createChokidarWatcher`'s `ignoreFilter` option now accepts either an `IIgnoreFilter` (captured by reference at construction, the historical shape) or a `() => IIgnoreFilter | undefined` getter that is re-evaluated per chokidar event. The getter form is what enables the BFF / CLI watch to swap the filter at runtime without tearing chokidar down. Static callers continue to pass an `IIgnoreFilter` literal and behave exactly as before.

Note: `scan.watch.debounceMs` itself is captured at boot — changing the debounce window in settings.json still requires restarting the watcher.
