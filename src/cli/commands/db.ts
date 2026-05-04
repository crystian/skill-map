/**
 * `sm db` — database lifecycle verbs. Backup, restore, reset, shell, dump,
 * migrate. Destructive verbs (`restore`, `reset --state`, `reset --hard`)
 * require interactive confirmation unless `--yes` / `--force` is passed, per
 * spec/cli-contract.md §Database.
 *
 * Exit codes follow spec/cli-contract.md:
 *   0  ok
 *   2  error (unhandled / config / user aborted)
 *   5  not-found
 */

import { spawn, spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { withSqlite } from '../util/with-sqlite.js';
import { confirm } from '../util/confirm.js';
import { tx } from '../../kernel/util/tx.js';
import { DB_TEXTS } from '../i18n/db.texts.js';

import { Command, Option } from 'clipanion';

import { createSqliteStorage } from '../../kernel/adapters/sqlite/index.js';
import type { StoragePort } from '../../kernel/ports/storage.js';
import type { IPluginApplyResult } from '../../kernel/adapters/sqlite/plugin-migrations.js';
import type { IDiscoveredPlugin } from '../../kernel/types/plugin.js';
import { assertDbExists, resolveDbPath } from '../util/db-path.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { ExitCode } from '../util/exit-codes.js';
import { formatErrorMessage } from '../util/error-reporter.js';
import { pathExists, statOrNull } from '../util/fs.js';
import {
  emptyPluginRuntime,
  loadPluginRuntime,
} from '../util/plugin-runtime.js';
import { SmCommand } from '../util/sm-command.js';

const SAFE_SQL_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Reject any sqlite_master row name that is not a plain identifier before
 * it reaches a `db.exec` statement. The catalog filter `LIKE 'scan_%'`
 * (and optional `state_%`) shipped above is the primary line of defence;
 * this function is the second layer.
 */
function assertSafeIdentifier(name: string): void {
  if (!SAFE_SQL_IDENTIFIER_RE.test(name)) {
    throw new Error(`refusing to operate on non-identifier table name: ${JSON.stringify(name)}`);
  }
}

/**
 * Force `0o600` perms on a file, swallowing failures (Windows / non-POSIX
 * filesystems may reject `chmod`). Used after `db restore` to keep the
 * restored DB owner-readable only — see audit L4.
 */
async function chmodOwnerOnlyBestEffort(target: string): Promise<void> {
  try {
    await chmod(target, 0o600);
  } catch {
    // Best effort — the DB is already in place; tightening perms is a
    // hardening pass, not a correctness gate.
  }
}

// --- backup ---------------------------------------------------------------

export class DbBackupCommand extends SmCommand {
  static override paths = [['db', 'backup']];
  static override usage = Command.Usage({
    category: 'Database',
    description: 'WAL checkpoint + copy the DB file to a backup.',
    details: `
      Default output: <db-dir>/backups/<timestamp>.db. Use --out to override.
      scan_* is regenerated on demand and is NOT excluded from the raw file
      copy, but restoring a backup over a live DB is the expected use —
      running sm scan afterwards refreshes scan_*.
    `,
  });

  out = Option.String('--out', { required: false });

  protected async run(): Promise<number> {
    const path = resolveDbPath({ global: this.global, db: this.db, ...defaultRuntimeContext() });
    if (!assertDbExists(path, this.context.stderr)) return ExitCode.NotFound;

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = this.out ? resolve(this.out) : join(dirname(path), 'backups', `${ts}.db`);

    // Route through the storage port — the port's `writeBackup` does
    // the WAL checkpoint, parent-directory creation, and atomic file
    // copy in one call. `autoMigrate: false` keeps the open from
    // touching schema; `autoBackup: false` is implied because no
    // migrations run. The verb composes `outPath` (timestamp default
    // or `--out` override) and hands it to the port.
    await withSqlite({ databasePath: path, autoMigrate: false }, async (storage) => {
      storage.migrations.writeBackup(outPath);
    });

    this.context.stdout.write(tx(DB_TEXTS.backupWritten, { outPath }));
    return ExitCode.Ok;
  }
}

// --- restore --------------------------------------------------------------

export class DbRestoreCommand extends SmCommand {
  static override paths = [['db', 'restore']];
  static override usage = Command.Usage({
    category: 'Database',
    description: 'Replace the active DB file with a backup.',
    details: `
      Destructive. Requires interactive confirmation unless --yes / --force
      is passed. scan_* will be re-populated by the next sm scan.
      With --dry-run: previews the swap (source size, target overwrite
      status, sidecars to drop) without copying or deleting anything.
      Dry-run bypasses the confirmation prompt.
    `,
  });

  source = Option.String({ required: true });
  yes = Option.Boolean('--yes,--force', false);
  dryRun = Option.Boolean('-n,--dry-run', false, {
    description: 'Preview the restore without overwriting the live DB.',
  });

  protected async run(): Promise<number> {
    const target = resolveDbPath({ global: this.global, db: this.db, ...defaultRuntimeContext() });
    const sourcePath = resolve(this.source);

    const sourceStat = await statOrNull(sourcePath);
    if (!sourceStat) {
      this.context.stderr.write(tx(DB_TEXTS.restoreSourceNotFound, { sourcePath }));
      return ExitCode.NotFound;
    }

    if (this.dryRun) {
      this.context.stdout.write(DB_TEXTS.dryRunHeader);
      const sourceBytes = sourceStat.size;
      const targetClause = (await pathExists(target))
        ? DB_TEXTS.dryRunRestoreTargetExistsClause
        : DB_TEXTS.dryRunRestoreTargetMissingClause;
      this.context.stdout.write(
        tx(DB_TEXTS.dryRunRestoreWouldOverwrite, {
          sourcePath,
          sourceBytes,
          target,
          targetClause,
        }),
      );
      return ExitCode.Ok;
    }

    if (!this.yes) {
      const ok = await confirm(tx(DB_TEXTS.restoreConfirm, { sourcePath, target }), {
        stdin: this.context.stdin,
        stderr: this.context.stderr,
      });
      if (!ok) {
        this.context.stderr.write(DB_TEXTS.aborted);
        return ExitCode.Error;
      }
    }

    await mkdir(dirname(target), { recursive: true });
    await copyFile(sourcePath, target);
    // Defence in depth (audit L4): force restrictive owner-only perms on
    // the restored DB. Helper-extracted so the try/catch doesn't push
    // `execute` past the cyclomatic budget.
    await chmodOwnerOnlyBestEffort(target);
    // WAL sidecars from the old DB would be out of sync — delete them so
    // next open starts clean against the restored main file.
    for (const sidecar of [`${target}-wal`, `${target}-shm`]) {
      if (await pathExists(sidecar)) await rm(sidecar);
    }

    this.context.stdout.write(tx(DB_TEXTS.restoreDone, { sourcePath, target }));
    return ExitCode.Ok;
  }
}

// --- reset ----------------------------------------------------------------

export class DbResetCommand extends SmCommand {
  static override paths = [['db', 'reset']];
  static override usage = Command.Usage({
    category: 'Database',
    description: 'Drop scan_* (default), optionally state_*, or delete the DB entirely.',
    details: `
      Without flags: drops scan_* tables only. Non-destructive — no prompt.
      With --state: also drops state_* tables. Destructive — requires
      confirmation unless --yes / --force.
      With --hard: deletes the DB file entirely. Destructive — requires
      confirmation unless --yes / --force.
      With --dry-run: previews what would be cleared / deleted without
      touching the DB. Bypasses the confirmation prompt entirely (the
      preview itself is non-destructive).
    `,
  });

  state = Option.Boolean('--state', false);
  hard = Option.Boolean('--hard', false);
  yes = Option.Boolean('--yes,--force', false);
  dryRun = Option.Boolean('-n,--dry-run', false, {
    description: 'Preview the reset without dropping any tables or unlinking any files.',
  });

  // CLI orchestrator: --state vs --hard flag combo + --dry-run + --yes
  // confirm + per-mode actions. The early-return chain is the clearest
  // expression of the flag semantics; splitting per branch would
  // distance the validations from their guards.
  // eslint-disable-next-line complexity
  protected async run(): Promise<number> {
    if (this.state && this.hard) {
      this.context.stderr.write(DB_TEXTS.resetStateAndHardMutex);
      return ExitCode.Error;
    }

    const path = resolveDbPath({ global: this.global, db: this.db, ...defaultRuntimeContext() });

    if (this.hard) {
      if (this.dryRun) {
        this.context.stdout.write(DB_TEXTS.dryRunHeader);
        const dbStat = await statOrNull(path);
        const sizeBytes = dbStat ? dbStat.size : null;
        this.context.stdout.write(
          sizeBytes === null
            ? tx(DB_TEXTS.dryRunResetHardWouldDeleteMissing, { path })
            : tx(DB_TEXTS.dryRunResetHardWouldDelete, { path, sizeBytes }),
        );
        return ExitCode.Ok;
      }
      if (!this.yes) {
        const ok = await confirm(tx(DB_TEXTS.resetHardConfirm, { path }), {
          stdin: this.context.stdin,
          stderr: this.context.stderr,
        });
        if (!ok) {
          this.context.stderr.write(DB_TEXTS.aborted);
          return ExitCode.Error;
        }
      }
      for (const suffix of ['', '-wal', '-shm']) {
        const p = `${path}${suffix}`;
        if (await pathExists(p)) await rm(p);
      }
      this.context.stdout.write(tx(DB_TEXTS.resetHardDeleted, { path }));
      return ExitCode.Ok;
    }

    if (!assertDbExists(path, this.context.stderr)) return ExitCode.NotFound;

    if (this.state && !this.yes && !this.dryRun) {
      const ok = await confirm(tx(DB_TEXTS.resetStateConfirm, { path }), {
        stdin: this.context.stdin,
        stderr: this.context.stderr,
      });
      if (!ok) {
        this.context.stderr.write(DB_TEXTS.aborted);
        return ExitCode.Error;
      }
    }

    const db = new DatabaseSync(path);
    try {
      const rows = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'scan\\_%' ESCAPE '\\'"
            + (this.state ? " OR name LIKE 'state\\_%' ESCAPE '\\'" : '')
            + ')',
        )
        .all() as Array<{ name: string }>;

      // Defence in depth — the LIKE filter above already restricts
      // results to `scan_*` (and optionally `state_*`) catalog rows, but
      // the per-plugin migration validator approves DML in plugin-owned
      // tables. A future bug there could yield a row with an unsafe
      // name reaching this loop. Whitelist + double-quote before
      // interpolating into a statement that is exec'd as-is.
      for (const r of rows) assertSafeIdentifier(r.name);

      if (this.dryRun) {
        this.context.stdout.write(DB_TEXTS.dryRunHeader);
        if (rows.length === 0) {
          this.context.stdout.write(DB_TEXTS.dryRunResetWouldClearNone);
          return ExitCode.Ok;
        }
        // Probe row counts so the user sees the destructive scope. Read-
        // only queries — safe in dry-run.
        const withCounts = rows.map((r) => {
          const count = db.prepare(`SELECT COUNT(*) AS c FROM "${r.name}"`).get() as { c: number };
          return { name: r.name, rowCount: Number(count.c) };
        });
        const totalRows = withCounts.reduce((acc, r) => acc + r.rowCount, 0);
        const lines = withCounts.map((r) => `  - ${r.name}: ${r.rowCount} row(s)`).join('\n');
        this.context.stdout.write(
          tx(DB_TEXTS.dryRunResetWouldClearWithRowCounts, {
            tableCount: rows.length,
            totalRows,
            lines,
          }),
        );
        return ExitCode.Ok;
      }

      db.exec('BEGIN');
      for (const { name } of rows) {
        db.exec(`DELETE FROM "${name}"`);
      }
      db.exec('COMMIT');

      this.context.stdout.write(
        rows.length === 0
          ? DB_TEXTS.resetClearedNone
          : tx(DB_TEXTS.resetCleared, {
              tableCount: rows.length,
              tableNames: rows.map((r) => r.name).join(', '),
            }),
      );
    } finally {
      db.close();
    }
    return ExitCode.Ok;
  }
}

