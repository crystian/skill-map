/**
 * `sm plugins` — discover, inspect, and toggle plugins.
 *
 *   sm plugins list      tabulate discovered plugins with status (and DB / settings overrides)
 *   sm plugins show X    dump one plugin's manifest + loaded extensions
 *   sm plugins doctor    full load pass + summary by failure mode
 *   sm plugins enable  <id> | --all   write `enabled: true` to config_plugins
 *   sm plugins disable <id> | --all   write `enabled: false` to config_plugins
 *
 * Step 6.6 wires the enable/disable verbs and respects the resolution
 * order spec'd in `kernel/config/plugin-resolver.ts`:
 *
 *   DB override (config_plugins) > settings.json (#/plugins/<id>/enabled) > installed default (true)
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { Command, Option } from 'clipanion';

import {
  PluginLoader,
  installedSpecVersion,
  type IPluginLoaderOptions,
} from '../../kernel/adapters/plugin-loader.js';
import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import { SqliteStorageAdapter } from '../../kernel/adapters/sqlite/index.js';
import {
  deletePluginOverride,
  loadPluginOverrideMap,
  setPluginEnabled,
} from '../../kernel/adapters/sqlite/plugins.js';
import { loadConfig } from '../../kernel/config/loader.js';
import { makeEnabledResolver } from '../../kernel/config/plugin-resolver.js';
import type { IDiscoveredPlugin } from '../../kernel/types/plugin.js';
import { emitDoneStderr, startElapsed } from '../util/elapsed.js';

const PLUGINS_DIR = '.skill-map/plugins';
const DB_FILENAME = 'skill-map.db';

interface IScopeOptions {
  global: boolean;
  pluginDir: string | undefined;
}

function resolveSearchPaths(opts: IScopeOptions): string[] {
  if (opts.pluginDir) return [resolve(opts.pluginDir)];
  const project = resolve(process.cwd(), PLUGINS_DIR);
  const user = join(homedir(), PLUGINS_DIR);
  return opts.global ? [user] : [project, user];
}

function resolveDbPath(global: boolean): string {
  return global
    ? join(homedir(), '.skill-map', DB_FILENAME)
    : resolve(process.cwd(), '.skill-map', DB_FILENAME);
}

/**
 * Build a resolver from the layered config (settings.json) + the DB
 * overrides (config_plugins). Either layer may be absent (no
 * settings.json, no DB) — both fall through gracefully.
 */
async function buildResolver(global: boolean): Promise<(id: string) => boolean> {
  const { effective: cfg } = loadConfig({ scope: global ? 'global' : 'project' });
  const dbPath = resolveDbPath(global);
  let dbOverrides = new Map<string, boolean>();
  if (existsSync(dbPath)) {
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    try {
      await adapter.init();
      dbOverrides = await loadPluginOverrideMap(adapter.db);
    } finally {
      await adapter.close();
    }
  }
  return makeEnabledResolver(cfg, dbOverrides);
}

async function loadAll(opts: IScopeOptions): Promise<IDiscoveredPlugin[]> {
  const validators = loadSchemaValidators();
  const loaderOpts: IPluginLoaderOptions = {
    searchPaths: resolveSearchPaths(opts),
    validators,
    specVersion: installedSpecVersion(),
    resolveEnabled: await buildResolver(opts.global),
  };
  const loader = new PluginLoader(loaderOpts);
  return loader.discoverAndLoadAll();
}

function statusIcon(status: IDiscoveredPlugin['status']): string {
  switch (status) {
    case 'loaded': return 'ok';
    case 'disabled': return 'off';
    case 'incompatible-spec': return 'spec!';
    case 'invalid-manifest': return 'mani!';
    case 'load-error': return 'load!';
  }
}

// --- list -----------------------------------------------------------------

export class PluginsListCommand extends Command {
  static override paths = [['plugins', 'list']];
  static override usage = Command.Usage({
    category: 'Plugins',
    description: 'List discovered plugins and their load status.',
    details: 'Scans <scope>/.skill-map/plugins and ~/.skill-map/plugins (or --plugin-dir <path>).',
  });

