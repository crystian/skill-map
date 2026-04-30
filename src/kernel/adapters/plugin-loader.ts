/**
 * `PluginLoader` — default `PluginLoaderPort` implementation.
 *
 * Responsibilities (per spec §Plugin discovery + Step 1b acceptance +
 * spec v0.8.0 § A.5 — id uniqueness):
 *
 * 1. Discover plugin directories under one or more search paths, each
 *    containing a `plugin.json` at its root.
 * 2. Parse + AJV-validate the manifest against
 *    `plugins-registry.schema.json#/$defs/PluginManifest`.
 * 3. Enforce the structural rule **directory name == manifest id**. A
 *    mismatch surfaces as `invalid-manifest` with a directed reason.
 *    This rule alone rules out same-root collisions by construction
 *    (a filesystem cannot host two siblings with the same name).
 * 4. Semver-check `manifest.specCompat` against the installed
 *    `@skill-map/spec` version.
 * 5. Dynamic-import every path listed in `manifest.extensions[]`, expect a
 *    default export matching the extension-kind schema, validate it, and
 *    collect the loaded extensions.
 * 6. After every plugin has been loaded individually, scan the result set
 *    for cross-root id collisions. Two plugins claiming the same id (any
 *    combination of project + global + `--plugin-dir`) BOTH receive
 *    status `id-collision`; no precedence rule applies. The user resolves
 *    by renaming one and rerunning.
 * 7. Surface one of the documented failure modes when anything fails:
 *    `invalid-manifest` / `incompatible-spec` / `load-error` /
 *    `id-collision`. The kernel keeps booting regardless — a bad plugin
 *    cannot take the process down.
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import semver from 'semver';

import type {
  IDiscoveredPlugin,
  ILoadedExtension,
  IPluginManifest,
  IPluginStorageSchema,
  TPluginLoadStatus,
} from '../types/plugin.js';
import { PLUGIN_LOADER_TEXTS } from '../i18n/plugin-loader.texts.js';
import { tx } from '../util/tx.js';
import { KV_SCHEMA_KEY } from './plugin-store.js';
import type { TExtensionKind } from './schema-validators.js';
import type { ISchemaValidators } from './schema-validators.js';

// ajv-formats ships CJS-first; the default export is the callable plugin
// under ESM interop but TS sometimes types it as the namespace. Match
// the normalisation `schema-validators.ts` does for the same reason.
const addFormats = (addFormatsModule as unknown as { default?: typeof addFormatsModule })
  .default ?? addFormatsModule;

type TAjv = InstanceType<typeof Ajv2020>;

/**
 * Default per-extension dynamic-import timeout. Generous on purpose —
 * a plugin that legitimately takes >5s to import is misbehaving (it
 * should not have heavy work at module top level), but the extra
 * headroom avoids spurious timeouts on cold disk caches and slow CI
 * runners.
 */
export const DEFAULT_PLUGIN_IMPORT_TIMEOUT_MS = 5000;

export interface IPluginLoaderOptions {
  /** Search paths to scan for plugin directories. Non-existent paths are skipped. */
  searchPaths: string[];
  /** Required — used to validate plugin.json and each extension manifest. */
  validators: ISchemaValidators;
  /** Installed @skill-map/spec version, used for specCompat check. */
  specVersion: string;
  /**
   * When supplied, the loader calls this with every parsed plugin id
   * AFTER manifest + specCompat validation succeed. A return value of
   * `false` short-circuits the load: the plugin is reported with
   * `status: 'disabled'` and its extensions are NOT imported. Defaults
   * to "always enabled" when omitted (no DB / config integration —
   * useful for tests that assert raw discovery behaviour).
   */
  resolveEnabled?: (pluginId: string) => boolean;
  /**
   * Per-extension dynamic-import timeout in milliseconds. A plugin whose
   * top-level work (imports, side effects) exceeds this is reported as
   * `load-error` with a message naming the timeout, instead of hanging
   * the host CLI command (`sm scan`, `sm plugins list`, `sm watch`).
   * Defaults to `DEFAULT_PLUGIN_IMPORT_TIMEOUT_MS` (5s). Tests pass a
   * smaller value to exercise the timeout path quickly.
   *
   * Note: there is no AbortSignal on `import()` in Node 24 — when the
   * timer wins, the import is abandoned (the dangling promise resolves
   * later and is GC'd) but its side effects, if any, still run. The
   * timeout protects the orchestrator from hanging, not the host
   * process from a misbehaving plugin's runtime cost.
   */
  loadTimeoutMs?: number;
}

