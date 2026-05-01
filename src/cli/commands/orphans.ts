/**
 * `sm orphans` — list active orphan / auto-rename issues.
 * `sm orphans reconcile <orphan.path> --to <new.path>`
 * `sm orphans undo-rename <new.path> [--from <old.path>] [--force]`
 *
 * Step 5.6. The verbs operate on FK ownership only — neither edits
 * files on disk. They consume the `orphan` / `auto-rename-medium` /
 * `auto-rename-ambiguous` issues emitted by the rename heuristic
 * (Step 5.5) and are the manual escape hatches for cases the heuristic
 * could not resolve automatically.
 *
 * Exit codes (per `spec/cli-contract.md` §Exit codes):
 *   0  ok
 *   2  bad flag (e.g. `--from` mismatch on auto-rename-medium)
 *   5  not-found (target node missing, no active issue, --from not in candidates)
 */

import { Command, Option } from 'clipanion';

import { migrateNodeFks } from '../../kernel/adapters/sqlite/history.js';
import type { IMigrateNodeFksReport } from '../../kernel/adapters/sqlite/history.js';
import type { SqliteStorageAdapter } from '../../kernel/adapters/sqlite/index.js';
import type { ITransactionalStorage } from '../../kernel/ports/storage.js';
import type { IIssueRow } from '../../kernel/types/storage.js';
import type { Issue } from '../../kernel/types.js';
import { tx } from '../../kernel/util/tx.js';
import { assertDbExists, resolveDbPath } from '../util/db-path.js';
import { confirm } from '../util/confirm.js';
import { emitDoneStderr, startElapsed } from '../util/elapsed.js';
import { ExitCode } from '../util/exit-codes.js';
import { ORPHANS_TEXTS } from '../i18n/orphans.texts.js';
import { withSqlite } from '../util/with-sqlite.js';
import type { Kysely } from 'kysely';
import type { IDatabase } from '../../kernel/adapters/sqlite/schema.js';

const ORPHAN_RULE_IDS = ['orphan', 'auto-rename-medium', 'auto-rename-ambiguous'] as const;
type OrphanRuleId = typeof ORPHAN_RULE_IDS[number];

// --- shared helpers -------------------------------------------------------

/**
 * Find every active orphan / auto-rename issue whose runtime shape
 * passes `predicate`. Wraps `port.issues.findActive(...)` with the
 * `ruleId in ORPHAN_RULE_IDS` gate, so callers only spell out the
 * predicate they care about (path equality, candidate match, etc.).
 */
async function findActiveOrphanIssues(
  adapter: SqliteStorageAdapter,
  predicate: (issue: Issue) => boolean,
): Promise<IIssueRow[]> {
  return adapter.issues.findActive(
    (issue) =>
      (ORPHAN_RULE_IDS as readonly string[]).includes(issue.ruleId) &&
      predicate(issue),
  );
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

// --- sm orphans -----------------------------------------------------------

export class OrphansCommand extends Command {
  static override paths = [['orphans']];
  static override usage = Command.Usage({
    category: 'Browse',
    description:
      'List orphan / auto-rename issues from the last scan. --json emits an array conforming to issue.schema.json.',
    details: `
      Surfaces every active issue with ruleId in
      (orphan, auto-rename-medium, auto-rename-ambiguous) so the user
      can decide whether to reconcile (forward) or undo-rename (reverse).

      Filter with --kind: orphan | medium | ambiguous.
    `,
    examples: [
      ['List every orphan / auto-rename issue', '$0 orphans'],
      ['Just the ambiguous ones, JSON', '$0 orphans --kind ambiguous --json'],
    ],
  });

  global = Option.Boolean('-g,--global', false);
  db = Option.String('--db', { required: false });
  kind = Option.String('--kind', { required: false });
  json = Option.Boolean('--json', false);
  quiet = Option.Boolean('--quiet', false);

  async execute(): Promise<number> {
    const elapsed = startElapsed();

    let ruleFilter: OrphanRuleId | null = null;
    if (this.kind !== undefined) {
      const map: Record<string, OrphanRuleId> = {
        orphan: 'orphan',
        medium: 'auto-rename-medium',
        ambiguous: 'auto-rename-ambiguous',
      };
      const resolved = map[this.kind];
      if (!resolved) {
        this.context.stderr.write(tx(ORPHANS_TEXTS.invalidKind, { kind: this.kind }));
        return ExitCode.Error;
      }
      ruleFilter = resolved;
    }

    const dbPath = resolveDbPath({ global: this.global, db: this.db });
    if (!assertDbExists(dbPath, this.context.stderr)) return ExitCode.NotFound;

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      const found = await findActiveOrphanIssues(adapter, (issue) => {
        if (ruleFilter !== null) return issue.ruleId === ruleFilter;
        return true;
      });

      if (this.json) {
        this.context.stdout.write(
          JSON.stringify(found.map((f) => f.issue)) + '\n',
        );
      } else if (found.length === 0) {
        this.context.stdout.write(ORPHANS_TEXTS.noIssues);
      } else {
        this.context.stdout.write(renderOrphans(found.map((f) => f.issue)));
      }

      emitDoneStderr(this.context.stderr, elapsed, this.quiet);
      return ExitCode.Ok;
    });
  }
}

