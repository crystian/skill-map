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
 *
 * Spec § A.7 — granularity. Each plugin / built-in bundle declares a
 * granularity (`bundle` or `extension`). The CLI surfaces both kinds:
 *
 *   - bundle granularity ('claude', and most user plugins by default):
 *     the bundle id is the only toggle-able key. `sm plugins disable
 *     claude` works; `sm plugins disable claude/slash` is rejected as a
 *     misuse.
 *   - extension granularity ('core', plus user plugins that opt in):
 *     the bundle id alone is NOT toggle-able. `sm plugins disable core`
 *     is rejected; `sm plugins disable core/superseded` works.
 *
 * `--all` operates only on top-level plugin / bundle ids (never expands
 * to qualified `<bundle>/<ext>` keys); the user loses no expressivity
 * because granularity=extension bundles surface every extension in
 * `--all` only via their bundle id, which is rejected with directed
 * guidance — the right tool for the "disable every core extension"
 * intent is `--no-built-ins` on `sm scan`.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Command, Option } from 'clipanion';

import { builtInBundles } from '../../built-in-plugins/built-ins.js';
import type {
  IProvider,
  IExtractor,
} from '../../kernel/extensions/index.js';
import type { ILoadedExtension } from '../../kernel/types/plugin.js';
import {
  createPluginLoader,
  installedSpecVersion,
  type IPluginLoaderOptions,
} from '../../kernel/adapters/plugin-loader.js';
import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import { loadConfig } from '../../kernel/config/loader.js';
import { makeEnabledResolver } from '../../kernel/config/plugin-resolver.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';
import type {
  IDiscoveredPlugin,
  TGranularity,
} from '../../kernel/types/plugin.js';
import { tx } from '../../kernel/util/tx.js';
import { PLUGINS_TEXTS } from '../i18n/plugins.texts.js';
import { emitDoneStderr, startElapsed } from '../util/elapsed.js';
import { ExitCode } from '../util/exit-codes.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { tryWithSqlite, withSqlite } from '../util/with-sqlite.js';

const PLUGINS_DIR = '.skill-map/plugins';
const DB_FILENAME = 'skill-map.db';

interface IScopeOptions {
  global: boolean;
  pluginDir: string | undefined;
}

function resolveSearchPaths(opts: IScopeOptions, cwd: string, homedir: string): string[] {
  if (opts.pluginDir) return [resolve(opts.pluginDir)];
  const project = resolve(cwd, PLUGINS_DIR);
  const user = join(homedir, PLUGINS_DIR);
  return opts.global ? [user] : [project, user];
}

function resolveDbPath(global: boolean, cwd: string, homedir: string): string {
  return global
    ? join(homedir, '.skill-map', DB_FILENAME)
    : resolve(cwd, '.skill-map', DB_FILENAME);
}

/**
 * Build a resolver from the layered config (settings.json) + the DB
 * overrides (config_plugins). Either layer may be absent (no
 * settings.json, no DB) — both fall through gracefully.
 */
async function buildResolver(global: boolean): Promise<(id: string) => boolean> {
  const ctx = defaultRuntimeContext();
  const { effective: cfg } = loadConfig({
    scope: global ? 'global' : 'project',
    cwd: ctx.cwd,
    homedir: ctx.homedir,
  });
  const dbPath = resolveDbPath(global, ctx.cwd, ctx.homedir);
  const dbOverrides =
    (await tryWithSqlite(
      { databasePath: dbPath, autoBackup: false },
      (adapter) => adapter.pluginConfig.loadOverrideMap(),
    )) ?? new Map<string, boolean>();
  return makeEnabledResolver(cfg, dbOverrides);
}

async function loadAll(opts: IScopeOptions): Promise<IDiscoveredPlugin[]> {
  const ctx = defaultRuntimeContext();
  const validators = loadSchemaValidators();
  const loaderOpts: IPluginLoaderOptions = {
    searchPaths: resolveSearchPaths(opts, ctx.cwd, ctx.homedir),
    validators,
    specVersion: installedSpecVersion(),
    resolveEnabled: await buildResolver(opts.global),
  };
  const loader = createPluginLoader(loaderOpts);
  return loader.discoverAndLoadAll();
}