// --- shell ----------------------------------------------------------------

export class DbShellCommand extends SmCommand {
  static override paths = [['db', 'shell']];
  static override usage = Command.Usage({
    category: 'Database',
    description: 'Open an interactive sqlite3 shell on the DB file.',
    details: `
      Spawns the system sqlite3 binary. If sqlite3 is not on PATH, a
      clear error points at the two workarounds: install sqlite3, or use
      sm db dump for a read-only inspection.
    `,
  });

  // Interactive shell: the spawned `sqlite3` owns the terminal. No
  // `done in <…>` line — the user expects to see the shell's own
  // prompt + farewell, not a follow-up trailer once they exit.
  protected override emitElapsed = false;

  protected async run(): Promise<number> {
    const path = resolveDbPath({ global: this.global, db: this.db, ...defaultRuntimeContext() });
    if (!assertDbExists(path, this.context.stderr)) return ExitCode.NotFound;

    const result = spawnSync('sqlite3', [path], { stdio: 'inherit' });
    if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      this.context.stderr.write(DB_TEXTS.shellSqlite3NotFound);
      return ExitCode.Error;
    }
    return result.status ?? 0;
  }
}

// --- browser --------------------------------------------------------------

export class DbBrowserCommand extends SmCommand {
  static override paths = [['db', 'browser']];
  static override usage = Command.Usage({
    category: 'Database',
    description: 'Open the DB in DB Browser for SQLite (sqlitebrowser GUI).',
    details: `
      Default: read-only (-R), so a concurrent \`sm scan\` writer is safe.
      Pass --rw to enable writes.

      Resolution order for the DB path: positional arg > --db <path> >
      -g/--global > project default (cwd/.skill-map/skill-map.db).

      Spawns sqlitebrowser detached so the terminal stays usable. If
      sqlitebrowser is not on PATH, a clear error points at the install
      hint (Debian/Ubuntu: sudo apt install -y sqlitebrowser).
    `,
    examples: [
      ['Open the project DB read-only', 'sm db browser'],
      ['Open the project DB read-write', 'sm db browser --rw'],
      ['Open an arbitrary DB file', 'sm db browser path/to/other.db'],
    ],
  });