// --- sm orphans reconcile -------------------------------------------------

export class OrphansReconcileCommand extends Command {
  static override paths = [['orphans', 'reconcile']];
  static override usage = Command.Usage({
    category: 'Browse',
    description:
      'Migrate state_* FKs from an orphan path to a live node, resolving the orphan issue.',
    details: `
      Forward direction: when the rename heuristic could not find a match
      (e.g. semantic-only rename, body rewrite), use this verb to attach
      the orphan's history to a live node.

      Validates that <new.path> exists in scan_nodes (exit 5 otherwise)
      and that an active orphan issue exists for <orphan.path> (exit 5
      otherwise). Migration is atomic via a single transaction.
    `,
    examples: [
      ['Reattach orphan history', '$0 orphans reconcile skills/old.md --to skills/new.md'],
    ],
  });

  global = Option.Boolean('-g,--global', false);
  db = Option.String('--db', { required: false });
  orphanPath = Option.String({ required: true });
  to = Option.String('--to', { required: true });
  dryRun = Option.Boolean('-n,--dry-run', false);
  quiet = Option.Boolean('--quiet', false);

  async execute(): Promise<number> {
    const elapsed = startElapsed();

    const dbPath = resolveDbPath({ global: this.global, db: this.db });
    if (!assertDbExists(dbPath, this.context.stderr)) return ExitCode.NotFound;

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      // 1. Validate <new.path> is a live node.
      const target = await adapter.scans.findNode(this.to);
      if (!target) {
        this.context.stderr.write(
          tx(ORPHANS_TEXTS.reconcileTargetNotFound, { path: this.to }),
        );
        return ExitCode.NotFound;
      }

      // 2. Find the active orphan issue for <orphan.path>.
      const candidates = await findActiveOrphanIssues(adapter, (issue) => {
        if (issue.ruleId !== 'orphan') return false;
        const dataPath = issue.data ? (issue.data['path'] as unknown) : undefined;
        return typeof dataPath === 'string' && dataPath === this.orphanPath;
      });
      if (candidates.length === 0) {
        this.context.stderr.write(
          tx(ORPHANS_TEXTS.reconcileNoActiveIssue, { path: this.orphanPath }),
        );
        return ExitCode.NotFound;
      }

      // 3. Migrate FKs and resolve every matching issue inside one tx.
      // `--dry-run` runs the same migration inside the transaction so the
      // same code path produces the report, then forces a rollback via
      // a sentinel throw — the spec § Dry-run contract is "no observable
      // side effects" and rolling back the transaction guarantees that
      // even if SQLite touched any pages they are reverted before commit.
      const orphanPath = this.orphanPath;
      const toPath = this.to;
      // Strict-equality check: Clipanion's `Option.Boolean` evaluator
      // returns a placeholder symbol BEFORE the parser runs (the field
      // type stays `boolean` from TS's view but the runtime value is
      // not `true` / `false`). Direct `if (this.dryRun)` would treat
      // that placeholder as truthy and silently flip every test that
      // constructs the command without going through Clipanion.
      const dryRun = this.dryRun === true;
      const summary = await runWithOptionalRollback(
        adapter.db,
        async (trx) => {
          const report = await migrateNodeFks(trx, orphanPath, toPath);
          if (!dryRun) {
            for (const cand of candidates) {
              await trx.deleteFrom('scan_issues').where('id', '=', cand.id).execute();
            }
          }
          return report;
        },
        dryRun,
      );

      const totalRows = summaryTotal(summary);
      const summaryVars = {
        from: this.orphanPath,
        to: this.to,
        rows: totalRows,
        jobs: summary.jobs,
        execs: summary.executions,
        summaries: summary.summaries,
        enrichments: summary.enrichments,
        kv: summary.pluginKvs,
      };
      this.context.stdout.write(
        tx(
          dryRun ? ORPHANS_TEXTS.reconcileWouldMigrate : ORPHANS_TEXTS.reconcileSummary,
          summaryVars,
        ),
      );
      if (summary.collisions.length > 0) {
        this.context.stderr.write(
          tx(
            dryRun
              ? ORPHANS_TEXTS.reconcileCollisionsNoteDryRun
              : ORPHANS_TEXTS.reconcileCollisionsNote,
            { count: summary.collisions.length },
          ),
        );
      }
      emitDoneStderr(this.context.stderr, elapsed, this.quiet);
      return ExitCode.Ok;
    });
  }
}

