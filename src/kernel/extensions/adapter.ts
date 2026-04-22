/**
 * Adapter runtime contract. Walks filesystem roots and emits raw node
 * records; classification maps path conventions to a node kind.
 *
 * `walk()` is an async iterator so large scopes don't buffer in memory.
 * Each yielded `IRawNode` carries the full parsed frontmatter + body plus
 * the path relative to the scan root; the kernel computes hashes, bytes,
 * and tokens on top.
 */

import type { IExtensionBase } from './base.js';
import type { NodeKind } from '../types.js';

export interface IRawNode {
  /** Path relative to the scan root that produced this node. */
  path: string;
  /** Raw markdown body (everything after the frontmatter fence). */
  body: string;
  /** Raw frontmatter text (between `---` fences). Empty string when absent. */
  frontmatterRaw: string;
  /** Parsed frontmatter, or `{}` when absent / unparseable. */
  frontmatter: Record<string, unknown>;
}

export interface IAdapter extends IExtensionBase {
  kind: 'adapter';

  /**
   * Map from detected node kind → action id the UI calls when the user
   * asks for a probabilistic refresh. Every kind the adapter can emit
   * MUST have an entry.
   */
  defaultRefreshAction: Partial<Record<NodeKind, string>>;

  /**
   * Walk the given roots and yield every node the adapter recognises.
   * Non-matching files are silently skipped. Unreadable files produce
   * a diagnostic via the emitter (Step 4+) but do not abort the walk.
   */
  walk(roots: string[], options?: { ignore?: string[] }): AsyncIterable<IRawNode>;

  /**
   * Given a path and its parsed frontmatter, decide the node kind. The
   * classifier is called after walk() yields — adapters MAY embed the
   * logic inside walk itself, but exposing it lets the kernel rebuild
   * classification during partial scans without re-walking.
   */
  classify(path: string, frontmatter: Record<string, unknown>): NodeKind;
}
