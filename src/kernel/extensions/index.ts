/**
 * Runtime contracts for the six extension kinds. Each module below declares
 * (a) the manifest shape — structurally mirrors the corresponding schema in
 * `@skill-map/spec/schemas/extensions/` — and (b) the runtime method(s) the
 * kernel calls on an instance of the extension.
 *
 * A plugin's default export IS the runtime instance: a detector exports
 * `{ ...manifest, detect: (node, body) => Link[] }`, not a class. This
 * keeps ESM interop simple (no new / constructor dance) and matches how
 * Claude Code's own subagents/skills are declared.
 */

export type { IAdapter, IRawNode } from './adapter.js';
export type { IDetector, IDetectContext } from './detector.js';
export type { IRule, IRuleContext } from './rule.js';
export type { IRenderer, IRenderContext } from './renderer.js';
export type { IAudit, IAuditContext, TAuditReport } from './audit.js';
export type { IExtensionBase } from './base.js';
export type { TExecutionMode } from '../types.js';
