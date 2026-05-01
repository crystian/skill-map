---
"@skill-map/cli": minor
---

Close H1 / M1 / M3 from the cli-architect review.

- **kernel — `IExtractorContext.store` wiring (spec § A.12)**: `RunScanOptions.pluginStores?: ReadonlyMap<string, IPluginStore>` is threaded through `walkAndExtract → runExtractorsForNode → buildExtractorContext` and surfaced on `ctx.store`. Legacy contract preserved (no entry for a plugin id → `ctx.store` stays `undefined`). The orchestrator never touches the wrapper's persist callback; driving adapters supply it. New public exports on `kernel/index.ts`: `IPluginStore`, `IKvStoreWrapper`, `IDedicatedStoreWrapper`, `IKvStorePersist`, `IDedicatedStorePersist`, `makePluginStore`, `makeKvStoreWrapper`, `makeDedicatedStoreWrapper`, `KV_SCHEMA_KEY`.
- **cli — `sm version --json`**: emits `{ sm, kernel, spec, dbSchema }` exactly per `spec/cli-contract.md` § `sm version`. The orphan `json = false` field is gone; the option is wired through Clipanion. `runtime` stays in human-only output (spec lists four JSON fields).
- **cli — `sm orphans reconcile --dry-run` / `sm orphans undo-rename --dry-run`**: previews the FK migration without mutating. Rollback is forced via a sentinel symbol thrown inside the Kysely transaction so the dry-run path runs the same `migrateNodeFks` code as live mode (no count-only divergence). Per spec § Dry-run, `--dry-run` skips the `--force` confirm prompt entirely.
- **cli — refresh stream discipline (M1)**: mid-action banners (`refreshingStale`, `refreshingNode`) move from stdout to stderr so a future `--json` mode (or any pipe consumer) sees only the payload.
- **cli — printer abstraction**: new `cli/util/printer.ts` exposing `IPrinter { data, info, warn, error }` with a `quietInfo` flag for `--json` gating. Optional helper for verbs that opt in.
- **cli — orphans i18n migration**: ten new entries in `cli/i18n/orphans.texts.ts` replacing inline string templates in `reconcile` and `undo-rename`.

Tests:
- `test/orchestrator-ctx-store.test.ts` (new, 5 cases): pluginStores absent → `undefined`; pluginStores entry matches `pluginId` → wrapper inyected, persist captures writes; multi-plugin without leakage; plugin without entry stays `undefined`; `runExtractorsForNode` honours the same wiring.
- `test/orphans-cli.test.ts` (+ 2 cases): `reconcile --dry-run` + `undo-rename --dry-run` both leave `state_executions` and `scan_issues` UNCHANGED.
- `test/cli.test.ts` (+ 1 case): `sm version --json` emits the four-field shape per spec.
- `test/node-enrichments.test.ts`: updated to expect `Refreshing enrichments for` on stderr after the M1 banner move.

What is NOT in this PR (deferred):
- The CLI side of H1 (Mode A persister against `state_plugin_kvs`, Mode B dedicated-table persister) is out of scope until the first plugin declares `storage`. The kernel seam ships now so any future driver can plug in without an orchestrator change.
