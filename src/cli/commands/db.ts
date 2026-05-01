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

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { confirm } from '../util/confirm.js';
import { tx } from '../../kernel/util/tx.js';
import { DB_TEXTS } from '../i18n/db.texts.js';

import { Command, Option } from 'clipanion';

import {
  applyMigrations,
  discoverMigrations,
  planMigrations,
  writeBackup,
} from '../../kernel/adapters/sqlite/migrations.js';
import {
  applyPluginMigrations,
  planPluginMigrations,
  type IPluginApplyResult,
} from '../../kernel/adapters/sqlite/plugin-migrations.js';
import type { IDiscoveredPlugin } from '../../kernel/types/plugin.js';
import { assertDbExists, resolveDbPath } from '../util/db-path.js';
import { ExitCode } from '../util/exit-codes.js';
import {
  emptyPluginRuntime,
  loadPluginRuntime,
} from '../util/plugin-runtime.js';

// --- backup ---------------------------------------------------------------

export class DbBackupCommand extends Command {
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

  global = Option.Boolean('-g,--global', false);
  db = Option.String('--db', { required: false });
  out = Option.String('--out', { required: false });

  async execute(): Promise<number> {
    const path = resolveDbPath({ global: this.global, db: this.db });
    if (!assertDbExists(path, this.context.stderr)) return ExitCode.NotFound;

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = this.out ? resolve(this.out) : join(dirname(path), 'backups', `${ts}.db`);

    mkdirSync(dirname(outPath), { recursive: true });

    const db = new DatabaseSync(path);
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally {
      db.close();
    }
    copyFileSync(path, outPath);

    this.context.stdout.write(tx(DB_TEXTS.backupWritten, { outPath }));
    return ExitCode.Ok;
  }
}

// --- restore --------------------------------------------------------------

export class DbRestoreCommand extends Command {
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
  global = Option.Boolean('-g,--global', false);
  db = Option.String('--db', { required: false });
  yes = Option.Boolean('--yes,--force', false);
  dryRun = Option.Boolean('-n,--dry-run', false, {
    description: 'Preview the restore without overwriting the live DB.',
  });

  async execute(): Promise<number> {
    const target = resolveDbPath({ global: this.global, db: this.db });
    const sourcePath = resolve(this.source);

    if (!existsSync(sourcePath)) {
      this.context.stderr.write(tx(DB_TEXTS.restoreSourceNotFound, { sourcePath }));
      return ExitCode.NotFound;
    }

    if (this.dryRun) {
      this.context.stdout.write(DB_TEXTS.dryRunHeader);
      const sourceBytes = statSync(sourcePath).size;
      const targetClause = existsSync(target)
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

    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(sourcePath, target);
    // WAL sidecars from the old DB would be out of sync — delete them so
    // next open starts clean against the restored main file.
    for (const sidecar of [`${target}-wal`, `${target}-shm`]) {
      if (existsSync(sidecar)) rmSync(sidecar);
    }

    this.context.stdout.write(tx(DB_TEXTS.restoreDone, { sourcePath, target }));
    return ExitCode.Ok;
  }
}

// --- reset ----------------------------------------------------------------

export class DbResetCommand extends Command {
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

