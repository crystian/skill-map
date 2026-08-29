/**
 * Storage-port domain types, option bags and result shapes the
 * `StoragePort` namespaces consume / return. Live next to the port
 * (`kernel/ports/storage.ts`) so adapters and CLI consumers share a
 * single source of truth without depending on the SQLite adapter's
 * internal types.
 *
 * Naming bucket: category 4 (internal shapes) per `context/kernel.md` §Type
 * naming convention. Every name carries the `I*` prefix.
 */

import type {
  ExecutionStatus,
  Issue,
  JobExtensionKind,
  JobStatus,
  Link,
  Node,
  Severity,
} from '../types.js';

/**
 * Origin lane of a `state_findings` row (`spec/db-schema.md`
 * §state_findings). `extension` = one entry of a finder Analyzer's
 * validated `findings[]` array; `kernel` = a safety row the record path
 * synthesized from a probabilistic report's `safety` block under one of
 * the reserved type slugs.
 */
export type TFindingOrigin = 'extension' | 'kernel';

/**
 * The lifecycle STATE a finding moved into (`spec/db-schema.md`
 * §state_findings, "Finding lifecycle state"). `fixed` = resolved;
 * `human-decision` = a fixer proposed but the choice is the author's
 * (renamed from the earlier `declined`, which read as a dead-end when it is
 * the most action-demanding state).
 *
 * A lifecycle state, NOT a verdict: `fixed` means "resolved", not "verified
 * gone". It hides from the default `sm findings` view but the row persists
 * and stays re-checkable (only the finder re-judging the current body
 * deletes or reopens it). `human-decision` stays VISIBLE: its note is the
 * fixer's PROPOSAL, the author's TODO. `null` = open.
 */
export type TFindingResolution = 'fixed' | 'human-decision' | 'dismissed';

/**
 * WHO decided a `fixed` finding (`state_findings.resolution_actor`,
 * `spec/db-schema.md` §state_findings). One rule: **any user interaction
 * makes it `human`; only a fully autonomous fix with zero user interaction
 * is `fixer`.** So an unattended processing run that applies a clear-cut fix is
 * `fixer`; an interactive processing run where the operator approved the edit, chose
 * among options, or a `sm findings resolve` is `human`. `null` on a
 * `human-decision` (undecided) or open row.
 */
export type TResolutionActor = 'human' | 'fixer';

/**
 * Row-level filter for `port.scans.findNodes(...)` (driven by
 * `sm list`'s flags). All fields are optional, an empty filter
 * returns every node sorted by `path` asc.
 */
export interface INodeFilter {
  /** Restrict to a single node kind. Open string (matches `Node.kind`). */
  kind?: string;
  /**
   * When `true`, keep only nodes whose path is referenced by at least
   * one `scan_issues.nodeIds` array.
   */
  hasIssues?: boolean;
  /**
   * Sort column. The adapter validates against its own whitelist and
   * rejects anything else with an Error (the CLI's own usage-error
   * exit is the right place to surface a bad `--sort-by`; the port
   * defends in depth).
   */
  sortBy?: string;
  /** `'asc'` or `'desc'`. Defaults to the adapter's per-column convention. */
  sortDirection?: 'asc' | 'desc';
  /** Cap the result. Positive integer; absent → no limit. */
  limit?: number;
}

/**
 * Bundled fetch for `port.scans.findNode(path)`, one node and
 * everything `sm show <path>` displays alongside it. Every field is
 * computed from `scan_*` zone reads only; per-domain data (history,
 * jobs, plugin enrichments) ships through other namespaces.
 */
export interface INodeBundle {
  node: Node;
  linksOut: Link[];
  linksIn: Link[];
  issues: Issue[];
}

/**
 * A stored per-node summary row (`state_summaries`), as returned by
 * `port.summaries.forNode(nodeId)`. `report` is the parsed `summary_json`
 * (the validated summarizer report); `bodyHashAtGeneration` lets a reader
 * (`sm show`) flag the summary `(stale)` by comparing against the node's
 * current `scan_nodes.body_hash`.
 */
export interface ISummaryRecord {
  nodeId: string;
  kind: string;
  summarizerActionId: string;
  summarizerVersion: string;
  bodyHashAtGeneration: string;
  generatedAt: number;
  /** Recording agent's self-reported model; `null` when undeclared. */
  model: string | null;
  report: Record<string, unknown>;
}

/**
 * Write intent handed to `port.jobs.recordTerminal(execution, summary?)`
 * when the recorded Action's report schema is a per-node summary schema
 * (`summaryKindOfReportSchema`, see `kernel/jobs/summary-schema.ts`). Carries only the
 * caller-known fields; the adapter reads the target node's live `kind`
 * and `body_hash` from `scan_nodes` inside the record transaction (and
 * skips the upsert when the node is absent). `summaryJson` is the
 * serialized validated report.
 */
