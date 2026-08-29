/**
 * Typed Kysely schema for the kernel database. Mirrors `spec/db-schema.md`
 * at the TypeScript level, the `Database` interface below is what
 * downstream repositories consume via `Kysely<Database>`.
 *
 * **camelCase on TypeScript, snake_case on SQL.** Kysely's CamelCasePlugin
 * (wired in SqliteStorageAdapter) bridges the two: the interfaces here
 * use camelCase field names, and the plugin rewrites them to snake_case
 * on the way out to SQL. The migrations in `src/migrations/` use
 * snake_case (spec-authoritative).
 *
 * **Nullable columns** use `| null` rather than optional `?`: the column
 * exists in every row, its value is sometimes SQL NULL.
 *
 * **`Generated<T>`** marks columns the database fills (autoincrement
 * `INTEGER PRIMARY KEY` or DEFAULT-valued columns).
 */

import type { Generated } from 'kysely';

import type { Severity } from '../../types.js';

// --- Enum unions mirroring spec CHECK constraints --------------------------

/**
 * SQLite-side kind type. Open `string` to mirror `Node.kind` (open by
 * design, Providers may declare their own kinds). The `kernel/types.ts`
 * `NodeKind` alias still exists for code that intentionally narrows on
 * the built-in Claude Provider catalog (`skill` / `agent` / `command` /
 * `hook` / `note`); use that there. For everything else, column types,
 * loaders, persisters, `TNodeKind = string` is the right contract.
 */
export type TNodeKind = string;
export type TStability = 'experimental' | 'stable' | 'deprecated';

/**
 * Drift status of a node's co-located `.sm` sidecar (Step 9.6.2).
 *
 *   - `fresh`, both `for.bodyHash` and `for.frontmatterHash` match the
 *     current node hashes; the sidecar is up to date.
 *   - `stale-body`, `for.bodyHash` is outdated; the body changed since
 *     the last bump.
 *   - `stale-frontmatter`, `for.frontmatterHash` is outdated; the
 *     frontmatter changed since the last bump.
 *   - `stale-both`, both hashes are outdated.
 *
 * NULL on `scan_nodes.sidecar_status` when no sidecar accompanies the
 * node.
 */
export type TSidecarStatus = 'fresh' | 'stale-body' | 'stale-frontmatter' | 'stale-both';

export type TLinkKind = 'invokes' | 'references' | 'mentions' | 'points';
/**
 * Migrated 2026-05-18: confidence stored as REAL `[0..1]`. The named
 * tiers `'high' | 'medium' | 'low'` are exposed at the domain layer
 * via `ConfidenceTier` constants (`0.9`, `0.6`, `0.3`); the SQL
 * column is range-checked, not enum-checked.
 */
export type TConfidence = number;

// Alias the domain `Severity` so the DB and runtime stay in lock-step:
// today the unions are identical, and any future change to the domain
// type propagates here without manual sync. Distinct names are preserved
// to keep call-site intent visible (`TIssueSeverity` reads as "the
// severity stored in `scan_issues.severity`").
export type TIssueSeverity = Severity;

export type TJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type TJobFailureReason =
  | 'runner-error'
  | 'report-invalid'
  | 'timeout'
  | 'abandoned'
  | 'job-file-missing'
  | 'user-failed';
export type TJobRunner = 'agent' | 'in-process';
/**
 * Extension kind frozen on `state_jobs.extension_kind` at submit time
 * (CHECK in (`action`, `analyzer`)); `sm record` routes on it. Mirrors
 * the domain `JobExtensionKind`.
 */
export type TJobExtensionKind = 'action' | 'analyzer';

export type TExecutionKind = 'action';
export type TExecutionStatus = 'completed' | 'failed' | 'cancelled';

/**
 * Migration-ledger scope. `kernel` is the only value: plugins do not own
 * tables in the project database, so nothing else migrates. The column
 * (and the pair with `owner_id`) is kept so the ledger's shape can carry
 * a second owner later without a PK change.
 */
