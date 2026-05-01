/**
 * Decide whether a plugin is enabled, given the layered inputs.
 *
 * Decision (recorded against the option-3 vote in the plan):
 *
 *   `.skill-map/settings.json#/plugins/<id>/enabled` is the **team-shared
 *   baseline** committed to the repo; `config_plugins.enabled` in the DB
 *   is the **user override** that takes precedence locally without
 *   requiring a commit.
 *
 * Effective order (highest precedence first):
 *
 *   1. DB override     (`config_plugins` row, if present)
 *   2. settings.json   (`cfg.plugins[id].enabled`, if defined)
 *   3. installed default — every plugin is enabled until told otherwise
 *
 * The same precedence applies whether the scope is `project` or
 * `global`; the caller picks which scope's DB to read.
 */

import type { IEffectiveConfig } from './loader.js';

export function resolvePluginEnabled(
  pluginId: string,
  cfg: Pick<IEffectiveConfig, 'plugins'>,
  dbOverrides: Map<string, boolean>,
): boolean {
  if (dbOverrides.has(pluginId)) return dbOverrides.get(pluginId) === true;
  const settingsEntry = cfg.plugins[pluginId];
  if (settingsEntry?.enabled !== undefined) return settingsEntry.enabled;
  return true;
}

/**
 * Build a closure suitable for `IPluginLoaderOptions.resolveEnabled`.
 * Captures the layered settings and DB override map once so the
 * loader can ask per-plugin without re-reading anything.
 */
export function makeEnabledResolver(
  cfg: Pick<IEffectiveConfig, 'plugins'>,
  dbOverrides: Map<string, boolean>,
): (pluginId: string) => boolean {
  return (pluginId: string) => resolvePluginEnabled(pluginId, cfg, dbOverrides);
}