export interface ISummaryWriteIntent {
  summarizerActionId: string;
  summarizerVersion: string;
  generatedAt: number;
  /** Agent-self-reported `--model`; `null` when undeclared. */
  model: TReportedModel;
  summaryJson: string;
}

/**
 * One fresh `state_findings` row the record path composes BEFORE the
 * node-derived fields are known. `bodyHashAtGeneration` is stamped by the
 * adapter from the live `scan_nodes.body_hash` inside the record
 * transaction; `extensionId` / `extensionVersion` / `generatedAt` /
 * `jobId` travel on the enclosing `IFindingsWriteIntent`.
 */
export interface IFindingRowInput {
  origin: TFindingOrigin;
  type: string;
  severity: Severity;
  message: string;
  detail: string | null;
  confidence: number;
}

/** Recording agent's self-reported model id; `null` when undeclared. */
export type TReportedModel = string | null;

/**
 * Write intent handed to `port.jobs.recordTerminal(execution, summary?,
 * findings?)` when the recorded job is a probabilistic extension whose
 * `completed` report produces `state_findings` rows: the finder lane
 * (`origin: 'extension'`, Analyzers only) plus the kernel safety lane
 * (`origin: 'kernel'`, any probabilistic report whose `safety` block flags
 * trouble). The adapter DELETEs every existing row for
 * `(nodeId, extensionId)` (both origins) then inserts `rows`, in the SAME
 * transaction as the `state_executions` insert + job transition; an empty
 * `rows` array is a clean verdict that erases the prior judgment. The
 * whole write is skipped (previous rows kept) when the target node has
 * disappeared from `scan_nodes` (`spec/db-schema.md` §state_findings).
 */
export interface IFindingsWriteIntent {
  extensionId: string;
  extensionVersion: string;
  generatedAt: number;
  jobId: string | null;
  /**
   * Agent-self-reported `--model` of the recording callback, stamped
   * onto EVERY row of the intent (both lanes); `null` when undeclared.
   */
  model: TReportedModel;
  rows: IFindingRowInput[];
}

/**
 * A stored `state_findings` row as returned by `port.findings.list(...)`,
 * camelCase mirror of the SQL columns plus the derived `stale` boolean
 * (`bodyHashAtGeneration` differs from the node's live
 * `scan_nodes.body_hash`, or the node is gone from the scan entirely).
 */
export interface IFindingRecord {
  id: number;
  nodeId: string;
  extensionId: string;
  extensionVersion: string;
  origin: TFindingOrigin;
  type: string;
  severity: Severity;
  message: string;
  detail: string | null;
  confidence: number;
  /** Recording agent's self-reported model; `null` when undeclared. */
  model: string | null;
  /**
   * The lifecycle state this finding moved into; `null` (open) until a
   * fixer or the operator resolves it. `fixed` hides from the default
   * `sm findings` view (re-checkable, not deleted); `human-decision` stays
   * visible with the fixer's PROPOSAL (the author's TODO) in
   * `resolutionNote` (`spec/db-schema.md` §state_findings).
   */
  resolution: TFindingResolution | null;
  /**
   * WHO decided a `fixed` finding (`human` / `fixer`); `null` for a
   * `human-decision` (undecided) or open row (`spec/db-schema.md`
   * §state_findings).
   */
  resolutionActor: TResolutionActor | null;
  /** The one-line reason, verbatim (agent-supplied: sanitize at render). */
  resolutionNote: string | null;
  /**
   * The fixer's qualified extension id (agent-adjacent: sanitize at
   * render); `null` for a purely human resolution (`sm findings resolve`).
   */
  resolutionBy: string | null;
  resolutionAt: number | null;
  bodyHashAtGeneration: string;
  generatedAt: number;
  jobId: string | null;
  stale: boolean;
}

/**
 * Discriminated outcome of `port.findings.resolveByHuman(id, note, nowMs)`,
 * the operator marking a finding `fixed` themselves (`sm findings resolve`,
 * `spec/cli-contract.md`):
 *   - `resolved`, an OPEN or `human-decision` row moved to `fixed` /
 *     `human` (the updated `finding` rides along for the `--json` echo).
 *   - `already-fixed`, the row is already `fixed` (the verb exits 2).
 *   - `not-found`, no `state_findings` row carries that id (exit 5).
 */
export type TFindingResolveOutcome =
  | { kind: 'resolved'; finding: IFindingRecord }
  | { kind: 'already-fixed' }
  | { kind: 'not-found' };

/**
 * Outcome of `port.findings.dismissByHuman(id, note, nowMs)`, the
 * ROW-grain dismissal (`sm findings dismiss <id>`, the tray's X;
 * 2026-07-22): `dismissed` carries the updated row; `already-dismissed`
 * exits 2; `not-found` exits 5.
 */
