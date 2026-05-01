/**
 * Plugin migrations runner.
 *
 * Mirrors the kernel migrations runner (`migrations.ts`) but scopes its
 * ledger writes to `(scope='plugin', owner_id=<pluginId>)` and gates
 * every applied SQL through the triple-protection validator
 * (`plugin-migrations-validator.ts`).
 *
 * Scope rule: only plugins with `storage.mode === 'dedicated'` ship
 * migrations. Plugins with no storage or `storage.mode === 'kv'` are
 * skipped silently — the kernel-owned `state_plugin_kvs` table is
 * already there. A `dedicated` plugin without a `migrations/` folder is
 * a config error and surfaces as `0 pending` (the apply call is a no-op).
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type { IDiscoveredPlugin } from '../../types/plugin.js';
import type {
  IPluginApplyOptions,
  IPluginApplyResult,
  IPluginMigrationFile,
  IPluginMigrationPlan,
  IPluginMigrationRecord,
} from '../../types/storage.js';
import {
  detectCatalogIntrusion,
  normalizePluginId,
  snapshotCatalog,
  validatePluginMigrationSql,
} from './plugin-migrations-validator.js';

export type {
  IPluginApplyOptions,
  IPluginApplyResult,
  IPluginMigrationFile,
  IPluginMigrationPlan,
  IPluginMigrationRecord,
} from '../../types/storage.js';

const FILE_RE = /^(\d{3})_([a-z0-9_]+)\.sql$/;

/**
 * Resolve the absolute migrations directory for a discovered plugin.
 * Returns `null` if the plugin is not in `dedicated` storage mode (which
 * is the only mode that ships migrations) or the directory doesn't
 * exist.
 */
export function resolvePluginMigrationsDir(plugin: IDiscoveredPlugin): string | null {
  const manifest = plugin.manifest;
  if (!manifest) return null;
  if (!manifest.storage) return null;
  if (manifest.storage.mode !== 'dedicated') return null;
  const dir = join(plugin.path, 'migrations');
  if (!existsSync(dir)) return null;
  return dir;
}

/**
 * Discover the migrations a plugin ships, sorted by version. Same
 * `NNN_snake_case.sql` convention as kernel migrations.
 */
export function discoverPluginMigrations(plugin: IDiscoveredPlugin): IPluginMigrationFile[] {
  const dir = resolvePluginMigrationsDir(plugin);
  if (!dir) return [];

  const files = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => FILE_RE.test(name))
    .sort();

  const out: IPluginMigrationFile[] = [];
  for (const name of files) {
    const match = FILE_RE.exec(name);
    if (!match) continue;
    out.push({
      version: Number.parseInt(match[1]!, 10),
      description: match[2]!,
      filePath: join(dir, name),
    });
  }

  for (let i = 1; i < out.length; i++) {
    if (out[i]!.version === out[i - 1]!.version) {
      throw new Error(
        `Plugin ${plugin.id}: duplicate migration version ${out[i]!.version} ` +
          `(${out[i - 1]!.filePath} and ${out[i]!.filePath})`,
      );
    }
  }
  return out;
}

/**
 * Read the ledger for a single plugin's migrations. Empty array when
 * `config_schema_versions` is missing or has no rows for this plugin
 * (fresh DB, or a plugin that has never migrated).
 */
export function readPluginLedger(db: DatabaseSync, pluginId: string): IPluginMigrationRecord[] {
  const tableExists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='config_schema_versions'",
    )
    .get() as { name: string } | undefined;
  if (!tableExists) return [];

  const rows = db
    .prepare(
      `SELECT version, description, applied_at
       FROM config_schema_versions
       WHERE scope='plugin' AND owner_id = ?
       ORDER BY version ASC`,
    )
    .all(pluginId) as Array<{ version: number; description: string; applied_at: number }>;

  return rows.map((r) => ({
    version: r.version,
    description: r.description,
    appliedAt: r.applied_at,
  }));
}

/**
 * Plan a plugin's migrations against its ledger.
 */