  // GUI launch: the spawned process is detached and unref'd; we exit
  // immediately. No `done in <…>` line — the user expects to see the
  // GUI window, not a follow-up trailer in the terminal.
  protected override emitElapsed = false;

  rw = Option.Boolean('--rw', false, {
    description:
      'Open in read-write mode. Default is read-only so a concurrent `sm scan` writer is safe.',
  });
  positional = Option.String({ required: false });

  protected async run(): Promise<number> {
    // Positional wins over `--db` / `-g/--global`; mirrors the legacy
    // `scripts/open-sqlite-browser.js` precedence so the cutover is a
    // pure rewire (no behaviour change for users).
    const path = this.positional
      ? resolve(this.positional)
      : resolveDbPath({ global: this.global, db: this.db, ...defaultRuntimeContext() });

    if (!assertDbExists(path, this.context.stderr)) {
      this.context.stderr.write(DB_TEXTS.browserRunScanFirstHint);
      return ExitCode.NotFound;
    }

    // Sniff the binary before spawning so missing sqlitebrowser gives a
    // clean install hint instead of a vague ENOENT trace.
    const which = spawnSync('which', ['sqlitebrowser'], { stdio: 'ignore' });
    if (which.status !== 0) {
      this.context.stderr.write(DB_TEXTS.browserNotFound);
      return ExitCode.Error;
    }

    const readOnly = !this.rw;
    const args = readOnly ? ['-R', path] : [path];

    this.context.stdout.write(
      tx(readOnly ? DB_TEXTS.browserOpeningReadOnly : DB_TEXTS.browserOpeningReadWrite, { path }),
    );

    const child = spawn('sqlitebrowser', args, { detached: true, stdio: 'ignore' });
    child.unref();
    return ExitCode.Ok;
  }
}

