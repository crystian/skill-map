/**
 * Rule runtime contract. Runs against the whole graph after every adapter
 * and detector has completed; emits issues. Deterministic rules are pure
 * (same graph in → same issues out) and run synchronously inside `sm scan`
 * / `sm check`. Probabilistic rules invoke an LLM through the kernel's
 * `RunnerPort` and dispatch only as queued jobs — they never participate
 * in scan-time pipelines. Mode is declared in the manifest (default
 * `deterministic`).
 */

import type { IExtensionBase } from './base.js';
import type { Issue, Link, Node, TExecutionMode } from '../types.js';

export interface IRuleContext {
  nodes: Node[];
  links: Link[];
}

export interface IRule extends IExtensionBase {
  kind: 'rule';
  /**
   * Execution mode. Optional in the manifest with a default of
   * `deterministic` per `spec/schemas/extensions/rule.schema.json`.
   */
  mode?: TExecutionMode;
  evaluate(ctx: IRuleContext): Issue[] | Promise<Issue[]>;
}