export type TSchemaVersionScope = 'kernel';

// --- Scan zone -------------------------------------------------------------

export interface IScanNodesTable {
  path: string;
  kind: TNodeKind;
  provider: string;
  title: string | null;
  description: string | null;
  stability: TStability | null;
  version: number | null;
  /**
   * Step 9.6.2, sidecar denormalisation. `sidecarPresent` is a SQLite
   * INTEGER (0 / 1) that bridges to a runtime boolean; `sidecarStatus`
   * carries the drift state when present (NULL when absent);
   * `annotationsJson` is the JSON-encoded `annotations:` block from the
   * parsed sidecar (NULL when absent or empty).
   *
   * R15 closure (2026-05-07), `sidecarRootJson` is the JSON-encoded
   * full parsed YAML root (the entire `.sm` payload). Sibling to
   * `annotationsJson` per Decision R15 option (b) (additive column,
   * no rewrite of the existing read path); duplicates the
   * `annotations:` sub-block by design so existing
   * `annotationsJson` consumers keep working. NULL when no sidecar is
   * present, or when the sidecar failed to parse / validate.
   */
  sidecarPresent: Generated<number>;
  sidecarStatus: TSidecarStatus | null;
  annotationsJson: string | null;
  sidecarRootJson: string | null;
  frontmatterJson: string;
  bodyHash: string;
  frontmatterHash: string;
  bytesFrontmatter: number;
  bytesBody: number;
  bytesTotal: number;
  tokensFrontmatter: number | null;
  tokensBody: number | null;
  tokensTotal: number | null;
  linksOutCount: Generated<number>;
  linksInCount: Generated<number>;
  externalRefsCount: Generated<number>;
  /**
   * JSON array of `IExternalRef` objects (every http(s) URL the body
   * references, in extractor-order, deduped by normalised URL).
   * NULL / unset when the body has no external URLs. Populated by
   * `recomputeExternalRefsCount` alongside the count, persisted by
   * `nodeToRow`, and read by `rowToNode`.
   */
  externalRefsJson: string | null;
  scannedAt: number;
  /**
   * File modification time (`mtime`) in Unix ms, captured at scan time
   * from the walker's `lstat`. NULL for virtual / derived nodes (no
   * backing file). Written by `nodeToRow`, read by `rowToNode`. Maps to
   * the `modified_at_ms` column via Kysely's CamelCasePlugin (same
   * bridge as `bytesTotal` / `scannedAt`).
   */
  modifiedAtMs: number | null;
  /**
   * Virtual / derived node identity. `virtual` is a SQLite INTEGER (0 / 1)
   * bridging to `Node.virtual`: 1 for a synthetic node with no backing file
   * (e.g. `mcp://<server>` materialised by `core/mcp-tools`). `derivedFromJson`
   * is the JSON-encoded source-path array (`Node.derivedFrom`), NULL for
   * non-virtual nodes. Round-tripped by `nodeToRow` / `rowToNode` so a
   * DB-loaded prior can carry a virtual node forward across a cached scan.
   */
  virtual: Generated<number>;
  derivedFromJson: string | null;
}

export interface IScanLinksTable {
  id: Generated<number>;
  sourcePath: string;
  targetPath: string;
  kind: TLinkKind;
  confidence: TConfidence;
  sourcesJson: string;
  originalTrigger: string | null;
  normalizedTrigger: string | null;
  locationLine: number | null;
  locationColumn: number | null;
  locationOffset: number | null;
  /**
   * JSON array of `LinkOccurrence` objects (every syntactic site in
   * the source body that contributed to this edge). NULL when the
   * link has no body-level evidence. Populated by extractors at emit
   * time and accumulated by `dedupeLinks` on merge. Read by
   * `core/reference-redundant` and surfaced verbatim through
   * the BFF `/api/links` envelope so the UI can list per-row sites.
   */
  occurrencesJson: string | null;
  /**
   * Node path the link resolved to, per the post-walk lift transform.
   * NULL when the link is unresolved (broken). Equal to `target_path`
   * for path-style links; differs for trigger-style links (the
   * authored trigger sits in `target_path`, the resolved node path
   * sits here). Indexed by `ix_scan_links_resolved_target` so the
   * BFF can answer "incoming edges that reach this node by name" in
   * sub-millisecond.
   */
  resolvedTarget: string | null;
  raw: string | null;
}