function statusIcon(status: IDiscoveredPlugin['status']): string {
  switch (status) {
    case 'enabled': return 'ok';
    case 'disabled': return 'off';
    case 'incompatible-spec': return 'spec!';
    case 'invalid-manifest': return 'mani!';
    case 'load-error': return 'load!';
    case 'id-collision': return 'dup!';
  }
}

// --- built-in bundle synthesis -------------------------------------------

interface IBuiltInBundleRow {
  id: string;
  granularity: TGranularity;
  enabled: boolean;
  extensions: ReadonlyArray<{
    id: string;
    kind: string;
    version: string;
    enabled: boolean;
  }>;
  /** Per-extension version+kind catalogue, used by `sm plugins show`. */
  manifestSummary: string;
}

/**
 * Build a synthesised view over the two built-in bundles, with the
 * resolved enabled-state for the bundle (granularity=bundle) or each
 * extension (granularity=extension). This lets the CLI list / show /
 * doctor / enable / disable verbs treat built-ins as first-class
 * citizens of the plugin surface — the spec promise that "no extension
 * is privileged, removable" only holds if the user can see and toggle
 * them through the same commands as their own plugins.
 */
function builtInRows(resolveEnabled: (id: string) => boolean): IBuiltInBundleRow[] {
  return builtInBundles.map((bundle) => {
    const bundleEnabled = resolveEnabled(bundle.id);
    const extensions = bundle.extensions.map((ext) => ({
      id: ext.id,
      kind: ext.kind,
      version: ext.version,
      enabled:
        bundle.granularity === 'bundle'
          ? bundleEnabled
          : resolveEnabled(qualifiedExtensionId(bundle.id, ext.id)),
    }));
    const manifestSummary = bundle.extensions
      .map((ext) => `${ext.kind}:${qualifiedExtensionId(bundle.id, ext.id)}@${ext.version}`)
      .join(', ');
    return {
      id: bundle.id,
      granularity: bundle.granularity,
      enabled: bundleEnabled,
      extensions,
      manifestSummary,
    };
  });
}

// --- list -----------------------------------------------------------------

export class PluginsListCommand extends Command {
  static override paths = [['plugins', 'list']];
  static override usage = Command.Usage({
    category: 'Plugins',
    description: 'List discovered plugins and their load status.',
    details: 'Scans <scope>/.skill-map/plugins and ~/.skill-map/plugins (or --plugin-dir <path>). Built-in bundles (claude, core) are listed alongside user plugins.',
  });

  global = Option.Boolean('-g,--global', false);
  pluginDir = Option.String('--plugin-dir', { required: false });
  json = Option.Boolean('--json', false);

  async execute(): Promise<number> {
    const plugins = await loadAll({ global: this.global, pluginDir: this.pluginDir });
    const resolveEnabled = await buildResolver(this.global);
    const builtIns = builtInRows(resolveEnabled);

    if (this.json) {
      this.context.stdout.write(
        JSON.stringify({ builtIns, plugins }, omitModule, 2) + '\n',
      );
      return ExitCode.Ok;
    }

    if (plugins.length === 0 && builtIns.length === 0) {
      this.context.stdout.write(PLUGINS_TEXTS.listEmpty);
      return ExitCode.Ok;
    }

    // Built-ins first; then user plugins.
    for (const bundle of builtIns) this.context.stdout.write(renderBuiltInBundleRow(bundle));
    for (const p of plugins) this.context.stdout.write(renderPluginRow(p));
    return ExitCode.Ok;
  }
}

/**
 * Render the multi-line block for one built-in bundle: header line plus
 * either a single inline kinds line (granularity=bundle) or one
 * indented status line per extension (granularity=extension).
 */
function renderBuiltInBundleRow(bundle: IBuiltInBundleRow): string {
  const lines: string[] = [];
  lines.push(
    tx(PLUGINS_TEXTS.builtInBundleHeader, {
      status: bundle.enabled ? PLUGINS_TEXTS.rowStatusOk : PLUGINS_TEXTS.rowStatusOff,
      id: bundle.id,
      granularity: bundle.granularity,
    }),
  );
  if (bundle.granularity === 'bundle') {
    const kinds = bundle.extensions
      .map((e) => `${e.kind}:${qualifiedExtensionId(bundle.id, e.id)}`)
      .join(', ');
    lines.push(tx(PLUGINS_TEXTS.builtInBundleKindsLine, { kinds }));
  } else {
    for (const ext of bundle.extensions) {
      lines.push(
        tx(PLUGINS_TEXTS.builtInExtensionRow, {
          stat: ext.enabled ? PLUGINS_TEXTS.rowStatusOkPad : PLUGINS_TEXTS.rowStatusOffPad,
          kind: ext.kind,
          qualifiedId: qualifiedExtensionId(bundle.id, ext.id),
          version: ext.version,
        }),
      );
    }
  }
  return lines.join('\n') + '\n';
}

