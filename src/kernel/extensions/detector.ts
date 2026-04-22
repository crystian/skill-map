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
import type { Confidence, Link, LinkKind, Node } from '../types.js';

export interface IDetectContext {
  node: Node;
  body: string;
  frontmatter: Record<string, unknown>;
}

export interface IDetector extends IExtensionBase {
  kind: 'detector';
  emitsLinkKinds: LinkKind[];
  defaultConfidence: Confidence;
  scope: 'frontmatter' | 'body' | 'both';

  detect(ctx: IDetectContext): Link[] | Promise<Link[]>;
}
