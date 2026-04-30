/**
 * Formatter runtime contract. Turns the (nodes, links, issues) graph into
 * a textual representation for `sm graph --format <name>`.
 *
 * Two adjacent names live on the same instance:
 *
 *   - `formatId: string` — the manifest field consumed by the
 *     `--format <name>` CLI flag. The kernel's lookup is
 *     `formatters.find((f) => f.formatId === flag)`.
 *   - `format(ctx) → string` — the runtime method. Receives the full
 *     graph and returns the serialized output. Output MUST be
 *     byte-deterministic for the same input (the snapshot-test suite
 *     relies on this).
 *
 * The split (`formatId` vs `format`) is deliberate: it keeps the method
 * named after the kind (`Formatter.format()` reads naturally) while the
 * field carries the identifier the user types on the command line.
 */

import type { IExtensionBase } from './base.js';
import type { Issue, Link, Node } from '../types.js';

export interface IFormatterContext {
  nodes: Node[];
  links: Link[];
  issues: Issue[];
}

export interface IFormatter extends IExtensionBase {
  kind: 'formatter';
  /** Format identifier consumed by `sm graph --format <name>`. */
  formatId: string;
  /** Serialize the graph into a string. Deterministic-only. */
  format(ctx: IFormatterContext): string;
}
