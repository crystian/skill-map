import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { Command, Option } from 'clipanion';
import type { Kysely } from 'kysely';

import { createKernel, runScan } from '../../kernel/index.js';
import type { ScanResult } from '../../kernel/index.js';
import { builtIns, listBuiltIns } from '../../extensions/built-ins.js';
import { SqliteStorageAdapter } from '../../kernel/adapters/sqlite/index.js';
import type { IDatabase } from '../../kernel/adapters/sqlite/schema.js';
import { persistScanResult } from '../../kernel/adapters/sqlite/scan-persistence.js';
import { loadScanResult } from '../../kernel/adapters/sqlite/scan-load.js';

const DEFAULT_PROJECT_DB = '.skill-map/skill-map.db';

/**
 * `sm scan [roots...] [--json] [--no-built-ins] [-n|--dry-run] [--changed]`
 *
 * Scans the given roots using the built-in extension set (claude adapter,
 * 4 detectors, 3 rules). The registry is populated with manifest rows so
 * introspection (`sm help`, future `sm plugins`) sees what's active; the
 * orchestrator consumes the callable instances separately.
 *
 * Result is persisted into `<cwd>/.skill-map/skill-map.db` (auto-migrated)
 * with replace-all semantics across `scan_nodes / scan_links / scan_issues`.
 *
 * - `--no-built-ins` skips both the pipeline and the persistence step
 *   (kernel-empty-boot parity); cannot be combined with `--changed`.
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
    description: 'Scan roots for markdown nodes, run detectors and rules.',
    details: `
      Walks the given roots with the built-in claude adapter, runs the
      frontmatter / slash / at-directive / external-url-counter
      detectors per node, then the trigger-collision / broken-ref /
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

  async execute(): Promise<number> {
    // --- flag combinatorics -------------------------------------------------
    // `--no-built-ins` zero-fills the pipeline; combining it with
    // `--changed` (which loads a prior to merge against) is incoherent.
    if (this.changed && this.noBuiltIns) {
      this.context.stderr.write(
        '--changed and --no-built-ins cannot be combined: --no-built-ins yields a zero-filled ScanResult, leaving nothing to merge against.\n',
      );
      return 2;
    }

    const kernel = createKernel();
    const roots = this.roots.length > 0 ? this.roots : ['.'];

    const extensions = this.noBuiltIns ? undefined : builtIns();
    if (!this.noBuiltIns) {
      for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
    }

    // --- prior snapshot for --changed --------------------------------------
    // Load the persisted snapshot (read-only; the adapter is closed
    // before the scan runs). If the DB doesn't exist yet, or the
    // snapshot is empty, degrade to a full scan and warn.
    const dbPath = resolve(process.cwd(), DEFAULT_PROJECT_DB);
    let priorSnapshot: ScanResult | null = null;
    if (this.changed) {
      if (!existsSync(dbPath)) {
        this.context.stderr.write(
          '--changed: no prior snapshot found; running full scan.\n',
        );
      } else {
        const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
        await adapter.init();
        try {
          const loaded = await loadScanResult(adapter.db);
          if (loaded.nodes.length === 0) {
            this.context.stderr.write(
              '--changed: no prior snapshot found; running full scan.\n',
            );
          } else {
            priorSnapshot = loaded;
          }
        } finally {
          await adapter.close();
        }
      }
    }

    const runOptions: Parameters<typeof runScan>[1] = {
      roots,
      // `--global` for `sm scan` lands in Step 6 (config + onboarding).
      // The orchestrator already accepts the scope override; the CLI
      // surface defaults to `'project'` until the flag is wired.
      scope: 'project',
      tokenize: !this.noTokens,
    };
    if (extensions) runOptions.extensions = extensions;
    if (priorSnapshot) runOptions.priorSnapshot = priorSnapshot;

    // Surface root-validation errors from the orchestrator as clean
    // operational failures (exit 2) rather than crash-trace dumps.
    // `runScan` validates each root exists as a directory up front;
    // those messages start with `runScan: root path ...`.
    let result: ScanResult;
    try {
      result = await runScan(kernel, runOptions);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.context.stderr.write(`sm scan: ${message}\n`);
      return 2;
    }

    // --- persist (skipped under --no-built-ins or --dry-run) ---------------
    let persistedTo: string | null = null;
    const willPersist = !this.noBuiltIns && !this.dryRun;
    if (willPersist) {
      persistedTo = dbPath;
      const adapter = new SqliteStorageAdapter({ databasePath: persistedTo });
      await adapter.init();
      try {
        // Defensive guard: refuse to wipe a populated DB with a
        // zero-result scan unless `--allow-empty` is passed. Belt-and-
        // braces with the orchestrator-level root validation: even if
        // a future code path or weird edge case yields a zero-filled
        // ScanResult, an existing populated snapshot survives. The
        // natural case of "empty repo on first scan" is not affected
        // (DB starts empty, scan returns 0 rows, persist proceeds).
        if (result.stats.nodesCount === 0 && !this.allowEmpty) {
          const existing = await countExistingScanRows(adapter.db);
          if (existing > 0) {
            this.context.stderr.write(
              `sm scan: refusing to wipe a populated DB (${existing} rows in scan_*) ` +
                `with a zero-result scan. Pass --allow-empty to override. ` +
                `If this is unexpected, double-check the root paths.\n`,
            );
            return 2;
          }
        }
        await persistScanResult(adapter.db, result);
      } finally {
        await adapter.close();
      }
    }

    // Exit code mirrors `sm check` (and spec/cli-contract.md §Exit codes):
    // 1 only when at least one issue is at `error` severity. Warns / infos
    // do not fail the verb. The exit code is independent of `--json`.
    const exitCode = result.issues.some((i) => i.severity === 'error') ? 1 : 0;

    if (this.json) {
      this.context.stdout.write(JSON.stringify(result) + '\n');
      return exitCode;
    }

    this.context.stdout.write(
      `Scanned ${result.roots.length} root(s) in ${result.stats.durationMs}ms — ` +
        `${result.stats.nodesCount} nodes, ${result.stats.linksCount} links, ` +
        `${result.stats.issuesCount} issues.\n`,
    );
    if (persistedTo) {
      this.context.stdout.write(`Persisted to ${persistedTo}\n`);
    } else if (this.dryRun && !this.noBuiltIns) {
      this.context.stdout.write(
        `Would persist ${result.stats.nodesCount} nodes / ${result.stats.linksCount} links / ${result.stats.issuesCount} issues to ${dbPath} (dry-run).\n`,
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
