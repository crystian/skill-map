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
  /**
   * Optional opt-in filter on `node.kind`. When declared, the orchestrator
   * skips invocation of `detect()` for any node whose `kind` is NOT in
   * this list — fail-fast, before context construction, so a
   * probabilistic detector wastes zero LLM cost on inapplicable nodes
   * and a deterministic detector wastes zero CPU.
   *
   * Absent (`undefined`) is the default: the detector applies to every
   * kind. There are no wildcards — the absence of the field already
   * encodes "every kind". An empty array (`[]`) is rejected at load
   * time by AJV (`minItems: 1` in the schema).
   *
   * Unknown kinds (no installed Provider declares them) do NOT block
   * the load: the detector keeps `loaded` status and `sm plugins doctor`
   * surfaces a warning. The Provider that declares the kind may arrive
   * later (e.g. a user installs the corresponding plugin).
   *
   * Spec: `spec/schemas/extensions/detector.schema.json#/properties/applicableKinds`.
   */
  applicableKinds?: string[];

  detect(ctx: IDetectContext): Link[] | Promise<Link[]>;
}
