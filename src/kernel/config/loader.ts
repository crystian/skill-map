/**
 * Layered config loader for `.skill-map/settings.json`. Walks the six
 * canonical layers (defaults → user → user-local → project → project-local
 * → overrides), deep-merges per key, validates each layer against the
 * `project-config` JSON schema, and skips offending keys (warning) or
 * fails fast (strict). The effective config plus a per-key sources map
 * are returned so `sm config show --source` can answer who set what.
 *
 * Layer semantics (low → high precedence):
 *   1. `defaults`        — `src/config/defaults.json`, shipped in bundle.
 *   2. `user`            — `~/.skill-map/settings.json`.
 *   3. `user-local`      — `~/.skill-map/settings.local.json`.
 *   4. `project`         — `<cwd>/.skill-map/settings.json`.
 *   5. `project-local`   — `<cwd>/.skill-map/settings.local.json`.
 *   6. `override`        — caller-supplied object (env vars / CLI flags).
 *
 * For scope === 'global', layers 4 and 5 resolve to the same files as 2/3
 * and are skipped to avoid double-merging the same source.
 *
 * Failure modes:
 *   - missing file       → silent skip (the layer is optional).
 *   - malformed JSON     → warning + skip whole layer (or throw if strict).
 *   - schema violation   → strip the offending key + warning (or throw
 *                          if strict). Per-key resilience: a single bad
 *                          value never invalidates the rest of the file.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import { join } from 'node:path';

import { loadSchemaValidators, type ISchemaValidators } from '../adapters/schema-validators.js';

import DEFAULTS_RAW from '../../config/defaults.json' with { type: 'json' };

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export interface IRetentionConfig {
  completed: number | null;
  failed: number | null;
}

export interface IJobsConfig {
  ttlSeconds: number;
  graceMultiplier: number;
  minimumTtlSeconds: number;
  perActionTtl: Record<string, number>;
  perActionPriority: Record<string, number>;
  retention: IRetentionConfig;
}

export interface IPluginConfigEntry {
  enabled?: boolean;
  config?: Record<string, unknown>;
}

export interface IScanWatchConfig {
  debounceMs: number;
}

export interface IScanConfig {
  tokenize: boolean;
  strict: boolean;
  followSymlinks: boolean;
  maxFileSizeBytes: number;
  watch: IScanWatchConfig;
}

export interface IEffectiveConfig {
  schemaVersion: 1;
  autoMigrate: boolean;
  tokenizer: string;
  adapters: string[];
  roots: string[];
  ignore: string[];
  scan: IScanConfig;
  plugins: Record<string, IPluginConfigEntry>;
  history: { share: boolean };
  jobs: IJobsConfig;
  i18n: { locale: string };
}

export type TConfigLayer =
  | 'defaults'
  | 'user'
  | 'user-local'
  | 'project'
  | 'project-local'
  | 'override';

export interface ILoadConfigOptions {
  /** Determines whether project-scoped layers are walked (`project`) or skipped (`global`). */
  scope: 'project' | 'global';
  /** Override `process.cwd()` — primarily for tests. */
  cwd?: string;
  /** Override `os.homedir()` — primarily for tests. */
  homedir?: string;
  /** Top layer applied after every file layer. Translates env vars / CLI flags into config keys. */
  overrides?: Record<string, unknown>;
  /** When true, every warning is thrown as an `Error` instead of being collected. */
  strict?: boolean;
}