/** Render the single-line status row for one user plugin. */
function renderPluginRow(p: IDiscoveredPlugin): string {
  const kinds = p.extensions?.map((e) => `${e.kind}:${e.pluginId}/${e.id}`).join(', ') ?? '';
  const granularitySuffix = p.granularity
    ? tx(PLUGINS_TEXTS.pluginRowGranularitySuffix, { granularity: p.granularity })
    : '';
  const tail =
    p.status === 'enabled'
      ? tx(PLUGINS_TEXTS.pluginRowTailEnabled, { kinds })
      : tx(PLUGINS_TEXTS.pluginRowTailDisabled, { reason: p.reason ?? '' });
  return (
    tx(PLUGINS_TEXTS.pluginRow, {
      statusIcon: statusIcon(p.status).padEnd(6),
      id: p.id,
      version: p.manifest?.version ?? PLUGINS_TEXTS.detailVersionUnknown,
      granularitySuffix,
      tail,
    }) + '\n'
  );
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
    const resolveEnabled = await buildResolver(this.global);
    const builtIns = builtInRows(resolveEnabled);
    const builtIn = builtIns.find((b) => b.id === this.id);
    const match = plugins.find((p) => p.id === this.id);

    if (!builtIn && !match) {
      this.context.stderr.write(tx(PLUGINS_TEXTS.pluginNotFound, { id: this.id }) + '\n');
      return ExitCode.NotFound;
    }

    if (this.json) {
      const payload = builtIn ?? match;
      this.context.stdout.write(JSON.stringify(payload, omitModule, 2) + '\n');
      return ExitCode.Ok;
    }

    const lines = builtIn
      ? renderBuiltInDetail(builtIn)
      : renderPluginDetail(match!);
    this.context.stdout.write(lines.join('\n') + '\n');
    return ExitCode.Ok;
  }
}

/** Detail rendering for one built-in bundle (header + extensions list). */
function renderBuiltInDetail(builtIn: IBuiltInBundleRow): string[] {
  const lines = [
    tx(PLUGINS_TEXTS.detailIdRow, { id: builtIn.id }),
    PLUGINS_TEXTS.detailPathBuiltIn,
    tx(PLUGINS_TEXTS.detailStatusRow, {
      status: builtIn.enabled ? PLUGINS_TEXTS.detailStatusEnabled : PLUGINS_TEXTS.detailStatusDisabled,
    }),
    tx(PLUGINS_TEXTS.detailGranularityRow, { granularity: builtIn.granularity }),
    PLUGINS_TEXTS.detailExtensionsHeader,
  ];
  for (const ext of builtIn.extensions) {
    const tag =
      builtIn.granularity === 'extension'
        ? tx(PLUGINS_TEXTS.detailExtensionTag, {
            state: ext.enabled ? PLUGINS_TEXTS.detailExtensionTagOn : PLUGINS_TEXTS.detailExtensionTagOff,
          })
        : '';
    lines.push(
      tx(PLUGINS_TEXTS.detailExtensionRow, {
        kind: ext.kind,
        qualifiedId: qualifiedExtensionId(builtIn.id, ext.id),
        version: ext.version,
        tag,
      }),
    );
  }
  return lines;
}