export class PluginLoader {
  readonly #options: IPluginLoaderOptions;
  readonly #loadTimeoutMs: number;

  constructor(options: IPluginLoaderOptions) {
    this.#options = options;
    this.#loadTimeoutMs = options.loadTimeoutMs ?? DEFAULT_PLUGIN_IMPORT_TIMEOUT_MS;
  }

  /**
   * Discover every plugin directory across the configured search paths.
   * Each direct child directory containing a `plugin.json` is considered a
   * plugin root. Non-plugin directories are silently skipped.
   */
  discoverPaths(): string[] {
    const out: string[] = [];
    for (const root of this.#options.searchPaths) {
      if (!existsSync(root)) continue;
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = join(root, entry.name);
        if (existsSync(join(candidate, 'plugin.json'))) {
          out.push(resolve(candidate));
        }
      }
    }
    return out;
  }

  /**
   * Full pass — discover every plugin, attempt to load each, then apply
   * the cross-root id-collision pass over the results. Two plugins that
   * survived their individual load with the same `manifest.id` both get
   * downgraded to status `id-collision` (no precedence — the spec is
   * explicit that "no extension is privileged"). Plugins that already
   * failed their individual load (`invalid-manifest` /
   * `incompatible-spec` / `load-error`) keep their original status:
   * their `id` field is untrusted (it may be a fall-back path hint when
   * the manifest could not be parsed) and they would muddy the
   * collision report.
   */
  async discoverAndLoadAll(): Promise<IDiscoveredPlugin[]> {
    const paths = this.discoverPaths();
    const out: IDiscoveredPlugin[] = [];
    for (const path of paths) {
      out.push(await this.loadOne(path));
    }
    return applyIdCollisions(out);
  }

  /**
   * Load a single plugin from its directory. Never throws — a failure is
   * reported via the returned status.
   */
  async loadOne(pluginPath: string): Promise<IDiscoveredPlugin> {
    const manifestPath = join(pluginPath, 'plugin.json');

    // --- manifest parse + shape validation --------------------------------
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      return fail(
        pluginPath,
        pathId(pluginPath),
        'invalid-manifest',
        tx(PLUGIN_LOADER_TEXTS.invalidManifestJsonParse, {
          manifestPath,
          errDescription: describe(err),
        }),
      );
    }

    const manifestResult = this.#options.validators.validatePluginManifest<IPluginManifest>(raw);
    if (!manifestResult.ok) {
      return fail(
        pluginPath,
        pathId(pluginPath),
        'invalid-manifest',
        tx(PLUGIN_LOADER_TEXTS.invalidManifestAjv, {
          manifestPath,
          errors: manifestResult.errors,
        }),
      );
    }
    const manifest = manifestResult.data;

    // --- directory name == manifest id ------------------------------------
    // Cheap structural rule (spec § A.5 — plugin id global uniqueness).
    // Two siblings on the same filesystem cannot share a name, so making
    // the directory match the id eliminates same-root collisions by
    // construction. Cross-root collisions are caught afterwards by
    // `applyIdCollisions` over the full discovery result.
    const dirName = pathId(pluginPath);
    if (dirName !== manifest.id) {
      return {
        ...fail(
          pluginPath,
          manifest.id,
          'invalid-manifest',
          tx(PLUGIN_LOADER_TEXTS.invalidManifestDirMismatch, {
            dirName,
            manifestId: manifest.id,
          }),
        ),
        manifest,
      };
    }

    // --- spec compat ------------------------------------------------------
    if (!semver.validRange(manifest.specCompat)) {
      return {
        ...fail(
          pluginPath,
          manifest.id,
          'invalid-manifest',
          tx(PLUGIN_LOADER_TEXTS.invalidSpecCompat, { specCompat: manifest.specCompat }),
        ),
        manifest,
      };
    }
    if (!semver.satisfies(this.#options.specVersion, manifest.specCompat, { includePrerelease: true })) {
      return {
        path: pluginPath,
        id: manifest.id,
        status: 'incompatible-spec',
        manifest,
        granularity: manifest.granularity ?? 'bundle',
        reason: tx(PLUGIN_LOADER_TEXTS.incompatibleSpec, {
          installedSpecVersion: this.#options.specVersion,
          specCompat: manifest.specCompat,
        }),
      };
    }

    // --- enabled resolution ----------------------------------------------
    // Only check after manifest + specCompat pass: a `disabled` status
    // implies "we know this plugin enough to surface it; we just chose
    // not to run it". An invalid or incompatible plugin gets its own
    // status and never reaches this branch.
    //
    // Spec § A.7 — granularity. User plugins always opt into one of two
    // toggle modes. The loader's pre-import resolveEnabled() check uses
    // the plugin id (the bundle-level key). Plugins with
    // granularity='extension' that want to gate individual extensions
    // need a richer policy at the runtime composer (see
    // `cli/util/plugin-runtime.ts`); the loader stage is intentionally
    // coarse — disabling the bundle id always wins, so the import work
    // is skipped wholesale.
    if (this.#options.resolveEnabled && !this.#options.resolveEnabled(manifest.id)) {
      return {
        path: pluginPath,
        id: manifest.id,
        status: 'disabled',
        manifest,
        granularity: manifest.granularity ?? 'bundle',
        reason: PLUGIN_LOADER_TEXTS.disabledByConfig,
      };
    }

    // --- extension imports + kind validation ------------------------------
    const loaded: ILoadedExtension[] = [];
    for (const relEntry of manifest.extensions) {
      const abs = resolve(pluginPath, relEntry);
      if (!existsSync(abs)) {
        return {
          ...fail(
            pluginPath,
            manifest.id,
            'load-error',
            tx(PLUGIN_LOADER_TEXTS.loadErrorFileNotFound, { relEntry, abs }),
          ),
          manifest,
        };
      }

      let mod: unknown;
      try {
        mod = await importWithTimeout(pathToFileURL(abs).href, this.#loadTimeoutMs);
      } catch (err) {
        return {
          ...fail(
            pluginPath,
            manifest.id,
            'load-error',
            tx(PLUGIN_LOADER_TEXTS.loadErrorImportFailed, {
              relEntry,
              errDescription: describe(err),
            }),
          ),
          manifest,
        };
      }

      const exported = extractDefault(mod);
      if (!isRecord(exported) || typeof exported['kind'] !== 'string') {
        return {
          ...fail(
            pluginPath,
            manifest.id,
            'load-error',
            tx(PLUGIN_LOADER_TEXTS.loadErrorMissingKind, {
              relEntry,
              knownKindsList: KNOWN_KINDS_LIST,
            }),
          ),
          manifest,
        };
      }

      const kind = exported['kind'] as TExtensionKind;
      if (!KNOWN_KINDS.has(kind)) {
        return {
          ...fail(
            pluginPath,
            manifest.id,
            'load-error',
            tx(PLUGIN_LOADER_TEXTS.loadErrorUnknownKind, {
              relEntry,
              kindReceived: String(exported['kind']),
              knownKindsList: KNOWN_KINDS_LIST,
            }),
          ),
          manifest,
        };
      }

      // Spec § A.6 — qualified ids. The loader injects `pluginId =
      // manifest.id` so the registry can key extensions by
      // `<pluginId>/<id>`. If the author hand-declared `pluginId` AND it
      // disagrees with `plugin.json#/id`, that is a hard load error: there
      // can only be one source of truth for the namespace, and it lives in
      // the manifest. A matching declaration is tolerated (no-op);
      // we strip it before AJV validation since the spec deliberately
      // doesn't model `pluginId` (it's a runtime concern).
      const declaredPluginId = exported['pluginId'];
      if (typeof declaredPluginId === 'string' && declaredPluginId !== manifest.id) {
        return {
          ...fail(
            pluginPath,
            manifest.id,
            'invalid-manifest',
            tx(PLUGIN_LOADER_TEXTS.loadErrorPluginIdMismatch, {
              relEntry,
              declared: declaredPluginId,
              manifestId: manifest.id,
            }),
          ),
          manifest,
        };
      }

      // The runtime export carries both manifest fields (id, kind,
      // version, kind-specific metadata) AND runtime methods (extract /
      // evaluate / format / walk / parse / run). The
      // extension-kind schemas are strict (`unevaluatedProperties: false`)
      // because they describe the *manifest* shape — functions are not
      // representable in JSON Schema and would always fail the strict
      // check. Strip them before validation; the runtime methods are
      // covered by the TypeScript `IExtractor` / `IFormatter` / ... interfaces
      // at the call site (the orchestrator invokes `.extract()`,
      // `.format()`, etc. and crashes loudly if absent).
      //
      // Also strip `pluginId`: per spec § A.6 it's a runtime concern that
      // the loader injects from `plugin.json#/id`; the schemas
      // deliberately do not model it. A user export that includes a
      // matching `pluginId` (the mismatching case was rejected above) is
      // tolerated; stripping prevents `unevaluatedProperties: false` from
      // raising on an authored-but-equal field.
      const manifestView = stripFunctionsAndPluginId(exported);

      // Spec § A.11 — Hook triggers validation runs BEFORE AJV so the
      // user gets a directed `invalid-manifest` reason (with the offending
      // trigger and full hookable list) rather than a generic AJV enum
      // error string under `load-error`. AJV's enum check would also
      // catch unknown triggers, but its message would be opaque to a
      // first-time author.
      if (kind === 'hook') {
        const triggers = (manifestView as Record<string, unknown>)['triggers'];
        const hookId = (exported['id'] as string) ?? '?';
        if (!Array.isArray(triggers) || triggers.length === 0) {
          return {
            ...fail(
              pluginPath,
              manifest.id,
              'invalid-manifest',
              tx(PLUGIN_LOADER_TEXTS.invalidManifestHookEmptyTriggers, { hookId }),
            ),
            manifest,
          };
        }
        for (const trig of triggers) {
          if (typeof trig !== 'string' || !HOOKABLE_TRIGGERS.includes(trig)) {
            return {
              ...fail(
                pluginPath,
                manifest.id,
                'invalid-manifest',
                tx(PLUGIN_LOADER_TEXTS.invalidManifestHookUnknownTrigger, {
                  hookId,
                  trigger: String(trig),
                  hookableList: HOOKABLE_TRIGGERS_LIST,
                }),
              ),
              manifest,
            };
          }
        }
      }

      const extValidator = this.#options.validators.validatorForExtension(kind);
      if (!extValidator(manifestView)) {
        const errors = (extValidator.errors ?? [])
          .map((e) => `${e.instancePath || '(root)'} ${e.message ?? e.keyword}`)
          .join('; ');
        return {
          ...fail(
            pluginPath,
            manifest.id,
            'load-error',
            tx(PLUGIN_LOADER_TEXTS.loadErrorManifestInvalid, { relEntry, kind, errors }),
          ),
          manifest,
        };
      }

      loaded.push({
        kind,
        id: exported['id'] as string,
        pluginId: manifest.id,
        version: exported['version'] as string,
        entryPath: abs,
        module: mod,
      });
    }

    // --- storage output schemas (spec § A.12) -----------------------------
    // Opt-in: only plugins that declare `storage.schemas` (Mode B) or
    // `storage.schema` (Mode A) trigger the read+compile pass. A schema
    // file missing on disk OR failing AJV compile blocks the load with
    // `load-error` so the user sees the typo or syntax error at boot
    // instead of at first write. Storage modes without any schema
    // declaration stay permissive (status quo) — `storageSchemas` is
    // simply omitted from the discovered plugin row.
    const storageSchemasResult = loadStorageSchemas(pluginPath, manifest);
    if (!storageSchemasResult.ok) {
      return {
        ...fail(pluginPath, manifest.id, 'load-error', storageSchemasResult.reason),
        manifest,
      };
    }

    return {
      path: pluginPath,
      id: manifest.id,
      status: 'loaded',
      manifest,
      granularity: manifest.granularity ?? 'bundle',
      extensions: loaded,
      ...(storageSchemasResult.schemas
        ? { storageSchemas: storageSchemasResult.schemas }
        : {}),
    };
  }
}

