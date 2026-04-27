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

/**
 * Execution mode of an analytical extension. Mirrors the per-kind capability
 * matrix in `spec/architecture.md` §Execution modes:
 *
 *   - `deterministic` — pure code, runs synchronously inside `sm scan` /
 *     `sm check` / `sm audit`. Same input → same output, every run.
 *   - `probabilistic` — calls an LLM through `RunnerPort`, dispatches only
 *     as a queued job (`sm job submit <kind>:<id>`); never participates in
 *     scan-time pipelines.
 *
 * Detector / Rule / Action declare it directly (default `deterministic` when
 * omitted in the manifest). Audit forbids declaring it — the kernel derives
 * it from `composes[]` at load time. Adapter / Renderer are deterministic-only
 * and MUST NOT carry the field.
 */
export type TExecutionMode = 'deterministic' | 'probabilistic';

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

export type ExecutionKind = 'action' | 'audit';
export type ExecutionStatus = 'completed' | 'failed' | 'cancelled';
export type ExecutionFailureReason =
  | 'runner-error'
  | 'report-invalid'
  | 'timeout'
  | 'abandoned'
  | 'job-file-missing'
  | 'user-cancelled';
export type ExecutionRunner = 'cli' | 'skill' | 'in-process';

/**
 * One row of execution history (`state_executions`). Matches
 * `spec/schemas/execution-record.schema.json`. `nodeIds` is the camelCased
 * domain field name; storage flattens it to `node_ids_json`.
 */
export interface ExecutionRecord {
  id: string;
  kind: ExecutionKind;
  extensionId: string;
  extensionVersion: string;
  nodeIds?: string[];
  contentHash?: string | null;
  status: ExecutionStatus;
  failureReason?: ExecutionFailureReason | null;
  exitCode?: number | null;
  runner?: ExecutionRunner | null;
  startedAt: number;
  finishedAt: number;
  durationMs?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  reportPath?: string | null;
  jobId?: string | null;
}

export interface HistoryStatsTotals {
  executionsCount: number;
  completedCount: number;
  failedCount: number;
  tokensIn: number;
  tokensOut: number;
  durationMsTotal: number;
}

export interface HistoryStatsTokensPerAction {
  actionId: string;
  actionVersion: string;
  executionsCount: number;
  tokensIn: number;
  tokensOut: number;
  durationMsMean: number | null;
  durationMsMedian: number | null;
}

export interface HistoryStatsExecutionsPerPeriod {
  periodStart: string; // ISO-8601
  periodUnit: 'day' | 'week' | 'month';
  executionsCount: number;
  tokensIn: number;
  tokensOut: number;
}

export interface HistoryStatsTopNode {
  nodePath: string;
  executionsCount: number;
  lastExecutedAt: number;
}

export interface HistoryStatsPerActionRate {
  actionId: string;
  rate: number;
  executionsCount: number;
  failedCount: number;
}

export interface HistoryStatsErrorRates {
  global: number;
  perAction: HistoryStatsPerActionRate[];
  perFailureReason: Record<ExecutionFailureReason, number>;
}

/**
 * `sm history stats --json` payload, conforming to
 * `spec/schemas/history-stats.schema.json`. `elapsedMs` is the command's
 * own wall-clock per `cli-contract.md` §Elapsed time.
 */
export interface HistoryStats {
  schemaVersion: 1;
  range: { since: string | null; until: string };
  totals: HistoryStatsTotals;
  tokensPerAction: HistoryStatsTokensPerAction[];
  executionsPerPeriod: HistoryStatsExecutionsPerPeriod[];
  topNodes: HistoryStatsTopNode[];
  errorRates: HistoryStatsErrorRates;
  elapsedMs: number;
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
