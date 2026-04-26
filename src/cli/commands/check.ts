/**
 * `sm check [--json]`
 *
 * Print every current issue from `scan_issues`. Equivalent to
 * `sm scan --json | jq '.issues'` but reads from the persisted snapshot,
 * so it skips the entire walk + detect + rule pipeline.
 *
 * Exit codes (per `spec/cli-contract.md` §Exit codes):
 *   0  ok — no error-severity issues (warns / infos do not fail the verb)
 *   1  one or more issues at severity `error`
 *   5  DB file missing — run `sm scan` first
 *
 * The `1` ≠ `0` boundary intentionally mirrors `sm scan`'s contract: an
 * agent / CI loop can use `sm check` as a fast pre-flight without paying
 * for a full walk.
 */

import { Command, Option } from 'clipanion';

import { SqliteStorageAdapter } from '../../kernel/adapters/sqlite/index.js';
import { rowToIssue } from '../../kernel/adapters/sqlite/scan-load.js';
import type { Issue, Severity } from '../../kernel/types.js';
import { assertDbExists, resolveDbPath } from '../util/db-path.js';

const SEVERITY_ORDER: Severity[] = ['error', 'warn', 'info'];

export class CheckCommand extends Command {
  static override paths = [['check']];
  static override usage = Command.Usage({
    category: 'Browse',
    description: 'Print all current issues (reads from DB, faster than sm scan --json | jq).',
    details: `
      Loads every row from scan_issues. Exits 1 if any issue has
      severity \`error\`, otherwise 0. \`warn\` and \`info\` do not fail.

      Run \`sm scan\` first to populate the DB.
    `,
    examples: [
      ['Print every current issue', '$0 check'],
      ['Machine-readable issue list', '$0 check --json'],
    ],
  });

  global = Option.Boolean('-g,--global', false);
  db = Option.String('--db', { required: false });
  json = Option.Boolean('--json', false);

  async execute(): Promise<number> {
    const dbPath = resolveDbPath({ global: this.global, db: this.db });
    if (!assertDbExists(dbPath, this.context.stderr)) return 5;

    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    await adapter.init();
    try {
      const rows = await adapter.db.selectFrom('scan_issues').selectAll().execute();
      const issues = rows.map(rowToIssue);

      if (this.json) {
        this.context.stdout.write(JSON.stringify(issues) + '\n');
      } else if (issues.length === 0) {
        this.context.stdout.write('No issues.\n');
      } else {
        this.context.stdout.write(renderHuman(issues));
      }

      return issues.some((i) => i.severity === 'error') ? 1 : 0;
    } finally {
      await adapter.close();
    }
  }
}

function renderHuman(issues: Issue[]): string {
  // Group by severity (errors first, then warns, then infos) so the
  // most actionable rows are at the top of the output.
  const grouped = new Map<Severity, Issue[]>();
  for (const sev of SEVERITY_ORDER) grouped.set(sev, []);
  for (const issue of issues) {
    const bucket = grouped.get(issue.severity);
    if (bucket) bucket.push(issue);
    else grouped.set(issue.severity, [issue]);
  }

  const lines: string[] = [];
  for (const sev of SEVERITY_ORDER) {
    const bucket = grouped.get(sev) ?? [];
    for (const issue of bucket) {
      lines.push(
        `[${issue.severity}] ${issue.ruleId}: ${issue.message} — ${issue.nodeIds.join(', ')}`,
      );
    }
  }
  return lines.join('\n') + '\n';
}
