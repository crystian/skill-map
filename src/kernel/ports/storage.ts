/**
 * `StoragePort`, the kernel's persistence boundary. Driving adapters
 * (CLI, future server, in-memory test harness) consume this surface
 * exclusively; nothing in `cli/**` should reach into the SQLite
 * adapter's internal helpers (free functions on
 * `kernel/adapters/sqlite/*`) directly. Phase F of the
 * storage-port-promotion refactor finishes that hardening; A-E grow
 * the port enough that the CLI has somewhere to land.
 *
 * The port is namespaced by domain (`scans`, `issues`, `enrichments`,
 * etc.), explicitly NOT a generic `port.query<T>(sql)`. Each
 * namespace's methods name an operation the kernel cares about; the
 * adapter translates to its persistence engine's idioms.
 *
 * Phase A lands the **scans / issues / enrichments / transaction**
 * namespaces, the core scan pipeline. The remaining namespaces
 * (history / jobs / migrations) arrive in subsequent phases. Plugin import trust was once on this
 * list; it is not a storage concern any more, having moved to the scope
 * lock outside the database. The port shape declared here is the
 * Phase A subset; later phases extend it without reshaping what
 * lands today.
 */

import type {
  ExecutionRecord,
  HistoryStats,
  Issue,
  Job,
  JobRunner,
  JobStatus,
  Node,
  ScanResult,
} from '../types.js';
import type {
  IEnrichmentRecord,
  IExtractorRunRecord,
  IPersistedEnrichment,
} from '../orchestrator.js';
import type { IPriorExtractorRun } from '../adapters/sqlite/scan-load.js';
import type {
  IPluginKvListQuery,
  IPluginKvRow,
  IPluginKvScope,
} from '../adapters/sqlite/plugin-kvs.js';
import type { ISuppressionEntry } from '../jobs/findings-report.js';
import type { IUpdateCheckCache } from '../update-check/index.js';
import type {
  IActivityPairRow,
  IActivityStatsRow,
  IApplyOptions,
  IApplyResult,
  IBranchProjection,
  IBranchScope,
  IFindingRecord,
  IFindingResolutionIntent,
  IFindingSeverityCount,
  IFindingsListFilter,
  IFindingsWriteIntent,
  IHistoryStatsRange,
  IIssueIncidenceCount,
  IIssueListFilter,
  IIssueListResult,
  IIssueRow,
  IJobClaim,
  IJobContentInput,
  IJobListFilter,
  IJobsIntegrityCounts,
  IJobSubmitRow,
  IListExecutionsFilter,
  ILiteNode,
  IMigrateNodeFksReport,
  IMigrationFile,
  IMigrationPlan,
  INodeBundle,
  INodeCounts,
  INodeFilter,
  IPersistedContribution,
  IPersistOptions,
  IPruneResult,
  IQuickCheckResult,
  IStateEnrichmentRecord,
  IStateEnrichmentUpsert,
  ISummaryRecord,
  ISummaryWriteIntent,
  TFindingResolveOutcome,
  TFindingRowDismissOutcome,
  TFindingReopenOutcome,
  TFixerSubmitOutcome,
  THistoryStatsPeriod,
  TJobTransitionOutcome,
} from '../types/storage.js';

/**
 * Subset of `StoragePort` exposed inside a `transaction(fn)` callback.
 * Lifecycle methods are intentionally omitted, a transaction that
 * tries to `init()` the adapter mid-flight is a category error.
 *
 * Every callable in the subset MUST run on the same underlying
 * transaction handle the adapter opened for the callback. Adapters
 * are responsible for that wiring; consumers only see the namespace
 * surfaces.
 */
export interface ITransactionalStorage {
  scans: {
    persist(result: ScanResult, opts?: IPersistOptions): Promise<void>;
  };
  issues: {
    deleteById(id: number): Promise<void>;
    insert(issue: Issue): Promise<void>;
  };
  enrichments: {
    /**
     * Upsert a batch of fresh enrichment records produced by an
     * extractor pass (Model B, `node_enrichments`). Composite PK is
     * `(nodePath, extractorId)`; conflict → replace. Every row lands
     * with `stale = 0` (the caller just refreshed it; ROADMAP §B.10,
     * staleness is computed downstream when the body hash changes
     * again).
     */
    upsertMany(records: IEnrichmentRecord[]): Promise<void>;
    /**
     * Upsert one `state_enrichments` row (Model A, the enrichment
     * write-through `sm enrich` lands for an enricher Action).
     * Composite PK is `(nodeId, providerId)`; conflict → replace.
     * Transactional variant so the state row and its `state_executions`
     * sibling land atomically (mirror of the summaries fold inside
     * `jobs.recordTerminal`).
     */
    upsertState(row: IStateEnrichmentUpsert): Promise<void>;
  };
  history: {
    /**
     * Repoint every `state_*` reference from `fromPath` to `toPath`.
     * Atomic across the four state tables; the report flags any
     * composite-PK collisions so callers can diagnose them.
     * `sm orphans reconcile` / `undo-rename` and the scan-time
     * rename heuristic are the canonical consumers.
     */
    migrateNodeFks(from: string, to: string): Promise<IMigrateNodeFksReport>;
    /**
     * Append a single `state_executions` row inside the transaction.
     * `sm enrich` pairs it with `enrichments.upsertState` so an
     * in-process enricher execution and its state row commit together.
     */
    insertExecution(record: ExecutionRecord): Promise<void>;
  };
  // The jobs namespace lands in Phase C. Trust is NOT a storage concern
  // any more: it moved to the scope lock, outside the database.
}