// Optional manifest fields (`version`, `specCompat`, `granularity`,
// `description`, `reason`) each fall back via `??` — every coalesce is
// one cyclomatic branch, none is a real control-flow decision.
// eslint-disable-next-line complexity
function renderPluginDetail(match: IDiscoveredPlugin): string[] {
  const lines = [
    tx(PLUGINS_TEXTS.detailIdRow, { id: match.id }),
    tx(PLUGINS_TEXTS.detailPathRow, { path: match.path }),
    tx(PLUGINS_TEXTS.detailStatusRow, { status: match.status }),
    tx(PLUGINS_TEXTS.detailVersionRow, {
      version: match.manifest?.version ?? PLUGINS_TEXTS.detailVersionUnknown,
    }),
    tx(PLUGINS_TEXTS.detailCompatRow, {
      compat: match.manifest?.specCompat ?? PLUGINS_TEXTS.detailCompatUnknown,
    }),
    tx(PLUGINS_TEXTS.detailGranularityRow, {
      granularity: match.granularity ?? PLUGINS_TEXTS.detailGranularityUnknown,
    }),
  ];
  if (match.manifest?.description) {
    lines.push(tx(PLUGINS_TEXTS.detailSummaryRow, { description: match.manifest.description }));
  }
  if (match.reason) lines.push(tx(PLUGINS_TEXTS.detailReasonRow, { reason: match.reason }));
  if (match.extensions && match.extensions.length > 0) {
    lines.push(...renderExtensionsList(match.extensions));
  }
  return lines;
}

/** Indented `extensions:` block listing one bullet per loaded extension. */
function renderExtensionsList(exts: ILoadedExtension[]): string[] {
  const lines: string[] = [PLUGINS_TEXTS.detailExtensionsHeader];
  for (const ext of exts) {
    lines.push(
      tx(PLUGINS_TEXTS.detailExtensionRow, {
        kind: ext.kind,
        qualifiedId: `${ext.pluginId}/${ext.id}`,
        version: ext.version,
        tag: '',
      }),
    );
  }
  return lines;
}

// --- applicableKinds doctor warnings (Spec § A.10) -----------------------

/**
 * One unknown-kind warning. Produced when an Extractor declares
 * `applicableKinds` including a kind that no installed Provider (built-in
 * or user plugin) emits. The extractor itself stays `loaded` — the
 * Provider may arrive later — but `sm plugins doctor` surfaces the
 * mismatch so authors catch typos and missing-dependency cases early.
 */
interface IApplicableKindWarning {
  extractorQualifiedId: string;
  unknownKind: string;
}

/**
 * Pull the runtime instance an `ILoadedExtension` points at. The loader
 * stores the imported ESM namespace verbatim in `.module`; the
 * extension's runtime export lives at `module.default` (or, for a CJS
 * fallback, on the namespace itself). Returns `null` when the shape is
 * not recognisable — the caller treats that as "no applicableKinds to
 * inspect" and moves on.
 */
function extensionInstance(ext: ILoadedExtension): Record<string, unknown> | null {
  const mod = ext.module;
  if (mod === null || typeof mod !== 'object') return null;
  const candidate = (mod as { default?: unknown }).default ?? mod;
  if (candidate === null || typeof candidate !== 'object') return null;
  return candidate as Record<string, unknown>;
}

/**
 * Collect the set of `node.kind` values every installed Provider
 * (built-in + user plugin) declares it can emit. The truth source is
 * `IProvider.kinds` — every kind the Provider emits MUST appear there
 * per `architecture.md` §`Provider`. The union of those keys is the
 * kernel's "known kinds" surface for unknown-kind detection.
 *
 * Phase 3 (spec 0.8.0): the source-of-truth migrated from a flat
 * `defaultRefreshAction` map to the `kinds` map (which subsumes both
 * the per-kind schema and the refresh action). The set of keys is the
 * same — only the field name changed.
 */
function collectKnownKinds(plugins: IDiscoveredPlugin[]): Set<string> {
  const known = new Set<string>();
  forEachProviderInstance(plugins, ({ instance }) => {
    const map = instance['kinds'];
    if (map === null || typeof map !== 'object') return;
    for (const k of Object.keys(map)) known.add(k);
  });
  return known;
}

/**
 * Iterate every Provider instance reachable from this run — built-in
 * bundles first, then user plugins (enabled only). Centralises the
 * "if (ext.kind !== 'provider') continue; cast/extract instance"
 * guard so doctor-style helpers (collect known kinds, collect missing
 * exploration dirs, …) can stay focused on per-Provider logic.
 *
 * The `instance` field uses `Record<string, unknown>` so user-plugin
 * Providers (whose runtime shape is not type-checked) and built-in
 * Providers share the same callback signature.
 */