// --- helpers ---------------------------------------------------------------

const KNOWN_KINDS = new Set<TExtensionKind>(['provider', 'extractor', 'rule', 'action', 'formatter', 'hook']);
const KNOWN_KINDS_LIST = [...KNOWN_KINDS].join(' / ');

/**
 * Spec § A.11 — curated hookable trigger set. Mirrors the enum in
 * `spec/schemas/extensions/hook.schema.json` and `kernel/extensions/hook.ts`.
 * Kept duplicated here on purpose: the loader runs in the kernel package
 * with no dependency back into `kernel/extensions/*` (those carry runtime
 * contracts; the loader is data-only). A test asserts the two stay in
 * lock-step.
 */
const HOOKABLE_TRIGGERS: readonly string[] = Object.freeze([
  'scan.started',
  'scan.completed',
  'extractor.completed',
  'rule.completed',
  'action.completed',
  'job.spawning',
  'job.completed',
  'job.failed',
] as const);
const HOOKABLE_TRIGGERS_LIST = HOOKABLE_TRIGGERS.join(', ');

/**
 * Race the dynamic import against a timer. When the timer wins we throw
 * a clear timeout error — the caller turns it into a `load-error` row
 * naming the offending entry. The dangling import promise lingers in
 * Node's loader and resolves later (the result is GC'd unreferenced);
 * there is no public `import()` cancellation API in Node 24, so this
 * is the best we can do without spawning a worker thread.
 */
