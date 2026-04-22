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
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';

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
  | 'extension-adapter'
  | 'extension-detector'
  | 'extension-rule'
  | 'extension-action'
  | 'extension-audit'
  | 'extension-renderer';

export type TExtensionKind = 'adapter' | 'detector' | 'rule' | 'action' | 'audit' | 'renderer';

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
  'extension-adapter': 'schemas/extensions/adapter.schema.json',
  'extension-detector': 'schemas/extensions/detector.schema.json',
  'extension-rule': 'schemas/extensions/rule.schema.json',
  'extension-action': 'schemas/extensions/action.schema.json',
  'extension-audit': 'schemas/extensions/audit.schema.json',
  'extension-renderer': 'schemas/extensions/renderer.schema.json',
};

/** Schemas that other schemas reference via $ref but aren't validated directly. */
const SUPPORTING_SCHEMAS: string[] = [
  'schemas/extensions/base.schema.json',
  'schemas/frontmatter/base.schema.json',
  'schemas/frontmatter/agent.schema.json',
  'schemas/frontmatter/command.schema.json',
  'schemas/frontmatter/hook.schema.json',
  'schemas/frontmatter/note.schema.json',
  'schemas/frontmatter/skill.schema.json',
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

export function loadSchemaValidators(): ISchemaValidators {
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
    adapter: 'extension-adapter',
    detector: 'extension-detector',
    rule: 'extension-rule',
    action: 'extension-action',
    audit: 'extension-audit',
    renderer: 'extension-renderer',
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
  try {
    const pkgJsonPath = require.resolve('@skill-map/spec/package.json');
    return dirname(pkgJsonPath);
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