// Two parallel iteration sources (built-in bundles + user plugins),
// each with a kind/instance guard. Centralised here so doctor helpers
// stay focused on per-Provider logic.
// eslint-disable-next-line complexity
function forEachProviderInstance(
  plugins: IDiscoveredPlugin[],
  callback: (entry: { id: string; pluginId: string; instance: Record<string, unknown> }) => void,
): void {
  for (const bundle of builtInBundles) {
    for (const ext of bundle.extensions) {
      if (ext.kind !== 'provider') continue;
      const provider = ext as IProvider;
      callback({
        id: provider.id,
        pluginId: bundle.id,
        instance: provider as unknown as Record<string, unknown>,
      });
    }
  }
  for (const p of plugins) {
    if (p.status !== 'enabled' || !p.extensions) continue;
    for (const ext of p.extensions) {
      if (ext.kind !== 'provider') continue;
      const inst = extensionInstance(ext);
      if (!inst) continue;
      callback({ id: ext.id, pluginId: ext.pluginId, instance: inst });
    }
  }
}

/**
 * Walk every loaded Extractor (built-in + user plugin) and produce one
 * warning per unknown kind referenced via `applicableKinds`. An extractor
 * with no `applicableKinds` field is silent (default = applies to all
 * kinds). Iteration order is deterministic so the rendered doctor output
 * stays stable across runs.
 */
// Two parallel iteration sources (built-in extractors + user plugin
// extractors) with kind/applicableKinds guards. The shared inner loop
// is `appendUnknownKindWarnings`.
// eslint-disable-next-line complexity
function collectApplicableKindWarnings(
  plugins: IDiscoveredPlugin[],
  knownKinds: Set<string>,
): IApplicableKindWarning[] {
  const out: IApplicableKindWarning[] = [];

  // Built-in extractors (typed).
  for (const bundle of builtInBundles) {
    for (const ext of bundle.extensions) {
      if (ext.kind !== 'extractor') continue;
      const extractor = ext as IExtractor;
      if (!extractor.applicableKinds) continue;
      appendUnknownKindWarnings(
        out,
        qualifiedExtensionId(bundle.id, extractor.id),
        extractor.applicableKinds,
        knownKinds,
      );
    }
  }

  // User-plugin extractors (untyped — applicableKinds may be any value).
  for (const p of plugins) {
    if (p.status !== 'enabled' || !p.extensions) continue;
    for (const ext of p.extensions) {
      if (ext.kind !== 'extractor') continue;
      const inst = extensionInstance(ext);
      if (!inst) continue;
      const ak = inst['applicableKinds'];
      if (!Array.isArray(ak)) continue;
      appendUnknownKindWarnings(
        out,
        qualifiedExtensionId(ext.pluginId, ext.id),
        ak,
        knownKinds,
      );
    }
  }
  return out;
}

/**
 * Push one warning for every kind in `applicableKinds` that the
 * Provider catalog does not recognise. Tolerates `unknown[]` so the
 * user-plugin path (where the array shape is not type-checked) can
 * filter non-string entries silently.
 */
function appendUnknownKindWarnings(
  out: IApplicableKindWarning[],
  extractorQualifiedId: string,
  applicableKinds: readonly unknown[],
  knownKinds: Set<string>,
): void {
  for (const k of applicableKinds) {
    if (typeof k !== 'string') continue;
    if (!knownKinds.has(k)) out.push({ extractorQualifiedId, unknownKind: k });
  }
}

// --- explorationDir doctor warnings (Provider §) -------------------------

/**
 * One missing-explorationDir warning. Produced when a Provider declares an
 * `explorationDir` that does not exist on the filesystem after `~`
 * expansion. Non-blocking — the user may legitimately have not installed
 * that platform yet — so the warning is informational and does NOT promote
 * the exit code.
 */
interface IProviderExplorationDirWarning {
  providerQualifiedId: string;
  explorationDir: string;
  resolvedPath: string;
}

/**
 * Resolve `~` and `~user` prefixes against the supplied home dir.
 * Mirrors the canonical shell convention so the doctor's existence check
 * matches what the Provider's `walk()` would actually traverse at scan
 * time. Returns the input verbatim when no `~` prefix is present.
 */
function expandHome(p: string, homedir: string): string {
  if (p === '~') return homedir;
  if (p.startsWith('~/')) return join(homedir, p.slice(2));
  return p;
}

/**
 * Walk every loaded Provider (built-in + user plugin) and emit one warning
 * per declared `explorationDir` that does not exist on disk. The lookup
 * resolves `~` against the supplied home dir; relative paths fall back
 * to the cwd.
 */