export interface StoragePort {
  // --- lifecycle ---------------------------------------------------------
  init(): Promise<void>;
  close(): Promise<void>;

  // --- scans namespace ---------------------------------------------------
  scans: {
    /**
     * Persist a fresh `ScanResult` (replace-all on the scan zone).
     * Called by `sm scan` after the orchestrator returns. The renames /
     * extractor-runs / enrichments side bags ride along inside the
     * same transaction, the call is atomic from the caller's view.
     */
    persist(result: ScanResult, opts?: IPersistOptions): Promise<void>;
    /**
     * Hydrate the persisted `ScanResult`. Returns the snapshot the
     * scan zone holds today (including external-Provider kinds,
     * `node.kind` is open string per `node.schema.json`).
     */
    load(): Promise<ScanResult>;
    /**
     * Metadata-only `ScanResult`: every scalar field plus real
     * `COUNT(*)` stats, but empty `nodes` / `links` / `issues` arrays.
     * Reads only the single `scan_meta` row plus the counts, never the
     * node / link / issue tables, so the BFF `GET /api/scan?meta=1` boot
     * fetch stays cheap on a large corpus. The SPA pairs it with
     * `/api/folders` (tree) and `/api/branch` (map).
     */
    loadMeta(): Promise<ScanResult>;
    /**
     * Spec § A.9, fine-grained extractor-runs cache breadcrumbs.
     * Returns `Map<nodePath, Map<qualifiedExtractorId, IPriorExtractorRun>>`.
     * Inner value carries `bodyHash` AND `sidecarAnnotationsHash`; both
     * participate in the cache hit condition for every Extractor.
     */
    loadExtractorRuns(): Promise<Map<string, Map<string, IPriorExtractorRun>>>;
    /** Universal enrichment layer, every persisted `(node, extractor)` pair. */
    loadNodeEnrichments(): Promise<IPersistedEnrichment[]>;
    /**
     * Row counts for `scan_nodes` / `scan_links` / `scan_issues`.
     * Used by `sm scan`'s "refusing to wipe a populated DB" guard.
     */
    countRows(): Promise<INodeCounts>;
    /** Row-level filter for `sm list`. Open `kind` (matches `Node.kind`). */
    findNodes(filter: INodeFilter): Promise<Node[]>;
    /**
     * Bundled fetch for `sm show <path>`. Returns `null` if the node
     * is not in the persisted scan.
     */
    findNode(path: string): Promise<INodeBundle | null>;
    /**
     * Lightweight full-corpus node list `{ path, kind }[]`, ordered by
     * `path` ASC. Backs the BFF `/api/folders` endpoint: the SPA folders
     * tree renders the whole scanned corpus (up to `scan.maxScan`)
     * without hydrating the full `ScanResult`. Pushes the projection to
     * SQL (`SELECT path, kind`), never loads the rest of the row.
     */
    listLiteNodes(): Promise<ILiteNode[]>;
    /**
     * Distinct `scan_nodes.provider` values in the persisted scan.
     * Backs `sm doctor`'s providers-matched-nothing check.
     */
    distinctNodeProviders(): Promise<string[]>;
    /**
     * Per-node issue incidence counts by severity, keyed by node path.
     * Expands every `scan_issues.node_ids_json` array with SQLite
     * `json_each` and groups by `(value, severity)` so the count is
     * computed in SQL, not by loading every issue into memory. Only
     * error / warn severities are tallied (the SPA badges ignore
     * `info`); nodes with no error / warn issue are absent from the
     * map. Backs the `errorCount` / `warnCount` fields on `/api/folders`.
     */
    issueCountsByPath(): Promise<Map<string, IIssueIncidenceCount>>;
    /**
     * Effective map-render cap recorded by the latest scan
     * (`scan_meta.max_render_nodes`). Returns the design default (256)
     * when no `scan_meta` row exists (DB freshly migrated / never
     * scanned). Backs the `/api/branch` cap default + clamp ceiling.
     */
    effectiveMaxRenderNodes(): Promise<number>;
    /**
     * Override-scoped, capped graph projection for the BFF `/api/branch`
     * endpoint (`spec/cli-contract.md` §Map scope overrides). A node is
     * in the branch when its NEAREST matching override (longest of the
     * scope's include/exclude paths that equals the node's path or
     * prefixes it, the root riding `rootExcluded`) is an include, or no
     * override matches at all (default include). The degenerate scopes
     * keep the historical semantics: `{include: [], exclude: [],
     * rootExcluded: false}` selects the whole corpus with no WHERE;
     * `{include: P, exclude: [], rootExcluded: true}` is the old
     * prefix-union over P. Identical paths are de-duped defensively.
     * `nodes` is the first `limit` scoped nodes in stable path order
     * (`ORDER BY path LIMIT`); `links` carries only edges whose source
     * AND resolved target are both in `nodes`; `issues` carries only
     * those whose `nodeIds` intersect `nodes`. `total` is the count of
     * scoped nodes BEFORE the cap (so the route can compute
     * `truncated`); `paths` echoes the de-duped includes. All scoping +
     * capping happens in SQL so a 50K corpus never hydrates into memory;
     * the fully-excluded scope (`rootExcluded` with no includes) short-
     * circuits to an empty projection without querying.
     */
    loadBranch(scope: IBranchScope, limit: number): Promise<IBranchProjection>;
    /**
     * Refresh ONE node's denormalized `scan_nodes.annotations_json`
     * mirror from its just-written `.sm` annotations, the write-through
     * half of `sm findings dismiss` / `undismiss` (`spec/db-schema.md`
     * §state_findings, read-time suppression lens). The sidecar stays the
     * source of truth; `sm scan` remains the wholesale refresher (a
     * hand-edited `.sm` reconciles at the next scan). `null` clears the
     * column; a path not in the scan is a no-op.
     */
    refreshAnnotations(path: string, annotations: Record<string, unknown> | null): Promise<void>;
  };