  global = Option.Boolean('-g,--global', false);
  pluginDir = Option.String('--plugin-dir', { required: false });
  json = Option.Boolean('--json', false);

  async execute(): Promise<number> {
    const plugins = await loadAll({ global: this.global, pluginDir: this.pluginDir });
    if (this.json) {
      this.context.stdout.write(JSON.stringify(plugins, omitModule, 2) + '\n');
      return 0;
    }

    if (plugins.length === 0) {
      this.context.stdout.write('No plugins discovered.\n');
      return 0;
    }

    for (const p of plugins) {
      const kinds = p.extensions?.map((e) => `${e.kind}:${e.id}`).join(', ') ?? '';
      const head = `${statusIcon(p.status).padEnd(6)} ${p.id}@${p.manifest?.version ?? '?'}`;
      const tail = p.status === 'loaded' ? ` · ${kinds}` : ` · ${p.reason ?? ''}`;
      this.context.stdout.write(head + tail + '\n');
    }
    return 0;
  }
}

// --- show -----------------------------------------------------------------

export class PluginsShowCommand extends Command {
  static override paths = [['plugins', 'show']];
  static override usage = Command.Usage({
    category: 'Plugins',
    description: 'Show a single plugin\'s manifest + loaded extensions.',
  });

  id = Option.String({ required: true });
  global = Option.Boolean('-g,--global', false);
  pluginDir = Option.String('--plugin-dir', { required: false });
  json = Option.Boolean('--json', false);

  async execute(): Promise<number> {
    const plugins = await loadAll({ global: this.global, pluginDir: this.pluginDir });
    const match = plugins.find((p) => p.id === this.id);
    if (!match) {
      this.context.stderr.write(`Plugin not found: ${this.id}\n`);
      return 5;
    }

    if (this.json) {
      this.context.stdout.write(JSON.stringify(match, omitModule, 2) + '\n');
      return 0;
    }

    const lines = [
      `id:       ${match.id}`,
      `path:     ${match.path}`,
      `status:   ${match.status}`,
      `version:  ${match.manifest?.version ?? '?'}`,
      `compat:   ${match.manifest?.specCompat ?? '?'}`,
    ];
    if (match.manifest?.description) lines.push(`summary:  ${match.manifest.description}`);
    if (match.reason) lines.push(`reason:   ${match.reason}`);
    if (match.extensions && match.extensions.length > 0) {
      lines.push('extensions:');
      for (const ext of match.extensions) {
        lines.push(`  - ${ext.kind}:${ext.id}@${ext.version}`);
      }
    }
    this.context.stdout.write(lines.join('\n') + '\n');
    return 0;
  }
}

// --- doctor ---------------------------------------------------------------

export class PluginsDoctorCommand extends Command {
  static override paths = [['plugins', 'doctor']];
  static override usage = Command.Usage({
    category: 'Plugins',
    description: 'Run the full load pass and summarise by failure mode.',
    details: 'Exit code 0 when every plugin loads or is intentionally disabled; 1 when any plugin is in an error / incompat state.',
  });

  global = Option.Boolean('-g,--global', false);
  pluginDir = Option.String('--plugin-dir', { required: false });

  async execute(): Promise<number> {
    const plugins = await loadAll({ global: this.global, pluginDir: this.pluginDir });
    const counts: Record<IDiscoveredPlugin['status'], number> = {
      loaded: 0,
      disabled: 0,
      'incompatible-spec': 0,
      'invalid-manifest': 0,
      'load-error': 0,
    };
    for (const p of plugins) counts[p.status]++;

    this.context.stdout.write(`Discovered ${plugins.length} plugin(s):\n`);
    for (const status of Object.keys(counts) as Array<IDiscoveredPlugin['status']>) {
      this.context.stdout.write(`  ${status.padEnd(18)} ${counts[status]}\n`);
    }

    // Errors gate the exit code; `disabled` is intentional and never an issue.
    const bad = plugins.filter(
      (p) => p.status !== 'loaded' && p.status !== 'disabled',
    );
    if (bad.length > 0) {
      this.context.stdout.write('\nIssues:\n');
      for (const p of bad) {
        this.context.stdout.write(`  [${p.status}] ${p.id} — ${p.reason ?? ''}\n`);
      }
      return 1;
    }
    return 0;
  }
}

