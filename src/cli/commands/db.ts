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
  readdirSync,
  rmSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createInterface } from 'node:readline';

import { Command, Option } from 'clipanion';

import {
  applyMigrations,
  discoverMigrations,
  planMigrations,
  writeBackup,
} from '../../kernel/adapters/sqlite/migrations.js';
import { assertDbExists, resolveDbPath } from '../util/db-path.js';

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await new Promise<string>((resolveP) => rl.question(`${question} [y/N] `, resolveP));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

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
    if (!assertDbExists(path, this.context.stderr)) return 5;

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

    this.context.stdout.write(`Backup written: ${outPath}\n`);
    return 0;
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
    `,
  });

  source = Option.String({ required: true });
  global = Option.Boolean('-g,--global', false);
  db = Option.String('--db', { required: false });
  yes = Option.Boolean('--yes,--force', false);

  async execute(): Promise<number> {
    const target = resolveDbPath({ global: this.global, db: this.db });
    const sourcePath = resolve(this.source);

    if (!existsSync(sourcePath)) {
      this.context.stderr.write(`Backup not found: ${sourcePath}\n`);
      return 5;
    }

    if (!this.yes) {
      const ok = await confirm(`Restore ${sourcePath} over ${target}? This overwrites the current DB.`);
      if (!ok) {
        this.context.stderr.write('Aborted.\n');
        return 2;
      }
    }

    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(sourcePath, target);
    // WAL sidecars from the old DB would be out of sync — delete them so
    // next open starts clean against the restored main file.
    for (const sidecar of [`${target}-wal`, `${target}-shm`]) {
      if (existsSync(sidecar)) rmSync(sidecar);
    }

    this.context.stdout.write(`Restored ${sourcePath} → ${target}\n`);
    return 0;
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
    `,
  });

  global = Option.Boolean('-g,--global', false);
  db = Option.String('--db', { required: false });
  state = Option.Boolean('--state', false);
  hard = Option.Boolean('--hard', false);
  yes = Option.Boolean('--yes,--force', false);

  async execute(): Promise<number> {
    if (this.state && this.hard) {
      this.context.stderr.write('--state and --hard are mutually exclusive.\n');
      return 2;
    }

    const path = resolveDbPath({ global: this.global, db: this.db });

    if (this.hard) {
      if (!this.yes) {
        const ok = await confirm(`Delete DB file ${path}?`);
        if (!ok) {
          this.context.stderr.write('Aborted.\n');
          return 2;
        }
      }
      for (const suffix of ['', '-wal', '-shm']) {
        const p = `${path}${suffix}`;
        if (existsSync(p)) rmSync(p);
      }
      this.context.stdout.write(`Deleted ${path}\n`);
      return 0;
    }

    if (!assertDbExists(path, this.context.stderr)) return 5;

    if (this.state && !this.yes) {
      const ok = await confirm(`Drop scan_* AND state_* in ${path}?`);
      if (!ok) {
        this.context.stderr.write('Aborted.\n');
        return 2;
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

      db.exec('BEGIN');
      for (const { name } of rows) {
        db.exec(`DELETE FROM ${name}`);
      }
      db.exec('COMMIT');

      this.context.stdout.write(
        `Cleared ${rows.length} table(s): ${rows.map((r) => r.name).join(', ') || '(none)'}\n`,
      );
    } finally {
      db.close();
    }
    return 0;
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
    if (!assertDbExists(path, this.context.stderr)) return 5;

    const result = spawnSync('sqlite3', [path], { stdio: 'inherit' });
    if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      this.context.stderr.write(
        'sqlite3 binary not found on PATH. Install it (macOS: brew install sqlite; Debian/Ubuntu: apt install sqlite3) or use `sm db dump` for read-only inspection.\n',
      );
      return 2;
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
    if (!assertDbExists(path, this.context.stderr)) return 5;

    const args = ['-readonly', path, '.dump'];
    if (this.tables && this.tables.length > 0) {
      args.push(...this.tables);
    }
    const result = spawnSync('sqlite3', args, { stdio: ['ignore', 'inherit', 'inherit'] });
    if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      this.context.stderr.write(
        'sqlite3 binary not found on PATH. Install it to use `sm db dump`.\n',
      );
      return 2;
    }
    return result.status ?? 0;
  }
}

// --- migrate --------------------------------------------------------------

export class DbMigrateCommand extends Command {
  static override paths = [['db', 'migrate']];
  static override usage = Command.Usage({
    category: 'Database',
    description: 'Apply pending kernel migrations (default) or inspect plan.',
    details: `
      --dry-run   show pending migrations without applying.
      --status    print applied vs pending summary and exit.
      --to <n>    apply up to (and including) version N.
      --no-backup skip the pre-apply backup.
    `,
  });

  global = Option.Boolean('-g,--global', false);
  db = Option.String('--db', { required: false });
  dryRun = Option.Boolean('--dry-run', false);
  status = Option.Boolean('--status', false);
  to = Option.String('--to', { required: false });
  noBackup = Option.Boolean('--no-backup', false);

  async execute(): Promise<number> {
    const path = resolveDbPath({ global: this.global, db: this.db });

    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

    const files = discoverMigrations();
    const raw = new DatabaseSync(path);
    try {
      raw.exec('PRAGMA foreign_keys = ON');

      if (this.status) {
        const plan = planMigrations(raw, files);
        this.context.stdout.write(
          `Applied: ${plan.applied.length} · Pending: ${plan.pending.length}\n`,
        );
        for (const f of plan.pending) {
          this.context.stdout.write(`  pending  ${String(f.version).padStart(3, '0')}_${f.description}\n`);
        }
        for (const r of plan.applied) {
          this.context.stdout.write(`  applied  ${String(r.version).padStart(3, '0')}_${r.description}\n`);
        }
        return 0;
      }

      const toValue = this.to !== undefined ? Number.parseInt(this.to, 10) : undefined;
      if (this.to !== undefined && (Number.isNaN(toValue) || toValue === undefined)) {
        this.context.stderr.write(`--to expects an integer, got ${this.to}\n`);
        return 2;
      }

      const options: { backup: boolean; dryRun: boolean; to?: number } = {
        backup: !this.noBackup,
        dryRun: this.dryRun,
      };
      if (toValue !== undefined) options.to = toValue;

      const result = applyMigrations(raw, path, options, files);

      if (this.dryRun) {
        this.context.stdout.write(
          result.applied.length === 0
            ? 'Nothing to apply.\n'
            : `Would apply ${result.applied.length} migration(s):\n` +
                result.applied
                  .map((m) => `  ${String(m.version).padStart(3, '0')}_${m.description}`)
                  .join('\n') + '\n',
        );
      } else {
        this.context.stdout.write(
          result.applied.length === 0
            ? 'Already up to date.\n'
            : `Applied ${result.applied.length} migration(s)${
                result.backupPath ? ` · backup: ${result.backupPath}` : ''
              }\n`,
        );
      }
      return 0;
    } finally {
      raw.close();
    }
  }
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

// Silence the readdirSync import — will be used by plugin migrations later.
void readdirSync;