// --- dump -----------------------------------------------------------------

export class DbDumpCommand extends SmCommand {
  static override paths = [['db', 'dump']];
  static override usage = Command.Usage({
    category: 'Database',
    description: 'SQL dump to stdout.',
    details:
      'Read-only. Pure node:sqlite — no external `sqlite3` binary required. Use --tables <names...> to limit the dump to specific tables.',
  });

  tables = Option.Array('--tables', { required: false });

  protected async run(): Promise<number> {
    const path = resolveDbPath({ global: this.global, db: this.db, ...defaultRuntimeContext() });
    if (!assertDbExists(path, this.context.stderr)) return ExitCode.NotFound;

    if (this.tables && this.tables.length > 0) {
      for (const t of this.tables) {
        if (!SAFE_SQL_IDENTIFIER_RE.test(t)) {
          this.context.stderr.write(tx(DB_TEXTS.dumpInvalidTable, { table: t }));
          return ExitCode.Error;
        }
      }
    }

    try {
      dumpDatabaseToStream(path, this.context.stdout, this.tables ?? null);
      return ExitCode.Ok;
    } catch (err) {
      this.context.stderr.write(`sm db dump: ${(err as Error).message}\n`);
      return ExitCode.Error;
    }
  }
}

/**
 * Pure-node SQL dump. Equivalent (for the subset we care about) to the
 * sqlite3 CLI's `.dump` meta-command, but uses `node:sqlite` directly
 * so we have zero dependency on a system binary. Output format matches
 * what sqlite3's `.dump` produces closely enough to be loadable via
 * `sqlite3 newdb < dump.sql` or `cat dump.sql | sqlite3 newdb`:
 *
 *   - `PRAGMA foreign_keys=OFF;` first (avoids ordering issues on load)
 *   - `BEGIN TRANSACTION;` … `COMMIT;` envelope
 *   - All schema objects (`table`, `index`, `trigger`, `view`) in
 *     `rootpage` order — same as sqlite3's `.dump`. Internal tables
 *     (`sqlite_*`) are skipped.
 *   - For each user table, one `INSERT INTO "table" VALUES(…);` per row.
 *
 * `tables` filters BOTH the schema-object pass and the data pass to
 * the named tables. Identifiers are validated against
 * `SAFE_SQL_IDENTIFIER_RE` upstream so the literal interpolation in
 * the data query is safe.
 */
