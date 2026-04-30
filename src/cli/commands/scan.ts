import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { Command, Option } from 'clipanion';
import type { Kysely } from 'kysely';

import { createKernel, runScan, runScanWithRenames } from '../../kernel/index.js';
import type {
  IEnrichmentRecord,
  IExtractorRunRecord,
  RenameOp,
  ScanResult,
} from '../../kernel/index.js';
import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import { listBuiltIns } from '../../extensions/built-ins.js';
import type { SqliteStorageAdapter } from '../../kernel/adapters/sqlite/index.js';
import type { IDatabase } from '../../kernel/adapters/sqlite/schema.js';
import { persistScanResult } from '../../kernel/adapters/sqlite/scan-persistence.js';
import { loadExtractorRuns, loadScanResult } from '../../kernel/adapters/sqlite/scan-load.js';
import { loadConfig } from '../../kernel/config/loader.js';
import { buildIgnoreFilter, readIgnoreFileText } from '../../kernel/scan/ignore.js';
import { tx } from '../../kernel/util/tx.js';
import { SCAN_TEXTS } from '../i18n/scan.texts.js';
import { createCliProgressEmitter } from '../util/cli-progress-emitter.js';
import { ExitCode } from '../util/exit-codes.js';
import {
  composeScanExtensions,
  emptyPluginRuntime,
  filterBuiltInManifests,
  loadPluginRuntime,
  type IPluginRuntimeBundle,
} from '../util/plugin-runtime.js';
import { tryWithSqlite, withSqlite } from '../util/with-sqlite.js';
import { runWatchLoop } from './watch.js';

const DEFAULT_PROJECT_DB = '.skill-map/skill-map.db';

/**
 * `sm scan [roots...] [--json] [--no-built-ins] [--no-plugins] [-n|--dry-run] [--changed]`
 *
 * Scans the given roots using the built-in extension set (claude Provider,
 * 4 extractors, 3 rules) plus any drop-in plugin extensions discovered
 * under `.skill-map/plugins/` and `~/.skill-map/plugins/` (Step 9.1).
 * The registry is populated with manifest rows so introspection
 * (`sm help`, `sm plugins list`) sees what's active; the orchestrator
 * consumes the callable instances separately.
 *
 * Result is persisted into `<cwd>/.skill-map/skill-map.db` (auto-migrated)
 * with replace-all semantics across `scan_nodes / scan_links / scan_issues`.
 *
 * - `--no-built-ins` skips both the pipeline and the persistence step
 *   (kernel-empty-boot parity); cannot be combined with `--changed`.
 * - `--no-plugins` skips drop-in plugin discovery entirely. Only the
 *   built-in set runs. Pairs with `--no-built-ins` for a fully empty
 *   pipeline (e.g. for the `kernel-empty-boot` conformance contract).
 *   Failed / incompatible plugins are logged to stderr and skipped;
 *   the scan never aborts on a bad plugin.
 * - `-n` / `--dry-run` runs the scan in-memory and skips ALL DB writes.
 *   Combined with `--changed` it still opens the DB read-side to load
 *   the prior snapshot, then exits without writing.
 * - `--changed` performs an incremental scan against the persisted prior
 *   snapshot. Reuses unchanged nodes (matched by path + bodyHash +
 *   frontmatterHash) and reprocesses new / modified files only. If the
 *   DB doesn't exist or the prior snapshot is empty, degrades to a full
 *   scan and prints a one-liner to stderr.
 */
export class ScanCommand extends Command {
  static override paths = [['scan']];

  static override usage = Command.Usage({
    category: 'Scan',
    description: 'Scan roots for markdown nodes, run extractors and rules.',
    details: `
      Walks the given roots with the built-in claude Provider, runs the
      frontmatter / slash / at-directive / external-url-counter
      extractors per node, then the trigger-collision / broken-ref /
      superseded rules over the full graph. Emits a ScanResult
      conforming to scan-result.schema.json.

      The result is persisted into <cwd>/.skill-map/skill-map.db
      (replace-all over scan_nodes/links/issues). Pass --no-built-ins
      to skip both the pipeline and the persistence step (kernel-empty-boot
      parity).

      Pass -n / --dry-run to skip every DB operation (the result is
      computed in memory and emitted to stdout). Pass --changed to load
      the prior snapshot from the DB, reuse unchanged nodes, and only
      reprocess new / modified files.
    `,
    examples: [
      ['Scan the current directory', '$0 scan'],
      ['Scan multiple roots and print JSON', '$0 scan ./docs ./skills --json'],
      ['Empty-pipeline conformance', '$0 scan --no-built-ins --json'],
      ['Dry-run, no DB writes', '$0 scan -n --json'],
      ['Incremental scan against prior snapshot', '$0 scan --changed'],
      ['What would the next incremental scan persist?', '$0 scan --changed -n --json'],
    ],
  });