  // --- contributions namespace -----------------------------------------
  /**
   * Phase 3 / View contribution system, read access to
   * `scan_contributions`, plus the targeted purge used by
   * `sm plugins disable` to clear stale rows immediately at toggle time.
   * Bulk writes still happen exclusively via
   * `scans.persist({ contributions })` (replace-all semantics).
   */
  contributions: {
    /** Every contribution row for a single node. Stable order. */
    listForNode(nodePath: string): Promise<IPersistedContribution[]>;
    /**
     * Bulk variant for the BFF nodes-list route. Returns rows for
     * every path in `paths`, sorted `nodePath` ASC, then qualified-id
     * ASC. Empty `paths` returns `[]` without a query.
     */
    listForPaths(paths: readonly string[]): Promise<IPersistedContribution[]>;
    /**
     * Lookup by qualified id + path. Used by
     * `GET /api/contributions/:pluginId/:contributionId?path=...`.
     */
    lookup(
      pluginId: string,
      contributionId: string,
      nodePath: string,
      extensionId?: string,
    ): Promise<IPersistedContribution[]>;
    /**
     * Drop rows for a plugin (optionally narrowed to a single
     * extension within the plugin). Returns the number of deleted
     * rows. Called by `sm plugins disable` so the UI stops rendering
     * the disabled plugin's chips before the next scan.
     */
    purgeByPlugin(pluginId: string, extensionId?: string): Promise<number>;
    /**
     * "off-shape visible" follow-up, every view contribution the last
     * scan REJECTED at emit time (undeclared ref, or payload failed the
     * slot's AJV schema), ordered by `(pluginId, extensionId, nodePath,
     * emittedAt)` ASC. Consumed by `sm plugins doctor` to surface
     * runtime contribution rejections per plugin (and later the BFF).
     */
    listAllErrors(): Promise<
      import('../adapters/sqlite/contributions.js').IContributionErrorRecord[]
    >;
  };

  // --- tags namespace ----------------------------------------------------
  /**
   * Read-only access to `scan_node_tags`. Writes happen exclusively
   * via `scans.persist({...})` (the persistence layer projects from
   * `node.sidecar.annotations.tags`, the only tag source); this
   * namespace is read-only.
   */
  tags: {
    /** Every tag row for a single node, ordered by tag name. */
    listForNode(nodePath: string): Promise<import('../adapters/sqlite/tags.js').ITagRecord[]>;
    /**
     * Bulk variant for the BFF nodes-list route. Returns rows for every
     * path in `paths`, sorted `tag` ASC. Empty `paths` returns `[]`
     * without a query.
     */
    listForPaths(
      paths: readonly string[],
    ): Promise<import('../adapters/sqlite/tags.js').ITagRecord[]>;
    /**
     * Find every node carrying `tag` in its `.sm` sidecar
     * (`annotations.tags`). Drives `sm list --tag <name>`.
     */
    findNodes(tag: string): Promise<string[]>;
  };

  // --- issues namespace --------------------------------------------------
  issues: {
    /** Every issue from the latest scan, in insertion order. */
    listAll(): Promise<Issue[]>;
    /**
     * Paginated, filtered issue read. Drives `/api/issues` (the BFF
     * route used to call `listAll()` and filter in JS, which loaded
     * every persisted issue into memory before paging; the audit
     * L6 fix pushes both filtering AND pagination into SQL).
     *
     * `total` in the result is the count matching the filters BEFORE
     * pagination is applied; `items` is the page slice (length ≤
     * `filter.limit`). Order is `id` ASC (insertion order, stable
     * across pages so the route's `offset` / `limit` is deterministic).
     *
     * Empty filters match every row (the route still passes
     * `offset` + `limit` so pagination always applies). See
     * `IIssueListFilter` for the per-field semantics.
     */
    list(filter: IIssueListFilter): Promise<IIssueListResult>;
    /**
     * Issue rows whose runtime `Issue` shape passes `predicate`.
     * `port.issues.findActive((i) => i.analyzerId === 'orphan')` is the
     * canonical use; `sm orphans` consumes this. The returned shape
     * carries the DB-assigned `id` so a follow-up
     * `transaction(tx => tx.issues.deleteById(row.id))` can target
     * a specific row.
     */
    findActive(predicate: (issue: Issue) => boolean): Promise<IIssueRow[]>;
    /**
     * Delete every persisted issue row matching an operator's issue
     * suppression (`spec/db-schema.md` §scan_issues): `analyzer`
     * (qualified or short, `matchesAnalyzerFilter` semantics against
     * the stored SHORT `analyzer_id`), the verbatim `data.target`
     * value (exact, case-sensitive), and membership of `nodePath` in
     * the row's `nodeIds`. Called by the `sm issues dismiss` surfaces
     * AFTER the sidecar write so reads agree without waiting for a
     * rescan; the delete converges regenerable machine state toward
     * what the next scan (whose analyzer consults the suppression at
     * emission time) produces anyway. Returns the deleted row count.
     */
    deleteForSuppression(nodePath: string, analyzer: string, value: string): Promise<number>;
  };