function dumpDatabaseToStream(
  dbPath: string,
  out: NodeJS.WritableStream,
  tables: string[] | null,
): void {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    out.write('PRAGMA foreign_keys=OFF;\n');
    out.write('BEGIN TRANSACTION;\n');

    const objects = listSchemaObjects(db, tables);

    // First pass: schema. Tables come before indices/triggers/views by
    // rootpage order, so a downstream `sqlite3 newdb < dump.sql` can
    // execute statements in declared order without dependency surprises.
    for (const obj of objects) {
      if (!obj.sql) continue; // sqlite_sequence has null sql, skip
      out.write(`${obj.sql};\n`);
    }

    // Second pass: data. Tables only.
    for (const obj of objects) {
      if (obj.type !== 'table') continue;
      writeTableData(db, out, obj.name);
    }

    out.write('COMMIT;\n');
  } finally {
    db.close();
  }
}

interface ISchemaObject {
  type: string;
  name: string;
  sql: string | null;
}

function listSchemaObjects(db: DatabaseSync, tables: string[] | null): ISchemaObject[] {
  const baseQuery =
    "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT LIKE 'sqlite_%'";
  if (tables === null || tables.length === 0) {
    return db.prepare(`${baseQuery} ORDER BY rootpage`).all() as unknown as ISchemaObject[];
  }
  // Filter applies to BOTH the table itself AND any index/trigger
  // attached to it — we look up `tbl_name` for non-table objects.
  const placeholders = tables.map(() => '?').join(',');
  const sql = `${baseQuery} AND (name IN (${placeholders}) OR tbl_name IN (${placeholders})) ORDER BY rootpage`;
  return db.prepare(sql).all(...tables, ...tables) as unknown as ISchemaObject[];
}