function collectExplorationDirWarnings(
  plugins: IDiscoveredPlugin[],
  homedir: string,
): IProviderExplorationDirWarning[] {
  const out: IProviderExplorationDirWarning[] = [];
  forEachProviderInstance(plugins, ({ id, pluginId, instance }) => {
    const dir = instance['explorationDir'];
    if (typeof dir !== 'string' || dir.length === 0) return;
    const resolved = expandHome(dir, homedir);
    if (!existsSync(resolved)) {
      out.push({
        providerQualifiedId: qualifiedExtensionId(pluginId, id),
        explorationDir: dir,
        resolvedPath: resolved,
      });
    }
  });
  return out;
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

  // Doctor verb: counts by status + applicableKinds warnings +
  // explorationDir warnings + bad-plugins issues, each with its own
  // gated render. Branching is intrinsic to the multi-section diagnostic
  // output; the per-section helpers (`collectKnownKinds`,
  // `collectApplicableKindWarnings`, `collectExplorationDirWarnings`)
  // already encapsulate the data gathering.
  // eslint-disable-next-line complexity
  async execute(): Promise<number> {
    const plugins = await loadAll({ global: this.global, pluginDir: this.pluginDir });
    const resolveEnabled = await buildResolver(this.global);
    const builtIns = builtInRows(resolveEnabled);
    const counts: Record<IDiscoveredPlugin['status'], number> = {
      enabled: 0,
      disabled: 0,
      'incompatible-spec': 0,
      'invalid-manifest': 0,
      'load-error': 0,
      'id-collision': 0,
    };
    // Built-ins contribute to enabled / disabled counts so the doctor
    // summary reflects the full surface, not just user plugins.
    for (const b of builtIns) {
      if (b.granularity === 'bundle') {
        counts[b.enabled ? 'enabled' : 'disabled']++;
      } else {
        for (const ext of b.extensions) {
          counts[ext.enabled ? 'enabled' : 'disabled']++;
        }
      }
    }
    for (const p of plugins) counts[p.status]++;

    const total = plugins.length + builtIns.reduce(
      (n, b) => n + (b.granularity === 'bundle' ? 1 : b.extensions.length),
      0,
    );
    this.context.stdout.write(
      tx(PLUGINS_TEXTS.doctorDiscoveredHeader, {
        total,
        builtInCount: builtIns.length,
        userCount: plugins.length,
      }),
    );
    for (const status of Object.keys(counts) as Array<IDiscoveredPlugin['status']>) {
      this.context.stdout.write(
        tx(PLUGINS_TEXTS.doctorCountRow, {
          status: status.padEnd(18),
          count: counts[status],
        }),
      );
    }

    // Spec § A.10 — applicableKinds: surface unknown-kind warnings as
    // informational diagnostics. They do NOT promote the exit code (the
    // Provider that declares the kind may legitimately arrive later);
    // they only tell the author "your extractor will never fire on the
    // kind you typed".
    const knownKinds = collectKnownKinds(plugins);
    const applicableKindWarnings = collectApplicableKindWarnings(plugins, knownKinds);
    // Provider explorationDir validation. Non-blocking — the user may not
    // have installed that platform yet, so missing dir is informational.
    const explorationDirWarnings = collectExplorationDirWarnings(plugins, defaultRuntimeContext().homedir);
    if (applicableKindWarnings.length > 0 || explorationDirWarnings.length > 0) {
      this.context.stdout.write(PLUGINS_TEXTS.doctorWarningsHeader);
      for (const w of applicableKindWarnings) {
        this.context.stdout.write(
          tx(PLUGINS_TEXTS.doctorWarningLine, {
            message: tx(PLUGINS_TEXTS.doctorApplicableKindUnknown, {
              extractorId: w.extractorQualifiedId,
              unknownKind: w.unknownKind,
            }),
          }),
        );
      }
      for (const w of explorationDirWarnings) {
        this.context.stdout.write(
          tx(PLUGINS_TEXTS.doctorWarningLine, {
            message: tx(PLUGINS_TEXTS.doctorProviderExplorationDirMissing, {
              providerId: w.providerQualifiedId,
              explorationDir: w.explorationDir,
              resolvedPath: w.resolvedPath,
            }),
          }),
        );
      }
    }

    // Errors gate the exit code; `disabled` is intentional and never an issue.
    const bad = plugins.filter(
      (p) => p.status !== 'enabled' && p.status !== 'disabled',
    );
    if (bad.length > 0) {
      this.context.stdout.write(PLUGINS_TEXTS.doctorIssuesHeader);
      for (const p of bad) {
        this.context.stdout.write(
          tx(PLUGINS_TEXTS.doctorIssueLine, {
            status: p.status,
            id: p.id,
            reason: p.reason ?? '',
          }),
        );
      }
      return ExitCode.Issues;
    }
    return ExitCode.Ok;
  }
}

