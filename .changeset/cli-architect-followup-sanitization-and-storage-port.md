---
'@skill-map/cli': minor
---

cli-architect audit follow-up — output sanitization hardening, `StoragePort.migrations.writeBackup` signature change, atomic config write, and shared helper extraction.

**BREAKING (pre-1.0, ships as minor per `versioning.md` § Pre-1.0)**

`StoragePort.migrations.writeBackup(targetVersion: number)` is now `writeBackup(destPath: string)`. The port stays a generic "WAL-checkpoint + atomic file copy" primitive; the per-target naming (`skill-map-pre-migrate-v<N>.db` for the migrations runner; `<timestamp>.db` for `sm db backup`) is the caller's concern. `sm db backup` now routes through the port via `withSqlite` instead of opening `node:sqlite` directly. The on-disk paths and the user-facing CLI surface (`sm db backup [--out <path>]`) are unchanged — verified deliberately. No spec impact.

**HIGH — output sanitization gaps (defence in depth)**

Plugin-authored strings persisted in the DB (`Issue.message`, `scan_issues.data_json`, conformance assertion `reason` strings spliced from subprocess stderr, plugin-loader `reason` payloads) reach the user's terminal through several CLI render paths that previously did not pass them through `sanitizeForTerminal`. A hostile or buggy plugin could plant ANSI escape sequences or C0 control bytes in those fields and repaint the user's screen on `sm history`, `sm orphans undo-rename`, `sm conformance run`, or any verb that prints a plugin-warning row.

- **H1** — `formatWarning` in `cli/util/plugin-runtime.ts` sanitizes + length-caps `id` (200) and `reason` (1000) before interpolation. Closes M8 in the same change. Function exported (with docstring noting test-only consumers) so the new audit unit tests can target it directly.
- **H2** — `renderStats` in `cli/commands/history.ts` sanitizes `actionId`, `actionVersion`, `nodePath`, and the `failureReason` enum key before interpolating into the top-actions / top-nodes / failures-by-reason rows. Enum value sanitized for symmetry with `renderTable`.
- **H3** — `cli/commands/orphans.ts` sanitizes `dataFrom` in `undoMediumFromMismatch` (sourced from `scan_issues.data_json` written by the rename heuristic) and `safeFrom` in the confirm-prompt + summary template paths.

**MEDIUM**

- **M1** — `cli/commands/conformance.ts` extracts `formatAssertionFailureDetail(type, reason)` that sanitizes + caps `reason` to 1000 chars. The conformance runner splices subprocess stderr verbatim into `runtime-error` reasons; a runaway impl-under-test could emit kilobytes that drown the user's terminal. Helper exported for the audit unit tests.
- **M2** — see BREAKING above.
- **M3** — `cli/commands/jobs.ts` swaps `unlinkSync` for `await unlink` from `node:fs/promises` in the prune loop. Aligns with the rest of the verb (already async) and avoids blocking the event loop on slow filesystems.
- **M4** — extracts shared `bucketByKind` helper at `kernel/util/bucket-by-kind.ts`. `built-in-plugins/built-ins.ts:bucketBuiltIn` and `cli/util/plugin-runtime.ts:bucketLoaded` both consume it; the open-coded six-way `switch (ext.kind)` blocks (each with its own exhaustive-`never` guard) collapse to one centralized dispatch table. The helper still owns the exhaustive switch so adding a new `ExtensionKind` flags every caller through the `never` guard at compile time. The `eslint-disable-next-line complexity` justification (AGENTS.md category 6 — discriminated-union dispatcher) moves to the helper.
- **M5** — `cli/commands/config.ts` `writeJsonAtomic` replaces `writeFileSync` with stage-to-`<path>.tmp.<pid>` + `renameSync`. POSIX guarantees rename atomicity on the same filesystem, so a crash mid-write leaves `settings.json` either at its prior content or at the new content, never half-written. Best-effort temp-file cleanup on error so we don't leak siblings if the rename target is read-only.

**LOW**

- **L4** — extracts shared `parsePositiveIntegerOption(raw, label, stderr)` at `cli/util/option-validators.ts` with new i18n catalog `option-validators.texts.ts`. Three near-duplicate inline checks consolidated: `sm list --limit`, `sm history --limit`, `sm history stats --top`. Each used to ship its own `LIST_TEXTS.invalidLimit` / `HISTORY_TEXTS.limitNotPositiveInt` / `HISTORY_TEXTS.topNotPositiveInt` wording; the three keys are removed and replaced by a single `OPTION_VALIDATORS_TEXTS.notPositiveInt` template scoped by the `{{label}}` placeholder. Acceptance rules stay locked across sites (a permissive `Number.parseInt('12abc', 10)` would otherwise accept `12` — every call site repeats the same trim + signed + non-integer guard).
- **L8** — `built-in-plugins/formatters/ascii/index.ts` sanitizes `issue.ruleId` for symmetry with the sibling `issue.message` sanitization. The registry validator already constrains `ruleId` to `[a-z0-9-]+`, but defence in depth keeps the gate uniform if the validator ever loosens.

**Tests**

725/725 pass (+31 vs prior 694). New: `test/bucket-by-kind.test.ts` (M4 dispatch table coverage), `test/option-validators.test.ts` (L4 boundary cases). Modified: `test/plugin-runtime.test.ts` (H1), `test/history-cli.test.ts` (H2 + L4), `test/orphans-cli.test.ts` (H3), `test/conformance-cli.test.ts` (M1), `test/config-cli.test.ts` (M5), `test/storage.test.ts` (M2 port shape), `built-in-plugins/formatters/ascii/ascii.test.ts` (L8).

No spec changes — `spec/index.json` not regenerated. `npm run lint` clean, `npm run -w src build` clean.
