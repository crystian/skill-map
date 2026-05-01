/**
 * Kernel migrations runner.
 *
 * Discovers `NNN_snake_case.sql` files in a migrations directory, compares
 * them against the `config_schema_versions` ledger for scope=`kernel`,
 * owner=`kernel`, and applies the pending ones inside a single transaction
 * each. `PRAGMA user_version` is kept in sync with the latest applied
 * kernel migration; a mismatch is surfaced by `sm doctor`.
 *
 * Auto-backup: before any apply, a copy of the DB goes to
 * `<dbDir>/backups/skill-map-pre-migrate-v<N>.db` where N is the target
 * migration number. Skipped for `:memory:` and when the caller sets
 * `backup: false` (used by `sm db migrate --no-backup`).
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const FILE_RE = /^(\d{3})_([a-z0-9_]+)\.sql$/;

export interface IMigrationFile {
  version: number;
  description: string;
  filePath: string;
}

export interface IMigrationRecord {
  scope: string;
  ownerId: string;
  version: number;
  description: string;
  appliedAt: number;
}

export interface IMigrationPlan {
  applied: IMigrationRecord[];
  pending: IMigrationFile[];
}

export interface IApplyOptions {
  backup?: boolean;
  dryRun?: boolean;
  to?: number;
}

export interface IApplyResult {
  applied: IMigrationFile[];
  backupPath: string | null;
}

/**
 * Default migrations directory — resolves the bundled `migrations/` folder
 * relative to this file so it works in both dev (tsx) and dist (tsup
 * output) as long as `package.json#files` ships the `migrations/` folder
 * alongside `dist/`.
 *
 * Two layouts to handle:
 *   - dev (tsx, source files):
 *       src/kernel/adapters/sqlite/migrations.ts → src/migrations/
 *       (three levels up from `here`).
 *   - dist (tsup bundle, single flat `cli.js`):
 *       src/dist/cli.js → src/dist/migrations/
 *       (one level up — `here` IS the dist root, not a nested
 *       `kernel/adapters/sqlite/` path, because the bundle is flat).
 *
 * We probe the flat layout first, then fall back to the source-shaped
 * layout. Consumers may override via `discoverMigrations(dir)`.
 */
export function defaultMigrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const flatLayout = resolve(here, 'migrations');
  if (existsSync(flatLayout)) return flatLayout;
  return resolve(here, '..', '..', '..', 'migrations');
}

export function discoverMigrations(dir: string = defaultMigrationsDir()): IMigrationFile[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => FILE_RE.test(name))
    .sort();

  const out: IMigrationFile[] = [];
  for (const name of files) {
    const match = FILE_RE.exec(name);
    if (!match) continue;
    out.push({
      version: Number.parseInt(match[1]!, 10),
      description: match[2]!,
      filePath: join(dir, name),
    });
  }
  // Reject duplicate version numbers early — a sorted sequence with a
  // repeat is a developer error (two branches both numbered 002).
  for (let i = 1; i < out.length; i++) {
    if (out[i]!.version === out[i - 1]!.version) {
      throw new Error(
        `Duplicate migration version ${out[i]!.version} in ${dir}: ${out[i - 1]!.filePath} and ${out[i]!.filePath}`,
      );
    }
  }
  return out;
}

/**
 * Read the ledger for kernel migrations. Returns an empty list if the
 * `config_schema_versions` table doesn't yet exist (fresh DB).
 */
export function readLedger(db: DatabaseSync): IMigrationRecord[] {
  const tableExists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='config_schema_versions'",
    )
    .get() as { name: string } | undefined;
  if (!tableExists) return [];

  const rows = db
    .prepare(
      "SELECT scope, owner_id, version, description, applied_at FROM config_schema_versions WHERE scope='kernel' AND owner_id='kernel' ORDER BY version ASC",
    )
    .all() as Array<{
      scope: string;
      owner_id: string;
      version: number;
      description: string;
      applied_at: number;
    }>;

  return rows.map((r) => ({
    scope: r.scope,
    ownerId: r.owner_id,
    version: r.version,
    description: r.description,
    appliedAt: r.applied_at,
  }));
}

export function planMigrations(
  db: DatabaseSync,
  files: IMigrationFile[] = discoverMigrations(),
): IMigrationPlan {
  const applied = readLedger(db);
  const appliedVersions = new Set(applied.map((r) => r.version));
  const pending = files.filter((f) => !appliedVersions.has(f.version));
  return { applied, pending };
}

/**
 * Apply pending migrations up to (and including) `options.to` — defaults
 * to the latest discovered. Each file is executed inside its own
 * `BEGIN / COMMIT` transaction; failure rolls back and throws, leaving
 * the DB and ledger in the last good state.
 */
export function applyMigrations(
  db: DatabaseSync,
  dbPath: string,
  options: IApplyOptions = {},
  files: IMigrationFile[] = discoverMigrations(),
): IApplyResult {
  const { backup = true, dryRun = false, to } = options;

  const plan = planMigrations(db, files);
  const target = to ?? (files.length > 0 ? files[files.length - 1]!.version : 0);
  const toApply = plan.pending.filter((f) => f.version <= target);

  if (toApply.length === 0 || dryRun) {
    return { applied: toApply, backupPath: null };
  }

  const backupPath = backup ? writeBackup(dbPath, target) : null;

  for (const migration of toApply) {
    const sql = readFileSync(migration.filePath, 'utf8');
    try {
      db.exec('BEGIN');
      db.exec(sql);
      // Record in the ledger in the same transaction so partial success
      // can't leave the ledger out of sync.
      db.prepare(
        `INSERT INTO config_schema_versions (scope, owner_id, version, description, applied_at)
         VALUES ('kernel', 'kernel', ?, ?, ?)`,
      ).run(migration.version, migration.description, Date.now());
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore rollback failures
      }
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Migration ${String(migration.version).padStart(3, '0')}_${migration.description} failed: ${reason}`,
      );
    }
  }

  return { applied: toApply, backupPath };
}

/**
 * WAL checkpoint + file copy. `:memory:` is a no-op (no file to copy).
 */
export function writeBackup(dbPath: string, targetVersion: number): string | null {
  if (dbPath === ':memory:') return null;
  const absolute = resolve(dbPath);
  const dir = join(dirname(absolute), 'backups');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `skill-map-pre-migrate-v${targetVersion}.db`);
  // Checkpoint WAL to the main file before copy so the backup is complete
  // without needing to also copy the `-wal` / `-shm` sidecars.
  const db = new DatabaseSync(absolute);
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
  copyFileSync(absolute, out);
  return out;
}