function writeTableData(db: DatabaseSync, out: NodeJS.WritableStream, tableName: string): void {
  // Identifier already vetted by SAFE_SQL_IDENTIFIER_RE (alphanumeric +
  // underscore, must start with letter / underscore). Quote anyway so a
  // future relaxation of the validator doesn't open an injection path.
  const quoted = `"${tableName.replace(/"/g, '""')}"`;
  for (const row of db.prepare(`SELECT * FROM ${quoted}`).iterate()) {
    const values = Object.values(row as Record<string, unknown>).map(formatSqlValue).join(',');
    out.write(`INSERT INTO ${quoted} VALUES(${values});\n`);
  }
}

/** Number → SQL literal. NaN / ±Infinity collapse to NULL (sqlite has no
 *  literal for either). */
function formatSqlNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : 'NULL';
}

/** SQL literal serialiser. Mirrors sqlite3 `.dump`'s formatting. */
function formatSqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return formatSqlNumber(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`;
  // Strings — single-quote, escape internal single quotes by doubling.
  return `'${String(value).replace(/'/g, "''")}'`;
}

// --- migrate --------------------------------------------------------------

export class DbMigrateCommand extends SmCommand {
  static override paths = [['db', 'migrate']];
  static override usage = Command.Usage({
    category: 'Database',
    description: 'Apply pending kernel + plugin migrations (default) or inspect plan.',
    details: `
      --dry-run       show pending migrations without applying.
      --status        print applied vs pending summary and exit.
      --to <n>        apply up to (and including) version N (kernel only).
      --no-backup     skip the pre-apply backup.
      --kernel-only   skip plugin migrations entirely.
      --plugin <id>   run only that plugin's migrations (skips kernel migrations).

      Plugin migrations live under <plugin-dir>/migrations/ and follow
      the same NNN_snake_case.sql convention as kernel migrations. Each
      migration is gated by a triple-protection rule: every object it
      creates / alters / drops MUST live in the namespace
      \`plugin_<normalizedId>_*\`. Layer 1 validates every pending file
      before anything runs; Layer 2 re-validates immediately before
      apply; Layer 3 sweeps sqlite_master after apply and reports any
      object outside the prefix.
    `,
  });

  dryRun = Option.Boolean('-n,--dry-run', false);
  status = Option.Boolean('--status', false);
  to = Option.String('--to', { required: false });
  noBackup = Option.Boolean('--no-backup', false);
  kernelOnly = Option.Boolean('--kernel-only', false);
  pluginId = Option.String('--plugin', { required: false });