  roots = Option.Rest({ name: 'roots' });
  json = Option.Boolean('--json', false, {
    description: 'Emit a machine-readable ScanResult document on stdout.',
  });
  noBuiltIns = Option.Boolean('--no-built-ins', false, {
    description: 'Skip the built-in extension set. Yields a zero-filled ScanResult (kernel-empty-boot parity); skips DB persistence.',
  });
  noPlugins = Option.Boolean('--no-plugins', false, {
    description: 'Skip drop-in plugin discovery. Only the built-in set runs. Combine with --no-built-ins for a fully empty pipeline.',
  });
  noTokens = Option.Boolean('--no-tokens', false, {
    description: 'Skip per-node token counts (cl100k_base BPE). Leaves node.tokens undefined; spec-valid since the field is optional.',
  });
  dryRun = Option.Boolean('-n,--dry-run', false, {
    description: 'Run the scan in memory and skip every DB write. Combined with --changed, still opens the DB read-side to load the prior snapshot.',
  });
  changed = Option.Boolean('--changed', false, {
    description: 'Incremental scan: reuse unchanged nodes from the persisted prior snapshot. Degrades to a full scan if no prior snapshot exists.',
  });
  allowEmpty = Option.Boolean('--allow-empty', false, {
    description: 'Allow a zero-result scan to wipe an already-populated DB (replace-all replace by zero rows). Off by default to avoid the typo-trap where an invalid root silently clears your data.',
  });
  strict = Option.Boolean('--strict', false, {
    description: 'Promote frontmatter-validation findings from warn to error (exit code 1 on any violation). Overrides scan.strict from config when both are set.',
  });
  watch = Option.Boolean('--watch', false, {
    description: 'Long-running mode: watch the roots and trigger an incremental scan after each debounced batch of filesystem events. Alias of `sm watch`.',
  });

