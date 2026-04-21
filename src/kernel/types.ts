/**
 * Domain types — byte-aligned with `spec/schemas/{node,link,issue,scan-result}.schema.json`.
 *
 * The kernel is the reference consumer of the spec; these types are therefore
 * derived from the schemas, not invented. When a schema changes, this file
 * follows. Step 2 introduces ajv + automatic derivation; until then the mapping
 * is hand-maintained, and the release gate is the conformance suite.
 */

export type NodeKind = 'skill' | 'agent' | 'command' | 'hook' | 'note';

export type LinkKind = 'invokes' | 'references' | 'mentions' | 'supersedes';

export type Confidence = 'high' | 'medium' | 'low';

export type Severity = 'error' | 'warn' | 'info';

export type Stability = 'experimental' | 'stable' | 'deprecated';

export interface TripleSplit {
  frontmatter: number;
  body: number;
  total: number;
}

export interface LinkTrigger {
  originalTrigger: string;
  normalizedTrigger: string;
}

export interface LinkLocation {
  line: number;
  column?: number;
  offset?: number;
}

export interface Node {
  path: string;
  kind: NodeKind;
  adapter: string;
  bodyHash: string;
  frontmatterHash: string;
  bytes: TripleSplit;
  linksOutCount: number;
  linksInCount: number;
  externalRefsCount: number;
  title?: string | null;
  description?: string | null;
  stability?: Stability | null;
  version?: string | null;
  author?: string | null;
  frontmatter?: Record<string, unknown>;
  tokens?: TripleSplit;
}

export interface Link {
  source: string;
  target: string;
  kind: LinkKind;
  confidence: Confidence;
  sources: string[];
  trigger?: LinkTrigger | null;
  location?: LinkLocation | null;
  raw?: string | null;
}

export interface IssueFix {
  summary?: string;
  autofixable?: boolean;
}

export interface Issue {
  ruleId: string;
  severity: Severity;
  nodeIds: string[];
  message: string;
  linkIndices?: number[];
  detail?: string | null;
  fix?: IssueFix | null;
  data?: Record<string, unknown>;
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