export interface IScanIssuesTable {
  id: Generated<number>;
  analyzerId: string;
  severity: TIssueSeverity;
  nodeIdsJson: string;
  linkIndicesJson: string | null;
  message: string;
  detail: string | null;
  fixJson: string | null;
  dataJson: string | null;
}

export interface IScanMetaTable {
  id: number;
  rootsJson: string;
  scannedAt: number;
  scannedByName: string;
  scannedByVersion: string;
  scannedBySpecVersion: string;
  providersJson: string;
  statsFilesWalked: number;
  statsFilesSkipped: number;
  statsDurationMs: number;
  /**
   * Scan-ceiling vs render-cap envelope (see `spec/cli-contract.md`
   * §Scan). `scanCeiling` is the effective WALK-INTAKE ceiling
   * (`scan.maxScan` setting or `--max-scan <N>` override) that produced
   * this scan; the walker walks + validates the full corpus up to it.
   * `scanTruncated` is 1 when the walker reached the ceiling and dropped
   * files, 0 otherwise (DEFAULT 0 so synthetic / legacy writes stay
   * valid). `maxRenderNodes` is the effective MAP RENDER cap
   * (`scan.maxNodes` setting or `--max-nodes <N>` override): pure
   * metadata, it does NOT bound the walk, only the graph projection.
   */
  scanCeiling: number;
  scanTruncated: Generated<number>;
  maxRenderNodes: number;
  /**
   * File-size skip envelope (see `scan.maxFileSizeBytes`).
   * `filesOversized` mirrors `stats.filesOversized` (DEFAULT 0 so
   * synthetic / legacy writes stay valid); `oversizedFilesJson` is the
   * JSON-encoded `OversizedFile[]` the CLI / serve terminal warns on and
   * the UI banner lists. NULL when no file was skipped.
   */
  filesOversized: Generated<number>;
  oversizedFilesJson: string | null;
  /**
   * Resolved offline tokenizer (encoder) that produced this scan's
   * per-node token counts (see `project-config.schema.json` §tokenizer,
   * closed enum `cl100k_base` / `o200k_base`). Mirrors
   * `ScanResult.tokenizer`. NULL on a pre-feature DB / never-tokenized
   * scan; the incremental path reads it back and treats a NULL or
   * mismatching value as an encoder change that forces a token recompute.
   */
  tokenizer: string | null;
  /**
   * Active provider LENS that produced this scan. Mirrors
   * `ScanResult.activeProvider`. The lens decides classification and
   * gates provider-specific extractors, so a node cached under a
   * different lens is stale; the incremental path reads this back and
   * treats a NULL or mismatching value as a lens change that forces a
   * re-classification. NULL on a pre-feature DB / a scan with no
   * resolvable lens.
   */
  activeProvider: string | null;
  /**
   * Schema-drift fingerprint (see `spec/db-schema.md` §Schema drift
   * (pre-1.0)). sha256 (hex) of the concatenated migration DDL the
   * schema was built from, written by `metaToRow` at persist time. NULL
   * on a DB created by a pre-fingerprint CLI; a NULL or mismatching
   * value is read as schema drift by `kernel/adapters/sqlite/schema-fingerprint.ts`
   * so an inline `001_initial.sql` column add (greenfield, no version
   * bump) forces a one-time cache rebuild. Internal DB metadata, NOT a
   * `ScanResult` field.
   */
  schemaFingerprint: string | null;
  /**
   * Whole-result fingerprint: sha256 (hex) over the canonical persisted
   * content of the scan (see `computeResultFingerprint` in
   * `scan-persistence.ts` for the exact input set). The next persist
   * compares its own fingerprint against this value and skips the
   * replace-all write when they match and no out-of-band inputs
   * (renames, enrichments, freshly-run tuples) ride along. NULL on a
   * pre-feature DB / synthetic writes. Internal DB metadata, NOT a
   * `ScanResult` field.
   */
  resultFingerprint: string | null;
}

