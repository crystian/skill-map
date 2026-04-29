/**
 * Built-in extension registry. Returns the eleven extensions bundled with
 * the reference implementation, ready to be registered on a Kernel. The
 * set matches ROADMAP §Step 2 verbatim.
 *
 * Keeping runtime references separate from the manifest-only entries the
 * Registry indexes: a consumer that only needs to list what's bundled
 * iterates `listBuiltIns()` for cheap manifest facts, while the
 * orchestrator needs the concrete `IAdapter` / `IDetector` / ... values
 * to actually call walk / detect / evaluate / render / run. Two exports
 * keep both access patterns first-class.
 *
 * **Spec § A.6 — qualified ids.** Every built-in declares its `pluginId`
 * directly in its module export (built-ins have no `plugin.json`, so
 * the bundle declaration IS the source of truth for their namespace).
 * Two namespaces by convention:
 *
 *   - **`core/`** — kernel-internal primitives (every rule, the ASCII
 *     renderer, the audit, the external-URL counter detector).
 *     Platform-agnostic.
 *   - **`claude/`** — the Claude Code provider bundle (the adapter plus
 *     its kind-aware detectors: frontmatter, slash, at-directive).
 *
 * The registry composes the qualified id `<pluginId>/<id>` at registration
 * time; cross-extension references (`defaultRefreshAction`, future
 * `composes[]`) MUST use the qualified form.
 *
 * **Spec § A.7 — granularity.** Each bundle declares whether the user
 * toggles it whole (`granularity: 'bundle'`) or one extension at a time
 * (`granularity: 'extension'`). The two built-in bundles split:
 *
 *   - `claude` — `granularity: 'bundle'`. Adapter + its kind-aware
 *     detectors form a coherent provider; the user enables or disables
 *     the whole Claude Code surface, never half of it.
 *   - `core`   — `granularity: 'extension'`. Per the spec promise that
 *     "no extension is privileged, removable", every kernel built-in
 *     (each rule, the ASCII renderer, the audit, the external-URL
 *     counter detector) is independently toggle-able via its qualified
 *     id (e.g. `sm plugins disable core/superseded`).
 */

import type {
  IAdapter,
  IAudit,
  IDetector,
  IRenderer,
  IRule,
} from '../kernel/extensions/index.js';
import type { Extension } from '../kernel/registry.js';
import type { TGranularity } from '../kernel/types/plugin.js';
import { claudeAdapter } from './adapters/claude/index.js';
import { frontmatterDetector } from './detectors/frontmatter/index.js';
import { slashDetector } from './detectors/slash/index.js';
import { atDirectiveDetector } from './detectors/at-directive/index.js';
import { externalUrlCounterDetector } from './detectors/external-url-counter/index.js';
import { triggerCollisionRule } from './rules/trigger-collision/index.js';
import { brokenRefRule } from './rules/broken-ref/index.js';
import { supersededRule } from './rules/superseded/index.js';
import { linkConflictRule } from './rules/link-conflict/index.js';
import { asciiRenderer } from './renderers/ascii/index.js';
import { validateAllAudit } from './audits/validate-all/index.js';

export interface IBuiltIns {
  adapters: IAdapter[];
  detectors: IDetector[];
  rules: IRule[];
  renderers: IRenderer[];
  audits: IAudit[];
}

/**
 * Concrete runtime instance of any extension kind a built-in can carry.
 * Mirrors what the orchestrator actually invokes (`walk` / `detect` /
 * `evaluate` / `render` / `audit`); composed into the `IBuiltIns` buckets
 * by `builtIns()`.
 */
export type TBuiltInExtension = IAdapter | IDetector | IRule | IRenderer | IAudit;

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
 * order in which built-ins land in the registry (claude adapter +
 * detectors, then core rules / renderer / audit). Stable order matters
 * for snapshot tests and CI output diffs.
 */
export const builtInBundles: IBuiltInBundle[] = [
  {
    id: 'claude',
    granularity: 'bundle',
    extensions: [
      claudeAdapter,
      frontmatterDetector,
      slashDetector,
      atDirectiveDetector,
    ],
  },
  {
    id: 'core',
    granularity: 'extension',
    extensions: [
      externalUrlCounterDetector,
      triggerCollisionRule,
      brokenRefRule,
      supersededRule,
      linkConflictRule,
      asciiRenderer,
      validateAllAudit,
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
    adapters: [],
    detectors: [],
    rules: [],
    renderers: [],
    audits: [],
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
    case 'adapter':
      out.adapters.push(ext);
      break;
    case 'detector':
      out.detectors.push(ext);
      break;
    case 'rule':
      out.rules.push(ext);
      break;
    case 'renderer':
      out.renderers.push(ext);
      break;
    case 'audit':
      out.audits.push(ext);
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