export type TFindingRowDismissOutcome =
  | { kind: 'dismissed'; finding: IFindingRecord }
  | { kind: 'already-dismissed' }
  | { kind: 'not-found' };

/**
 * Outcome of `port.findings.reopen(id, nowMs)` (`sm findings reopen`):
 * `reopened` carries the updated row; `already-open` exits 2;
 * `not-found` exits 5.
 */
export type TFindingReopenOutcome =
  | { kind: 'reopened'; finding: IFindingRecord }
  | { kind: 'already-open' }
  | { kind: 'not-found' };

/**
 * One entry of a fixer report's `resolved[]`, narrowed from the
 * AJV-validated payload (`spec/job-lifecycle.md` §Findings injection for
 * fixers, "The resolution"): the `id` the fixer echoed back from the
 * injected findings section, the `state` it moved the finding into
 * (`fixed` = it edited the file to resolve it, `human-decision` = it did
 * not; the fix needs the author's choice and the `note` is the fixer's
 * PROPOSAL), the deciding actor `by` (`fixer` = zero user interaction,
 * `human` = any user interaction was involved), and its one-line `note`.
 *
 * `by` is stamped onto `resolution_actor` and is meaningful ONLY on a
 * `fixed` entry (`null` on a `human-decision` one, where the actor is
 * undecided).
 */
export interface IFindingResolutionEntry {
  id: number;
  state: TFindingResolution;
  by: TResolutionActor | null;
  note: string;
}

/**
 * Write intent handed to `port.jobs.recordTerminal(execution, summary,
 * findings, resolutions)` when the recorded job's extension is a FIXER (a
 * probabilistic Action declaring `precondition.analyzerIds`) and its
 * report validated. The adapter stamps each entry onto the finding its
 * `id` names, inside the SAME transaction as the execution insert + job
 * transition.
 *
 * Every entry is SKIPPED silently when its `id` no longer exists, when
 * the row's node is not the job's target node, or when the row's
 * `extension_id` is outside `analyzerIds`: a missing id is a benign race
 * (the finder re-ran between submit and record, so the resolution is
 * moot), and the node / analyzer guards are the defensive scope, a fixer
 * can NEVER stamp a finding outside its own (`spec/db-schema.md`
 * §state_findings).
 */
export interface IFindingResolutionIntent {
  /** The fixer's qualified extension id, stamped as `resolution_by`. */
  resolvedBy: string;
  /**
   * The fixer's declared `precondition.analyzerIds`: a finding is only
   * stampable when its `extension_id` matches one
   * (`matchesQualifiedExtensionFilter` semantics, qualified or bare).
   */
  analyzerIds: readonly string[];
  /** Stamped as `resolution_at` on every entry that lands. */
  resolvedAt: number;
  entries: readonly IFindingResolutionEntry[];
}

/**
 * Row-level filter for `port.findings.list(...)` (driven by
 * `sm findings`' flags and `sm show`'s per-node section). All fields
 * optional; an empty filter returns every non-stale row.
 */
export interface IFindingsListFilter {
  /** Restrict to rows whose `node_id` equals the path. */
  nodeId?: string;
  /**
   * Qualified (`<plugin>/<ext>`) or bare extension ids; a row matches
   * when its stored qualified `extension_id` matches any entry
   * (`matchesQualifiedExtensionFilter` semantics, mirroring
   * `sm check --analyzers`). Empty / absent = every extension.
   */
  extensionIds?: readonly string[];
  /** Restrict to rows whose `type` slug equals the value. */
  type?: string;
  /** MINIMUM severity: `warn` keeps `warn` + `error`, drops `info`. */
  minSeverity?: Severity;
  /** Keep rows whose `generated_at` >= the value (Unix ms). */
  sinceMs?: number;
  /** Keep rows whose `confidence` >= the value. */
  minConfidence?: number;
  /**
   * When `true`, stale rows are INCLUDED (each flagged via the derived
   * `stale` boolean). Default `false`: stale rows are excluded, matching
   * `sm findings`' default read (`spec/cli-contract.md` §sm findings).
   */
  includeStale?: boolean;
}

/**
 * A stored per-node enrichment state row (`state_enrichments`), as
 * returned by `port.enrichments.listStateForNode(nodeId)` /
 * `listStaleStateCandidates()`. `providerId` carries the enriching
 * Action's qualified id (e.g. `github/enrichment`); `data` is the
 * parsed `data_json` (the validated enrichment report). Model A of the
 * enrichment split: Model B (Extractor outputs) lives in
 * `node_enrichments` behind the transactional-only `upsertMany`, do not
 * conflate the two.
 */
