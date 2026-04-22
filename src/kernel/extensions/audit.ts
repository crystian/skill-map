/**
 * Audit runtime contract. Audits run as standalone operations (not inside
 * the scan pipeline); they consume the current scan state plus any state
 * the kernel chooses to expose and return a pass/fail report with
 * findings. `validate-all` is the canonical audit — checks every
 * frontmatter + every registered extension manifest.
 */

import type { IExtensionBase } from './base.js';
import type { Issue, Link, Node } from '../types.js';

export interface IAuditContext {
  nodes: Node[];
  links: Link[];
  issues: Issue[];
}

export interface TAuditReport {
  auditId: string;
  status: 'pass' | 'fail';
  findings: Issue[];
  summary?: string;
}

export interface IAudit extends IExtensionBase {
  kind: 'audit';
  run(ctx: IAuditContext): TAuditReport | Promise<TAuditReport>;
}