  global = Option.Boolean('-g,--global', false);
  db = Option.String('--db', { required: false });
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
  async execute(): Promise<number> {
    if (this.state && this.hard) {
      this.context.stderr.write(DB_TEXTS.resetStateAndHardMutex);
      return ExitCode.Error;
    }

    const path = resolveDbPath({ global: this.global, db: this.db });

    if (this.hard) {
      if (this.dryRun) {
        this.context.stdout.write(DB_TEXTS.dryRunHeader);
        const sizeBytes = existsSync(path) ? statSync(path).size : null;
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
        if (existsSync(p)) rmSync(p);
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

      if (this.dryRun) {
        this.context.stdout.write(DB_TEXTS.dryRunHeader);
        if (rows.length === 0) {
          this.context.stdout.write(DB_TEXTS.dryRunResetWouldClearNone);
          return ExitCode.Ok;
        }
        // Probe row counts so the user sees the destructive scope. Read-
        // only queries — safe in dry-run.
        const withCounts = rows.map((r) => {
          const count = db.prepare(`SELECT COUNT(*) AS c FROM ${r.name}`).get() as { c: number };
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
        db.exec(`DELETE FROM ${name}`);
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

export class DbShellCommand extends Command {
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

  global = Option.Boolean('-g,--global', false);
  db = Option.String('--db', { required: false });

  async execute(): Promise<number> {
    const path = resolveDbPath({ global: this.global, db: this.db });
    if (!assertDbExists(path, this.context.stderr)) return ExitCode.NotFound;

    const result = spawnSync('sqlite3', [path], { stdio: 'inherit' });
    if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      this.context.stderr.write(
        'sqlite3 binary not found on PATH. Install it (macOS: brew install sqlite; Debian/Ubuntu: apt install sqlite3) or use `sm db dump` for read-only inspection.\n',
      );
      return ExitCode.Error;
    }
    return result.status ?? 0;
  }
}

// --- dump -----------------------------------------------------------------

export class DbDumpCommand extends Command {
  static override paths = [['db', 'dump']];
  static override usage = Command.Usage({
    category: 'Database',
    description: 'SQL dump to stdout.',
    details: 'Read-only. Use --tables <names...> to limit the dump to specific tables.',
  });

  global = Option.Boolean('-g,--global', false);
  db = Option.String('--db', { required: false });
  tables = Option.Array('--tables', { required: false });

  async execute(): Promise<number> {
    const path = resolveDbPath({ global: this.global, db: this.db });
    if (!assertDbExists(path, this.context.stderr)) return ExitCode.NotFound;

    const args = ['-readonly', path, '.dump'];
    if (this.tables && this.tables.length > 0) {
      args.push(...this.tables);
    }
    const result = spawnSync('sqlite3', args, { stdio: ['ignore', 'inherit', 'inherit'] });
    if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      this.context.stderr.write(
        'sqlite3 binary not found on PATH. Install it to use `sm db dump`.\n',
      );
      return ExitCode.Error;
    }
    return result.status ?? 0;
  }
}

// --- migrate --------------------------------------------------------------

export class DbMigrateCommand extends Command {
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

  global = Option.Boolean('-g,--global', false);
  db = Option.String('--db', { required: false });
  dryRun = Option.Boolean('--dry-run', false);
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
  async execute(): Promise<number> {
    if (this.kernelOnly && this.pluginId !== undefined) {
      this.context.stderr.write(DB_TEXTS.migrateKernelOnlyAndPluginMutex);
      return ExitCode.Error;
    }

    const path = resolveDbPath({ global: this.global, db: this.db });

    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

    const files = discoverMigrations();
    const raw = new DatabaseSync(path);
    try {
      raw.exec('PRAGMA foreign_keys = ON');

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
          const plan = planMigrations(raw, files);
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
            const plan = planPluginMigrations(raw, plugin);
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

      const toValue = this.to !== undefined ? Number.parseInt(this.to, 10) : undefined;
      if (this.to !== undefined && (Number.isNaN(toValue) || toValue === undefined)) {
        this.context.stderr.write(tx(DB_TEXTS.migrateInvalidTo, { to: this.to }));
        return ExitCode.Error;
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

        const result = applyMigrations(raw, path, options, files);
        kernelApplied = result.applied.length;
        backupPath = result.backupPath;

        if (this.dryRun) {
          this.context.stdout.write(
            kernelApplied === 0
              ? 'kernel · Nothing to apply.\n'
              : `kernel · Would apply ${kernelApplied} migration(s):\n` +
                  result.applied
                    .map((m) => `  ${formatKernelName(m.version, m.description)}`)
                    .join('\n') + '\n',
          );
        } else {
          this.context.stdout.write(
            kernelApplied === 0
              ? 'kernel · Already up to date.\n'
              : `kernel · Applied ${kernelApplied} migration(s)${
                  backupPath ? ` · backup: ${backupPath}` : ''
                }\n`,
          );
        }
      }

      // --- plugin pass --------------------------------------------------
      if (!this.kernelOnly) {
        const exitCode = await runPluginMigrations({
          db: raw,
          plugins: targetedPlugins,
          dryRun: this.dryRun,
          stdout: this.context.stdout,
          stderr: this.context.stderr,
        });
        if (exitCode !== 0) return exitCode;
      }

      return ExitCode.Ok;
    } finally {
      raw.close();
    }
  }
}

interface IRunPluginMigrationsOpts {
  db: DatabaseSync;
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
  const { db, plugins, dryRun, stdout, stderr } = opts;
  let exit = 0;
  for (const plugin of plugins) {
    let result: IPluginApplyResult;
    try {
      result = applyPluginMigrations(db, plugin, { dryRun });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      stderr.write(`plugin ${plugin.id} · ${reason}\n`);
      exit = 2;
      continue;
    }
    if (dryRun) {
      stdout.write(
        result.applied.length === 0
          ? `plugin ${plugin.id} · Nothing to apply.\n`
          : `plugin ${plugin.id} · Would apply ${result.applied.length} migration(s):\n` +
              result.applied
                .map((m) => `  ${formatKernelName(m.version, m.description)}`)
                .join('\n') + '\n',
      );
    } else {
      stdout.write(
        result.applied.length === 0
          ? `plugin ${plugin.id} · Already up to date.\n`
          : `plugin ${plugin.id} · Applied ${result.applied.length} migration(s)\n`,
      );
    }
    if (result.intrusions.length > 0) {
      stderr.write(
        `plugin ${plugin.id} · catalog intrusion detected: ${result.intrusions.join(', ')}\n`,
      );
      exit = 2;
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
  DbDumpCommand,
  DbMigrateCommand,
];

