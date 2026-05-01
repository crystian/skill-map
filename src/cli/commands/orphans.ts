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
import { rowToIssue } from '../../kernel/adapters/sqlite/scan-load.js';
import type { IDatabase, IScanIssuesTable } from '../../kernel/adapters/sqlite/schema.js';
import type { Issue } from '../../kernel/types.js';
import { assertDbExists, resolveDbPath } from '../util/db-path.js';
import { confirm } from '../util/confirm.js';
import { emitDoneStderr, startElapsed } from '../util/elapsed.js';
import { ExitCode } from '../util/exit-codes.js';
import { withSqlite } from '../util/with-sqlite.js';
import type { Kysely, Selectable } from 'kysely';

const ORPHAN_RULE_IDS = ['orphan', 'auto-rename-medium', 'auto-rename-ambiguous'] as const;
type OrphanRuleId = typeof ORPHAN_RULE_IDS[number];

// --- shared helpers -------------------------------------------------------

type IIssueRow = Selectable<IScanIssuesTable>;

async function findActiveIssues(
  db: Kysely<IDatabase>,
  predicate: (issue: Issue) => boolean,
): Promise<Array<{ row: IIssueRow; issue: Issue }>> {
  const rows = await db
    .selectFrom('scan_issues')
    .selectAll()
    .where('ruleId', 'in', [...ORPHAN_RULE_IDS])
    .execute();
  const out: Array<{ row: IIssueRow; issue: Issue }> = [];
  for (const row of rows) {
    const issue = rowToIssue(row);
    if (predicate(issue)) out.push({ row, issue });
  }
  return out;
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
        this.context.stderr.write(
          `--kind: invalid value "${this.kind}". Allowed: orphan, medium, ambiguous.\n`,
        );
        return ExitCode.Error;
      }
      ruleFilter = resolved;
    }

    const dbPath = resolveDbPath({ global: this.global, db: this.db });
    if (!assertDbExists(dbPath, this.context.stderr)) return ExitCode.NotFound;

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      const found = await findActiveIssues(adapter.db, (issue) => {
        if (ruleFilter !== null) return issue.ruleId === ruleFilter;
        return true;
      });

      if (this.json) {
        this.context.stdout.write(
          JSON.stringify(found.map((f) => f.issue)) + '\n',
        );
      } else if (found.length === 0) {
        this.context.stdout.write('No orphan / auto-rename issues.\n');
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
  quiet = Option.Boolean('--quiet', false);

  async execute(): Promise<number> {
    const elapsed = startElapsed();

    const dbPath = resolveDbPath({ global: this.global, db: this.db });
    if (!assertDbExists(dbPath, this.context.stderr)) return ExitCode.NotFound;

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      // 1. Validate <new.path> is a live node.
      const newNode = await adapter.db
        .selectFrom('scan_nodes')
        .select(['path'])
        .where('path', '=', this.to)
        .executeTakeFirst();
      if (!newNode) {
        this.context.stderr.write(
          `sm orphans reconcile: target node "${this.to}" not found in scan_nodes.\n`,
        );
        return ExitCode.NotFound;
      }

      // 2. Find the active orphan issue for <orphan.path>.
      const candidates = await findActiveIssues(adapter.db, (issue) => {
        if (issue.ruleId !== 'orphan') return false;
        const dataPath = issue.data ? (issue.data['path'] as unknown) : undefined;
        return typeof dataPath === 'string' && dataPath === this.orphanPath;
      });
      if (candidates.length === 0) {
        this.context.stderr.write(
          `sm orphans reconcile: no active orphan issue found for "${this.orphanPath}".\n`,
        );
        return ExitCode.NotFound;
      }

      // 3. Migrate FKs and resolve every matching issue inside one tx.
      const orphanPath = this.orphanPath;
      const toPath = this.to;
      const summary = await adapter.db.transaction().execute(async (trx) => {
        const report = await migrateNodeFks(trx, orphanPath, toPath);
        for (const cand of candidates) {
          await trx.deleteFrom('scan_issues').where('id', '=', cand.row.id).execute();
        }
        return report;
      });

      this.context.stdout.write(
        `Reconciled ${this.orphanPath} → ${this.to}. ` +
          `Migrated ${summary.jobs + summary.executions + summary.summaries + summary.enrichments + summary.pluginKvs} ` +
          `state rows ` +
          `(jobs:${summary.jobs}, execs:${summary.executions}, summaries:${summary.summaries}, ` +
          `enrichments:${summary.enrichments}, kv:${summary.pluginKvs}).\n`,
      );
      if (summary.collisions.length > 0) {
        this.context.stderr.write(
          `Note: ${summary.collisions.length} composite-PK collision(s); destination rows preserved (see spec/db-schema.md §Rename detection).\n`,
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
  quiet = Option.Boolean('--quiet', false);

  async execute(): Promise<number> {
    const elapsed = startElapsed();

    const dbPath = resolveDbPath({ global: this.global, db: this.db });
    if (!assertDbExists(dbPath, this.context.stderr)) return ExitCode.NotFound;

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      // Find the active auto-rename-medium / -ambiguous issue on <new.path>.
      const candidates = await findActiveIssues(adapter.db, (issue) => {
        if (issue.ruleId !== 'auto-rename-medium' && issue.ruleId !== 'auto-rename-ambiguous') {
          return false;
        }
        return issue.nodeIds.includes(this.newPath);
      });

      if (candidates.length === 0) {
        this.context.stderr.write(
          `sm orphans undo-rename: no active auto-rename issue targets "${this.newPath}".\n`,
        );
        return ExitCode.NotFound;
      }
      if (candidates.length > 1) {
        this.context.stderr.write(
          `sm orphans undo-rename: ${candidates.length} active auto-rename issues target "${this.newPath}"; the rename heuristic should have produced at most one. Run \`sm scan\` and retry.\n`,
        );
        return ExitCode.Error;
      }

      const candidate = candidates[0]!;
      const issue = candidate.issue;

      let resolvedFrom: string;
      if (issue.ruleId === 'auto-rename-medium') {
        const dataFrom = issue.data ? (issue.data['from'] as unknown) : undefined;
        if (typeof dataFrom !== 'string') {
          this.context.stderr.write(
            `sm orphans undo-rename: auto-rename-medium issue is missing data.from; cannot revert without --from.\n`,
          );
          return ExitCode.Error;
        }
        if (this.from !== undefined && this.from !== dataFrom) {
          this.context.stderr.write(
            `sm orphans undo-rename: --from "${this.from}" does not match auto-rename-medium data.from "${dataFrom}".\n`,
          );
          return ExitCode.Error;
        }
        resolvedFrom = dataFrom;
      } else {
        // ambiguous
        if (this.from === undefined) {
          this.context.stderr.write(
            `sm orphans undo-rename: --from <old.path> is REQUIRED for auto-rename-ambiguous (pick one of data.candidates).\n`,
          );
          return ExitCode.NotFound;
        }
        const dataCandidates = issue.data ? issue.data['candidates'] : undefined;
        if (!isStringArray(dataCandidates) || !dataCandidates.includes(this.from)) {
          this.context.stderr.write(
            `sm orphans undo-rename: --from "${this.from}" not in auto-rename-ambiguous candidates.\n`,
          );
          return ExitCode.NotFound;
        }
        resolvedFrom = this.from;
      }

      // Destructive — confirm unless --force.
      if (!this.force) {
        const ok = await confirm(
          `Undo auto-rename: migrate state_* FKs from ${this.newPath} back to ${resolvedFrom}?`,
        );
        if (!ok) {
          this.context.stderr.write('Aborted.\n');
          return ExitCode.Error;
        }
      }

      const newPath = this.newPath;
      const toPath = resolvedFrom;
      const summary = await adapter.db.transaction().execute(async (trx) => {
        const report = await migrateNodeFks(trx, newPath, toPath);
        await trx
          .deleteFrom('scan_issues')
          .where('id', '=', candidate.row.id)
          .execute();
        // Per spec: "the previous path becomes an `orphan`". The new path
        // (which the file in FS still has) inherits no rows, so the
        // orphan path is the OLD path the FKs just landed on.
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
        return report;
      });

      this.context.stdout.write(
        `Reverted ${this.newPath} → ${resolvedFrom}. ` +
          `Migrated ${summary.jobs + summary.executions + summary.summaries + summary.enrichments + summary.pluginKvs} ` +
          `state rows; new orphan issue emitted on ${resolvedFrom}.\n`,
      );
      emitDoneStderr(this.context.stderr, elapsed, this.quiet);
      return ExitCode.Ok;
    });
  }
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
