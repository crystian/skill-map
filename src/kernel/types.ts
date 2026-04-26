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
  /**
   * Files visited by the adapter walkers. With a single adapter this
   * matches `nodesCount`; with multiple adapters running on overlapping
   * roots it can diverge (each yielded `IRawNode` is one walked file).
   */
  filesWalked: number;
  /**
   * Files walked but not classified by any adapter. Today every walked
   * file is classified by its adapter (the `claude` adapter falls back to
   * `'note'`), so this is always 0; the field will matter once multiple
   * adapters compete in Step 9+.
   */
  filesSkipped: number;
  nodesCount: number;
  linksCount: number;
  issuesCount: number;
  durationMs: number;
}

export interface ScanScannedBy {
  name: string;
  version: string;
  specVersion: string;
}

export interface ScanResult {
  schemaVersion: 1;
  /** Unix milliseconds when the scan started. */
  scannedAt: number;
  /** Scan scope. `project` walks the cwd repo; `global` walks user-level skill dirs. */
  scope: 'project' | 'global';
  /**
   * Filesystem roots that were walked during this scan. Spec requires
   * `minItems: 1` — `runScan` throws if `roots: []` is supplied.
   */
  roots: string[];
  /** Adapter ids that participated in classification. Empty if no adapter matched. */
  adapters: string[];
  /** Implementation metadata. Populated by `runScan` for self-describing output. */
  scannedBy?: ScanScannedBy;
  nodes: Node[];
  links: Link[];
  issues: Issue[];
  stats: ScanStats;
}