/**
 * Spec § A.9, fine-grained Extractor cache.
 *
 * One row per `(node_path, extractor_id)` recording the body hash the
 * extractor saw when it last ran. The orchestrator consults this table on
 * incremental scans: a node-level cache hit (body+frontmatter unchanged)
 * is upgraded to a full skip ONLY when every currently-registered
 * extractor already has a row matching the prior body hash. A new
 * extractor registered between scans is detected by the absence of its
 * row and runs over the cached node without invalidating the rest of
 * the cache. Replace-all on every persist drops rows for extractors that
 * were uninstalled since the last scan.
 *
 * `extractor_id` is the qualified form `<pluginId>/<id>` per spec § A.6;
 * link `sources_json` carries the author-supplied short id (extractor
 * authors write `sources: ['slash-command']`, not `'core/slash-command'`), so the
 * orchestrator builds a short→qualified map from the live extractor set
 * when filtering cached links by source.
 */
export interface IScanExtractorRunsTable {
  nodePath: string;
  extractorId: string;
  bodyHashAtRun: string;
  ranAt: number;
  /**
   * SHA-256 of the canonical-form `node.sidecar.annotations` the
   * Extractor saw at run time. Always populated, an absent sidecar
   * or one with no annotations canonicalises to `'{}'` so the hash
   * stays stable and comparable across "no sidecar" → "sidecar with
   * no annotations".
   *
   * Participates in the cache key alongside `bodyHashAtRun`, both
   * must match for an Extractor's prior run to be reused. See
   * `spec/db-schema.md` § scan_extractor_runs for the trade-off
   * rationale (universal invalidation over an opt-in flag).
   */
  sidecarAnnotationsHashAtRun: string;
  /**
   * SHA-256 of the extractor's canonical-form resolved settings at run
   * time (the merged `ctx.settings` bag: committed keys, project-local
   * secrets, env-var overrides). Third leg of the cache key alongside
   * `bodyHashAtRun` and `sidecarAnnotationsHashAtRun`: a settings
   * change (via `sm plugins config`, the Settings UI, or a secret's
   * `envVar`) re-runs the pair on the next scan instead of serving
   * outputs computed under superseded settings.
   */
  settingsHashAtRun: string;
}

/**
 * Spec § A.8, universal enrichment layer.
 *
 * One row per `(node_path, extractor_id)` capturing the partial Node fields
 * a single Extractor merged onto the enrichment layer via `ctx.enrichNode`.
 * The author-supplied frontmatter on `scan_nodes.frontmatter_json` stays
 * immutable; this table is the kernel-curated overlay.
 *
 *   - `body_hash_at_enrichment`, the `node.body_hash` the Extractor saw
 *     when it produced this enrichment. Always equal to the live body hash
 *     for Extractor writes (Extractors are deterministic-only and
 *     regenerate via the A.9 cache); reserved for the future Action-issued
 *     probabilistic enrichment revision where stale tracking matters.
 *   - `value_json`, JSON-serialised `Partial<Node>` bag the Extractor
 *     emitted (potentially the cumulative merge across multiple
 *     `enrichNode` calls within the same scan).
 *   - `stale`, reserved. Always `0` in this revision (Extractors are
 *     deterministic; rows simply pisar prior rows via the A.9 cache).
 *     Kept on the table for the future Action-issued enrichment revision.
 *   - `is_probabilistic`, reserved. Always `0` for Extractor writes
 *     (Extractors are deterministic-only). Kept so the future
 *     Action-issued enrichment revision can denormalise the writer's
 *     mode without a schema migration.
 *   - `enriched_at`, wall-clock ms; drives the deterministic merge order
 *     (`ASC` → last-write-wins per field) inside `mergeNodeWithEnrichments`.
 */