export interface IStateEnrichmentRecord {
  nodeId: string;
  providerId: string;
  data: Record<string, unknown>;
  verified: boolean | null;
  fetchedAt: number;
  staleAfter: number | null;
}

/**
 * Upsert payload for one `state_enrichments` row
 * (`port.enrichments.upsertState` / the transactional
 * `tx.enrichments.upsertState`). `dataJson` is the already-serialized
 * validated report; `verified` is lifted from the report by the caller
 * (`null` when the report carries no boolean verdict); `staleAfter` is
 * `null` in v1 (no declared refresh policy, body-hash drift is the only
 * staleness signal, `spec/db-schema.md` §state_enrichments).
 */
export interface IStateEnrichmentUpsert {
  nodeId: string;
  providerId: string;
  dataJson: string;
  verified: boolean | null;
  fetchedAt: number;
  staleAfter: number | null;
}

/**
 * Output of `port.scans.countRows()`. Used by `sm scan` to decide
 * whether the persist would wipe a populated DB (the "refusing to
 * wipe" guard) and by `sm db status` for the human summary.
 */
export interface INodeCounts {
  nodes: number;
  links: number;
  issues: number;
}

/**
 * Lightweight per-node projection for the BFF `/api/folders` endpoint.
 * Carries only the cheap scalar columns the SPA folders tree needs
 * (`path`, `kind`, the two link counts, total tokens, mtime), never the
 * full `Node` (no frontmatter, body, links, signals, contributions).
 * Pushed straight from `scan_nodes` so a 50K corpus does not hydrate the
 * whole `ScanResult` into memory.
 */
export interface ILiteNode {
  path: string;
  kind: string;
  linksInCount: number;
  linksOutCount: number;
  tokensTotal: number | null;
  modifiedAtMs: number | null;
  /**
   * The persisted `scan_nodes.sidecar_status`, null when there is no
   * parseable sidecar. Lets the folders rail flag staleness corpus-wide,
   * sibling of the issue counts.
   */
  sidecarStatus: string | null;
}

/**
 * Per-node issue incidence counts by severity, output of
 * `port.scans.issueCountsByPath()`. One entry per node that has at least
 * one error- or warn-severity issue whose `nodeIds` array includes the
 * path; nodes with no error / warn issues are absent from the map. The
 * `info` severity is intentionally ignored (the SPA badges only error /
 * warn). Counts are issue incidence (one per matching issue), the same
 * semantics the UI's `countIssuesByPath` rolls up per node.
 */
export interface IIssueIncidenceCount {
  error: number;
  warn: number;
}

/**
 * Per-node count of UNRESOLVED, non-stale probabilistic findings by
 * severity, output of `port.findings.countUnresolvedByPath(paths)`.
 * "Unresolved" = NOT `fixed` (so `resolution IS NULL` open rows AND
 * `human-decision` proposals awaiting the author both count), non-stale,
 * matching the `sm findings` default view (`findings-view.ts`
 * `isFindingShown`) so the card chip and the inspector agree
 * (`spec/view-slots.md` §card.footer.right). Only `warn` / `error`
 * are tallied (`info` is not surfaced on the card, mirroring
 * `IIssueIncidenceCount`); nodes with no such finding are
 * absent from the map (the caller defaults them to `{ warn: 0, error:
 * 0 }`). Backs the BFF read-time fold that sums a node's findings into
 * `core/issue-counter`'s aggregate severity chips.
 */
export interface IFindingSeverityCount {
  warn: number;
  error: number;
}

/**
 * Input of `port.scans.loadBranch(...)`: the map scope overrides
 * (`spec/cli-contract.md` §Map scope overrides). `include` / `exclude`
 * carry the non-root override paths; the root override rides
 * `rootExcluded` (the path `''` never appears in the arrays). A node's
 * effective state is the override of its NEAREST ancestor (self
 * included); no matching override = included.
 */
export interface IBranchScope {
  include: string[];
  exclude: string[];
  rootExcluded: boolean;
}

/**
 * Output of `port.scans.loadBranch(...)`, the override-scoped + capped
 * graph projection the BFF `/api/branch` endpoint returns. `nodes` is
 * the first `LIMIT` nodes of the scoped set (nearest-ancestor override
 * evaluation over `IBranchScope`), ordered by the SENIORITY FILL rule
 * (spec §Map scope overrides): root excluded with two or more includes
 * ranks rows by the first include (in `IBranchScope.include` order)
 * that admits them, then path; every other shape is plain stable path
 * order; `links` carries only edges whose source AND RESOLVED target
 * (`resolvedTarget`, else the raw `target` for path-style links) are
 * both in that node set, so a trigger-style `invokes` / `mentions` edge
 * that resolves to a rendered node is kept and a genuinely-broken link
 * is dropped; `issues` carries only those whose `nodeIds` intersect it.
 * `total` is the count of scoped nodes BEFORE the cap (so the route can
 * compute `truncated`), post-override by construction. `paths` echoes
 * the (de-duped, request-ordered) include overrides; the whole-corpus
 * case echoes `[]`.
 */
