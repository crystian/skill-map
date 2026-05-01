/**
 * Storage helpers for the `config_plugins` table — persists the user's
 * enable/disable overrides for discovered plugins. Read-side feeds
 * `sm plugins list/show/doctor`; write-side feeds
 * `sm plugins enable/disable`.
 *
 * The table schema is shipped in the kernel's initial migration (see
 * `src/migrations/001_initial.sql`). This module only adds the helpers.
 */

import type { Kysely, Transaction } from 'kysely';

import type { IDatabase } from './schema.js';

type DbOrTx = Kysely<IDatabase> | Transaction<IDatabase>;

export interface IPluginConfigRow {
  pluginId: string;
  enabled: boolean;
  configJson: string | null;
  updatedAt: number;
}

/**
 * Upsert a single `config_plugins` row. `now` defaults to `Date.now()`
 * when omitted.
 */
export async function setPluginEnabled(
  db: DbOrTx,
  pluginId: string,
  enabled: boolean,
  now: number = Date.now(),
): Promise<void> {
  await db
    .insertInto('config_plugins')
    .values({
      pluginId,
      enabled: enabled ? 1 : 0,
      configJson: null,
      updatedAt: now,
    })
    .onConflict((oc) =>
      oc.column('pluginId').doUpdateSet({
        enabled: enabled ? 1 : 0,
        updatedAt: now,
      }),
    )
    .execute();
}

/**
 * Fetch the enabled override for one plugin id. Returns `undefined`
 * when the user has not set an override (the caller falls back to
 * `settings.json` → installed default).
 */
export async function getPluginEnabled(
  db: DbOrTx,
  pluginId: string,
): Promise<boolean | undefined> {
  const row = await db
    .selectFrom('config_plugins')
    .select(['enabled'])
    .where('pluginId', '=', pluginId)
    .executeTakeFirst();
  if (!row) return undefined;
  return row.enabled === 1;
}

/** List every override row. Useful for `sm plugins list`. */
export async function listPluginOverrides(db: DbOrTx): Promise<IPluginConfigRow[]> {
  const rows = await db
    .selectFrom('config_plugins')
    .select(['pluginId', 'enabled', 'configJson', 'updatedAt'])
    .orderBy('pluginId', 'asc')
    .execute();
  return rows.map((r) => ({
    pluginId: r.pluginId,
    enabled: r.enabled === 1,
    configJson: r.configJson,
    updatedAt: r.updatedAt,
  }));
}

/**
 * Drop the user override for one plugin so the next resolution falls
 * back to `settings.json` → installed default. Idempotent — removing a
 * non-existent row is a no-op.
 */
export async function deletePluginOverride(
  db: DbOrTx,
  pluginId: string,
): Promise<void> {
  await db
    .deleteFrom('config_plugins')
    .where('pluginId', '=', pluginId)
    .execute();
}

/**
 * Fetch every override at once and return a `Map<pluginId, enabled>`.
 * `PluginLoader` consumers use this once per process to avoid one
 * round-trip per plugin during discovery.
 */
export async function loadPluginOverrideMap(
  db: DbOrTx,
): Promise<Map<string, boolean>> {
  const rows = await listPluginOverrides(db);
  const out = new Map<string, boolean>();
  for (const row of rows) out.set(row.pluginId, row.enabled);
  return out;
}