export interface INodeEnrichmentsTable {
  nodePath: string;
  extractorId: string;
  bodyHashAtEnrichment: string;
  valueJson: string;
  stale: Generated<number>;
  enrichedAt: number;
  isProbabilistic: Generated<number>;
}

/**
 * Phase 3 / View contribution system, `scan_contributions`.
 *
 * One row per `(plugin_id, extension_id, node_path, contribution_id)`
 * tuple. Carries per-node typed data emitted by extractors via
 * `ctx.emitContribution(id, payload)` (and analyzers via
 * `ctx.emitScopeContribution(id, payload)` for scope-level slots).
 * Belongs to the `scan_*` family, replaced on every scan; NOT
 * analogous to `state_plugin_kvs` (which is plugin-private storage
 * the plugin manages).
 *
 *   - `slot`, closed-enum-by-spec slot name; mirror of
 *     `view-slots.schema.json#/$defs/SlotName`. Kept open at the SQL
 *     layer (no CHECK) so catalog evolution does not need a DDL
 *     migration; `sm plugins upgrade` handles renames at the
 *     manifest layer.
 *   - `payload_json`, JSON-serialised payload, already validated
 *     against the slot's payload schema at emit time
 *     (`view-slots.schema.json#/$defs/payloads/<slot>`). Off-slot
 *     payloads are silently dropped before they reach this table
 *     (mirror of `emitLink` rejecting links whose kind is outside the
 *     spec's closed enum).
 *   - `emitted_at`, wall-clock ms at emit time.
 *
 * Index on `node_path` for the inspector lazy-fetch route and for the
 * rename heuristic; index on `plugin_id` for the `purgeByPlugin` path
 * used when a plugin is uninstalled.
 */
export interface IScanContributionsTable {
  pluginId: string;
  extensionId: string;
  nodePath: string;
  contributionId: string;
  slot: string;
  payloadJson: string;
  emittedAt: number;
}

/**
 * Per-scan record of view contributions REJECTED at emit time, the
 * "off-shape visible" follow-up to the ephemeral `extension.error`
 * event (kind `contribution-rejected`). One row per rejected
 * `ctx.emitContribution(...)` call.
 *
 *   - `reason`, the diagnostic reason. Either the literal
 *     `undeclared-contribution-ref` (the ref was not a declared
 *     `viewContributions` object) or the AJV error string when the
 *     payload failed the slot's payload schema.
 *   - `message`, the rendered human-readable diagnostic (same string
 *     the `extension.error` event carries).
 *   - `contributionId` / `slot`, NULL for the
 *     `undeclared-contribution-ref` shape (no contribution / slot was
 *     resolved); populated for the AJV-failure shape.
 *   - `emittedAt`, wall-clock ms at rejection time.
 *
 * Belongs to the `scan_*` family, plain REPLACE-ALL per scan (the same
 * posture as `scan_issues`; NOT the sweep model `scan_contributions`
 * uses). Index on `plugin_id` for the `sm plugins doctor` group-by,
 * index on `node_path` for per-node lookups + the rename heuristic.
 */
export interface IScanContributionErrorsTable {
  pluginId: string;
  extensionId: string;
  nodePath: string;
  reason: string;
  message: string;
  contributionId: string | null;
  slot: string | null;
  emittedAt: number;
}

