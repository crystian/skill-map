---
"@skill-map/cli": patch
---

Close L1 / L2 / L3 from the cli-architect review.

- **L1 — Async FS off the per-node loop**: `cli/commands/refresh.ts` reads each target node's body inside a `for (node of targetNodes)` loop. The read is now `await readFile(...)` from `node:fs/promises` instead of `readFileSync`. The body still serializes today (extractor pass is awaited per node) but routing through `fs/promises` lets the event loop overlap any concurrent kernel work and removes a sync hop that would block on a slow disk. Bootstrap reads (config, settings, schemas, package.json, migration runners) stay sync — those are cold-path or whitelist category 4 in `AGENTS.md`.
- **L3 — Error reporter helper**: new `cli/util/error-reporter.ts` exporting `formatErrorMessage(err: unknown): string`. Replaces 22 inline duplicates of `err instanceof Error ? err.message : String(err)` across `watch.ts`, `jobs.ts`, `conformance.ts`, `scan.ts`, `db.ts`, `init.ts`, `refresh.ts`, `config.ts`, `scan-compare.ts`. The helper deliberately stays minimal (no `--verbose` stack mode, no JSON envelope) — those grow when a concrete need surfaces.
- **L2 — `db migrate --to` strict integer parse**: `Number.parseInt` accepted `'123abc'` as `123` and didn't reject negatives, so a typo could silently roll the migration ledger to an unexpected target. Tightened to require `String(parsed) === trimmed && parsed >= 0`; bad input now exits `2` per spec § Exit codes.

Side effect: the `formatErrorMessage` substitution in `init.ts:runFirstScan` dropped the function below the cyclomatic threshold; removed the no-longer-needed `eslint-disable-next-line complexity`.

What was a false positive in the original review (no work needed):
- **L4 — `console.*` mixed with `this.context.std*`**: zero matches in `src/cli/` or `src/kernel/`. The lint rule + existing CLI discipline already enforce this.
