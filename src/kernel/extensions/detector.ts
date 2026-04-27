/**
 * Detector runtime contract. Consumes a single node (frontmatter + body)
 * and returns the links it finds. Detectors run in isolation: they MUST
 * NOT read other nodes, the graph, or the DB. Cross-node reasoning lives
 * in rules.
 *
 * The manifest's `scope` field tells the orchestrator which parts to feed:
 * `frontmatter` detectors receive an empty string for body and vice versa.
 */

import type { IExtensionBase } from './base.js';
import type { Confidence, Link, LinkKind, Node, TExecutionMode } from '../types.js';

export interface IDetectContext {
  node: Node;
  body: string;
  frontmatter: Record<string, unknown>;
}

export interface IDetector extends IExtensionBase {
  kind: 'detector';
  /**
   * Execution mode. Optional in the manifest with a default of
   * `deterministic` per `spec/schemas/extensions/detector.schema.json`.
   * `probabilistic` detectors invoke an LLM through the kernel's
   * `RunnerPort` and never participate in scan-time pipelines —
   * they dispatch only as queued jobs.
   */
  mode?: TExecutionMode;
  emitsLinkKinds: LinkKind[];
  defaultConfidence: Confidence;
  scope: 'frontmatter' | 'body' | 'both';

  detect(ctx: IDetectContext): Link[] | Promise<Link[]>;
}