async function importWithTimeout(href: string, timeoutMs: number): Promise<unknown> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(tx(PLUGIN_LOADER_TEXTS.importExceededTimeout, { timeoutMs })));
    }, timeoutMs);
  });
  try {
    return await Promise.race([import(href), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function fail(
  path: string,
  id: string,
  status: TPluginLoadStatus,
  reason: string,
): IDiscoveredPlugin {
  return { path, id, status, reason };
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return String(err);
  } catch {
    return 'unknown error';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function extractDefault(mod: unknown): unknown {
  if (!isRecord(mod)) return mod;
  return 'default' in mod ? mod['default'] : mod;
}

/**
 * Drop function-typed properties AND the runtime-only `pluginId` so the
 * resulting object is JSON-Schema-validatable. Used on the runtime export
 * before AJV gets it: an extension's `detect` / `render` / etc. method is
 * part of its TypeScript contract, not its declarative manifest, and JSON
 * Schema's `unevaluatedProperties: false` posture would otherwise reject
 * the whole export. Same posture for `pluginId` — per spec § A.6 it's a
 * runtime concern injected by the loader, not a manifest field.
 *
 * Phase 3 (spec 0.8.0): Provider runtime instances carry an additional
 * runtime-only field per `kinds` entry — `schemaJson`, the loaded JSON
 * Schema for the kind. The manifest declares `schema` (a relative path
 * string); `schemaJson` is loaded by the kernel/loader at boot. Strip
 * it before AJV-validating against the strict provider schema (which
 * has `additionalProperties: false` on each kind entry).
 *
 * Cheap shallow + one-level-deep copy — manifests are flat enough.
 */
function stripFunctionsAndPluginId(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'function') continue;
    if (k === 'pluginId') continue;
    if (k === 'kinds' && isRecord(v)) {
      out[k] = stripKindsRuntimeFields(v);
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * Provider `kinds` map: for each entry, drop runtime-only fields
 * (`schemaJson`) so AJV sees only the manifest-level fields the spec
 * declares (`schema`, `defaultRefreshAction`).
 */
function stripKindsRuntimeFields(kinds: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [kind, entry] of Object.entries(kinds)) {
    if (!isRecord(entry)) {
      out[kind] = entry;
      continue;
    }
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(entry)) {
      if (k === 'schemaJson') continue;
      if (typeof v === 'function') continue;
      cleaned[k] = v;
    }
    out[kind] = cleaned;
  }
  return out;
}

/** Fall-back plugin id derived from directory name when the manifest is unreadable. */
function pathId(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] ?? p;
}

/**
 * Cross-root id-collision pass. Group survivors (plugins whose individual
 * load reached a status that exposes a *trusted* `manifest.id`) by id, and
 * for any group of size ≥ 2 rewrite every member's status to
 * `id-collision` with a reason naming the other path(s).
 *
 * "Trusted id" means the manifest parsed and validated. The eligible
 * statuses are therefore `loaded`, `disabled`, and `incompatible-spec`
 * (each of those keeps `manifest` populated). The remaining failure
 * modes — `invalid-manifest` and `load-error` — either never reached the
 * id-trust point (`invalid-manifest`) or carry a manifest that's still
 * structurally fine; we treat them inclusively. Pragmatically, the only
 * status whose `id` is a path fall-back is `invalid-manifest` from a
 * manifest that failed to parse — and those are excluded because the
 * fall-back id is the directory name, which by the same-root pigeonhole
 * cannot collide with another fall-back id (and a collision against a
 * real id would be misleading noise: "rename your plugin to fix your
 * neighbour's broken JSON" is bad guidance).
 *
 * Concretely we only consider plugins that have a `manifest` populated.
 */
function applyIdCollisions(plugins: IDiscoveredPlugin[]): IDiscoveredPlugin[] {
  const buckets = new Map<string, IDiscoveredPlugin[]>();
  for (const p of plugins) {
    if (!p.manifest) continue; // skip path-fall-back ids (untrusted)
    const id = p.manifest.id;
    const bucket = buckets.get(id);
    if (bucket) bucket.push(p);
    else buckets.set(id, [p]);
  }

  const collidingPaths = new Set<string>();
  const collisionReason = new Map<string, string>();
  for (const [id, bucket] of buckets) {
    if (bucket.length < 2) continue;
    // Stable order so the rendered "collides with" list is deterministic
    // across runs — essential for snapshot tests and CI output diffs.
    const sorted = [...bucket].sort((a, b) => a.path.localeCompare(b.path));
    for (const member of sorted) {
      collidingPaths.add(member.path);
      const others = sorted.filter((p) => p.path !== member.path).map((p) => p.path);
      // Reason names the FIRST other path explicitly (matches the spec
      // suggestion) and lists the rest (if any) for the rare 3-way case.
      const pathB = others.length === 1 ? others[0]! : others.join(', ');
      collisionReason.set(
        member.path,
        tx(PLUGIN_LOADER_TEXTS.idCollision, { id, pathA: member.path, pathB }),
      );
    }
  }

  if (collidingPaths.size === 0) return plugins;

  return plugins.map((p) => {
    if (!collidingPaths.has(p.path)) return p;
    const next: IDiscoveredPlugin = {
      ...p,
      status: 'id-collision',
      reason: collisionReason.get(p.path) ?? p.reason ?? '',
    };
    // A colliding plugin's extensions are inert — strip them so a
    // careless caller cannot register them anyway. Manifest is kept
    // for diagnostics (`sm plugins list/show` shows version, author).
    delete next.extensions;
    return next;
  });
}

/**
 * Spec § A.12 — read and AJV-compile the storage output schemas a
 * plugin declares in its manifest. Returns either:
 *
 *   - `{ ok: true, schemas: undefined }` — the plugin declared no
 *     schemas (Mode A without `schema`, Mode B without `schemas`, or
 *     no storage at all). Permissive — `storageSchemas` is omitted
 *     from the discovered row and the runtime store wrapper skips
 *     validation.
 *   - `{ ok: true, schemas }` — every declared schema was read and
 *     compiled. Mode A's single value-shape lives under the sentinel
 *     `KV_SCHEMA_KEY`; Mode B's per-table schemas live under their
 *     logical table name (matching the manifest map).
 *   - `{ ok: false, reason }` — at least one schema file was missing,
 *     unparseable as JSON, or rejected by AJV's compiler. The caller
 *     surfaces the reason as `load-error`.
 *
 * One fresh Ajv instance per plugin keeps schema `$id` collisions from
 * leaking across plugins (and from polluting the kernel's spec
 * validators, which live on a separate cached instance — see
 * `schema-validators.ts`).
 */
function loadStorageSchemas(
  pluginPath: string,
  manifest: IPluginManifest,
):
  | { ok: true; schemas?: Record<string, IPluginStorageSchema> }
  | { ok: false; reason: string } {
  const storage = manifest.storage;
  if (!storage) return { ok: true };

  // Mode A — single optional `schema`.
  if (storage.mode === 'kv') {
    if (!storage.schema) return { ok: true };
    const compiled = compilePluginSchema(pluginPath, storage.schema);
    if (!compiled.ok) {
      const reason = tx(
        compiled.phase === 'read'
          ? PLUGIN_LOADER_TEXTS.loadErrorStorageKvSchemaRead
          : PLUGIN_LOADER_TEXTS.loadErrorStorageKvSchemaCompile,
        {
          pluginId: manifest.id,
          schemaPath: storage.schema,
          errDescription: compiled.errDescription,
        },
      );
      return { ok: false, reason };
    }
    return {
      ok: true,
      schemas: {
        [KV_SCHEMA_KEY]: {
          schemaPath: storage.schema,
          validate: compiled.validate,
        },
      },
    };
  }

  // Mode B — optional `schemas` map keyed by logical table name.
  if (!storage.schemas || Object.keys(storage.schemas).length === 0) {
    return { ok: true };
  }
  const out: Record<string, IPluginStorageSchema> = {};
  for (const [table, relPath] of Object.entries(storage.schemas)) {
    const compiled = compilePluginSchema(pluginPath, relPath);
    if (!compiled.ok) {
      const reason = tx(
        compiled.phase === 'read'
          ? PLUGIN_LOADER_TEXTS.loadErrorStorageSchemaRead
          : PLUGIN_LOADER_TEXTS.loadErrorStorageSchemaCompile,
        {
          pluginId: manifest.id,
          table,
          schemaPath: relPath,
          errDescription: compiled.errDescription,
        },
      );
      return { ok: false, reason };
    }
    out[table] = { schemaPath: relPath, validate: compiled.validate };
  }
  return { ok: true, schemas: out };
}

/**
 * Read a single JSON Schema file relative to the plugin directory and
 * compile it with a fresh Ajv2020 instance. Two failure modes:
 *   - `phase: 'read'`  — file missing, unreadable, or not JSON.
 *   - `phase: 'compile'` — JSON parsed but AJV rejected it.
 * Both surface to the caller as `load-error` with a phase-specific
 * template message.
 */
function compilePluginSchema(
  pluginPath: string,
  relPath: string,
):
  | {
      ok: true;
      validate: ValidateFunction & {
        errors?: { instancePath: string; message?: string; keyword: string }[] | null;
      };
    }
  | { ok: false; phase: 'read' | 'compile'; errDescription: string } {
  const abs = resolve(pluginPath, relPath);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (err) {
    return { ok: false, phase: 'read', errDescription: describe(err) };
  }
  try {
    const ajv: TAjv = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true });
    (addFormats as unknown as (a: TAjv) => void)(ajv);
    const compiled = ajv.compile(raw as object) as ValidateFunction & {
      errors?: { instancePath: string; message?: string; keyword: string }[] | null;
    };
    return { ok: true, validate: compiled };
  } catch (err) {
    return { ok: false, phase: 'compile', errDescription: describe(err) };
  }
}

/**
 * Locate the installed `@skill-map/spec` version at runtime. Handy default
 * for `IPluginLoaderOptions.specVersion` when the caller just wants the
 * real installed version without plumbing it through.
 */
export function installedSpecVersion(): string {
  const require = createRequire(import.meta.url);
  // Spec exports index.json but not package.json; we use the former to
  // locate the package root and then read package.json off disk directly.
  const indexPath = require.resolve('@skill-map/spec/index.json');
  const pkgPath = resolve(indexPath, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
  return pkg.version;
}