export interface IBranchProjection {
  nodes: Node[];
  links: Link[];
  issues: Issue[];
  total: number;
  paths: string[];
}

/**
 * Lightweight option bag for `port.scans.persist`. Mirrors the optional
 * inputs of the `persistScanResult(db, result, inputs)` free function
 * (`IPersistScanInputs` in `kernel/adapters/sqlite/scan-persistence.ts`),
 * so the adapter implementation is a one-line delegation; the named-bag
 * shape lets new optional inputs land without breaking callers.
 */
export interface IPersistOptions {
  renameOps?: import('../orchestrator.js').RenameOp[];
  extractorRuns?: import('../orchestrator.js').IExtractorRunRecord[];
  enrichments?: import('../orchestrator.js').IEnrichmentRecord[];
  contributions?: import('../adapters/sqlite/contributions.js').IContributionRecord[];
  /**
   * "off-shape visible" follow-up, per-scan records of view
   * contributions REJECTED at emit time (undeclared ref, or payload
   * failed the slot's AJV schema). Plain REPLACE-ALL into
   * `scan_contribution_errors` (delete all, then insert), the same
   * posture as `scan_issues`. Empty / absent wipes the table (a clean
   * scan clears any stale rows). Surfaced by `sm plugins doctor`.
   */
  contributionErrors?: import('../adapters/sqlite/contributions.js').IContributionErrorRecord[];
  /**
   * Per-op confidence-attribution audit trail for `scan_link_scores`.
   * One entry per attributed `ctx.adjustConfidence(link, op)` call a
   * `score`-phase analyzer buffered this scan; the orchestrator already
   * folded them into `link.confidence`, so these rows are the attribution
   * (which plugin / extension / op moved a given link, plus the folded
   * `result_confidence`). Plain REPLACE-ALL into `scan_link_scores`
   * (delete all, then insert), the same posture as `scan_issues`. Empty /
   * absent wipes the table (a scan whose scorers touched nothing clears
   * any stale rows).
   */
  linkScores?: import('../adapters/sqlite/link-scores.js').IConfidenceAdjustment[];
  /**
   * Phase 3 / View contribution system, active runtime catalog of
   * registered view contributions, keyed by qualified id
   * `<pluginId>/<extensionId>/<contributionId>`. Passed to the
   * `scan_contributions` upsert so the catalog sweep can drop rows
   * belonging to plugins / extensions that are no longer in the
   * catalog (uninstalled plugins, disabled plugins, removed
   * contributions). Empty / absent set = no catalog sweep (legacy
   * behaviour, leaves disabled-plugin rows stale per design F24
   * pre-fix).
   */
  registeredContributionKeys?: ReadonlySet<string>;
  /**
   * Phase 3 / View contribution system, set of `(plugin, extension,
   * node)` tuples where the extension actually RAN against that node
   * in this scan. Format: `<pluginId>/<extensionId>/<nodePath>` (no
   * contribution-id segment, the sweep operates at the (plugin,
   * extension, node) level and inspects the buffer to decide which
   * contribution-ids survive).
   *
   * Membership rules:
   *   - Extractor + cache miss: tuple INCLUDED (extract() ran).
   *   - Extractor + cache hit: tuple OMITTED (extract() skipped, prior
   *     rows must be preserved).
   *   - Rule, every node in `ctx.nodes`: tuple INCLUDED (rules always
   *     run and see the full graph).
   *
   * Drives the per-tuple sweep documented in `spec/architecture.md`
   * §View contribution system → Persistence (sweep #3): rows whose
   * `(plugin_id, extension_id, node_path)` is in this set but whose
   * `(plugin_id, extension_id, node_path, contribution_id)` is NOT in
   * the buffer get DELETEd before the upsert. Catches the "extractor
   * used to emit, now does not" case (e.g. body change removes the
   * trigger). Empty / absent set = no per-tuple sweep (legacy
   * callers preserve the pre-fix behaviour where stale rows linger).
   */
  freshlyRunTuples?: ReadonlySet<string>;
}

/**
 * Issue row as the storage layer sees it, paired with its DB-assigned
 * id so `port.issues.deleteById(id)` can target it inside a
 * transaction. The runtime `Issue` shape (per `issue.schema.json`) does
 * not carry `id` because the spec models issues as ephemeral findings
 * scoped to a scan; the DB does need the synthetic id to update / delete
 * a single row.
 */
export interface IIssueRow {
  id: number;
  issue: Issue;
}

