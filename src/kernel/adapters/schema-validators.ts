/**
 * AJV validator loader. Compiles every JSON Schema the kernel needs into a
 * map of reusable validators keyed by a stable logical name. Schemas load
 * directly from the `@skill-map/spec` package at startup; any missing file
 * is a fatal boot error (the kernel cannot validate without them).
 *
 * Key design choices:
 *
 * - **Single Ajv instance per loader** so `$ref` resolution can reach sibling
 *   schemas (e.g. `extensions/base.schema.json` → extended by every kind).
 * - **`strict: false`** because the spec uses a few keywords AJV considers
 *   unknown under strict mode (`const` inside `oneOf`, tuple length hints)
 *   that are nevertheless valid Draft 2020-12.
 * - **`ajv-formats`** enabled for `uri`, `date`, `date-time` — all used by
 *   frontmatter base and plugin manifest.
 * - **Lazy compilation** is NOT used: every validator compiles eagerly on
 *   `load()` so the kernel fails fast on a spec corruption instead of
 *   crashing the first time a plugin tries to register.
 *
 * **Phase 3 (spec 0.8.0).** Per-kind frontmatter schemas (`skill`,
 * `agent`, `command`, `hook`, `note`) relocated from spec to the
 * Provider that owns them. Spec-only validators no longer cover those
 * five names. `buildProviderFrontmatterValidator(providers)` produces a
 * dedicated AJV instance pre-loaded with `frontmatter/base` (from spec)
 * plus every Provider's per-kind schemas — the kernel composes it once
 * per scan and the orchestrator validates each node's frontmatter
 * through it.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';

import type { IProvider } from '../extensions/index.js';

// ajv-formats ships CJS-first; the default export is the callable plugin
// under ESM interop but TS sometimes types it as the namespace. Normalise.
const addFormats = (addFormatsModule as unknown as { default?: typeof addFormatsModule })
  .default ?? addFormatsModule;

type TAjv = InstanceType<typeof Ajv2020>;

export type TSchemaName =
  | 'node'
  | 'link'
  | 'issue'
  | 'scan-result'
  | 'execution-record'
  | 'project-config'
  | 'plugins-registry'
  | 'job'
  | 'report-base'
  | 'conformance-case'
  | 'history-stats'
  | 'extension-provider'
  | 'extension-extractor'
  | 'extension-rule'
  | 'extension-action'
  | 'extension-formatter'
  | 'frontmatter-base';

export type TExtensionKind = 'provider' | 'extractor' | 'rule' | 'action' | 'formatter';

const SCHEMA_FILES: Record<TSchemaName, string> = {
  node: 'schemas/node.schema.json',
  link: 'schemas/link.schema.json',
  issue: 'schemas/issue.schema.json',
  'scan-result': 'schemas/scan-result.schema.json',
  'execution-record': 'schemas/execution-record.schema.json',
  'project-config': 'schemas/project-config.schema.json',
  'plugins-registry': 'schemas/plugins-registry.schema.json',
  job: 'schemas/job.schema.json',
  'report-base': 'schemas/report-base.schema.json',
  'conformance-case': 'schemas/conformance-case.schema.json',
  'history-stats': 'schemas/history-stats.schema.json',
  'extension-provider': 'schemas/extensions/provider.schema.json',
  'extension-extractor': 'schemas/extensions/extractor.schema.json',
  'extension-rule': 'schemas/extensions/rule.schema.json',
  'extension-action': 'schemas/extensions/action.schema.json',
  'extension-formatter': 'schemas/extensions/formatter.schema.json',
  'frontmatter-base': 'schemas/frontmatter/base.schema.json',
};

/** Schemas that other schemas reference via $ref but aren't validated directly. */
const SUPPORTING_SCHEMAS: string[] = [
  'schemas/extensions/base.schema.json',
  'schemas/frontmatter/base.schema.json',
  'schemas/summaries/security-scanner.schema.json',
];

