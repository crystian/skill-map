/**
 * `GET /api/plugins` — list installed plugins (built-in + drop-in) with
 * load status.
 *
 * Item shape:
 *
 *   ```ts
 *   {
 *     id: string;
 *     version: string | null;
 *     kinds: string[];          // e.g. ['provider', 'extractor']
 *     status: 'enabled' | 'disabled' | 'incompatible-spec' | 'invalid-manifest' | 'load-error' | 'id-collision';
 *     reason: string | null;    // populated when status !== 'enabled'
 *     source: 'built-in' | 'project' | 'global';
 *   }
 *   ```
 *
 * Built-ins surface alongside drop-ins so the SPA can render one
 * homogeneous list. Both honour the same `resolveEnabled` resolver so
 * a `disabled` built-in displays as `disabled` in this list (parity
 * with `sm plugins list`).
 */

import type { Hono } from 'hono';

import { builtInBundles } from '../../built-in-plugins/built-ins.js';
import {
  emptyPluginRuntime,
  loadPluginRuntime,
} from '../../cli/util/plugin-runtime.js';
import { defaultProjectPluginsDir } from '../../cli/util/db-path.js';
import type { IDiscoveredPlugin } from '../../kernel/index.js';
import { buildListEnvelope } from '../envelope.js';
import type { IRouteDeps } from './deps.js';

export interface IPluginListItem {
  id: string;
  version: string | null;
  kinds: string[];
  status: IDiscoveredPlugin['status'];
  reason: string | null;
  source: 'built-in' | 'project' | 'global';
}

export function registerPluginsRoute(app: Hono, deps: IRouteDeps): void {
  app.get('/api/plugins', async (c) => {
    const pluginRuntime = deps.options.noPlugins
      ? emptyPluginRuntime()
      : await loadPluginRuntime({ scope: deps.options.scope });
    for (const warn of pluginRuntime.warnings) {
      process.stderr.write(`${warn}\n`);
    }

    const items: IPluginListItem[] = [
      ...(deps.options.noBuiltIns ? [] : buildBuiltInItems(pluginRuntime.resolveEnabled)),
      ...buildDiscoveredItems(pluginRuntime.discovered, deps),
    ];

    return c.json(
      buildListEnvelope({
        kind: 'plugins',
        items,
        filters: {},
        total: items.length,
        kindRegistry: deps.kindRegistry,
      }),
    );
  });
}

/**
 * One row per built-in bundle (`claude`, `core`). Status comes from the
 * resolver — same source the CLI's `sm plugins list` uses, so the two
 * surfaces never drift on "is this built-in active?".
 */
function buildBuiltInItems(
  resolveEnabled: (id: string) => boolean,
): IPluginListItem[] {
  return builtInBundles.map((bundle) => ({
    id: bundle.id,
    version: firstVersion(bundle.extensions),
    kinds: uniqueKinds(bundle.extensions.map((e) => e.kind)),
    status: resolveEnabled(bundle.id) ? 'enabled' : 'disabled',
    reason: null,
    source: 'built-in' as const,
  }));
}

/**
 * One row per drop-in plugin discovered by the loader. Includes
 * disabled / failure-mode plugins so the SPA can render them with the
 * same surface area as the CLI.
 */
function buildDiscoveredItems(
  discovered: IDiscoveredPlugin[],
  deps: IRouteDeps,
): IPluginListItem[] {
  return discovered.map((plugin) => ({
    id: plugin.id,
    version: plugin.manifest?.version ?? null,
    kinds: uniqueKinds(plugin.extensions?.map((e) => e.kind) ?? []),
    status: plugin.status,
    reason: plugin.reason ?? null,
    source: classifyPluginSource(plugin.path, deps),
  }));
}

function uniqueKinds(kinds: string[]): string[] {
  return [...new Set(kinds)].sort();
}

function firstVersion(
  extensions: ReadonlyArray<{ version?: string }>,
): string | null {
  for (const ext of extensions) {
    if (ext.version) return ext.version;
  }
  return null;
}

/**
 * Classify a discovered plugin's `path` as `project` or `global` based
 * on whether it sits under the project plugins dir. Anything that
 * doesn't match the project dir is reported as `global` (the loader
 * walks both the project + user dirs and we want a stable label
 * regardless of which one matched).
 */
function classifyPluginSource(
  pluginPath: string,
  deps: IRouteDeps,
): 'project' | 'global' {
  const projectDir = defaultProjectPluginsDir(deps.runtimeContext);
  return pluginPath.startsWith(projectDir) ? 'project' : 'global';
}