  // --- enrichments namespace ---------------------------------------------
  /**
   * Read access to `state_enrichments` (Model A, the per-node
   * enrichment write-through an enricher Action lands via `sm enrich`,
   * `spec/db-schema.md` §state_enrichments). The mutation surfaces stay
   * transactional-only on `ITransactionalStorage`: the Model B batch
   * (`upsertMany`, `node_enrichments`) rides inside the refresh
   * extractor persist, and the Model A upsert (`upsertState`) commits
   * atomically with its `state_executions` sibling. This top-level
   * namespace is read-only by design.
   */
  enrichments: {
    /**
     * Every `state_enrichments` row for a node, ordered by
     * `providerId` ASC. `providerId` carries the enriching Action's
     * qualified id (e.g. `github/enrichment`).
     */
    listStateForNode(nodeId: string): Promise<IStateEnrichmentRecord[]>;
    /**
     * The stale candidate set for `sm enrich --stale` (v1 staleness:
     * `data_json.localBodyHash` differs from the node's current
     * `scan_nodes.body_hash`, or a non-null `stale_after` has passed;
     * rows whose node vanished from the scan are excluded). Computed
     * SQL-side, see `adapters/sqlite/enrichments.ts`.
     */
    listStaleStateCandidates(nowMs: number): Promise<IStateEnrichmentRecord[]>;
  };

