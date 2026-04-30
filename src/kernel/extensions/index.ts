/**
 * Runtime contracts for the five extension kinds. Each module below declares
 * (a) the manifest shape — structurally mirrors the corresponding schema in
 * `@skill-map/spec/schemas/extensions/` — and (b) the runtime method(s) the
 * kernel calls on an instance of the extension.
 *
 * A plugin's default export IS the runtime instance: an extractor exports
 * `{ ...manifest, extract: (ctx) => void }`, not a class. This keeps ESM
 * interop simple (no new / constructor dance) and matches how Claude Code's
 * own subagents/skills are declared.
 *
 * **Naming note.** `IProvider` is the extension-surface kind that plugin
 * authors implement. The `adapter` term is reserved for the hexagonal
 * architecture's driven adapters (`RunnerPort.adapter`, `StoragePort.adapter`
 * — see `kernel/adapters/`); the two concepts are deliberately namespaced
 * apart even though they used to share the word historically.
 */

export type { IProvider, IRawNode } from './provider.js';
export type { IExtractor, IExtractorContext, IExtractorCallbacks } from './extractor.js';
export type { IRule, IRuleContext } from './rule.js';
export type { IFormatter, IFormatterContext } from './formatter.js';
export type { IExtensionBase } from './base.js';
export type { TExecutionMode } from '../types.js';