// --- sm orphans undo-rename ----------------------------------------------

export class OrphansUndoRenameCommand extends Command {
  static override paths = [['orphans', 'undo-rename']];
  static override usage = Command.Usage({
    category: 'Browse',
    description:
      'Reverse a medium- or ambiguous-confidence auto-rename. Migrates state_* FKs back, emits a new orphan on the prior path.',
    details: `
      Use when the rename heuristic auto-migrated history to a node that
      turned out to be unrelated.

      For an active auto-rename-medium issue on <new.path>, the prior
      path is read from issue.data.from — omit --from. For an active
      auto-rename-ambiguous issue, --from <old.path> is REQUIRED to
      pick a candidate from data.candidates.

      Destructive (changes FK ownership). Prompts for confirmation
      unless --force.
    `,
    examples: [
      ['Undo a medium-confidence auto-rename', '$0 orphans undo-rename skills/new.md'],
      ['Undo an ambiguous, picking a candidate', '$0 orphans undo-rename skills/new.md --from skills/old-a.md'],
    ],
  });

  global = Option.Boolean('-g,--global', false);
  db = Option.String('--db', { required: false });
  newPath = Option.String({ required: true });
  from = Option.String('--from', { required: false });
  force = Option.Boolean('--force', false);
  dryRun = Option.Boolean('-n,--dry-run', false);
  quiet = Option.Boolean('--quiet', false);