export interface ISchemaValidators {
  validate<T = unknown>(name: TSchemaName, data: unknown): { ok: true; data: T } | { ok: false; errors: string };
  getValidator(name: TSchemaName): ValidateFunction;
  validatorForExtension(kind: TExtensionKind): ValidateFunction;
  /**
   * Validate raw plugin.json against `$defs/PluginManifest` inside
   * plugins-registry.schema.json. Returns the typed manifest on success.
   */
  validatePluginManifest<T = unknown>(data: unknown): { ok: true; data: T } | { ok: false; errors: string };
}

// Step 5.12 — module-level cache. Cold load compiles ~17 validators
// (~20 schemas counting supporting refs) which is ~100 ms cold for a CLI
// startup. Subsequent calls in the same process return the same instance,
// so future verbs that validate at multiple boundaries pay the cost once.
// `null` means "not yet loaded"; we never expose a way to invalidate
// because the schemas are static, baked-in, and the underlying spec
// package version doesn't change at runtime.
let cachedValidators: ISchemaValidators | null = null;

/** Test-only escape hatch — drop the cache so a test can re-trigger load. */
export function _resetSchemaValidatorsCacheForTests(): void {
  cachedValidators = null;
}

export function loadSchemaValidators(): ISchemaValidators {
  if (cachedValidators !== null) return cachedValidators;
  cachedValidators = buildSchemaValidators();
  return cachedValidators;
}

function buildSchemaValidators(): ISchemaValidators {
  const specRoot = resolveSpecRoot();
  const ajv: TAjv = new Ajv2020({
    strict: false,
    allErrors: true,
    allowUnionTypes: true,
  });
  (addFormats as unknown as (a: TAjv) => void)(ajv);

  // Add supporting schemas first so $ref targets resolve during compile.
  for (const rel of SUPPORTING_SCHEMAS) {
    const file = resolve(specRoot, rel);
    if (!existsSyncSafe(file)) continue;
    const schema = JSON.parse(readFileSync(file, 'utf8'));
    ajv.addSchema(schema);
  }

  const validators = new Map<TSchemaName, ValidateFunction>();
  for (const [name, rel] of Object.entries(SCHEMA_FILES) as Array<[TSchemaName, string]>) {
    const file = resolve(specRoot, rel);
    const schema = JSON.parse(readFileSync(file, 'utf8'));
    // Reuse existing compilation if the schema was already added above.
    const byId = typeof schema.$id === 'string' ? ajv.getSchema(schema.$id) : undefined;
    validators.set(name, byId ?? ajv.compile(schema));
  }

  const extensionByKind: Record<TExtensionKind, TSchemaName> = {
    provider: 'extension-provider',
    extractor: 'extension-extractor',
    rule: 'extension-rule',
    action: 'extension-action',
    formatter: 'extension-formatter',
  };

  // Dedicated validator that targets PluginManifest inside the oneOf of
  // plugins-registry.schema.json, so callers don't have to hand-filter
  // against the combined schema.
  const pluginManifestValidator = ajv.compile({
    $ref: 'https://skill-map.dev/spec/v0/plugins-registry.schema.json#/$defs/PluginManifest',
  });

  return {
    getValidator(name) {
      const v = validators.get(name);
      if (!v) throw new Error(`Unknown schema: ${name}`);
      return v;
    },
    validatorForExtension(kind) {
      return validators.get(extensionByKind[kind])!;
    },
    validate<T = unknown>(name: TSchemaName, data: unknown) {
      const v = validators.get(name);
      if (!v) throw new Error(`Unknown schema: ${name}`);
      if (v(data)) return { ok: true as const, data: data as T };
      const errors = (v.errors ?? []).map(formatError).join('; ');
      return { ok: false as const, errors };
    },
    validatePluginManifest<T = unknown>(data: unknown) {
      if (pluginManifestValidator(data)) return { ok: true as const, data: data as T };
      const errors = (pluginManifestValidator.errors ?? []).map(formatError).join('; ');
      return { ok: false as const, errors };
    },
  };
}