/**
 * Filter + pagination shape for `port.issues.list(...)`, driven by the
 * BFF's `/api/issues` route. Every field is optional, an empty filter
 * returns every issue ordered by `id` ASC (insertion order, stable
 * across pages so `offset` / `limit` paging is deterministic).
 *
 * The three semantic filters mirror `/api/issues`'s query params:
 *
 *   - `severities`, narrowed list of `Severity` values. Empty / absent
 *     matches every severity.
 *   - `analyzerIds`, accepts qualified (`<plugin>/<id>`) AND short
 *     (`<id>`) forms; the suffix-match semantics live in
 *     `matchesAnalyzerFilter`. Each entry generates two SQL clauses
 *     (`= ?` and `LIKE '%/' || ?`) ORed together so the filter remains
 *     a single SQL pass with parameterised values, no string
 *     interpolation. Empty / absent matches every analyzer id.
 *   - `nodePath`, keeps issues whose `nodeIds` JSON array contains the
 *     given path (correlated EXISTS over `json_each`). Absent / null
 *     skips the filter.
 *   - `nodePaths`, multi-node variant of `nodePath`: keeps issues
 *     whose `nodeIds` JSON array intersects the given set (correlated
 *     EXISTS over `json_each` with an `IN(...)` predicate). Used by
 *     the linked-nodes panel to fetch issues for the focused node +
 *     its neighbours in one round-trip instead of pulling the whole
 *     table. Empty array matches zero rows; absent skips the filter.
 *     Combines with `nodePath` (intersection); when both are set, the
 *     `nodePath` predicate is AND-ed with `nodePaths`.
 *
 * Pagination is mandatory; the route layer fills the defaults via
 * `parsePagination`. `total` in `IIssueListResult` reports the total
 * MATCHING the filters (not just the page slice) so the SPA can
 * surface a correct page-count without a second round-trip.
 */
export interface IIssueListFilter {
  /**
   * Severity tokens to match. Typed as open `string` (not the
   * `Severity` union) so an unknown value from a URL query string
   * surfaces as a zero-match SQL query, not a kernel validation
   * error. The adapter parameterises each entry into the `IN(...)`
   * clause; unrecognised severities simply match no rows.
   */
  severities?: readonly string[];
  analyzerIds?: readonly string[];
  nodePath?: string | null;
  nodePaths?: readonly string[];
  offset: number;
  limit: number;
}

/**
 * Output of `port.issues.list(...)`. `items` is the page slice (length
 * ≤ `filter.limit`); `total` is the count of rows matching the filters
 * before pagination was applied.
 */
export interface IIssueListResult {
  items: Issue[];
  total: number;
}

// --- jobs namespace --------------------------------------------------------

/**
 * Output of `port.jobs.claim(...)`, the identity a runner needs after an
 * atomic claim (spec/job-lifecycle.md §Atomic claim). `contentHash` lets
 * the caller fetch the rendered content; `nonce` is the sole credential a
 * later `sm record` presents. `null` from `claim` means the queue was
 * empty (or nothing matched the filter).
 */
export interface IJobClaim {
  id: string;
  nonce: string;
  contentHash: string;
}

/**
 * Discriminated outcome of the two operator-driven terminal transitions,
 * `port.jobs.cancel(id, nowMs)` and `port.jobs.fail(id, nowMs)`. Shared
 * because both share the same guard shape:
 *   - `cancelled`, a `queued` / `running` job was moved to the terminal
 *     `cancelled` state (returned only by `cancel`).
 *   - `failed`, a `queued` / `running` job was moved to `failed` /
 *     `user-failed` (returned only by `fail`).
 *   - `already-terminal`, the job is already `completed` / `failed` /
 *     `cancelled` (spec rejects the re-transition with exit 2).
 *   - `not-found`, no `state_jobs` row carries that id (exit 5).
 */
export type TJobTransitionOutcome =
  | 'cancelled'
  | 'failed'
  | 'already-terminal'
  | 'not-found';

/** Output of `port.jobs.pruneTerminal` / `listTerminalCandidates`. */
export interface IPruneResult {
  /** How many `state_jobs` rows were deleted (or would be, in dry-run). */
  deletedCount: number;
  /**
   * How many orphaned `state_job_contents` rows were collected in the
   * same transaction (content blobs referenced by zero surviving
   * `state_jobs` rows). Always `0` for the `listTerminalCandidates`
   * dry-run preview; the live `pruneTerminal` returns the real count.
   */
  prunedContents: number;
}

/** Output of `port.jobs.integrityCounts` (the `sm doctor` job checks). */
export interface IJobsIntegrityCounts {
  /**
   * `state_jobs` rows whose `content_hash` has no `state_job_contents`
   * row. DB-corruption signal (`job-file-missing` at claim time);
   * healthy DBs report `0`.
   */
  missingContent: number;
  /**
   * `state_job_contents` rows referenced by zero `state_jobs` rows.
   * Retention leftovers; `sm jobs prune` collects them.
   */
  contentStragglers: number;
}