  async execute(): Promise<number> {
    const elapsed = startElapsed();

    const dbPath = resolveDbPath({ global: this.global, db: this.db });
    if (!assertDbExists(dbPath, this.context.stderr)) return ExitCode.NotFound;

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      // Find the active auto-rename-medium / -ambiguous issue on <new.path>.
      const candidates = await findActiveOrphanIssues(adapter, (issue) => {
        if (issue.ruleId !== 'auto-rename-medium' && issue.ruleId !== 'auto-rename-ambiguous') {
          return false;
        }
        return issue.nodeIds.includes(this.newPath);
      });

      if (candidates.length === 0) {
        this.context.stderr.write(
          tx(ORPHANS_TEXTS.undoNoActiveIssue, { path: this.newPath }),
        );
        return ExitCode.NotFound;
      }
      if (candidates.length > 1) {
        this.context.stderr.write(
          tx(ORPHANS_TEXTS.undoMultipleActive, {
            count: candidates.length,
            path: this.newPath,
          }),
        );
        return ExitCode.Error;
      }

      const candidate = candidates[0]!;
      const issue = candidate.issue;

      const resolved = this.#resolveFrom(issue);
      if (!resolved.ok) return resolved.exitCode;
      const resolvedFrom = resolved.from;

      // Destructive — confirm unless --force OR --dry-run. Per spec
      // § Dry-run: "Dry-run MUST NOT depend on --yes / --force ...
      // (no confirmation needed when nothing is being destroyed)".
      // Strict equality: see the placeholder note further down.
      if (this.force !== true && this.dryRun !== true) {
        const ok = await confirm(
          tx(ORPHANS_TEXTS.undoConfirmPrompt, {
            newPath: this.newPath,
            from: resolvedFrom,
          }),
          { stdin: this.context.stdin, stderr: this.context.stderr },
        );
        if (!ok) {
          this.context.stderr.write(ORPHANS_TEXTS.aborted);
          return ExitCode.Error;
        }
      }

      const newPath = this.newPath;
      const toPath = resolvedFrom;
      // Strict-equality check: Clipanion's `Option.Boolean` evaluator
      // returns a placeholder symbol BEFORE the parser runs (the field
      // type stays `boolean` from TS's view but the runtime value is
      // not `true` / `false`). Direct `if (this.dryRun)` would treat
      // that placeholder as truthy and silently flip every test that
      // constructs the command without going through Clipanion.
      const dryRun = this.dryRun === true;
      const summary = await runWithOptionalRollback(
        adapter.db,
        async (trx) => {
          const report = await migrateNodeFks(trx, newPath, toPath);
          if (!dryRun) {
            await trx
              .deleteFrom('scan_issues')
              .where('id', '=', candidate.id)
              .execute();
            // Per spec: "the previous path becomes an `orphan`". The new
            // path (which the file in FS still has) inherits no rows, so
            // the orphan path is the OLD path the FKs just landed on.
            await trx
              .insertInto('scan_issues')
              .values({
                ruleId: 'orphan',
                severity: 'info',
                nodeIdsJson: JSON.stringify([toPath]),
                linkIndicesJson: null,
                message: `Orphan history: ${toPath} (was reverted from auto-rename to ${newPath}).`,
                detail: null,
                fixJson: null,
                dataJson: JSON.stringify({ path: toPath }),
              })
              .execute();
          }
          return report;
        },
        dryRun,
      );

      this.context.stdout.write(
        tx(dryRun ? ORPHANS_TEXTS.undoWouldMigrate : ORPHANS_TEXTS.undoSummary, {
          newPath: this.newPath,
          from: resolvedFrom,
          rows: summaryTotal(summary),
        }),
      );
      emitDoneStderr(this.context.stderr, elapsed, this.quiet);
      return ExitCode.Ok;
    });
  }

  /**
   * Resolve the prior path the FK migration should target. Pulled out of
   * `execute()` so the destructive verb's main control flow stays
   * linear (validate → resolve → confirm → migrate). Dispatches to a
   * per-ruleId helper to keep cyclomatic complexity below the lint
   * threshold; the dispatcher itself is the discriminated-union pattern
   * AGENTS.md whitelists, but here we keep it simple.
   */
  #resolveFrom(
    issue: Issue,
  ): { ok: true; from: string } | { ok: false; exitCode: number } {
    if (issue.ruleId === 'auto-rename-medium') return this.#resolveFromMedium(issue);
    return this.#resolveFromAmbiguous(issue);
  }

  #resolveFromMedium(
    issue: Issue,
  ): { ok: true; from: string } | { ok: false; exitCode: number } {
    const dataFrom = issue.data ? (issue.data['from'] as unknown) : undefined;
    if (typeof dataFrom !== 'string') {
      this.context.stderr.write(ORPHANS_TEXTS.undoMediumMissingFrom);
      return { ok: false, exitCode: ExitCode.Error };
    }
    if (this.from !== undefined && this.from !== dataFrom) {
      this.context.stderr.write(
        tx(ORPHANS_TEXTS.undoMediumFromMismatch, { from: this.from, dataFrom }),
      );
      return { ok: false, exitCode: ExitCode.Error };
    }
    return { ok: true, from: dataFrom };
  }

  #resolveFromAmbiguous(
    issue: Issue,
  ): { ok: true; from: string } | { ok: false; exitCode: number } {
    if (this.from === undefined) {
      this.context.stderr.write(ORPHANS_TEXTS.undoAmbiguousRequiresFrom);
      return { ok: false, exitCode: ExitCode.NotFound };
    }
    const dataCandidates = issue.data ? issue.data['candidates'] : undefined;
    if (!isStringArray(dataCandidates) || !dataCandidates.includes(this.from)) {
      this.context.stderr.write(
        tx(ORPHANS_TEXTS.undoAmbiguousNotInCandidates, { from: this.from }),
      );
      return { ok: false, exitCode: ExitCode.NotFound };
    }
    return { ok: true, from: this.from };
  }
}

