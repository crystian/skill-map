/**
 * Built-in extension registry. Returns the eleven extensions bundled with
 * the reference implementation, ready to be registered on a Kernel. The
 * set matches ROADMAP §Step 2 verbatim.
 *
 * Keeping runtime references separate from the manifest-only entries the
 * Registry indexes: a consumer that only needs to list what's bundled
 * iterates `listBuiltIns()` for cheap manifest facts, while the
 * orchestrator needs the concrete `IProvider` / `IExtractor` / ... values
 * to actually call walk / extract / evaluate / format. Two exports
 * keep both access patterns first-class.
 *
 * **Spec § A.6 — qualified ids.** Every built-in declares its `pluginId`
 * directly in its module export (built-ins have no `plugin.json`, so
 * the bundle declaration IS the source of truth for their namespace).
 * Two namespaces by convention:
 *
 *   - **`core/`** — kernel-internal primitives (every rule, the ASCII
 *     formatter, the external-URL counter extractor). Platform-agnostic.
 *   - **`claude/`** — the Claude Code Provider bundle (the Provider plus
 *     its kind-aware extractors: frontmatter, slash, at-directive).
 *
 * The registry composes the qualified id `<pluginId>/<id>` at registration
 * time; cross-extension references (`defaultRefreshAction`, future
 * `composes[]`) MUST use the qualified form.
 *
 * **Spec § A.7 — granularity.** Each bundle declares whether the user
 * toggles it whole (`granularity: 'bundle'`) or one extension at a time
 * (`granularity: 'extension'`). The two built-in bundles split:
 *
 *   - `claude` — `granularity: 'bundle'`. Provider + its kind-aware
 *     extractors form a coherent platform integration; the user enables
 *     or disables the whole Claude Code surface, never half of it.
 *   - `core`   — `granularity: 'extension'`. Per the spec promise that
 *     "no extension is privileged, removable", every kernel built-in
 *     (each rule, the ASCII formatter, the external-URL counter extractor)
 *     is independently toggle-able via its qualified id (e.g.
 *     `sm plugins disable core/superseded`).
 */

import type {
  IProvider,
  IExtractor,
  IFormatter,
  IHook,
  IRule,
} from '../kernel/extensions/index.js';
import type { Extension } from '../kernel/registry.js';
import type { TGranularity } from '../kernel/types/plugin.js';
import { claudeProvider } from './providers/claude/index.js';
import { frontmatterExtractor } from './extractors/frontmatter/index.js';
import { slashExtractor } from './extractors/slash/index.js';
import { atDirectiveExtractor } from './extractors/at-directive/index.js';
import { externalUrlCounterExtractor } from './extractors/external-url-counter/index.js';
import { triggerCollisionRule } from './rules/trigger-collision/index.js';
import { brokenRefRule } from './rules/broken-ref/index.js';
import { supersededRule } from './rules/superseded/index.js';
import { linkConflictRule } from './rules/link-conflict/index.js';
import { asciiFormatter } from './formatters/ascii/index.js';
import { validateAllRule } from './rules/validate-all/index.js';

export interface IBuiltIns {
  providers: IProvider[];
  extractors: IExtractor[];
  rules: IRule[];
  formatters: IFormatter[];
  /**
   * Hooks bundled with the reference impl. Empty in this bump (A.11
   * adds the kind itself; concrete built-in hooks land separately if
   * the demand surfaces — bookkeeping / metrics hooks are the obvious
   * future candidates). Carried as a typed field so call sites can
   * iterate `bundle.hooks` without conditional checks.
   */
  hooks: IHook[];
}

/**
 * Concrete runtime instance of any extension kind a built-in can carry.
 * Mirrors what the orchestrator actually invokes (`walk` / `extract` /
 * `evaluate` / `format` / `on`); composed into the `IBuiltIns` buckets
 * by `builtIns()`.
 */
export type TBuiltInExtension = IProvider | IExtractor | IRule | IFormatter | IHook;

/**
 * One bundle of built-in extensions. The bundle's `id` is the plugin id
 * (`'core'` / `'claude'`) — built-ins have no `plugin.json` so the
 * bundle declaration IS the source of truth for both the namespace and
 * the granularity policy.
 */
export interface IBuiltInBundle {
  id: string;
  granularity: TGranularity;
  extensions: TBuiltInExtension[];
}

/**
 * The two built-in bundles, in their canonical order. Consumers that
 * need to apply per-bundle / per-extension policies (the runtime
 * `composeScanExtensions`, `sm plugins list`) iterate this directly.
 *
 * Iteration order is stable: claude first, core second. It mirrors the
 * order in which built-ins land in the registry (claude Provider +
 * extractors, then core rules / formatter). Stable order matters for
 * snapshot tests and CI output diffs.
 */
export const builtInBundles: IBuiltInBundle[] = [
  {
    id: 'claude',
    granularity: 'bundle',
    extensions: [
      claudeProvider,
      frontmatterExtractor,
      slashExtractor,
      atDirectiveExtractor,
    ],
  },
  {
    id: 'core',
    granularity: 'extension',
    extensions: [
      externalUrlCounterExtractor,
      triggerCollisionRule,
      brokenRefRule,
      supersededRule,
      linkConflictRule,
      asciiFormatter,
      validateAllRule,
    ],
  },
];

/**
 * Bucketed view of every built-in, in the shape the orchestrator
 * consumes. Composed from `builtInBundles` so the source of truth stays
 * single. NOT filtered by `config_plugins` — call sites that need
 * granular gating (`composeScanExtensions`) walk the bundles themselves.
 */
export function builtIns(): IBuiltIns {
  const out: IBuiltIns = {
    providers: [],
    extractors: [],
    rules: [],
    formatters: [],
    hooks: [],
  };
  for (const bundle of builtInBundles) {
    for (const ext of bundle.extensions) {
      bucketBuiltIn(ext, out);
    }
  }
  return out;
}

/** Flat view as Registry-ready Extension rows. */
export function listBuiltIns(): Extension[] {
  const out: Extension[] = [];
  for (const bundle of builtInBundles) {
    for (const x of bundle.extensions) {
      out.push(toExtensionRow(x));
    }
  }
  return out;
}

/**
 * Drop a built-in into the right bucket for the orchestrator. Mirrors
 * `bucketLoaded` in `cli/util/plugin-runtime.ts` — kept private here
 * because the built-ins skip the `module` namespace step (their
 * `pluginId` is already declared).
 */
function bucketBuiltIn(ext: TBuiltInExtension, out: IBuiltIns): void {
  switch (ext.kind) {
    case 'provider':
      out.providers.push(ext);
      break;
    case 'extractor':
      out.extractors.push(ext);
      break;
    case 'rule':
      out.rules.push(ext);
      break;
    case 'formatter':
      out.formatters.push(ext);
      break;
    case 'hook':
      out.hooks.push(ext);
      break;
  }
}

function toExtensionRow(x: TBuiltInExtension): Extension {
  const row: Extension = {
    id: x.id,
    pluginId: x.pluginId,
    kind: x.kind,
    version: x.version,
  };
  if (x.description !== undefined) row.description = x.description;
  if (x.stability !== undefined) row.stability = x.stability;
  if (x.preconditions !== undefined) row.preconditions = x.preconditions;
  if (x.entry !== undefined) row.entry = x.entry;
  return row;
}
