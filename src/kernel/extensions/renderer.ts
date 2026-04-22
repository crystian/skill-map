/**
 * Renderer runtime contract. Turns the (nodes, links, issues) graph into
 * a textual representation for `sm graph --format <name>`.
 */

import type { IExtensionBase } from './base.js';
import type { Issue, Link, Node } from '../types.js';

export interface IRenderContext {
  nodes: Node[];
  links: Link[];
  issues: Issue[];
}

export interface IRenderer extends IExtensionBase {
  kind: 'renderer';
  format: string;
  render(ctx: IRenderContext): string;
}