// --- shared dry-run helper ------------------------------------------------

/**
 * Sentinel symbol used to force a Kysely transaction rollback in
 * `--dry-run` mode without conflating with real errors. The caller
 * captures it after the transaction promise rejects and rethrows
 * anything else.
 */
const DRY_RUN_ROLLBACK = Symbol('orphans:dry-run-rollback');

/**
 * Run `body` inside a Kysely transaction. When `dryRun` is true, the
 * helper throws the rollback sentinel after capturing `body`'s return
 * value so SQLite reverts every page touched by the body — the spec
 * § Dry-run "no observable side effects" guarantee. The return value
 * is propagated either way.
 *
 * Reasoning: `migrateNodeFks` is a complex multi-table mutation; we
 * want the dry-run preview to come from the SAME code path as the
 * live mode (no parallel "count" implementation that could drift).
 * A throw-to-rollback gives that for free.
 */
async function runWithOptionalRollback(
  db: Kysely<IDatabase>,
  body: (trx: Parameters<Parameters<ReturnType<Kysely<IDatabase>['transaction']>['execute']>[0]>[0]) => Promise<IMigrateNodeFksReport>,
  dryRun: boolean,
): Promise<IMigrateNodeFksReport> {
  let captured: IMigrateNodeFksReport | undefined;
  try {
    return await db.transaction().execute(async (trx) => {
      const report = await body(trx);
      if (dryRun) {
        captured = report;
        throw DRY_RUN_ROLLBACK;
      }
      return report;
    });
  } catch (err) {
    if (err === DRY_RUN_ROLLBACK && captured !== undefined) return captured;
    throw err;
  }
}

function summaryTotal(s: IMigrateNodeFksReport): number {
  return s.jobs + s.executions + s.summaries + s.enrichments + s.pluginKvs;
}

// --- renderers ------------------------------------------------------------

function renderOrphans(issues: Issue[]): string {
  const lines: string[] = [];
  lines.push('Active orphan / auto-rename issues:');
  for (const issue of issues) {
    const subject = issue.nodeIds[0] ?? '(no node)';
    lines.push(`  [${issue.ruleId}] ${subject} — ${issue.message}`);
  }
  lines.push('');
  return lines.join('\n');
}

export const ORPHANS_COMMANDS = [
  OrphansCommand,
  OrphansReconcileCommand,
  OrphansUndoRenameCommand,
];
