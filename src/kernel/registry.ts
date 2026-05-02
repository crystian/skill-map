/**
 * Extension registry — six kinds, first-class, loaded through a single API.
 *
 * The `Extension` shape is aligned with `spec/schemas/extensions/base.schema.json`.
 * Kind-specific manifests (provider / extractor / rule / action / formatter /
 * hook) extend this base structurally; the registry stores the base view
 * and each kind's code carries its own fuller type where needed.
 *
 * **Spec § A.6 — qualified ids.** Every extension is keyed in the registry
 * by `<pluginId>/<id>` (e.g. `core/frontmatter`, `claude/slash`,
 * `hello-world/greet`). `Extension.id` carries the **short** id as authored;
 * `Extension.pluginId` carries the namespace; the registry composes the
 * qualifier internally and exposes lookup APIs that operate on either form
 * (qualified for direct lookup, kind-scoped listing for enumeration).
 *
 * Boot invariant: `new Registry()` is empty. `registry.totalCount() === 0`
 * when the kernel boots with zero extensions. This is the data side of the
 * `kernel-empty-boot` conformance contract.
 */

import { REGISTRY_TEXTS } from './i18n/registry.texts.js';
import type { Stability } from './types.js';
import { tx } from './util/tx.js';

export type ExtensionKind =
  | 'provider'
  | 'extractor'
  | 'rule'
  | 'action'
  | 'formatter'
  | 'hook';

export const EXTENSION_KINDS: readonly ExtensionKind[] = Object.freeze([
  'provider',
  'extractor',
  'rule',
  'action',
  'formatter',
  'hook',
] as const);

export interface Extension {
  /** Short (unqualified) extension id as declared in the manifest. */
  id: string;
  /** Owning plugin namespace. Composed with `id` to form the qualified key. */
  pluginId: string;
  kind: ExtensionKind;
  version: string;
  description?: string;
  stability?: Stability;
  preconditions?: string[];
  entry?: string;
}

/**
 * Compose the qualified registry key for an extension. Single source of
 * truth so callers don't reinvent the format and a future change (e.g. a
 * different separator) lands in one place.
 */
export function qualifiedExtensionId(pluginId: string, id: string): string {
  return `${pluginId}/${id}`;
}

export class DuplicateExtensionError extends Error {
  constructor(kind: ExtensionKind, qualifiedId: string) {
    super(tx(REGISTRY_TEXTS.duplicateExtension, { kind, qualifiedId }));
    this.name = 'DuplicateExtensionError';
  }
}

export class Registry {
  /** kind → qualifiedId → Extension. */
  readonly #byKind: Map<ExtensionKind, Map<string, Extension>>;

  constructor() {
    this.#byKind = new Map(
      EXTENSION_KINDS.map((k) => [k, new Map<string, Extension>()]),
    );
  }

  register(ext: Extension): void {
    const bucket = this.#byKind.get(ext.kind);
    if (!bucket) {
      throw new Error(tx(REGISTRY_TEXTS.unknownKind, { kind: ext.kind }));
    }
    if (typeof ext.pluginId !== 'string' || ext.pluginId.length === 0) {
      throw new Error(tx(REGISTRY_TEXTS.missingPluginId, { kind: ext.kind, id: ext.id }));
    }
    const key = qualifiedExtensionId(ext.pluginId, ext.id);
    if (bucket.has(key)) {
      throw new DuplicateExtensionError(ext.kind, key);
    }
    bucket.set(key, ext);
  }

  /**
   * Lookup by qualified id (`<pluginId>/<id>`). Returns `undefined` when
   * no extension of that kind is registered under the qualifier.
   */
  get(kind: ExtensionKind, qualifiedId: string): Extension | undefined {
    return this.#byKind.get(kind)?.get(qualifiedId);
  }

  /**
   * Convenience wrapper that composes the qualified id for the caller.
   * Equivalent to `get(kind, qualifiedExtensionId(pluginId, id))`.
   */
  find(kind: ExtensionKind, pluginId: string, id: string): Extension | undefined {
    return this.get(kind, qualifiedExtensionId(pluginId, id));
  }

  all(kind: ExtensionKind): Extension[] {
    const bucket = this.#byKind.get(kind);
    return bucket ? [...bucket.values()] : [];
  }

  count(kind: ExtensionKind): number {
    return this.#byKind.get(kind)?.size ?? 0;
  }

  totalCount(): number {
    let n = 0;
    for (const bucket of this.#byKind.values()) n += bucket.size;
    return n;
  }
}