// --- enable / disable -----------------------------------------------------

interface IBundleSlim {
  id: string;
  granularity: TGranularity;
  extensionIds: string[];
}

/**
 * Build the canonical bundle catalogue: built-ins first, then any
 * loaded user plugins. Used by the toggle verbs to validate `<id>`
 * against the granularity declared on the owning bundle.
 *
 * Plugins whose manifest never validated (`invalid-manifest` /
 * `load-error` without a manifest) are still listed so the user can
 * disable a buggy plugin to silence its load error — but their
 * `granularity` falls back to `'bundle'` (the safe default that the
 * loader would inject if the manifest were repaired).
 */
function bundleCatalogue(plugins: IDiscoveredPlugin[]): IBundleSlim[] {
  const out: IBundleSlim[] = [];
  for (const bundle of builtInBundles) {
    out.push({
      id: bundle.id,
      granularity: bundle.granularity,
      extensionIds: bundle.extensions.map((e) => e.id),
    });
  }
  for (const p of plugins) {
    out.push({
      id: p.id,
      granularity: p.granularity ?? 'bundle',
      extensionIds: p.extensions?.map((e) => e.id) ?? [],
    });
  }
  return out;
}

interface IResolvedTarget {
  /**
   * The key written to `config_plugins.plugin_id`. For bundle granularity
   * this is the bundle id; for extension granularity it's the qualified
   * id `<bundle>/<ext>`.
   */
  key: string;
}

/**
 * Resolve a user-supplied `<id>` (either a plugin id or a qualified
 * extension id) against the catalogue. Returns either a usable
 * `key` to persist, or a directed error message that explains why the
 * id was rejected (granularity mismatch, unknown bundle, unknown
 * extension under a known bundle).
 */
// eslint-disable-next-line complexity
function resolveToggleTarget(
  id: string,
  catalogue: IBundleSlim[],
  verb: 'enable' | 'disable',
): IResolvedTarget | { error: string } {
  if (id.includes('/')) {
    const [bundleId, extId, ...rest] = id.split('/');
    if (!bundleId || !extId || rest.length > 0) {
      return { error: tx(PLUGINS_TEXTS.qualifiedIdUnknownBundle, { bundleId: id }) };
    }
    const bundle = catalogue.find((b) => b.id === bundleId);
    if (!bundle) {
      return { error: tx(PLUGINS_TEXTS.qualifiedIdUnknownBundle, { bundleId }) };
    }
    if (bundle.granularity === 'bundle') {
      return {
        error: tx(PLUGINS_TEXTS.granularityBundleRejectsQualified, {
          bundleId,
          extId,
          verb,
        }),
      };
    }
    if (!bundle.extensionIds.includes(extId)) {
      return {
        error: tx(PLUGINS_TEXTS.qualifiedIdNotFound, {
          id,
          bundleId,
          extId,
        }),
      };
    }
    return { key: qualifiedExtensionId(bundleId, extId) };
  }

  const bundle = catalogue.find((b) => b.id === id);
  if (!bundle) {
    return { error: tx(PLUGINS_TEXTS.pluginNotFound, { id }) };
  }
  if (bundle.granularity === 'extension') {
    return {
      error: tx(PLUGINS_TEXTS.granularityExtensionRejectsBundleId, {
        bundleId: id,
        verb,
      }),
    };
  }
  return { key: bundle.id };
}

abstract class TogglePluginsBase extends Command {
  global = Option.Boolean('-g,--global', false);
  all = Option.Boolean('--all', false);
  id = Option.String({ required: false });