  // --- jobs namespace ----------------------------------------------------
  jobs: {
    /**
     * Submit a job: `INSERT OR IGNORE` the rendered content into
     * `state_job_contents` then insert the `state_jobs` lifecycle row
     * (`status = 'queued'`), both in ONE transaction (content row first).
     * Returns the inserted job id. The `state_jobs` insert may throw a
     * UNIQUE-constraint error from `ix_state_jobs_extension_node_hash` when
     * a matching queued/running job already exists (the hard duplicate
     * backstop); the CLI maps that to exit 3.
     */
    submit(row: IJobSubmitRow, content: IJobContentInput): Promise<string>;
    /**
     * Atomic FIXER supersede submit (`spec/job-lifecycle.md` §Findings
     * injection for fixers · Supersede). In ONE transaction it finds any
     * ACTIVE job for the `(extensionId, nodeId)` pair and resolves the
     * collision: a running job refuses (`running-conflict`, never superseded);
     * an identical queued request refuses (`duplicate`); otherwise it CANCELS
     * every stale queued sibling (a different `contentHash`) and enqueues the
     * new job (`created`, `supersededIds` naming the cancelled rows). Only the
     * fixer submit path uses this; every other submit goes through
     * `submit(...)` + the plain `findActiveDuplicate` pre-check.
     */
    submitFixer(row: IJobSubmitRow, content: IJobContentInput): Promise<TFixerSubmitOutcome>;
    /**
     * Duplicate pre-check: id of any `queued`/`running` job matching
     * `(extensionId, extensionVersion, nodeId, contentHash)`, else `null`.
     * The soft gate `sm jobs submit` runs before insert (skipped by
     * `--force`).
     */
    findActiveDuplicate(
      extensionId: string,
      extensionVersion: string,
      nodeId: string,
      contentHash: string,
    ): Promise<string | null>;
    /** Filtered job list for `sm jobs list`, newest-first. */
    list(filter: IJobListFilter): Promise<Job[]>;
    /** Full job by id for `sm jobs show`, or `null` when absent. */
    get(id: string): Promise<Job | null>;
    /**
     * Rendered content blob for a job's `contentHash` (from
     * `state_job_contents`), or `null` when the content row is absent (the
     * DB-corruption-only `job-file-missing` state). Powers `sm jobs preview`.
     */
    getContent(contentHash: string): Promise<string | null>;
    /**
     * Atomic claim (`spec/job-lifecycle.md` §Atomic claim): a single
     * `UPDATE ... RETURNING` that transitions the highest-priority, oldest
     * queued job to `running`, stamping `claimedAt` / `runner` /
     * `expiresAt = claimedAt + ttlSeconds × 1000`. Returns the claimed
     * `{ id, nonce, contentHash }`, or `null` when the queue is empty (or
     * nothing matches `filter`, an `extensionId` restriction). The statement's
     * second `AND status='queued'` is the mandatory race guard, two racers
     * selecting the same id yield exactly one winning UPDATE. `sm jobs claim`
     * exposes this to external agents (`runner='agent'`).
     */
    claim(runner: JobRunner, nowMs: number, filter?: string): Promise<IJobClaim | null>;
    /**
     * Cancel a single job (`spec/job-lifecycle.md` §Cancellation): a
     * `queued` / `running` job moves to the terminal `cancelled` state
     * (`finishedAt = nowMs`, no `failureReason`; `cancelled` is a distinct
     * state, NOT a `failed` sub-reason). Returns `cancelled`,
     * `already-terminal` (job in a terminal state, the verb exits 2), or
     * `not-found` (exit 5). Does NOT interrupt any subprocess.
     */
    cancel(id: string, nowMs: number): Promise<TJobTransitionOutcome>;
    /**
     * Cancel every `queued` / `running` job in one statement; returns the
     * ids transitioned to the terminal `cancelled` state (mirroring
     * `reapExpired`: the caller derives the count from the length and
     * feeds the per-job `job.cancelled` live push,
     * `spec/job-events.md` §Transport). Powers `sm jobs cancel --all`.
     */
    cancelAllActive(nowMs: number): Promise<string[]>;
    /**
     * Fail a single job (`spec/job-lifecycle.md` §Fail), the symmetric
     * counterpart to `cancel`: a `queued` / `running` job moves to `failed`
     * with `failureReason = user-failed` (`finishedAt = nowMs`). Returns
     * `failed`, `already-terminal` (exit 2), or `not-found` (exit 5). Does
     * NOT interrupt any subprocess.
     */
    fail(id: string, nowMs: number): Promise<TJobTransitionOutcome>;
    /**
     * Fail every `queued` / `running` job in one statement; returns the
     * ids transitioned to `failed` / `user-failed` (mirroring
     * `reapExpired`, see `cancelAllActive`). Powers `sm jobs fail --all`.
     */
    failAllActive(nowMs: number): Promise<string[]>;
    /**
     * Counts per lifecycle status (`queued` / `running` / `completed` /
     * `failed` / `cancelled`), every key present. Backs `sm jobs status`
     * with no id.
     */
    countByStatus(): Promise<Record<JobStatus, number>>;
    /**
     * Read-only integrity counts for `sm doctor`: jobs whose content
     * row is missing (corruption) and content rows referenced by zero
     * jobs (retention leftovers `sm jobs prune` collects).
     */
    integrityCounts(): Promise<IJobsIntegrityCounts>;
    /**
     * Auto-reap (`spec/job-lifecycle.md` §Reap procedure): transition every
     * `running` job whose `expiresAt < nowMs` to `failed` / `abandoned`
     * with `finishedAt = nowMs`; returns the reaped job ids (a live event
     * transport MAY surface them, `spec/job-events.md` §Ordering; the CLI
     * claim verb ignores them silently). Invoked at the start of every
     * `sm jobs claim`, before the claim statement; no standalone verb.
     */
    reapExpired(nowMs: number): Promise<string[]>;
    /**
     * Retention GC, in one transaction: delete `state_jobs` rows in
     * terminal `status` whose `finishedAt` is older than `cutoffMs`
     * (Unix ms), then collect orphaned `state_job_contents` rows (every
     * content blob referenced by zero surviving `state_jobs` rows).
     * Returns the deleted job count plus the collected content-row count.
     * Caller computes `cutoffMs` from the configured retention. Job
     * content is DB-only (`state_job_contents`); there is no on-disk
     * `.skill-map/jobs/*.md` artifact to unlink.
     */
    pruneTerminal(
      status: 'completed' | 'failed' | 'cancelled',
      cutoffMs: number,
    ): Promise<IPruneResult>;
    /**
     * Read-only preview of `pruneTerminal` (no DELETE). Powers `sm jobs
     * prune --dry-run` so the output reports how many rows the live mode
     * would delete. `prunedContents` is `0` in the preview (see the
     * adapter note).
     */
    listTerminalCandidates(
      status: 'completed' | 'failed' | 'cancelled',
      cutoffMs: number,
    ): Promise<IPruneResult>;
    /**
     * Record callback (`spec/job-lifecycle.md` §Record): append the terminal
     * `state_executions` row AND transition the `running` job to its
     * terminal state (`completed` / `failed`), atomically in one
     * transaction. The `ExecutionRecord` carries the target `jobId`, the
     * final `status`, the `failureReason` (`report-invalid` /
     * `runner-error` / null), and `finishedAt`; the report payload rides
     * inline on `reportPath` (mapped to the `report_json` column). Backs
     * `sm record`.
     *
     * When `summary` is supplied (the recorded Action's report schema is
     * a per-node summary schema, only ever on the `completed` path), the validated
     * report is ALSO upserted into `state_summaries` inside the same
     * transaction, keyed by `(node_id, summarizer_action_id)`. The upsert
     * reads the node's live `kind` + `body_hash` from `scan_nodes` and is
     * skipped when the node no longer exists (deleted / renamed since
     * submit); the execution row + job transition still land
     * (`spec/job-lifecycle.md` §Record).
     *
     * When `findings` is supplied (the recorded job's extension is
     * probabilistic and its `completed` report produced finder / safety
     * rows, possibly zero), the pair's `state_findings` rows are REPLACED
     * inside the same transaction (both origins deleted, fresh rows
     * inserted stamped with the node's live `body_hash`); an empty intent
     * is a clean verdict that erases the prior judgment. Same skip rule
     * as summaries when the node has disappeared
     * (`spec/db-schema.md` §state_findings).
     *
     * When `resolutions` is supplied (the recorded job's extension is a
     * FIXER: an Action declaring `precondition.analyzerIds`), the lifecycle
     * `state` each entry of its report's `resolved[]` declares is stamped
     * onto the finding its `id` names, in the same transaction. A `fixed`
     * state hides the row from the default view but never deletes it; only
     * the finder re-judging closes a finding. Entries naming an unknown id,
     * a finding on another node, or a finder outside the fixer's
     * `analyzerIds` are skipped SILENTLY (benign race / defensive scope).
     */
    recordTerminal(
      execution: ExecutionRecord,
      summary?: ISummaryWriteIntent,
      findings?: IFindingsWriteIntent,
      resolutions?: IFindingResolutionIntent,
    ): Promise<void>;
  };