/** Output of `port.migrations.quickCheck` (the `sm doctor` DB check). */
export interface IQuickCheckResult {
  /** True when `PRAGMA quick_check` returned the single row `ok`. */
  ok: boolean;
  /** First reported corruption line when not ok, else `null`. */
  detail: string | null;
}

/**
 * Content row inserted into `state_job_contents` at submit time via
 * `INSERT OR IGNORE`. Keyed by `contentHash`; a second submit of the same
 * hash is a no-op (the blob is stored once, refcounted by reference).
 */
export interface IJobContentInput {
  contentHash: string;
  content: string;
  createdAt: number;
}

/**
 * The `state_jobs` row values a submit provides. Lifecycle-null columns
 * (`failureReason` / `runner` / `claimedAt` / `finishedAt` / `expiresAt`)
 * are filled by the adapter; the caller supplies only the frozen-at-submit
 * fields. `status` is `queued` for every real submit but stays typed for
 * reuse.
 */
export interface IJobSubmitRow {
  id: string;
  extensionId: string;
  extensionVersion: string;
  /**
   * Extension kind resolved by the submit target resolution and frozen
   * onto the row (`spec/db-schema.md` §state_jobs); `sm record` routes
   * on it instead of re-resolving the extension by id.
   */
  extensionKind: JobExtensionKind;
  /**
   * Per-job auto-fix opt-in, frozen at submit (`state_jobs.auto_fix`).
   * Optional like `submittedBy`: the column carries a SQL `DEFAULT 0`, so a
   * caller that omits it lands `false`. Only ever `true` on a finder submit
   * flagged `--auto-fix` (`spec/job-lifecycle.md` §Auto-fix chain (per-job)).
   */
  autoFix?: boolean;
  /**
   * Finding-subset targeting for FIXER jobs, frozen at submit
   * (`spec/job-lifecycle.md` §Findings injection for fixers ·
   * Finding-subset targeting): the `state_findings` ids this job
   * resolves. Absent/undefined = whole-node targeting (the column
   * stores NULL). Meaningless on non-fixer jobs.
   */
  findingIds?: readonly number[];
  nodeId: string;
  contentHash: string;
  nonce: string;
  priority: number;
  status: JobStatus;
  /** Optional operator-armed TTL; `null` = never expires (the default). */
  ttlSeconds: number | null;
  createdAt: number;
  submittedBy?: string | null;
}

/**
 * Outcome of `port.jobs.submitFixer(...)`, the atomic fixer supersede submit
 * (`spec/job-lifecycle.md` §Findings injection for fixers · Supersede). A
 * fixer submit that finds an ACTIVE job for the same `(extensionId, nodeId)`
 * pair resolves the collision in ONE transaction:
 *   - `created`, the new queued job landed; `supersededIds` are the stale
 *     queued siblings (a DIFFERENT `contentHash`: the finding set or the body
 *     changed since they were queued) cancelled in the SAME transaction
 *     (empty when there was nothing to supersede).
 *   - `duplicate`, an IDENTICAL queued request already exists (same
 *     `contentHash`); nothing was written, `existingId` names it (exit 3).
 *   - `running-conflict`, a RUNNING job holds the pair (an agent claimed it);
 *     it is never superseded, nothing was written, `runningId` names it
 *     (exit 3). Supersede applies to fixer submits only; non-fixer jobs keep
 *     the plain duplicate detection on `submit(...)`.
 */
export type TFixerSubmitOutcome =
  | { outcome: 'created'; jobId: string; supersededIds: string[] }
  | { outcome: 'duplicate'; existingId: string }
  | { outcome: 'running-conflict'; runningId: string };

/**
 * Filter for `port.jobs.list(...)` (drives `sm jobs list`). All optional;
 * an empty filter returns every job, newest first. `extensionId` matches
 * the stored (qualified) id exactly OR by bare-id suffix, mirroring the
 * analyzer-filter semantics so `--extension skill-summarizer` finds
 * `core/skill-summarizer`.
 */
export interface IJobListFilter {
  status?: JobStatus;
  extensionId?: string;
  nodeId?: string;
}

// --- history namespace -----------------------------------------------------

/** Filter shape for `port.history.list`. All fields optional. */
export interface IListExecutionsFilter {
  /** Restrict to executions whose `nodeIds` array contains this path. */
  nodePath?: string;
  /** Exact match on `extension_id`. */
  extensionId?: string;
  /** Subset of {`completed`,`failed`,`cancelled`}. */
  statuses?: ExecutionStatus[];
  /** Lower bound (inclusive) on `started_at`. Unix ms. */
  sinceMs?: number;
  /** Upper bound (exclusive) on `started_at`. Unix ms. */
  untilMs?: number;
  /** Cap result count. No default. */
  limit?: number;
}