// --- enable / disable -----------------------------------------------------

class TogglePluginsBase extends Command {
  global = Option.Boolean('-g,--global', false);
  all = Option.Boolean('--all', false);
  id = Option.String({ required: false });

  protected async toggle(enabled: boolean): Promise<number> {
    const elapsed = startElapsed();
    if (this.all && this.id) {
      this.context.stderr.write('Pass either an <id> or --all, not both.\n');
      emitDoneStderr(this.context.stderr, elapsed);
      return 2;
    }
    if (!this.all && !this.id) {
      this.context.stderr.write('Pass <id> or --all.\n');
      emitDoneStderr(this.context.stderr, elapsed);
      return 2;
    }

    // Resolve discovery so `<id>` is validated and `--all` knows the set.
    const plugins = await loadAll({
      global: this.global,
      pluginDir: undefined,
    });

    let targets: string[];
    if (this.all) {
      targets = plugins.map((p) => p.id);
    } else {
      const found = plugins.find((p) => p.id === this.id);
      if (!found) {
        this.context.stderr.write(`Plugin not found: ${this.id}\n`);
        emitDoneStderr(this.context.stderr, elapsed);
        return 5;
      }
      targets = [found.id];
    }

    const dbPath = resolveDbPath(this.global);
    const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
    try {
      await adapter.init();
      for (const id of targets) {
        await setPluginEnabled(adapter.db, id, enabled);
      }
    } finally {
      await adapter.close();
    }

    const verb = enabled ? 'enabled' : 'disabled';
    if (targets.length === 1) {
      this.context.stdout.write(`${verb}: ${targets[0]}\n`);
    } else {
      this.context.stdout.write(`${verb}: ${targets.length} plugin(s)\n`);
      for (const id of targets) this.context.stdout.write(`  - ${id}\n`);
    }
    emitDoneStderr(this.context.stderr, elapsed);
    return 0;
  }
}

export class PluginsEnableCommand extends TogglePluginsBase {
  static override paths = [['plugins', 'enable']];
  static override usage = Command.Usage({
    category: 'Plugins',
    description: 'Enable a plugin (or --all). Persists in config_plugins.',
    details: `
      Writes a row to config_plugins with enabled=1. Takes precedence
      over the team-shared baseline at settings.json#/plugins/<id>/enabled.
      Use sm plugins disable to flip; sm config reset plugins.<id>.enabled
      drops the settings.json baseline.
    `,
  });

  async execute(): Promise<number> {
    return this.toggle(true);
  }
}

export class PluginsDisableCommand extends TogglePluginsBase {
  static override paths = [['plugins', 'disable']];
  static override usage = Command.Usage({
    category: 'Plugins',
    description: 'Disable a plugin (or --all). Persists in config_plugins; does not delete files.',
    details: `
      Writes a row to config_plugins with enabled=0. Discovery still
      surfaces the plugin in sm plugins list, but with status=disabled
      — its extensions are not imported and the kernel will not run
      them.
    `,
  });

  async execute(): Promise<number> {
    return this.toggle(false);
  }
}

/* deletePluginOverride is kept available for sm config reset to use later. */
void deletePluginOverride;

/**
 * JSON-serializer replacer: the ILoadedExtension.module field is a live
 * ESM namespace with circular references — omit it from output.
 */
function omitModule(key: string, value: unknown): unknown {
  return key === 'module' ? undefined : value;
}

export const PLUGIN_COMMANDS = [
  PluginsListCommand,
  PluginsShowCommand,
  PluginsDoctorCommand,
  PluginsEnableCommand,
  PluginsDisableCommand,
];