/**
 * Per-op confidence-attribution audit trail, `scan_link_scores`.
 *
 * One row per attributed `ctx.adjustConfidence(link, op)` call buffered
 * by a `score`-phase analyzer during the scan (the kernel's own built-in
 * score-phase detectors `core/name-reserved`, `core/reference-broken`
 * dogfood the API, applying penalty deltas on top of the kernel's 1.0
 * baseline). Answers "why is this link at X?" by listing the plugin /
 * extension / op that moved it.
 *
 *   - `sourcePath` / `target` / `kind` / `normalizedTrigger`, the link's
 *     structural identity (the same key `scan_links` dedups on).
 *     `normalizedTrigger` is NULL for path-style links with no trigger.
 *   - `opKind`, the algebra bucket (`set` / `delta` / `ceil` / `floor`);
 *     `opValue`, its operand.
 *   - `resultConfidence`, the FOLDED final `link.confidence` after every
 *     op for this link was applied (denormalised, equal across all rows
 *     for one link, mirror of `scan_links.confidence`).
 *   - `emittedAt`, wall-clock ms at fold time.
 *
 * Belongs to the `scan_*` family, plain REPLACE-ALL per scan (the same
 * posture as `scan_issues` / `scan_contribution_errors`; NOT the sweep
 * model `scan_contributions` uses). Index on `source_path` for the
 * per-node "why this link?" lookup.
 */
export interface IScanLinkScoresTable {
  pluginId: string;
  extensionId: string;
  sourcePath: string;
  target: string;
  kind: string;
  normalizedTrigger: string | null;
  opKind: string;
  opValue: number;
  resultConfidence: number;
  emittedAt: number;
}

/**
 * Tags · single-source, `scan_node_tags`.
 *
 * One row per `(node_path, tag)` pair. Projected at persist time from
 * the node's `sidecar.annotations.tags` (the only tag source).
 * Drives `sm list --tag <name>` and the UI's tag-faceted search; the
 * `(tag)` index keeps lookups O(log n).
 *
 * Belongs to the `scan_*` family, replaced wholesale per scan via
 * `replaceAllScanTags`. Cached nodes' rows are projected from the
 * cached `node.sidecar.annotations.tags` (already in memory), so the
 * rebuild is cheap regardless of cache hit / miss.
 */
export interface IScanNodeTagsTable {
  nodePath: string;
  tag: string;
}

// --- State zone ------------------------------------------------------------

export interface IStateJobsTable {
  id: string;
  extensionId: string;
  extensionVersion: string;
  extensionKind: TJobExtensionKind;
  /**
   * Per-job auto-fix opt-in frozen at submit (`auto_fix`, DEFAULT 0). SQLite
   * INTEGER (0 / 1) bridging to `Job.autoFix`; `sm record` chains the
   * finder's fixers on completion when set (`spec/job-lifecycle.md`
   * §Auto-fix chain (per-job)).
   */
  autoFix: Generated<number>;
  /**
   * Finding-subset targeting for FIXER jobs (`finding_ids_json`, NULL =
   * whole node): JSON int array of `state_findings` ids frozen at
   * submit, bridged to `Job.findingIds`
   * (`spec/job-lifecycle.md` §Findings injection for fixers).
   */
  findingIdsJson: string | null;
  nodeId: string;
  contentHash: string;
  nonce: string;
  priority: Generated<number>;
  status: TJobStatus;
  failureReason: TJobFailureReason | null;
  runner: TJobRunner | null;
  ttlSeconds: number | null;
  createdAt: number;
  claimedAt: number | null;
  finishedAt: number | null;
  expiresAt: number | null;
  submittedBy: string | null;
}

/**
 * Content-addressed store for the rendered MD content of every queued /
 * completed job (`state_job_contents`). Keyed by `contentHash` (the same
 * hash `state_jobs.contentHash` carries); the blob is stored once and
 * refcounted by reference from `state_jobs`. There is no on-disk
 * `.skill-map/jobs/*.md` artifact, the DB row is the canonical content.
 *
 *   - `content`, the fully-rendered job content (preamble + action
 *     template + interpolated user content). NOT NULL.
 *   - `createdAt`, wall-clock ms at first insert. `INSERT OR IGNORE`
 *     keeps the earliest write; later submits of the same hash are no-ops.
 *
 * GC contract (see `spec/db-schema.md` §state_job_contents): `sm jobs
 * prune` deletes every row whose `contentHash` is referenced by zero
 * `state_jobs` rows, in the same transaction that prunes terminal jobs.
 */