export interface ILoadedConfig {
  effective: IEffectiveConfig;
  /** Maps dot-path keys (e.g. `"scan.strict"`) to the layer that last wrote them. */
  sources: Map<string, TConfigLayer>;
  /** Accumulated warnings about malformed JSON, schema violations, or invalid values. */
  warnings: string[];
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

const DEFAULTS = DEFAULTS_RAW as unknown as IEffectiveConfig;

export function loadConfig(opts: ILoadConfigOptions): ILoadedConfig {
  const cwd = opts.cwd ?? process.cwd();
  const home = opts.homedir ?? osHomedir();
  const strict = opts.strict ?? false;
  const warnings: string[] = [];
  const sources = new Map<string, TConfigLayer>();
  const validators = loadSchemaValidators();

  let effective = structuredClone(DEFAULTS);
  recordSources('', effective, sources, 'defaults');

  const filePairs: Array<{ path: string; layer: TConfigLayer }> = [
    { path: join(home, '.skill-map', 'settings.json'), layer: 'user' },
    { path: join(home, '.skill-map', 'settings.local.json'), layer: 'user-local' },
  ];
  if (opts.scope === 'project') {
    filePairs.push(
      { path: join(cwd, '.skill-map', 'settings.json'), layer: 'project' },
      { path: join(cwd, '.skill-map', 'settings.local.json'), layer: 'project-local' },
    );
  }

  for (const { path, layer } of filePairs) {
    if (!existsSync(path)) continue;
    const partial = readJsonSafe(path, layer, warnings, strict);
    if (partial === null) continue;
    const cleaned = validateAndStrip(validators, partial, layer, warnings, strict);
    effective = deepMerge(effective as unknown as Record<string, unknown>, cleaned) as unknown as IEffectiveConfig;
    recordSources('', cleaned, sources, layer);
  }

  if (opts.overrides && Object.keys(opts.overrides).length > 0) {
    const cleaned = validateAndStrip(validators, opts.overrides, 'override', warnings, strict);
    effective = deepMerge(effective as unknown as Record<string, unknown>, cleaned) as unknown as IEffectiveConfig;
    recordSources('', cleaned, sources, 'override');
  }

  return { effective, sources, warnings };
}

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------

function readJsonSafe(
  path: string,
  layer: TConfigLayer,
  warnings: string[],
  strict: boolean,
): unknown | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    return reportAndSkip(`[config:${layer}] failed to read ${path}: ${(err as Error).message}`, warnings, strict);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    return reportAndSkip(`[config:${layer}] invalid JSON in ${path}: ${(err as Error).message}`, warnings, strict);
  }
}

function reportAndSkip(msg: string, warnings: string[], strict: boolean): null {
  if (strict) throw new Error(msg);
  warnings.push(msg);
  return null;
}

/**
 * Validate `raw` against the project-config schema and return a copy with
 * any offending keys removed. Errors are accumulated as warnings (or thrown
 * in strict mode). Continues per-key so a single bad value never invalidates
 * the rest of the file.
 */
function validateAndStrip(
  validators: ISchemaValidators,
  raw: unknown,
  layer: TConfigLayer,
  warnings: string[],
  strict: boolean,
): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    const msg = `[config:${layer}] expected a JSON object, got ${describeJsonType(raw)}; ignored`;
    if (strict) throw new Error(msg);
    warnings.push(msg);
    return {};
  }

  const cloned = structuredClone(raw) as Record<string, unknown>;
  const validator = validators.getValidator('project-config');
  if (validator(cloned)) return cloned;

  const errors = validator.errors ?? [];
  for (const err of errors) {
    const path = err.instancePath ?? '';
    if (err.keyword === 'additionalProperties') {
      const extra = (err.params as { additionalProperty: string }).additionalProperty;
      deleteAtPath(cloned, path, extra);
      const msg = `[config:${layer}] unknown key ${joinSegments(path, extra)} ignored`;
      if (strict) throw new Error(msg);
      warnings.push(msg);
    } else {
      const segments = path.split('/').filter(Boolean);
      if (segments.length > 0) {
        const last = segments.pop() as string;
        deleteAtPath(cloned, '/' + segments.join('/'), last);
      }
      const msg = `[config:${layer}] invalid value at ${path || '(root)'}: ${err.message ?? err.keyword}`;
      if (strict) throw new Error(msg);
      warnings.push(msg);
    }
  }
  return cloned;
}

function describeJsonType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function deleteAtPath(root: Record<string, unknown>, parentPath: string, key: string): void {
  const segments = parentPath.split('/').filter(Boolean);
  let cur: unknown = root;
  for (const seg of segments) {
    if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return;
    }
  }
  if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
    delete (cur as Record<string, unknown>)[key];
  }
}

function joinSegments(instancePath: string, leaf: string): string {
  const segments = instancePath.split('/').filter(Boolean);
  return [...segments, leaf].join('.');
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const [k, v] of Object.entries(source)) {
    const tv = out[k];
    if (
      v !== null
      && typeof v === 'object'
      && !Array.isArray(v)
      && tv !== null
      && typeof tv === 'object'
      && !Array.isArray(tv)
    ) {
      out[k] = deepMerge(tv as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function recordSources(
  prefix: string,
  value: unknown,
  map: Map<string, TConfigLayer>,
  layer: TConfigLayer,
): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    if (prefix) map.set(prefix, layer);
    return;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0 && prefix) {
    map.set(prefix, layer);
    return;
  }
  for (const [k, v] of entries) {
    const next = prefix ? `${prefix}.${k}` : k;
    recordSources(next, v, map, layer);
  }
}