  // eslint-disable-next-line complexity
  protected async toggle(enabled: boolean): Promise<number> {
    const elapsed = startElapsed();
    const verb = enabled ? 'enable' : 'disable';
    if (this.all && this.id) {
      this.context.stderr.write(PLUGINS_TEXTS.toggleBothIdAndAll);
      emitDoneStderr(this.context.stderr, elapsed);
      return ExitCode.Error;
    }
    if (!this.all && !this.id) {
      this.context.stderr.write(PLUGINS_TEXTS.toggleNeitherIdNorAll);
      emitDoneStderr(this.context.stderr, elapsed);
      return ExitCode.Error;
    }

    // Resolve discovery so `<id>` is validated and `--all` knows the set.
    const plugins = await loadAll({
      global: this.global,
      pluginDir: undefined,
    });
    const catalogue = bundleCatalogue(plugins);

    let targets: string[];
    if (this.all) {
      // `--all` is a macro on bundle ids: every plugin / bundle the user
      // can see. We deliberately do NOT expand to qualified
      // <bundle>/<ext> keys — that would silently flip a granularity
      // policy. For granularity=extension bundles the user already
      // hits the directed error message ("use bundle/<ext>") if they
      // try the bundle id directly, so `--all` skips them here too
      // and the real "disable every core extension" intent is served
      // by `--no-built-ins` on `sm scan`.
      targets = catalogue
        .filter((b) => b.granularity === 'bundle')
        .map((b) => b.id);
    } else {
      const resolved = resolveToggleTarget(this.id!, catalogue, verb);
      if ('error' in resolved) {
        this.context.stderr.write(tx(PLUGINS_TEXTS.toggleResolveError, { error: resolved.error }));
        emitDoneStderr(this.context.stderr, elapsed);
        // Granularity errors and unknown ids are both user input
        // problems — exit 5 (NotFound) keeps the existing contract
        // for "you asked me to act on something I cannot resolve".
        return ExitCode.NotFound;
      }
      targets = [resolved.key];
    }

    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath(this.global, ctx.cwd, ctx.homedir);
    await withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      for (const id of targets) {
        await adapter.pluginConfig.set(id, enabled);
      }
    });

    const verbPast = enabled ? 'enabled' : 'disabled';
    if (targets.length === 1) {
      this.context.stdout.write(tx(PLUGINS_TEXTS.toggleAppliedSingle, { verbPast, id: targets[0]! }));
    } else {
      this.context.stdout.write(
        tx(PLUGINS_TEXTS.toggleAppliedManyHeader, { verbPast, count: targets.length }),
      );
      for (const id of targets) {
        this.context.stdout.write(tx(PLUGINS_TEXTS.toggleAppliedManyRow, { id }));
      }
    }
    emitDoneStderr(this.context.stderr, elapsed);
    return ExitCode.Ok;
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

      Granularity: a bundle-granularity plugin (default for user plugins,
      and the built-in 'claude' bundle) accepts only the bundle id. An
      extension-granularity plugin (the built-in 'core' bundle) accepts
      only qualified ids '<bundle>/<ext-id>'. Mismatches are rejected
      with directed guidance.
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

      Granularity: a bundle-granularity plugin (default for user plugins,
      and the built-in 'claude' bundle) accepts only the bundle id. An
      extension-granularity plugin (the built-in 'core' bundle) accepts
      only qualified ids '<bundle>/<ext-id>'. Mismatches are rejected
      with directed guidance.
    `,
  });

  async execute(): Promise<number> {
    return this.toggle(false);
  }
}

/* `port.pluginConfig.delete` is on the StoragePort surface, kept
 * available for `sm config reset` once that verb lands. */

/**
 * JSON-serializer replacer: the ILoadedExtension.module field is a live
 * ESM namespace with circular references — omit it from output.
 *
 * We identify the namespace by its `[Symbol.toStringTag] === 'Module'`
 * marker (the standard tag Node sets on ESM module records), so a
 * plugin manifest that legitimately ships an unrelated `module` key
 * (e.g. a string property in `metadata`) is preserved. The earlier
 * implementation dropped EVERY `module` key in the tree, which silently
 * lost data on first sight.
 */
function omitModule(key: string, value: unknown): unknown {
  if (key !== 'module') return value;
  if (value === null || typeof value !== 'object') return value;
  const tag = (value as { [Symbol.toStringTag]?: unknown })[Symbol.toStringTag];
  return tag === 'Module' ? undefined : value;
}

export const PLUGIN_COMMANDS = [
  PluginsListCommand,
  PluginsShowCommand,
  PluginsDoctorCommand,
  PluginsEnableCommand,
  PluginsDisableCommand,
];