export interface IStateJobContentsTable {
  contentHash: string;
  content: string;
  createdAt: number;
}

export interface IStateExecutionsTable {
  id: string;
  kind: TExecutionKind;
  extensionId: string;
  extensionVersion: string;
  nodeIdsJson: Generated<string>;
  contentHash: string | null;
  status: TExecutionStatus;
  failureReason: string | null;
  exitCode: number | null;
  runner: string | null;
  startedAt: number;
  finishedAt: number;
  durationMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  /** Agent-self-reported model name (`sm record --model`); NULL when undeclared. */
  model: string | null;
  /**
   * The report payload the runner returned, stored inline as JSON text
   * (validated against the action's `reportSchemaRef` at ingest time).
   * NULL when the execution produced no report. Maps to the
   * `report_json` column; there is no on-disk report file. The domain
   * `ExecutionRecord.reportPath` field (per `execution-record.schema.json`)
   * bridges to this column in `history.ts`.
   */
  reportJson: string | null;
  jobId: string | null;
}

export interface IStateSummariesTable {
  nodeId: string;
  kind: TNodeKind;
  summarizerActionId: string;
  summarizerVersion: string;
  bodyHashAtGeneration: string;
  generatedAt: number;
  /** Denormalized agent-self-reported model name; NULL when undeclared. */
  model: string | null;
  summaryJson: string;
}

/**
 * Origin lane of a `state_findings` row. `extension` rows come from a
 * probabilistic finder Analyzer's validated `findings[]` array; `kernel`
 * rows are synthesized by the record path from any probabilistic report's
 * `safety` block under the reserved type slugs (`injection-detected` /
 * `content-suspicious` / `content-malformed`).
 */
export type TFindingOrigin = 'extension' | 'kernel';

/**
 * The lifecycle STATE a finding moved into (`spec/db-schema.md`
 * §state_findings, "Finding lifecycle state"). `fixed` = resolved (hidden
 * from the default `sm findings` view, NOT deleted, re-checkable);
 * `human-decision` = a fixer proposed but the choice is the author's, so it
 * stays visible as the author's TODO (renamed from the earlier `declined`,
 * which read as a dead-end when it is the most action-demanding state).
 * Neither is "verified": only the finder re-judging the current body deletes
 * or reopens a `fixed` row. `null` = open.
 */
export type TFindingResolution = 'fixed' | 'human-decision' | 'dismissed';

/**
 * WHO decided a `fixed` finding (`state_findings.resolution_actor`). One
 * rule: ANY user interaction makes it `human` (an approval, a choice among
 * a fixer's options, an operator edit, or a `sm findings resolve`), only a
 * fully autonomous fix with zero user interaction is `fixer`. NULL on a
 * `human-decision` (undecided) or open row.
 */
export type TResolutionActor = 'human' | 'fixer';

/**
 * Probabilistic findings (`state_findings`, `spec/db-schema.md`
 * §state_findings). Written by the record path inside the
 * `recordJobTerminal` transaction with replace semantics per
 * `(node_id, extension_id)` (both origins deleted, fresh rows inserted).
 * `severity` reuses the domain union (`info` / `warn` / `error`).
 * Staleness (`body_hash_at_generation` vs the live `scan_nodes.body_hash`)
 * is computed at read time via JOIN, never persisted.
 *
 * The `resolution*` columns are stamped separately, by one of two writers
 * (`spec/db-schema.md` §state_findings): the record transaction closing a
 * FIXER's job (scoped to the job's node and the fixer's declared
 * `analyzerIds`), or `sm findings resolve` (a purely human resolution).
 */
