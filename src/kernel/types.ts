/**
 * Domain types — minimal shapes required by Step 0b.
 *
 * These are hand-aligned with `spec/schemas/*.schema.json`. Step 3 will refine
 * them (Node frontmatter fields, Link discriminators, etc.); for the scan stub
 * the only mandatory surface is what the `kernel-empty-boot` conformance case
 * asserts: a ScanResult with `schemaVersion: 1` and zeroed stats.
 */

export type NodeKind = 'skill' | 'agent' | 'command' | 'hook' | 'note';

export interface Node {
  path: string;
  kind: NodeKind;
  adapter: string;
  name: string;
  description: string;
  metadata: { version: string } & Record<string, unknown>;
}

export interface Link {
  from: string;
  to: string | null;
  detector: string;
  confidence: 'exact' | 'fuzzy';
  originalTrigger?: string;
  normalizedTrigger?: string;
}

export interface Issue {
  id: string;
  rule: string;
  severity: 'error' | 'warning' | 'info';
  nodes: string[];
  message: string;
}

export interface ScanStats {
  nodesCount: number;
  linksCount: number;
  issuesCount: number;
  durationMs: number;
}

export interface ScanResult {
  schemaVersion: 1;
  scannedAt: string;
  roots: string[];
  nodes: Node[];
  links: Link[];
  issues: Issue[];
  stats: ScanStats;
}
