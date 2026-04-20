/**
 * Extension registry — six kinds, first-class, loaded through a single API.
 *
 * Boot invariant: `new Registry()` is empty. `registry.totalCount() === 0`
 * when the kernel boots with zero extensions. This is the data side of the
 * `kernel-empty-boot` conformance contract.
 */

export type ExtensionKind =
  | 'adapter'
  | 'detector'
  | 'rule'
  | 'action'
  | 'audit'
  | 'renderer';

export const EXTENSION_KINDS: readonly ExtensionKind[] = Object.freeze([
  'adapter',
  'detector',
  'rule',
  'action',
  'audit',
  'renderer',
] as const);

export interface Extension {
  id: string;
  kind: ExtensionKind;
}

export class DuplicateExtensionError extends Error {
  constructor(kind: ExtensionKind, id: string) {
    super(`Extension already registered: ${kind}:${id}`);
    this.name = 'DuplicateExtensionError';
  }
}

export class Registry {
  readonly #byKind: Map<ExtensionKind, Map<string, Extension>>;

  constructor() {
    this.#byKind = new Map(
      EXTENSION_KINDS.map((k) => [k, new Map<string, Extension>()]),
    );
  }

  register(ext: Extension): void {
    const bucket = this.#byKind.get(ext.kind);
    if (!bucket) {
      throw new Error(`Unknown extension kind: ${ext.kind}`);
    }
    if (bucket.has(ext.id)) {
      throw new DuplicateExtensionError(ext.kind, ext.id);
    }
    bucket.set(ext.id, ext);
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