export interface IStateFindingsTable {
  id: Generated<number>;
  nodeId: string;
  extensionId: string;
  extensionVersion: string;
  origin: TFindingOrigin;
  type: string;
  severity: TIssueSeverity;
  message: string;
  detail: string | null;
  confidence: number;
  /** Denormalized agent-self-reported model name; NULL when undeclared. */
  model: string | null;
  /** Lifecycle state; NULL (open) until a fixer or the operator resolves it. */
  resolution: TFindingResolution | null;
  /** WHO decided a `fixed` row (`human` / `fixer`); NULL for `human-decision` / open. */
  resolutionActor: TResolutionActor | null;
  /** The one-line reason, verbatim; the author's TODO (its proposal) when `human-decision`. */
  resolutionNote: string | null;
  /** The fixer's qualified extension id; NULL for a purely human resolution. */
  resolutionBy: string | null;
  resolutionAt: number | null;
  bodyHashAtGeneration: string;
  generatedAt: number;
  jobId: string | null;
}

export interface IStateEnrichmentsTable {
  nodeId: string;
  providerId: string;
  dataJson: string;
  verified: number | null;
  fetchedAt: number;
  staleAfter: number | null;
}

export interface IStatePluginKvsTable {
  pluginId: string;
  nodeId: string;
  key: string;
  valueJson: string;
  updatedAt: number;
}

/**
 * Per-node "favorite" flag persisted per user. Single row per favorited
 * node, absence of a row means "not favorited". Lives in zone `state_`
 * so favorites survive `sm scan` truncation and `sm db reset`. Migrated
 * by `migrateNodeFks` (history.ts) on rename, same protocol as the other
 * state_* tables.
 */
export interface IStateNodeFavoritesTable {
  nodePath: string;
  favoritedAt: number;
}

/**
 * Runtime activity-stats checkpoint (`spec/db-schema.md`
 * §state_activity_stats): one row per node the live activity touched,
 * the persisted half of the BFF accumulator. `ownersJson` / `recentJson`
 * are JSON arrays owned by the accumulator. Migrated by `migrateNodeFks`
 * on rename like every keyed-by-node `state_*` table.
 */
export interface IStateActivityStatsTable {
  nodePath: string;
  count: number;
  firstSeenAt: number;
  lastStartAt: number;
  lastOwner: string | null;
  ownersJson: string;
  recentJson: string;
  toolUses: number;
  tokens: number;
  summarizedRuns: number;
}

/** Per-pair spawn counters, PK `(parent, childNodePath)` (spec §state_activity_pairs). */
export interface IStateActivityPairsTable {
  parent: string;
  childNodePath: string;
  count: number;
  lastStartAt: number;
}

// --- Config zone -----------------------------------------------------------


export interface IConfigPreferencesTable {
  key: string;
  valueJson: string;
  updatedAt: number;
}

export interface IConfigSchemaVersionsTable {
  scope: TSchemaVersionScope;
  ownerId: string;
  version: number;
  description: string;
  appliedAt: number;
}

// --- Kysely database binding ----------------------------------------------

export interface IDatabase {
  scan_nodes: IScanNodesTable;
  scan_links: IScanLinksTable;
  scan_issues: IScanIssuesTable;
  scan_meta: IScanMetaTable;
  scan_extractor_runs: IScanExtractorRunsTable;
  scan_contributions: IScanContributionsTable;
  scan_contribution_errors: IScanContributionErrorsTable;
  scan_link_scores: IScanLinkScoresTable;
  scan_node_tags: IScanNodeTagsTable;
  node_enrichments: INodeEnrichmentsTable;

  state_jobs: IStateJobsTable;
  state_job_contents: IStateJobContentsTable;
  state_executions: IStateExecutionsTable;
  state_summaries: IStateSummariesTable;
  state_findings: IStateFindingsTable;
  state_enrichments: IStateEnrichmentsTable;
  state_plugin_kvs: IStatePluginKvsTable;
  state_node_favorites: IStateNodeFavoritesTable;
  state_activity_stats: IStateActivityStatsTable;
  state_activity_pairs: IStateActivityPairsTable;

  config_preferences: IConfigPreferencesTable;
  config_schema_versions: IConfigSchemaVersionsTable;
}
