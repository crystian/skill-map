/**
 * `sm plugins` — discover and inspect plugins. Does NOT enable/disable;
 * those arrive at Step 6 with the `config_plugins` ledger.
 *
 *   sm plugins list     tabulate discovered plugins with status
 *   sm plugins show X   dump one plugin's manifest + extensions
 *   sm plugins doctor   full load pass + summary by failure mode
 */

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { Command, Option } from 'clipanion';

import {
  PluginLoader,
  installedSpecVersion,
} from '../../kernel/adapters/plugin-loader.js';
import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import type { IDiscoveredPlugin } from '../../kernel/types/plugin.js';

const PROJECT_PLUGINS = '.skill-map/plugins';
const GLOBAL_PLUGINS = '.skill-map/plugins';

interface IScopeOptions {
  global: boolean;
  pluginDir: string | undefined;
}

function resolveSearchPaths(opts: IScopeOptions): string[] {
  if (opts.pluginDir) return [resolve(opts.pluginDir)];
  const project = resolve(process.cwd(), PROJECT_PLUGINS);
  const user = join(homedir(), GLOBAL_PLUGINS);
  return opts.global ? [user] : [project, user];
}

async function loadAll(opts: IScopeOptions): Promise<IDiscoveredPlugin[]> {
  const validators = loadSchemaValidators();
  const loader = new PluginLoader({
    searchPaths: resolveSearchPaths(opts),
    validators,
    specVersion: installedSpecVersion(),
  });
  return loader.discoverAndLoadAll();
}

function statusIcon(status: IDiscoveredPlugin['status']): string {
  switch (status) {
    case 'loaded': return 'ok';
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
    details: 'Exit code 0 when every plugin loads; 1 when any plugin is not loaded.',
  });

  global = Option.Boolean('-g,--global', false);
  pluginDir = Option.String('--plugin-dir', { required: false });

  async execute(): Promise<number> {
    const plugins = await loadAll({ global: this.global, pluginDir: this.pluginDir });
    const counts: Record<IDiscoveredPlugin['status'], number> = {
      loaded: 0,
      'incompatible-spec': 0,
      'invalid-manifest': 0,
      'load-error': 0,
    };
    for (const p of plugins) counts[p.status]++;

    this.context.stdout.write(`Discovered ${plugins.length} plugin(s):\n`);
    for (const status of Object.keys(counts) as Array<IDiscoveredPlugin['status']>) {
      this.context.stdout.write(`  ${status.padEnd(18)} ${counts[status]}\n`);
    }

    const bad = plugins.filter((p) => p.status !== 'loaded');
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
];
