/**
 * Rule runtime contract. Runs against the whole graph after every adapter
 * and detector has completed; emits issues (deterministic, zero-cost to
 * re-run). Rules are pure: same graph in → same issues out.
 */

import type { IExtensionBase } from './base.js';
import type { Issue, Link, Node } from '../types.js';

export interface IRuleContext {
  nodes: Node[];
  links: Link[];
}

export interface IRule extends IExtensionBase {
  kind: 'rule';
  evaluate(ctx: IRuleContext): Issue[] | Promise<Issue[]>;
}