/** Window shape for `port.history.aggregateStats`. */
export interface IHistoryStatsRange {
  /** Inclusive lower bound. `null` = all-time. */
  sinceMs: number | null;
  /** Exclusive upper bound. */
  untilMs: number;
}

/** Period bucket granularity for `port.history.aggregateStats`. */
export type THistoryStatsPeriod = 'day' | 'week' | 'month';

/**
 * Output of `port.transaction(tx => tx.history.migrateNodeFks(from, to))`.
 * Lists how many rows in each `state_*` table were repointed plus any
 * composite-PK collisions that forced a drop instead of an update.
 */
/**
 * One entry of a node's recent-activity ring as persisted in
 * `state_activity_stats.recent_json` (`spec/db-schema.md`
 * §state_activity_stats). The BFF accumulator owns the shape and its
 * caps; the kernel stores it opaquely, so `kind` stays a plain string.
 */
export interface IActivityRecentRow {
  at: number;
  owner?: string;
  detail?: string;
  caller?: string;
  target?: string;
  kind?: string;
}

/** One `state_activity_stats` row, JSON columns already decoded. */
export interface IActivityStatsRow {
  nodePath: string;
  count: number;
  firstSeenAt: number;
  lastStartAt: number;
  lastOwner: string | null;
  owners: readonly string[];
  recent: readonly IActivityRecentRow[];
  toolUses: number;
  tokens: number;
  summarizedRuns: number;
}

/** One `state_activity_pairs` row (spec §state_activity_pairs). */
export interface IActivityPairRow {
  parent: string;
  childNodePath: string;
  count: number;
  lastStartAt: number;
}

export interface IMigrateNodeFksReport {
  jobs: number;
  executions: number;
  summaries: number;
  findings: number;
  enrichments: number;
  pluginKvs: number;
  nodeFavorites: number;
  /** `state_activity_stats` rows moved (0 or 1). */
  activityStats: number;
  /** `state_activity_pairs` rows repointed (either side). */
  activityPairs: number;
  /**
   * Collisions encountered when migrating any of the keyed-by-node
   * `state_*` tables because a row already existed at the destination
   * PK. The pre-existing rows are preserved, the migrating rows are
   * dropped (deleted from `fromPath` without a corresponding INSERT).
   * One entry per dropped row, with the affected PK fields included
   * for diagnostic output. `state_node_favorites` has no composite key
   * so its `keys` is the empty object.
   */
  collisions: Array<{
    table:
      | 'state_summaries'
      | 'state_enrichments'
      | 'state_plugin_kvs'
      | 'state_node_favorites'
      | 'state_activity_stats'
      | 'state_activity_pairs';
    fromPath: string;
    toPath: string;
    keys: Record<string, string>;
  }>;
}

// --- migrations namespace --------------------------------------------------

/** Discovered kernel migration file (one of `NNN_snake_case.sql`). */
export interface IMigrationFile {
  version: number;
  description: string;
  filePath: string;
}

/** A row from the `config_schema_versions` ledger for the kernel scope. */
export interface IMigrationRecord {
  scope: string;
  ownerId: string;
  version: number;
  description: string;
  appliedAt: number;
}

/** `port.migrations.plan` output: applied vs pending. */
export interface IMigrationPlan {
  applied: IMigrationRecord[];
  pending: IMigrationFile[];
}

/** Apply-time options for `port.migrations.apply`. */
export interface IApplyOptions {
  backup?: boolean;
  dryRun?: boolean;
  to?: number;
}

/** Result of `port.migrations.apply`. */
export interface IApplyResult {
  applied: IMigrationFile[];
  backupPath: string | null;
}

// --- contributions namespace ----------------------------------------------

/**
 * Single contribution row as returned to callers of the
 * `contributions` namespace on `StoragePort`. The payload is
 * `unknown` because the slot space is open at the type layer (catalog
 * evolution is a kernel + spec concern); narrow at the call site by
 * reading `slot`.
 *
 * Lives next to the port (not under `adapters/sqlite/`) so non-SQLite
 * implementations of `StoragePort` (in-memory test harness, future
 * Postgres adapter) can satisfy the port contract without importing
 * from the SQLite adapter. The SQLite adapter re-exports this type
 * for backwards compatibility with callers that still import from
 * the adapter path.
 */
export interface IPersistedContribution {
  pluginId: string;
  extensionId: string;
  nodePath: string;
  contributionId: string;
  slot: string;
  payload: unknown;
  emittedAt: number;
}