/**
 * Validator for Provider-owned per-kind frontmatter schemas. Built from
 * the live set of registered Providers — each Provider declares its
 * `kinds[<kind>].schemaJson` and the loader compiles them into a single
 * AJV instance that also carries the spec's `frontmatter/base.schema.json`
 * so cross-package `$ref`-by-`$id` resolves. The orchestrator builds
 * one of these per scan via `buildProviderFrontmatterValidator`.
 */
export interface IProviderFrontmatterValidator {
  /**
   * Validate a node's frontmatter against the schema declared by
   * `provider.kinds[kind]`. `kind` is the value `provider.classify`
   * returned for the node, so the entry is guaranteed to exist for any
   * Provider implemented per spec; an absent entry returns
   * `{ ok: false, errors: 'no-schema' }` so the caller can emit a
   * directed `frontmatter-invalid` issue without crashing.
   */
  validate(
    provider: IProvider,
    kind: string,
    data: unknown,
  ): { ok: true } | { ok: false; errors: string };
}

/**
 * Build a Provider-frontmatter validator. Composes one AJV instance,
 * pre-registers `frontmatter/base.schema.json` from spec so per-kind
 * schemas can `$ref` it by `$id`, then compiles every Provider's
 * `kinds[<kind>].schemaJson` keyed by `(providerId, kind)`. Idempotent
 * across providers that share kinds (same `$id` → AJV's `addSchema`
 * dedupes silently); the keying is by `providerId` first so two
 * Providers exporting different schemas under the same kind name don't
 * collide.
 */
export function buildProviderFrontmatterValidator(
  providers: IProvider[],
): IProviderFrontmatterValidator {
  const specRoot = resolveSpecRoot();
  const ajv: TAjv = new Ajv2020({
    strict: false,
    allErrors: true,
    allowUnionTypes: true,
  });
  (addFormats as unknown as (a: TAjv) => void)(ajv);

  // Register spec's frontmatter/base.schema.json so per-kind schemas can
  // resolve `$ref: 'https://skill-map.dev/spec/v0/frontmatter/base.schema.json'`.
  const baseFile = resolve(specRoot, 'schemas/frontmatter/base.schema.json');
  const baseSchema = JSON.parse(readFileSync(baseFile, 'utf8'));
  ajv.addSchema(baseSchema);

  const compiled = new Map<string, ValidateFunction>();
  for (const provider of providers) {
    for (const [kind, entry] of Object.entries(provider.kinds)) {
      const key = `${provider.id}::${kind}`;
      // Reuse a previously-compiled schema (multiple Providers may legitimately
      // share the same `$id` if they bundle a copy of another's schema).
      const json = entry.schemaJson as { $id?: string };
      const existing = typeof json.$id === 'string' ? ajv.getSchema(json.$id) : undefined;
      compiled.set(key, existing ?? ajv.compile(entry.schemaJson as object));
    }
  }

  return {
    validate(provider, kind, data) {
      const key = `${provider.id}::${kind}`;
      const v = compiled.get(key);
      if (!v) return { ok: false as const, errors: 'no-schema' };
      if (v(data)) return { ok: true as const };
      const errors = (v.errors ?? []).map(formatError).join('; ');
      return { ok: false as const, errors };
    },
  };
}

function formatError(err: { instancePath: string; message?: string; keyword: string; params?: unknown }): string {
  const path = err.instancePath || '(root)';
  return `${path} ${err.message ?? err.keyword}`;
}

/**
 * Locate the installed `@skill-map/spec` package root. Prefer Node's
 * resolver (handles npm workspaces + published installs symmetrically)
 * and fall back to the package's `package.json` directory.
 */
function resolveSpecRoot(): string {
  const require = createRequire(import.meta.url);
  // @skill-map/spec's exports field doesn't expose package.json, but
  // ./index.json is always exported and always lives at the package root.
  try {
    const indexPath = require.resolve('@skill-map/spec/index.json');
    return dirname(indexPath);
  } catch {
    throw new Error(
      '@skill-map/spec not resolvable — ensure the workspace is linked or the package is installed.',
    );
  }
}

function existsSyncSafe(path: string): boolean {
  try {
    readFileSync(path, 'utf8');
    return true;
  } catch {
    return false;
  }
}