  // Multi-flag CLI orchestrator: validates flag combos, optionally
  // discovers plugins, fans out into status / apply branches against
  // both the kernel ledger and per-plugin ledgers. Splitting per branch
  // would scatter the close-to-call-site flag handling without making
  // the verb easier to follow.
  // eslint-disable-next-line complexity
  protected async run(): Promise<number> {
    if (this.kernelOnly && this.pluginId !== undefined) {
      this.context.stderr.write(DB_TEXTS.migrateKernelOnlyAndPluginMutex);
      return ExitCode.Error;
    }

    const path = resolveDbPath({ global: this.global, db: this.db, ...defaultRuntimeContext() });

    if (path !== ':memory:') await mkdir(dirname(path), { recursive: true });

    // `autoMigrate: false` keeps the adapter from running migrations
    // on init() — the verb itself orchestrates the apply (or skips it
    // for `--status` / `--dry-run`). The migrations namespace's
    // methods open their own short-lived raw `DatabaseSync` handles
    // internally; the adapter's Kysely connection is unused by this
    // verb.
    const adapter = createSqliteStorage({
      databasePath: path,
      autoMigrate: false,
    });
    await adapter.init();
    try {
      const files = adapter.migrations.discover();

      // --- discover plugins for everything but --kernel-only -----------
      // We always need the plugin set for `--status` and the apply path
      // when plugin migrations are in play. Skip discovery only when the
      // user explicitly asked for kernel-only mode.
      const pluginRuntime = this.kernelOnly
        ? emptyPluginRuntime()
        : await loadPluginRuntime({ scope: this.global ? 'global' : 'project' });
      for (const warn of pluginRuntime.warnings) {
        this.context.stderr.write(`${warn}\n`);
      }
      const dedicated = pluginRuntime.discovered.filter(
        (p) => p.status === 'enabled' && p.manifest?.storage?.mode === 'dedicated',
      );
      const targetedPlugins = this.pluginId !== undefined
        ? dedicated.filter((p) => p.id === this.pluginId)
        : dedicated;

      if (this.pluginId !== undefined && targetedPlugins.length === 0) {
        this.context.stderr.write(
          tx(DB_TEXTS.migratePluginNotFound, { pluginId: this.pluginId }),
        );
        return ExitCode.NotFound;
      }

      // --- status branch (read-only summary) ---------------------------
      if (this.status) {
        if (!this.pluginId) {
          const plan = adapter.migrations.plan(files);
          this.context.stdout.write(
            tx(DB_TEXTS.migrateStatusKernelHeader, {
              applied: plan.applied.length, pending: plan.pending.length,
            }),
          );
          for (const f of plan.pending) {
            this.context.stdout.write(
              tx(DB_TEXTS.migrateStatusPending, { name: formatKernelName(f.version, f.description) }),
            );
          }
          for (const r of plan.applied) {
            this.context.stdout.write(
              tx(DB_TEXTS.migrateStatusApplied, { name: formatKernelName(r.version, r.description) }),
            );
          }
        }
        if (!this.kernelOnly) {
          for (const plugin of targetedPlugins) {
            const plan = adapter.pluginMigrations.plan(plugin);
            this.context.stdout.write(
              tx(DB_TEXTS.migrateStatusPluginHeader, {
                pluginId: plugin.id,
                applied: plan.applied.length,
                pending: plan.pending.length,
              }),
            );
            for (const f of plan.pending) {
              this.context.stdout.write(
                tx(DB_TEXTS.migrateStatusPending, { name: formatKernelName(f.version, f.description) }),
              );
            }
            for (const r of plan.applied) {
              this.context.stdout.write(
                tx(DB_TEXTS.migrateStatusApplied, { name: formatKernelName(r.version, r.description) }),
              );
            }
          }
        }
        return ExitCode.Ok;
      }

      // `Number.parseInt` is permissive: it accepts `'123abc'` as `123`
      // and negatives. Reject anything that isn't a clean non-negative
      // integer so a typo doesn't silently roll the migration ledger to
      // an unexpected target.
      let toValue: number | undefined;
      if (this.to !== undefined) {
        const trimmed = this.to.trim();
        const parsed = Number.parseInt(trimmed, 10);
        if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== trimmed) {
          this.context.stderr.write(tx(DB_TEXTS.migrateInvalidTo, { to: this.to }));
          return ExitCode.Error;
        }
        toValue = parsed;
      }

      // --- kernel pass --------------------------------------------------
      // Skipped under `--plugin <id>`: that mode targets a single plugin
      // and is not meant to advance the kernel ledger.
      let kernelApplied: number | undefined;
      let backupPath: string | null = null;
      if (this.pluginId === undefined) {
        const options: { backup: boolean; dryRun: boolean; to?: number } = {
          backup: !this.noBackup,
          dryRun: this.dryRun,
        };
        if (toValue !== undefined) options.to = toValue;

        const result = adapter.migrations.apply(options, files);
        kernelApplied = result.applied.length;
        backupPath = result.backupPath;

        if (this.dryRun) {
          this.context.stdout.write(
            kernelApplied === 0
              ? DB_TEXTS.migrateKernelDryNothing
              : tx(DB_TEXTS.migrateKernelDryHeader, {
                  count: kernelApplied,
                  lines: result.applied
                    .map((m) => `  ${formatKernelName(m.version, m.description)}`)
                    .join('\n'),
                }),
          );
        } else if (kernelApplied === 0) {
          this.context.stdout.write(DB_TEXTS.migrateKernelUpToDate);
        } else {
          this.context.stdout.write(
            backupPath
              ? tx(DB_TEXTS.migrateKernelAppliedWithBackup, {
                  count: kernelApplied,
                  backupPath,
                })
              : tx(DB_TEXTS.migrateKernelApplied, { count: kernelApplied }),
          );
        }
      }

      // --- plugin pass --------------------------------------------------
      if (!this.kernelOnly) {
        const exitCode = await runPluginMigrations({
          adapter,
          plugins: targetedPlugins,
          dryRun: this.dryRun,
          stdout: this.context.stdout,
          stderr: this.context.stderr,
        });
        if (exitCode !== 0) return exitCode;
      }

      return ExitCode.Ok;
    } finally {
      await adapter.close();
    }
  }
}