export function planPluginMigrations(
  db: DatabaseSync,
  plugin: IDiscoveredPlugin,
  files: IPluginMigrationFile[] = discoverPluginMigrations(plugin),
): IPluginMigrationPlan {
  const applied = readPluginLedger(db, plugin.id);
  const appliedVersions = new Set(applied.map((r) => r.version));
  const pending = files.filter((f) => !appliedVersions.has(f.version));
  return { pluginId: plugin.id, applied, pending };
}

/**
 * Apply pending plugin migrations.
 *
 * Layer 1 (discovery): each pending file is read + validated against
 *   the prefix rule before any of them run. A failure here aborts the
 *   whole batch with no DB writes.
 *
 * Layer 2 (apply): the same SQL is re-validated immediately before
 *   `db.exec(sql)`. Cheap defense against TOCTOU-style edits between
 *   discovery and apply.
 *
 * Layer 3 (post-apply): after the batch commits, `sqlite_master` is
 *   compared against the pre-batch snapshot. Any new object outside
 *   the plugin's prefix is reported as an intrusion. The apply still
 *   commits — the intrusion is surfaced to the caller, who decides
 *   what to do (the CLI converts it into an error and refuses to
 *   advance the ledger; the in-memory contract leaves intrusions
 *   visible for richer reporting).
 *
 * Each migration runs inside its own transaction. The ledger row is
 * inserted in the same transaction so a partial failure rolls back
 * cleanly.
 */
// Plugin migration runner — same shape as `applyMigrations` (per-file
// transactional apply with rollback) plus the plugin-id ledger
// scoping. Branching is intrinsic to the safe-apply contract.
// eslint-disable-next-line complexity
export function applyPluginMigrations(
  db: DatabaseSync,
  plugin: IDiscoveredPlugin,
  options: IPluginApplyOptions = {},
  files: IPluginMigrationFile[] = discoverPluginMigrations(plugin),
): IPluginApplyResult {
  const { dryRun = false } = options;
  const plan = planPluginMigrations(db, plugin, files);

  if (plan.pending.length === 0 || dryRun) {
    return { pluginId: plugin.id, applied: dryRun ? plan.pending : [], intrusions: [] };
  }

  const normalizedId = normalizePluginId(plugin.id);

  // --- Layer 1: validate every pending file BEFORE any run. ----------------
  const sources = new Map<string, string>();
  for (const m of plan.pending) {
    const sql = readFileSync(m.filePath, 'utf8');
    sources.set(m.filePath, sql);
    const result = validatePluginMigrationSql(sql, normalizedId);
    if (!result.ok) {
      throw new Error(
        `Plugin ${plugin.id}: migration ${formatMigrationName(m)} failed validation:\n` +
          result.violations.map((v) => `  - ${v}`).join('\n'),
      );
    }
  }

  // --- Layer 3 prep: snapshot the catalog. --------------------------------
  const before = snapshotCatalog(db);

  const applied: IPluginMigrationFile[] = [];
  for (const migration of plan.pending) {
    const sql = sources.get(migration.filePath)!;

    // --- Layer 2: re-validate. -------------------------------------------
    const result = validatePluginMigrationSql(sql, normalizedId);
    if (!result.ok) {
      throw new Error(
        `Plugin ${plugin.id}: migration ${formatMigrationName(migration)} failed Layer-2 validation:\n` +
          result.violations.map((v) => `  - ${v}`).join('\n'),
      );
    }

    try {
      db.exec('BEGIN');
      db.exec(sql);
      db.prepare(
        `INSERT INTO config_schema_versions (scope, owner_id, version, description, applied_at)
         VALUES ('plugin', ?, ?, ?, ?)`,
      ).run(plugin.id, migration.version, migration.description, Date.now());
      db.exec('COMMIT');
      applied.push(migration);
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore
      }
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Plugin ${plugin.id}: migration ${formatMigrationName(migration)} failed: ${reason}`,
        { cause: err },
      );
    }
  }

  // --- Layer 3: catalog assertion. ----------------------------------------
  const after = snapshotCatalog(db);
  const intrusions = detectCatalogIntrusion(before, after, normalizedId);

  return { pluginId: plugin.id, applied, intrusions };
}

function formatMigrationName(m: IPluginMigrationFile): string {
  return `${String(m.version).padStart(3, '0')}_${m.description}`;
}
