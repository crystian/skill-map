/**
 * Domain types — byte-aligned with `spec/schemas/{node,link,issue,scan-result}.schema.json`.
 *
 * The kernel is the reference consumer of the spec; these types are therefore
 * derived from the schemas, not invented. When a schema changes, this file
 * follows. Until automatic AJV-driven derivation lands, the mapping is
 * hand-maintained and the release gate is the conformance suite.
 *
 * --- Naming convention (kernel-wide) -------------------------------------
 *
 * Four categories with distinct prefix rules; the rules are deliberate
 * even though they look mixed at first read:
 *
 *   1. **Domain types** — every shape that mirrors a `spec/schemas/*.json`
 *      file: `Node`, `Link`, `Issue`, `ScanResult`, `ScanStats`,
 *      `ExecutionRecord`, `HistoryStats`, …. **No prefix.** Names track
 *      the spec verbatim because the spec is the source of truth.
 *      Renaming any of these is a spec change.
 *
 *   2. **Hexagonal ports** — the abstract boundaries the kernel calls
 *      out to (`StoragePort`, `RunnerPort`, `ProgressEmitterPort`,
 *      `FilesystemPort`, `PluginLoaderPort`). **`Port` suffix.** The
 *      suffix calls out the architectural role and avoids name clashes
 *      with the concrete adapter classes (`SqliteStorageAdapter`
 *      implements `StoragePort`).
 *
 *   3. **Runtime extension contracts** — what a plugin author
 *      implements: `IProvider`, `IExtractor`, `IRule`, `IFormatter`,
 *      `IExtensionBase`. **`I` prefix.** The prefix flags "this is a
 *      contract you supply, not a value the kernel hands you" — same
 *      reading as the rest of TypeScript's plugin ecosystems where a
 *      shape is implementable.
 *
 *   4. **Internal shapes** — option bags, result records, config
 *      slices, anything passed across function boundaries inside the
 *      kernel / CLI but not part of the spec: `IRunScanOptions` (well,
 *      `RunScanOptions` — see below), `IPluginRuntimeBundle`,
 *      `IPruneResult`, `IMigrationFile`, `IDbLocationOptions`. **`I`
 *      prefix.** The prefix matches category 3 because both are
 *      "shapes that live in TypeScript only, never in JSON".
 *
 * Edge cases worth knowing:
 *   - The following category-4 names lack the `I` prefix because
 *     they are part of the public kernel surface and renaming is a
 *     breaking change for downstream consumers. The list is closed:
 *       option bags / records: `RunScanOptions`, `RenameOp`;
 *       TS-only exports from `kernel/index.ts` / `kernel/ports/*`:
 *         `Kernel`, `ProgressEvent`, `LogRecord`, `NodeStat`.
 *     New public option bags and TS-only exports MUST still use
 *     `I*`; removing a name from this list is a breaking change.
 *   - `IDatabase` (SQLite schema) is category 4 but lives in
 *     `adapters/sqlite/schema.ts`, not here. Same rule applies.
 *
 * If you find yourself wanting to add a new type and aren't sure which
 * bucket it falls in: ask "does this shape exist in the spec?". If
 * yes, no prefix and align the name with the schema. If no, `I`
 * prefix.
 */

/**
 * The four node kinds the **built-in Claude Provider** declares — `skill`,
 * `agent`, `command`, `note`. **NOT** the kernel-wide kind type.
 *
 * `Node.kind` is `string`. An external Provider (Cursor, Obsidian, …)
 * MAY classify into its own kinds (e.g. `'cursorRule'`, `'daily'`); the
 * orchestrator, persistence layer, and AJV `node.schema.json` accept any
 * non-empty string. Per `spec/db-schema.md` § scan_nodes and
 * `node.schema.json#/properties/kind`, the contract is open-by-design
 * (matches `IProvider.kinds` "open by design" docstring).
 *
 * Step 9.5 dropped `hook` from the catalog: `.claude/hooks/*.md` is NOT
 * an Anthropic-defined node type — hooks live in `settings.json` or as
 * sub-objects of agent / skill frontmatter (see
 * https://code.claude.com/docs/en/hooks.md). Files at the old path now
 * classify as `note` via the Provider's fallback.
 *
 * This alias survives because:
 *   - claude-specific code legitimately wants to switch on the four
 *     hard-coded values (filter widgets, kind-aware UI cards, the
 *     `validate-all` built-in rule that maps each kind to its
 *     frontmatter schema);
 *   - sorting helpers want a stable `KIND_ORDER` for the canonical
 *     catalog;
 *   - tests expect to enumerate the four kinds when seeding fixtures.
 *
 * For "any kind a Provider could declare", use plain `string`. Only use
 * `NodeKind` when the code is intentionally claude-catalog-specific.
 */
export type NodeKind = 'skill' | 'agent' | 'command' | 'note';

export type LinkKind = 'invokes' | 'references' | 'mentions' | 'supersedes';

export type Confidence = 'high' | 'medium' | 'low';

export type Severity = 'error' | 'warn' | 'info';

export type Stability = 'experimental' | 'stable' | 'deprecated';

/**
 * Execution mode of an analytical extension. Mirrors the per-kind capability
 * matrix in `spec/architecture.md` §Execution modes:
 *
 *   - `deterministic` — pure code, runs synchronously inside `sm scan` /
 *     `sm check`. Same input → same output, every run.
 *   - `probabilistic` — calls an LLM through `RunnerPort`, dispatches only
 *     as a queued job (`sm job submit <kind>:<id>`); never participates in
 *     scan-time pipelines.
 *
 * Extractor / Rule / Action declare it directly (default `deterministic` when
 * omitted in the manifest). Provider / Formatter are deterministic-only and
 * MUST NOT carry the field.
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
  /**
   * Provider-declared category. Open string (matches
   * `node.schema.json#/properties/kind`): the built-in Claude Provider
   * emits one of `NodeKind`'s values, but external Providers MAY emit
   * their own. Code that intentionally switches on the claude catalog
   * narrows via `if (kind === 'skill' \| ... )`; everything else
   * accepts the open string and treats unknown values as opaque labels.
   */
  kind: string;
  provider: string;
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
  /** The originating node — the path of the file the extractor was reading
   *  when it emitted this link. Singular, NOT to be confused with
   *  `sources` (plural) below. */
  source: string;
  target: string;
  kind: LinkKind;
  confidence: Confidence;
  /** Identifiers of the extractors / extensions that contributed evidence
   *  for this link (one link can be confirmed by multiple extractors).
   *  Plural; NOT the same as `source` (singular) above, which is the
   *  originating node path. Naming is unfortunate but spec-frozen. */
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
   * Files visited by the Provider walkers. With a single Provider this
   * matches `nodesCount`; with multiple Providers running on overlapping
   * roots it can diverge (each yielded `IRawNode` is one walked file).
   */
  filesWalked: number;
  /**
   * Files walked but not classified by any Provider. Today every walked
   * file is classified by its Provider (the `claude` Provider falls back to
   * `'note'`), so this is always 0; the field will matter once multiple
   * Providers can claim the same file.
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

export type ExecutionKind = 'action';
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
  /** Provider ids that participated in classification. Empty if no Provider matched. */
  providers: string[];
  /** Implementation metadata. Populated by `runScan` for self-describing output. */
  scannedBy?: ScanScannedBy;
  nodes: Node[];
  links: Link[];
  issues: Issue[];
  stats: ScanStats;
}