interface IRunPluginMigrationsOpts {
  adapter: StoragePort;
  plugins: IDiscoveredPlugin[];
  dryRun: boolean;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

/**
 * Drive every targeted plugin's migration batch in sequence. Layer-3
 * intrusions are reported on stderr and flip the exit code to 2 — the
 * ledger row is still written for whatever applied cleanly, but the
 * caller knows something deeper is off (a plugin slipped a non-prefixed
 * object past the regex check). This is the intentional contract: don't
 * silently revert, surface the breach loud and clear.
 */
async function runPluginMigrations(opts: IRunPluginMigrationsOpts): Promise<number> {
  const { adapter, plugins, dryRun, stdout, stderr } = opts;
  let exit = 0;
  for (const plugin of plugins) {
    let result: IPluginApplyResult;
    try {
      result = adapter.pluginMigrations.apply(plugin, { dryRun });
    } catch (err) {
      const reason = formatErrorMessage(err);
      stderr.write(tx(DB_TEXTS.pluginMigrateFailure, { pluginId: plugin.id, reason }));
      exit = ExitCode.Error;
      continue;
    }
    if (dryRun) {
      stdout.write(
        result.applied.length === 0
          ? tx(DB_TEXTS.pluginMigrateDryNothing, { pluginId: plugin.id })
          : tx(DB_TEXTS.pluginMigrateDryHeader, {
              pluginId: plugin.id,
              count: result.applied.length,
              lines: result.applied
                .map((m) => `  ${formatKernelName(m.version, m.description)}`)
                .join('\n'),
            }),
      );
    } else {
      stdout.write(
        result.applied.length === 0
          ? tx(DB_TEXTS.pluginMigrateUpToDate, { pluginId: plugin.id })
          : tx(DB_TEXTS.pluginMigrateApplied, {
              pluginId: plugin.id,
              count: result.applied.length,
            }),
      );
    }
    if (result.intrusions.length > 0) {
      stderr.write(
        tx(DB_TEXTS.pluginMigrateIntrusion, {
          pluginId: plugin.id,
          intrusions: result.intrusions.join(', '),
        }),
      );
      exit = ExitCode.Error;
    }
  }
  return exit;
}

function formatKernelName(version: number, description: string): string {
  return `${String(version).padStart(3, '0')}_${description}`;
}

/** Aggregate export so CLI entry can register every db verb in one line. */
export const DB_COMMANDS = [
  DbBackupCommand,
  DbRestoreCommand,
  DbResetCommand,
  DbShellCommand,
  DbBrowserCommand,
  DbDumpCommand,
  DbMigrateCommand,
];