  // --- findings namespace -------------------------------------------------
  /**
   * Read access to `state_findings`, the probabilistic findings a finder
   * Analyzer (plus the kernel safety lane) lands via `sm record`. Writes
   * happen inside the `jobs.recordTerminal(execution, summary, findings)`
   * transaction (folded into the record callback, never a standalone
   * write); this namespace is read-only.
   */
  findings: {
    /**
     * Filtered read with the derived `stale` flag
     * (`body_hash_at_generation` vs the node's live `scan_nodes.body_hash`;
     * rows for nodes gone from the scan count as stale). Stale rows are
     * excluded unless `filter.includeStale` is set. Backs `sm findings`
     * and `sm show`'s Findings section.
     */
    list(filter?: IFindingsListFilter): Promise<IFindingRecord[]>;
    /**
     * Batch count of each node's FRESH OPEN findings by severity
     * (`resolution IS NULL`, non-stale; `warn` / `error` only, `info`
     * dropped, mirroring issues), keyed by node path. Both origins
     * (finder-lane + kernel safety-lane) count. One SQL GROUP BY over
     * `paths`; empty `paths` returns an empty map without a query; nodes
     * with no open warn/error finding are absent (the caller defaults to
     * `{ warn: 0, error: 0 }`). Backs the BFF read-time fold that sums a
     * node's findings into `core/issue-counter`'s aggregate severity chips
     * (`spec/view-slots.md` §card.footer.right); the sum is a read-time UI
     * decoration, `sm scan --json` carries only the deterministic
     * component.
     */
    countUnresolvedByPath(paths: readonly string[]): Promise<Map<string, IFindingSeverityCount>>;
    /**
     * Count the STALE rows (body-hash drift, or the node gone from
     * `scan_nodes`); the `sm findings prune` dry-run / confirmation
     * count.
     */
    countStale(): Promise<number>;
    /**
     * Delete every STALE row (`sm findings prune`); fresh rows are never
     * touched. Returns the deleted row count.
     */
    pruneStale(): Promise<number>;
    /**
     * `sm findings resolve <id>`: mark an OPEN or `human-decision` finding
     * `fixed` by the OPERATOR themselves (`resolution = 'fixed'`,
     * `resolution_actor = 'human'`, `resolution_by = NULL`, the optional
     * `note`, `resolution_at = nowMs`). Refuses a row already `fixed`
     * (`already-fixed`, exit 2); an unknown id is `not-found` (exit 5). It
     * records a human decision, NOT a verification (only re-running the
     * finder verifies). Returns the updated row for the `--json` echo.
     */
    resolveByHuman(
      id: number,
      note: string | null,
      nowMs: number,
    ): Promise<TFindingResolveOutcome>;
    /**
     * `sm findings dismiss <id>` (ROW grain, 2026-07-22): mark the row
     * `dismissed` by the operator (`resolution = 'dismissed'`, actor
     * `human`; no sidecar, no consent). Hides under the dismissed
     * bucket, dies with the row when the finder re-judges. Refuses an
     * already-dismissed row; the durable class suppression is the
     * separate `--class` / silence-type path.
     */
    dismissByHuman(
      id: number,
      note: string | null,
      nowMs: number,
    ): Promise<TFindingRowDismissOutcome>;
    /**
     * `sm findings reopen <id>`: clear ANY resolution (`dismissed` /
     * `fixed` / `human-decision`) back to open. Refuses an already-open
     * row. Class suppressions are untouched (`sm findings undismiss`).
     */
    reopen(id: number, nowMs: number): Promise<TFindingReopenOutcome>;
    /**
     * Read one finding by id with the derived `stale` flag. `null` when no
     * row carries the id. Backs `sm findings dismiss <id>`, which loads the
     * target (to read its `extension_id` / `type` / `node_id` / `origin`)
     * before writing the durable sidecar suppression.
     */
    get(id: number): Promise<IFindingRecord | null>;
    /**
     * Active suppression entries per node path, read from the
     * write-through `scan_nodes.annotations_json` mirror
     * (`spec/db-schema.md` §state_findings, read-time suppression lens):
     * the `.sm` sidecar is the source of truth, dismiss / undismiss
     * refresh the column for the touched node, `sm scan` refreshes it
     * wholesale. Backs the findings view's `dismissed` bucket, the card
     * counters, and `sm findings suppressions`; ZERO file reads. `paths`
     * narrows; absent reads every node. Nodes without suppressions are
     * absent from the map.
     */
    suppressionsByPath(paths?: readonly string[]): Promise<Map<string, ISuppressionEntry[]>>;
    /**
     * Count the rows `clear(nodeId?)` would delete (fresh included, all
     * origins); the `sm findings clear` dry-run / confirmation count.
     * `nodeId` narrows to one node, absent counts the whole table.
     */
    countClearable(nodeId?: string): Promise<number>;
    /**
     * `sm findings clear` (`spec/cli-contract.md` §sm findings clear):
     * wholesale delete of `state_findings` rows, FRESH included, all
     * origins (finder judgments AND kernel safety rows; a delete cannot
     * silence future warnings, unlike a suppression, so the safety lane is
     * deletable here while `sm findings dismiss` refuses it). `nodeId`
     * narrows to one node, absent clears the whole table. A reset, not a
     * suppression: a finder re-run re-judges. Returns the deleted count.
     */
    clear(nodeId?: string): Promise<number>;
    /**
     * Hard-delete ONE row by id, the per-row twin of `clear` behind
     * `DELETE /api/nodes/:pathB64/findings/:id` (the inspector's delete X
     * on a revealed dismissed / fixed row). Same all-origins rationale as
     * `clear`; leaves `annotations.suppressions` untouched. Returns
     * whether a row was deleted (false = unknown id).
     */
    removeById(id: number): Promise<boolean>;
  };