  async execute(): Promise<number> {
    // --- watch alias -----------------------------------------------------
    // `--watch` is a thin alias for the `sm watch` verb. We delegate to
    // the shared loop so there is exactly one watcher implementation.
    // Combining `--watch` with one-shot-only flags is incoherent — the
    // watcher always persists incrementally over the prior snapshot.
    if (this.watch) {
      if (this.noBuiltIns || this.dryRun || this.changed || this.allowEmpty) {
        this.context.stderr.write(SCAN_TEXTS.watchCannotCombine);
        return ExitCode.Error;
      }
      const roots = this.roots.length > 0 ? this.roots : ['.'];
      return runWatchLoop({
        roots,
        json: this.json,
        noTokens: this.noTokens,
        strict: this.strict,
        noPlugins: this.noPlugins,
        context: this.context,
      });
    }

    // --- flag combinatorics -------------------------------------------------
    // `--no-built-ins` zero-fills the pipeline; combining it with
    // `--changed` (which loads a prior to merge against) is incoherent.
    if (this.changed && this.noBuiltIns) {
      this.context.stderr.write(SCAN_TEXTS.changedWithoutBuiltIns);
      return ExitCode.Error;
    }

    const kernel = createKernel();
    const roots = this.roots.length > 0 ? this.roots : ['.'];

    // --- plugin runtime --------------------------------------------------
    // Step 9.1 wires plugin discovery into the scan pipeline. Failed
    // plugins (`incompatible-spec` / `invalid-manifest` / `load-error`)
    // emit one stderr line each but never abort the scan — the kernel
    // keeps booting on a bad plugin. Disabled plugins are silently
    // skipped; their `sm plugins list` row already conveys intent.
    //
    // `--no-plugins` short-circuits discovery entirely (no DB / config
    // reads, no FS walk under `.skill-map/plugins/`). Pairs with
    // `--no-built-ins` for the kernel-empty-boot conformance posture.
    const pluginRuntime = this.noPlugins
      ? emptyPluginRuntime()
      : await loadPluginRuntime({ scope: 'project' });
    for (const warn of pluginRuntime.warnings) {
      this.context.stderr.write(`${warn}\n`);
    }

    const extensions = composeScanExtensions({
      noBuiltIns: this.noBuiltIns,
      pluginRuntime,
    });
    if (!this.noBuiltIns) {
      // Granularity filter: a user-disabled built-in (whether bundle-
      // level `claude` or extension-level `core/<id>`) is silenced from
      // the registry too, so `sm help` / `sm plugins list` introspection
      // does not advertise it as active.
      const enabledBuiltIns = filterBuiltInManifests(listBuiltIns(), pluginRuntime.resolveEnabled);
      for (const manifest of enabledBuiltIns) kernel.registry.register(manifest);
    }
    for (const manifest of pluginRuntime.manifests) kernel.registry.register(manifest);

    const dbPath = resolve(process.cwd(), DEFAULT_PROJECT_DB);

    // --- config + ignore filter (no DB needed) -----------------------------
    // Loaded BEFORE we touch SQLite so a malformed config fails fast
    // without spinning up a connection.
    //
    // `--strict` (Step 6.7 + the .strict-config unification) propagates
    // to BOTH validation surfaces: the layered loader (so a bogus key
    // in settings.json fails the scan instead of being skipped with a
    // warning) and the per-node frontmatter validator (so any node
    // emitting a `frontmatter-invalid` issue trips exit 1).
    let cfg;
    try {
      cfg = loadConfig({ scope: 'project', strict: this.strict }).effective;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.context.stderr.write(tx(SCAN_TEXTS.scanFailure, { message }));
      return ExitCode.Error;
    }
    const ignoreFileText = readIgnoreFileText(process.cwd());
    const ignoreFilterOpts: Parameters<typeof buildIgnoreFilter>[0] = {};
    if (cfg.ignore.length > 0) ignoreFilterOpts.configIgnore = cfg.ignore;
    if (ignoreFileText !== undefined) ignoreFilterOpts.ignoreFileText = ignoreFileText;
    const ignoreFilter = buildIgnoreFilter(ignoreFilterOpts);

    // Frontmatter strict: --strict on the CLI takes precedence; scan.strict
    // in config provides the team default. (Loader strict above is gated
    // strictly by --strict — config can't promote a loader warning to an
    // error transparently because the warning lives at config-load time.)
    const strict = this.strict || cfg.scan.strict === true;

    // --- prior snapshot semantics -----------------------------------------
    // Step 5.8 decoupled "prior for rename detection" from "prior for
    // cache reuse". The orchestrator uses `priorSnapshot` to fire the
    // rename heuristic (every scan that can detect deletes / additions),
    // and uses `enableCache` — independently — to decide whether to skip
    // extractors on hash-matching nodes (`--changed` only).
    //
    // When `--changed` is set but no prior is found, we warn so the user
    // gets feedback that the incremental flag had nothing to act on.
    // Without `--changed`, an empty / missing prior is silent (it's the
    // normal first-scan path).
    const loadPrior = async (
      adapter: SqliteStorageAdapter,
    ): Promise<ScanResult | null> => {
      if (this.noBuiltIns) return null;
      const loaded = await loadScanResult(adapter.db);
      if (loaded.nodes.length === 0) return null;
      // H6 — under `--strict`, validate the prior we just hydrated from
      // SQLite against `scan-result.schema.json` before letting the
      // orchestrator consume it. A DB that was corrupted manually,
      // mid-rollback, or by a downstream tool can hand us nodes with
      // null / wrong-typed `bodyHash` / `frontmatterHash`, which the
      // rename heuristic dereferences directly. Without `--strict` the
      // current best-effort behaviour stays — casual scans against a
      // partially-broken DB still produce something useful.
      if (strict) {
        const validators = loadSchemaValidators();
        const result = validators.validate('scan-result', loaded);
        if (!result.ok) {
          throw new Error(tx(SCAN_TEXTS.priorSchemaValidationFailed, { errors: result.errors }));
        }
      }
      return loaded;
    };

    // --- run scan, given a prior --------------------------------------------
    // Closure so the path that persists (single open) and the path that
    // doesn't (ephemeral read open + standalone scan) share one runScan
    // invocation. The optional `priorExtractorRuns` map drives the
    // Phase 4 / A.9 fine-grained Extractor cache; the CLI loads it from
    // `scan_extractor_runs` whenever the prior snapshot is hydrated.
    const runScanWith = async (
      prior: ScanResult | null,
      priorExtractorRuns?: Map<string, Map<string, string>>,
    ): Promise<{
      result: ScanResult;
      renameOps: RenameOp[];
      extractorRuns: IExtractorRunRecord[];
      enrichments: IEnrichmentRecord[];
    }> => {
      if (this.changed && prior === null) {
        this.context.stderr.write(SCAN_TEXTS.changedNoPriorWarning);
      }
      const runOptions: Parameters<typeof runScan>[1] = {
        roots,
        // `--global` for `sm scan` lands in Step 6 (config + onboarding).
        // The orchestrator already accepts the scope override; the CLI
        // surface defaults to `'project'` until the flag is wired.
        scope: 'project',
        tokenize: !this.noTokens,
        ignoreFilter,
        strict,
        emitter: createCliProgressEmitter(this.context.stderr),
      };
      if (extensions) runOptions.extensions = extensions;
      if (prior) {
        runOptions.priorSnapshot = prior;
        // Cache reuse is opt-in via `--changed`. With a prior loaded but
        // no `--changed`, the rename heuristic still fires but every
        // file re-walks through extractors deterministically.
        runOptions.enableCache = this.changed;
      }
      if (priorExtractorRuns) runOptions.priorExtractorRuns = priorExtractorRuns;
      return await runScanWithRenames(kernel, runOptions);
    };

    const willPersist = !this.noBuiltIns && !this.dryRun;
    let result: ScanResult;
    let renameOps: RenameOp[];
    let persistedTo: string | null = null;

    // Surface root-validation errors from the orchestrator as clean
    // operational failures (exit 2) rather than crash-trace dumps.
    // `runScan` validates each root exists as a directory up front;
    // those messages start with `runScan: root path ...`. The
    // persist-guard error path returns its own structured kind so
    // the caller can render the canonical "refusing to wipe ..."
    // line outside the DB scope.
    type IScanOutcome =
      | {
          kind: 'ok';
          result: ScanResult;
          renameOps: RenameOp[];
          extractorRuns: IExtractorRunRecord[];
          enrichments: IEnrichmentRecord[];
        }
      | { kind: 'scan-error'; message: string }
      | { kind: 'guard'; existing: number };

    let outcome: IScanOutcome;
    if (willPersist) {
      // SINGLE open: read prior + runScan + guard + persist all happen
      // inside one withSqlite. Saves one migration discovery + one
      // WAL setup vs. the old read-prior + persist double-open.
      try {
        outcome = await withSqlite({ databasePath: dbPath }, async (adapter) => {
          const prior = await loadPrior(adapter);
          // Phase 4 / A.9 — load the fine-grained Extractor cache only
          // when the prior snapshot is in play. Without a prior, the
          // orchestrator never hits the cache path so the runs map is
          // wasted I/O.
          const priorExtractorRuns =
            this.changed && prior ? await loadExtractorRuns(adapter.db) : undefined;
          let scanned: {
            result: ScanResult;
            renameOps: RenameOp[];
            extractorRuns: IExtractorRunRecord[];
            enrichments: IEnrichmentRecord[];
          };
          try {
            scanned = await runScanWith(prior, priorExtractorRuns);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { kind: 'scan-error', message };
          }
          // Defensive guard: refuse to wipe a populated DB with a
          // zero-result scan unless `--allow-empty` is passed. Belt-and-
          // braces with the orchestrator-level root validation: even if
          // a future code path or weird edge case yields a zero-filled
          // ScanResult, an existing populated snapshot survives. The
          // natural case of "empty repo on first scan" is not affected
          // (DB starts empty, scan returns 0 rows, persist proceeds).
          if (scanned.result.stats.nodesCount === 0 && !this.allowEmpty) {
            const existing = await countExistingScanRows(adapter.db);
            if (existing > 0) return { kind: 'guard', existing };
          }
          await persistScanResult(
            adapter.db,
            scanned.result,
            scanned.renameOps,
            scanned.extractorRuns,
            scanned.enrichments,
          );
          return { kind: 'ok', ...scanned };
        });
      } catch (err) {
        // Open / migration / persist failures bubble out of withSqlite.
        const message = err instanceof Error ? err.message : String(err);
        this.context.stderr.write(tx(SCAN_TEXTS.scanFailure, { message }));
        return ExitCode.Error;
      }
      if (outcome.kind === 'scan-error') {
        this.context.stderr.write(tx(SCAN_TEXTS.scanFailure, { message: outcome.message }));
        return ExitCode.Error;
      }
      if (outcome.kind === 'guard') {
        this.context.stderr.write(tx(SCAN_TEXTS.guardWipeRefused, { existing: outcome.existing }));
        return ExitCode.Error;
      }
      result = outcome.result;
      renameOps = outcome.renameOps;
      persistedTo = dbPath;
    } else {
      // Non-persist path: ephemeral read-only open for the prior, then
      // runScan with the DB closed. We do NOT auto-create the DB here —
      // a `--dry-run` over a missing DB should not provision a scope.
      let prior: ScanResult | null;
      try {
        prior = this.noBuiltIns
          ? null
          : await tryWithSqlite(
              { databasePath: dbPath, autoBackup: false },
              loadPrior,
            );
      } catch (err) {
        // `loadPrior` throws under `--strict` if the DB-resident
        // scan-result fails schema validation. Surface it the same way
        // we surface a runScan failure.
        const message = err instanceof Error ? err.message : String(err);
        this.context.stderr.write(tx(SCAN_TEXTS.scanFailure, { message }));
        return ExitCode.Error;
      }
      try {
        const scanned = await runScanWith(prior);
        result = scanned.result;
        renameOps = scanned.renameOps;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.context.stderr.write(tx(SCAN_TEXTS.scanFailure, { message }));
        return ExitCode.Error;
      }
    }

    // Exit code mirrors `sm check` (and spec/cli-contract.md §Exit codes):
    // 1 only when at least one issue is at `error` severity. Warns / infos
    // do not fail the verb. The exit code is independent of `--json`.
    const exitCode = result.issues.some((i) => i.severity === 'error') ? ExitCode.Issues : ExitCode.Ok;

    if (this.json) {
      // H4 — under `--strict`, self-validate the ScanResult against
      // `scan-result.schema.json` before emitting it. The
      // orchestrator's per-link / per-issue guards (`validateLink`,
      // `validateIssue`) only check shallow shape; a custom extractor
      // could still produce a Link that fails the full schema and
      // would silently slip into stdout. Without this gate, a
      // downstream `sm scan compare-with <dump>` that loads the dump
      // through its schema validator would fail with an error the
      // original scan never surfaced — the kind of drift `--strict`
      // exists to prevent.
      if (strict) {
        const validators = loadSchemaValidators();
        const validation = validators.validate('scan-result', result);
        if (!validation.ok) {
          this.context.stderr.write(tx(SCAN_TEXTS.jsonSelfValidationFailed, { errors: validation.errors }));
          return ExitCode.Error;
        }
      }
      this.context.stdout.write(JSON.stringify(result) + '\n');
      return exitCode;
    }

    this.context.stdout.write(
      tx(SCAN_TEXTS.scannedSummary, {
        rootsCount: result.roots.length,
        durationMs: result.stats.durationMs,
        nodes: result.stats.nodesCount,
        links: result.stats.linksCount,
        issues: result.stats.issuesCount,
      }),
    );
    if (persistedTo) {
      this.context.stdout.write(tx(SCAN_TEXTS.persistedTo, { dbPath: persistedTo }));
    } else if (this.dryRun && !this.noBuiltIns) {
      this.context.stdout.write(
        tx(SCAN_TEXTS.wouldPersist, {
          nodes: result.stats.nodesCount,
          links: result.stats.linksCount,
          issues: result.stats.issuesCount,
          dbPath,
        }),
      );
    }
    return exitCode;
  }
}

/**
 * Sum of `scan_nodes + scan_links + scan_issues` row counts. Used by the
 * Layer-3 defensive guard in `ScanCommand.execute` to detect that a
 * zero-result scan is about to wipe a populated snapshot. Three small
 * `COUNT(*)` queries on tables that have at most a few thousand rows
 * each — cheap enough to skip a UNION ALL.
 */
async function countExistingScanRows(db: Kysely<IDatabase>): Promise<number> {
  const rows = await Promise.all([
    db.selectFrom('scan_nodes').select((eb) => eb.fn.countAll<number>().as('c')).executeTakeFirst(),
    db.selectFrom('scan_links').select((eb) => eb.fn.countAll<number>().as('c')).executeTakeFirst(),
    db.selectFrom('scan_issues').select((eb) => eb.fn.countAll<number>().as('c')).executeTakeFirst(),
  ]);
  let total = 0;
  for (const r of rows) total += Number(r?.c ?? 0);
  return total;
}