  // --- summaries namespace ----------------------------------------------
  /**
   * Read access to `state_summaries`, the per-node semantic summaries a
   * summarizer Action (one whose report schema extends a
   * `summaries/<kind>` schema) lands via `sm record`. Writes happen inside the
   * `jobs.recordTerminal(execution, summary)` transaction (folded into the
   * record callback, never a standalone write); this namespace is
   * read-only.
   */
  summaries: {
    /**
     * Every stored summary for a node, ordered by `summarizerActionId`
     * ASC. Backs `sm show <node>`'s Summary section: the caller flags each
     * `(stale)` by comparing `bodyHashAtGeneration` against the node's
     * current `scan_nodes.body_hash`.
     */
    forNode(nodeId: string): Promise<ISummaryRecord[]>;
    /**
     * Hard-delete the node's stored summaries: with `summarizerActionId`
     * only that action's row, without it every summary the node has
     * (`DELETE /api/nodes/:pathB64/summary`, the inspector's delete X).
     * A regenerable machine judgment, so no ceremony; returns the
     * deleted count (0 = nothing matched).
     */
    remove(nodeId: string, summarizerActionId?: string): Promise<number>;
  };

  // --- preferences namespace -------------------------------------------
  /**
   * Generic key/value preferences keyed by a stable string. Backs the
   * `config_preferences` table, one row per `key`, `value_json` is a
   * single JSON blob the caller serialises. Keys with the `_kernel.`
   * prefix are reserved for kernel-managed entries (today: the
   * update-check cache); user-set preferences land under unprefixed
   * keys when those ship.
   *
   * Read-only by design at the port level, the only writer is the
   * CLI's post-run hook (`cli/util/update-check-banner.ts`), which
   * reaches the persistence helpers directly. The port surfaces the
   * read so the BFF's `GET /api/update-status` projection can stay
   * inside the abstract contract.
   */
  preferences: {
    /**
     * Load the update-check cache row. Returns `null` when the row
     * is absent, malformed JSON, or fails the shape guard. Never
     * throws, read failures degrade silently because the banner is
     * a non-essential surface.
     */
    loadUpdateCheckCache(): Promise<IUpdateCheckCache | null>;
    /**
     * Upsert the update-check cache row. Always overwrites the
     * existing JSON blob in place. `updated_at` tracks wall-clock
     * now, separate from the embedded `checkedAt` field, which
     * the caller controls.
     */
    saveUpdateCheckCache(cache: IUpdateCheckCache): Promise<void>;
  };

  // --- favorites namespace ----------------------------------------------
  favorites: {
    /**
     * Mark `path` as favorited. Idempotent, a second call refreshes
     * `favoritedAt` but does not error. The path is FK-semantic to
     * `scan_nodes.path`; the route layer is responsible for confirming
     * the path exists in the live scan before calling.
     */
    set(path: string): Promise<void>;
    /** Drop the favorite row for `path`. Idempotent, no-op when absent. */
    unset(path: string): Promise<void>;
    /**
     * Load every favorited path as a `Set<string>` ready for `O(1)`
     * membership checks. Used by the BFF's `/api/nodes` decorator,
     * one query per request, no SQL JOIN against `scan_nodes`.
     */
    listPaths(): Promise<Set<string>>;
  };

  // --- activity namespace -------------------------------------------------
  /**
   * Runtime execution-stats checkpoint (`state_activity_stats` /
   * `state_activity_pairs`, `spec/db-schema.md` §state_activity_stats):
   * the persisted half of the BFF's in-memory accumulator
   * (`spec/provider-activity.md` §Execution stats). Rows are opaque to
   * the kernel, the BFF projects its state in and out; the port only
   * stores, loads, deletes and (via `history.migrateNodeFks`) migrates.
   */
  activity: {
    /** Every persisted node row + pair row (the boot hydration read). */
    loadAll(): Promise<{ nodes: IActivityStatsRow[]; pairs: IActivityPairRow[] }>;
    /** Insert-or-replace node rows (the debounced checkpoint write). */
    upsertNodes(rows: readonly IActivityStatsRow[]): Promise<void>;
    /** Insert-or-replace pair rows (same debounce). */
    upsertPairs(rows: readonly IActivityPairRow[]): Promise<void>;
    /**
     * Drop the node's row plus every pair row naming it on either side
     * (the Activity clear-all, `spec/provider-activity.md` §DELETE
     * /api/activity/node). Idempotent.
     */
    deleteNode(nodePath: string): Promise<void>;
  };

  // --- pluginKvs namespace ------------------------------------------------
  /**
   * Mode A plugin storage (`state_plugin_kvs`), the engine-level half
   * of the `KvStore` accessor specified in `spec/plugin-kv-api.md`.
   *
   * This namespace is NOT what a plugin calls. `ctx.store` is the
   * plugin-facing wrapper built by
   * `kernel/adapters/plugin-store.ts:makeKvStoreWrapper`; the wrapper
   * owns key validation, JSON encoding, size ceilings, the typed error
   * taxonomy and the `nodePath ↔ nodeId` sentinel, and delegates here
   * through a `pluginId`-bound port (`core/runtime/plugin-stores.ts`).
   * Everything below therefore speaks storage terms: encoded
   * `valueJson`, sentinel `nodeId` (`''` = global scope, never NULL).
   *
   * Every method takes a fully-qualified `pluginId`, which is what
   * makes cross-plugin reads structurally impossible rather than
   * merely discouraged.
   */
  pluginKvs: {
    /** One row, or `null` when absent. */
    get(scope: IPluginKvScope): Promise<IPluginKvRow | null>;
    /** Upsert one row against the `(pluginId, nodeId, key)` primary key. */
    set(row: IPluginKvRow): Promise<void>;
    /** Delete one row. `true` iff a row was removed. Idempotent. */
    delete(scope: IPluginKvScope): Promise<boolean>;
    /** One scope's rows, key ASC, optionally narrowed by key prefix. */
    list(query: IPluginKvListQuery): Promise<IPluginKvRow[]>;
    /**
     * Drop every row a plugin owns; returns the deleted count. Not
     * wired to a verb today (`sm plugins disable` keeps plugin
     * storage on purpose), reserved for the future
     * `sm plugins forget <id>`.
     */
    purgeByPlugin(pluginId: string): Promise<number>;
  };

  // --- history namespace -------------------------------------------------
  history: {
    /** List `state_executions` rows (paginated by filter). */
    list(filter: IListExecutionsFilter): Promise<ExecutionRecord[]>;
    /**
     * Distinct node paths holding at least one `state_executions` row
     * (any status). Feeds the activity summary's `runNodes` list
     * (`spec/provider-activity.md` §GET /api/activity/summary): the
     * boot-scoped counters reset on restart, the DB history does not,
     * so Activity visibility needs this persistent signal.
     */
    nodesWithRuns(): Promise<string[]>;
    /**
     * Append a single `state_executions` row (the table is append-only
     * apart from the targeted `deleteForNode` clear below). The
     * primitive history write the port previously lacked; `sm record`
     * transitions atomically through `jobs.recordTerminal`, while a
     * standalone in-process action with no job row uses this directly.
     */
    insertExecution(record: ExecutionRecord): Promise<void>;
    /**
     * Delete every `state_executions` row whose node list contains
     * `nodePath` (the same JSON1 containment the `list` filter applies,
     * so the delete removes exactly the rows a per-node listing shows).
     * Returns the deleted-row count. The single targeted history
     * delete: the Activity clear-all
     * (`spec/provider-activity.md` §DELETE /api/activity/node).
     */
    deleteForNode(nodePath: string): Promise<number>;
    /**
     * Aggregate counters / period buckets / top-nodes / error rates
     * over `state_executions`. Body matches the spec
     * `history-stats.schema.json` shape minus `range`/`elapsedMs`
     * (the verb fills those in around the call).
     */
    aggregateStats(
      range: IHistoryStatsRange,
      period: THistoryStatsPeriod,
      topN: number,
    ): Promise<
      Omit<HistoryStats, 'elapsedMs' | 'range'> & {
        rangeMs: { sinceMs: number | null; untilMs: number };
      }
    >;
  };

  // --- migrations namespace (sm db verb) --------------------------------
  migrations: {
    /** Enumerate kernel migration files bundled with this build. */
    discover(): IMigrationFile[];
    /**
     * Compute the apply / pending plan against the current `config_
     * schema_versions` ledger. Read-only; safe under `--dry-run`.
     */
    plan(files?: IMigrationFile[]): IMigrationPlan;
    /**
     * Apply pending migrations in order. Each runs inside its own
     * `BEGIN/COMMIT` (per `kernel/adapters/sqlite/migrations.ts`); a
     * partial failure rolls back to the prior state. Returns the
     * applied list + backup path (when `backup: true`).
     */
    apply(options?: IApplyOptions, files?: IMigrationFile[]): IApplyResult;
    /**
     * WAL-checkpoint + atomic file copy of the DB to `destPath`.
     * Caller composes the path. Returns the destination on success,
     * or `null` for in-memory DBs (no file to copy).
     */
    writeBackup(destPath: string): string | null;
    /**
     * Read `PRAGMA user_version` from the underlying DB. The migrations
     * runner keeps that pragma in sync with the latest applied kernel
     * migration, so this is the canonical "current schema version"
     * read for `sm version --json`'s `dbSchema` field. Returns `null`
     * on engine quirks (non-numeric / null pragma).
     */
    currentSchemaVersion(): number | null;
    /**
     * Run `PRAGMA quick_check` against the DB file (`sm doctor`'s
     * integrity probe). `ok: true` when SQLite reports the single `ok`
     * row; otherwise the first corruption line lands in `detail`.
     */
    quickCheck(): IQuickCheckResult;
  };

  // --- transactions ------------------------------------------------------
  /**
   * Open a transaction. The callback receives a transactional subset
   * of the port; the adapter commits on resolution and rolls back on
   * rejection. `sm orphans reconcile / undo-rename` and `sm enrich`
   * are the canonical consumers.
   */
  transaction<T>(fn: (tx: ITransactionalStorage) => Promise<T>): Promise<T>;
}

export type {
  IApplyOptions,
  IApplyResult,
  IBranchProjection,
  IBranchScope,
  IFindingRecord,
  IFindingResolutionIntent,
  IFindingSeverityCount,
  IFindingsListFilter,
  IFindingsWriteIntent,
  IHistoryStatsRange,
  IIssueIncidenceCount,
  IIssueRow,
  IJobClaim,
  IJobContentInput,
  IJobListFilter,
  IJobsIntegrityCounts,
  IJobSubmitRow,
  IListExecutionsFilter,
  ILiteNode,
  IMigrateNodeFksReport,
  IMigrationFile,
  IMigrationPlan,
  IMigrationRecord,
  INodeBundle,
  INodeCounts,
  INodeFilter,
  IPersistedContribution,
  IPersistOptions,
  IPruneResult,
  IQuickCheckResult,
  IStateEnrichmentRecord,
  IStateEnrichmentUpsert,
  ISummaryRecord,
  ISummaryWriteIntent,
  TFindingResolveOutcome,
  TFixerSubmitOutcome,
  THistoryStatsPeriod,
  TJobTransitionOutcome,
} from '../types/storage.js';
