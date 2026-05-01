/**
 * Scan orchestrator — runs the Provider → extractor → rule pipeline across
 * every registered extension and emits `ProgressEmitterPort` events in
 * canonical order. The callable extension set is injected via
 * `RunScanOptions.extensions` — the Registry holds manifest metadata, the
 * callable set holds the runtime instances the orchestrator actually
 * invokes. Separating the two lets `sm plugins` and `sm help` introspect
 * the graph without loading code.
 *
 * With zero registered extensions (or a callable set that carries none)
 * the pipeline still produces a valid zero-filled `ScanResult` — the
 * kernel-empty-boot invariant.
 *
 * Roots are validated up front: each entry of `RunScanOptions.roots`
 * must exist on disk as a directory. The first failure throws a clear
 * `Error` naming the offending path. This guards every caller (CLI,
 * server, skill-agent) against silently producing a zero-filled
 * `ScanResult` when a Provider walks a non-existent path — the bug
 * that wiped a populated DB via `sm scan -- --dry-run` (clipanion's
 * `--` made `--dry-run` a positional root that did not exist).
 *
 * Incremental scans (Step 4.4): when `priorSnapshot` is supplied, the
 * orchestrator walks the filesystem, hashes each file, and reuses the
 * prior node + its prior-extracted internal links whenever both
 * `bodyHash` and `frontmatterHash` match. New / modified files run
 * through the full extractor pipeline (including the external-url-counter
 * which produces ephemeral pseudo-links). Rules ALWAYS run over the
 * fully merged graph — issue state can change even for an unchanged node
 * (e.g. a previously broken `references` link now resolves because a new
 * node was added). For unchanged nodes the prior `externalRefsCount` is
 * preserved as-is (the external pseudo-links were never persisted, so
 * they cannot be reconstructed; the count survived in the node row).
 *
 * Extractor output model (B.1, post-rename from Detector): extractors
 * return `void` and emit through three callbacks injected on the context:
 *   - `ctx.emitLink(link)` → orchestrator validates against
 *     `emitsLinkKinds` then partitions into internal / external buckets.
 *   - `ctx.enrichNode(partial)` → orchestrator records ONE enrichment
 *     entry per `(node, extractor)` so attribution survives into the DB.
 *     Persisted into `node_enrichments` (A.8). The author-supplied
 *     frontmatter on `node.frontmatter` stays immutable from any Extractor
 *     — the enrichment layer is the only writable surface, and rules /
 *     formatters consume it via `mergeNodeWithEnrichments`.
 *   - `ctx.store` → plugin's own KV / dedicated tables (out of scope
 *     here — the orchestrator never inspects it).
 */

import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';

// js-tiktoken ships CJS subpaths without explicit `.cjs` in the import
// specifier — the lint rule's hard-coded extension matrix doesn't model
// dual-package CJS subpath exports.
// eslint-disable-next-line import-x/extensions
import { Tiktoken } from 'js-tiktoken/lite';
// eslint-disable-next-line import-x/extensions
import cl100k_base from 'js-tiktoken/ranks/cl100k_base';
import yaml from 'js-yaml';

import pkg from '../package.json' with { type: 'json' };

import type { IIgnoreFilter } from './scan/ignore.js';
import type { Kernel } from './index.js';
import type {
  Confidence,
  Issue,
  Link,
  LinkKind,
  Node,
  NodeKind,
  ScanResult,
  ScanScannedBy,
  Severity,
  TripleSplit,
} from './types.js';
import type {
  ProgressEmitterPort,
  ProgressEvent,
} from './ports/progress-emitter.js';
import { InMemoryProgressEmitter } from './adapters/in-memory-progress.js';
import { log } from './util/logger.js';
import { installedSpecVersion } from './adapters/plugin-loader.js';
import {
  buildProviderFrontmatterValidator,
  type IProviderFrontmatterValidator,
} from './adapters/schema-validators.js';
import { ORCHESTRATOR_TEXTS } from './i18n/orchestrator.texts.js';
import { qualifiedExtensionId } from './registry.js';
import { tx } from './util/tx.js';
import type {
  IProvider,
  IRawNode,
  IExtractorContext,
  IExtractor,
  IHook,
  IHookContext,
  IRule,
  THookTrigger,
} from './extensions/index.js';

// Resolved once at module init so every scan reuses the same metadata.
// `installedSpecVersion()` reads `@skill-map/spec/package.json` off disk;
// failure is non-fatal — fall back to `'unknown'` and keep the field
// shape spec-conformant (string).
const SCANNED_BY: ScanScannedBy = {
  name: 'skill-map',
  version: pkg.version,
  specVersion: resolveSpecVersionSafe(),
};

function resolveSpecVersionSafe(): string {
  try {
    return installedSpecVersion();
  } catch {
    return 'unknown';
  }
}

export interface IScanExtensions {
  providers: IProvider[];
  extractors: IExtractor[];
  rules: IRule[];
  /**
   * Optional hooks (spec § A.11). When supplied, the orchestrator's
   * lifecycle dispatcher invokes deterministic hooks subscribed to one
   * of the eight hookable triggers in canonical order with the matching
   * event payload. Absent → no hooks fire (the scan still emits its
   * lifecycle events to `ProgressEmitterPort` for observability).
   * Probabilistic hooks are loaded but skipped here with a stderr
   * advisory until the job subsystem ships at Step 10.
   */
  hooks?: IHook[];
}

/**
 * Confidence-tagged plan to repoint `state_*` references from one node
 * path to another. Emitted by the rename heuristic during `runScan` and
 * consumed by `persistScanResult` so the FK migration runs inside the
 * same transaction as the scan zone replace-all.
 */
export interface RenameOp {
  from: string;
  to: string;
  confidence: 'high' | 'medium';
}

export interface RunScanOptions {
  /**
   * Filesystem roots to walk. Spec requires `minItems: 1`; passing an
   * empty array makes `runScan` throw before any work happens.
   */
  roots: string[];
  emitter?: ProgressEmitterPort;
  /** Runtime extension instances. Absent → empty pipeline. */
  extensions?: IScanExtensions;
  /**
   * Scan scope. Defaults to `'project'`. The CLI flag wiring lands in
   * Step 6 (config + onboarding); `runScan` already accepts the override
   * so plugins / tests can opt into `'global'` today.
   */
  scope?: 'project' | 'global';
  /**
   * Compute per-node token counts (frontmatter / body / total) using the
   * cl100k_base BPE (the modern OpenAI tokenizer used by GPT-4 / GPT-3.5).
   * Defaults to true. Set false to skip tokenization; `node.tokens` is
   * left undefined (spec-valid: the field is optional).
   */
  tokenize?: boolean;
  /**
   * Prior snapshot for two purposes (decoupled at Step 5.8):
   *
   *   1. **Rename heuristic** (`spec/db-schema.md` §Rename detection):
   *      always evaluated when `priorSnapshot` is supplied. The
   *      heuristic compares prior vs current node paths and emits
   *      high / medium / ambiguous / orphan classifications. This
   *      runs on EVERY `sm scan` (with or without `--changed`) so
   *      reorganising files always preserves history, never silently.
   *
   *   2. **Cache reuse** (`sm scan --changed`): only kicks in when
   *      `enableCache: true` is also passed. With the flag set, nodes
   *      whose `path` exists in the prior with both `bodyHash` and
   *      `frontmatterHash` matching the freshly-computed hashes are
   *      reused as-is (their internal links and `externalRefsCount`
   *      survive); only new / modified nodes run through extractors.
   *      Rules always re-run over the merged graph.
   *
   * Pass `null` (or omit) for a fresh scan with no rename detection.
   */
  priorSnapshot?: ScanResult | null;
  /**
   * Reuse unchanged nodes from `priorSnapshot` instead of re-running
   * extractors over them. Defaults to `false` so a plain `sm scan`
   * always re-walks deterministically. `sm scan --changed` flips this
   * to `true` for the perf win on unchanged files.
   *
   * Has no effect without `priorSnapshot`; setting it to `true` with
   * a null prior is a no-op (every file is "new").
   */
  enableCache?: boolean;
  /**
   * Filter that decides which paths the Providers skip. Composed by the
   * caller (typically the CLI) from bundled defaults + `config.ignore`
   * + `.skill-mapignore`. Providers that omit this option fall back to
   * their own defensive defaults (just enough to keep `.git` /
   * `node_modules` out).
   */
  ignoreFilter?: IIgnoreFilter;
  /**
   * Promote frontmatter-validation findings from `warn` to `error`.
   * Defaults to false. The CLI surfaces this via `--strict` on `sm scan`
   * and the `scan.strict` config key. When false, the orchestrator
   * still emits a `frontmatter-invalid` issue per malformed file but
   * leaves the severity at `warn` so a clean scan exits 0; when true,
   * the same finding becomes `error` and the scan exits 1.
   */
  strict?: boolean;
  /**
   * Phase 4 / A.9 — fine-grained Extractor cache breadcrumbs from the
   * prior scan. Shape: `Map<nodePath, Map<qualifiedExtractorId, bodyHashAtRun>>`.
   * Loaded from the `scan_extractor_runs` table by the CLI before
   * invoking `runScan`; absent / empty for a fresh DB or an out-of-band
   * caller that does not maintain a cache. Decoupled from `priorSnapshot`
   * because the runs live in a sibling table and are useful only when
   * `enableCache` is also set.
   *
   * Cache decision per `(node, extractor)`:
   *   - body+frontmatter hashes match the prior node AND every currently-
   *     registered extractor that applies to this kind has a matching
   *     row → full skip, all prior outbound links reused.
   *   - some applicable extractor lacks a matching row (newly registered,
   *     or its prior run targeted a different body hash) → run only the
   *     missing extractors, drop prior links whose `sources` map to any
   *     missing extractor or to an extractor that is no longer registered.
   */
  priorExtractorRuns?: Map<string, Map<string, string>>;
}

/**
 * Phase 4 / A.9 — runs to persist into `scan_extractor_runs`. One entry
 * per `(nodePath, qualifiedExtractorId)` pair the orchestrator decided
 * "this extractor is current for this body". Includes both freshly-run
 * pairs (extractor invoked this scan) and reused pairs (cached node, the
 * extractor's prior run still applies to the same body hash). Excludes
 * obsolete pairs — extractors that ran in the prior but are no longer
 * registered — so a replace-all persist drops them automatically.
 */
export interface IExtractorRunRecord {
  nodePath: string;
  extractorId: string;
  bodyHashAtRun: string;
  ranAt: number;
}

/**
 * Phase 4 / A.8 — universal enrichment layer.
 *
 * One entry per `(nodePath, qualifiedExtractorId)` pair an Extractor
 * produced via `ctx.enrichNode(...)` during the walk. Attribution is
 * preserved per-Extractor (rather than merged client-side as B.1 did)
 * so the persistence layer can:
 *
 *   - upsert a single row per pair (stable PRIMARY KEY conflict on
 *     re-extract);
 *   - flag probabilistic rows `stale = 1` when the body changes between
 *     scans (preserving the prior LLM cost);
 *   - feed `mergeNodeWithEnrichments` with `enrichedAt`-sorted partials
 *     for last-write-wins per field at read time.
 *
 * `value` is the cumulative merge across every `enrichNode` call that
 * Extractor made for this node within this scan — multiple
 * `ctx.enrichNode({...})` calls inside one `extract(ctx)` invocation
 * fold into a single row, but two different Extractors hitting the
 * same node yield two distinct rows.
 *
 * `isProbabilistic` is denormalised so the persistence layer's stale
 * flag query stays a single-table read; recomputing from the live
 * registry would force every read-path to thread the runtime extension
 * set through.
 */
export interface IEnrichmentRecord {
  nodePath: string;
  extractorId: string;
  bodyHashAtEnrichment: string;
  value: Partial<Node>;
  enrichedAt: number;
  isProbabilistic: boolean;
}

/**
 * Same as `runScan` but also returns the rename heuristic's `RenameOp[]`
 * — the high- and medium-confidence renames the persistence layer must
 * apply to `state_*` rows inside the same tx as the scan zone replace-
 * all (per `spec/db-schema.md` §Rename detection). Most callers want
 * `runScan` (which returns just `ScanResult`); the CLI's `sm scan`
 * uses this variant so it can hand the ops off to `persistScanResult`.
 *
 * Also returns `extractorRuns` — the Phase 4 / A.9 fine-grained cache
 * breadcrumbs the CLI persists into `scan_extractor_runs` so the next
 * incremental scan can decide per-(node, extractor) whether re-running
 * is required.
 */
export async function runScanWithRenames(
  _kernel: Kernel,
  options: RunScanOptions,
): Promise<{
  result: ScanResult;
  renameOps: RenameOp[];
  extractorRuns: IExtractorRunRecord[];
  enrichments: IEnrichmentRecord[];
}> {
  return runScanInternal(_kernel, options);
}

export async function runScan(
  _kernel: Kernel,
  options: RunScanOptions,
): Promise<ScanResult> {
  const { result } = await runScanInternal(_kernel, options);
  return result;
}

async function runScanInternal(
  _kernel: Kernel,
  options: RunScanOptions,
): Promise<{
  result: ScanResult;
  renameOps: RenameOp[];
  extractorRuns: IExtractorRunRecord[];
  enrichments: IEnrichmentRecord[];
}> {
  validateRoots(options.roots);

  const start = Date.now();
  const scannedAt = start;
  const emitter = options.emitter ?? new InMemoryProgressEmitter();
  const exts = options.extensions ?? { providers: [], extractors: [], rules: [] };
  const hookDispatcher = makeHookDispatcher(exts.hooks ?? [], emitter);
  const tokenize = options.tokenize !== false;
  const scope: 'project' | 'global' = options.scope ?? 'project';
  const strict = options.strict === true;
  // Encoder is heavyweight to construct (loads the cl100k_base BPE table
  // once); reuse a single instance across the whole scan.
  const encoder = tokenize ? new Tiktoken(cl100k_base) : null;
  const prior = options.priorSnapshot ?? null;
  const enableCache = options.enableCache === true;
  // Phase 4 / A.9 — `priorExtractorRuns === undefined` means the caller
  // doesn't track the fine-grained Extractor cache (legacy behaviour: out-
  // of-band tests, alternate driving adapters that have no DB). In that
  // case we fall back to the pre-A.9 model where the node-level body /
  // frontmatter hash check is sufficient and every applicable extractor
  // is assumed to have run against the prior body. Passing an explicit
  // (possibly empty) Map opts the caller into the fine-grained path.
  const priorExtractorRuns = options.priorExtractorRuns;

  const priorIndex = indexPriorSnapshot(prior);

  // Phase 3 (spec 0.8.0): each Provider owns its per-kind frontmatter
  // schemas. Compose a single AJV-backed validator over the live set of
  // Providers so the orchestrator can ask it directly during the walk.
  const providerFrontmatter = buildProviderFrontmatterValidator(exts.providers);

  const scanStartedEvent = makeEvent('scan.started', { roots: options.roots });
  emitter.emit(scanStartedEvent);
  await hookDispatcher.dispatch('scan.started', scanStartedEvent);

  const walked = await walkAndExtract({
    providers: exts.providers,
    extractors: exts.extractors,
    roots: options.roots,
    ...(options.ignoreFilter ? { ignoreFilter: options.ignoreFilter } : {}),
    emitter,
    encoder,
    strict,
    enableCache,
    prior,
    priorIndex,
    priorExtractorRuns,
    providerFrontmatter,
  });

  // External pseudo-links (target is http(s)://) drive `externalRefsCount`
  // and are then dropped: never persisted, never seen by rules, never in
  // result.links. The string-prefix check is the contract — see
  // external-url-counter/index.ts.
  recomputeLinkCounts(walked.nodes, walked.internalLinks);
  recomputeExternalRefsCount(walked.nodes, walked.externalLinks, walked.cachedPaths);

  // Spec § A.11 — Hook dispatch for `extractor.completed`. Aggregated:
  // one event per registered extractor, after the full walk completes.
  // The payload carries the qualified extractor id so a hook with a
  // `filter: { extractorId: '...' }` can target a single extractor.
  // No per-node fan-out — that lives in `scan.progress` which is
  // deliberately NOT hookable (too verbose).
  for (const extractor of exts.extractors) {
    const extractorId = qualifiedExtensionId(extractor.pluginId, extractor.id);
    const evt = makeEvent('extractor.completed', { extractorId });
    emitter.emit(evt);
    await hookDispatcher.dispatch('extractor.completed', evt);
  }

  // Rules ALWAYS re-run over the merged graph (no shortcut for
  // incremental scans): the issue set for an "unchanged" node can flip
  // when a sibling node changes.
  const issues = await runRules(exts.rules, walked.nodes, walked.internalLinks, emitter, hookDispatcher);
  // Frontmatter-invalid issues from the walk land here so the rename
  // heuristic (next pass) sees them and the final stats.issuesCount
  // reflects them.
  for (const issue of walked.frontmatterIssues) issues.push(issue);

  // Rename heuristic runs after rules so the merged graph is final. The
  // returned `RenameOp[]` flows through to `persistScanResult` so FK
  // migration lands inside the same tx as the scan zone replace-all.
  const renameOps = prior ? detectRenamesAndOrphans(prior, walked.nodes, issues) : [];

  const stats = {
    // `filesSkipped` is "files walked but not classified by any Provider".
    // Today every walked file IS classified by its Provider (the `claude`
    // Provider's `classify()` always returns a kind, falling back to
    // `'note'`), so this is always 0. Wired now so the field shape is
    // spec-conformant; meaningful once multiple Providers compete (Step 9+).
    filesWalked: walked.filesWalked,
    filesSkipped: 0,
    nodesCount: walked.nodes.length,
    linksCount: walked.internalLinks.length,
    issuesCount: issues.length,
    durationMs: Date.now() - start,
  };

  const scanCompletedEvent = makeEvent('scan.completed', { stats });
  emitter.emit(scanCompletedEvent);
  await hookDispatcher.dispatch('scan.completed', scanCompletedEvent);

  return {
    result: {
      schemaVersion: 1,
      scannedAt,
      scope,
      roots: options.roots,
      providers: exts.providers.map((a) => a.id),
      scannedBy: SCANNED_BY,
      nodes: walked.nodes,
      links: walked.internalLinks,
      issues,
      stats,
    },
    renameOps,
    extractorRuns: walked.extractorRuns,
    enrichments: walked.enrichments,
  };
}

/**
 * Validate every root exists as a directory BEFORE any IO, BEFORE the
 * tokenizer is constructed, BEFORE `scan.started` fires. Throws on the
 * first failure — single-error feedback is enough; the user fixes it
 * and re-runs. Without this guard the claude Provider's `walk()` swallows
 * ENOENT inside `readdir` and returns silently, which lets a non-existent
 * root produce a valid-looking zero-filled `ScanResult` — directly
 * enabling the `sm scan -- --dry-run` typo-trap that wipes a populated
 * DB.
 *
 * Spec contract (`scan-result.schema.json#/properties/roots/minItems: 1`):
 * a ScanResult must report at least one walked root. The CLI defaults
 * `roots` to `['.']` when no positional args are supplied, so the
 * empty-array branch is a programming error from the CLI surface.
 */
function validateRoots(roots: string[]): void {
  if (roots.length === 0) {
    throw new Error(ORCHESTRATOR_TEXTS.runScanRootEmptyArray);
  }
  for (const root of roots) {
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      throw new Error(tx(ORCHESTRATOR_TEXTS.runScanRootMissing, { root }));
    }
  }
}

interface IPriorIndex {
  /** Prior nodes keyed by path so per-file lookup is O(1). */
  priorNodesByPath: Map<string, Node>;
  /** Set of every prior node path — used to disambiguate inverted
   *  `supersedes` links (see `originatingNodeOf`). */
  priorNodePaths: Set<string>;
  /**
   * Prior internal links bucketed by **originating node** — the node
   * whose body / frontmatter the extractor was processing when it emitted
   * the link. For most kinds that equals `link.source`, but the
   * frontmatter extractor emits inverted `supersedes` links where the
   * originating node is `link.target`.
   */
  priorLinksByOriginating: Map<string, Link[]>;
  /**
   * Per-node frontmatter-invalid / -malformed issues from the prior — we
   * reuse them when the cache is hit, otherwise the incremental scan
   * would silently drop the warning that landed on the prior pass.
   */
  priorFrontmatterIssuesByNode: Map<string, Issue[]>;
}

function indexPriorSnapshot(prior: ScanResult | null): IPriorIndex {
  const priorNodesByPath = new Map<string, Node>();
  const priorNodePaths = new Set<string>();
  const priorLinksByOriginating = new Map<string, Link[]>();
  const priorFrontmatterIssuesByNode = new Map<string, Issue[]>();
  if (!prior) {
    return { priorNodesByPath, priorNodePaths, priorLinksByOriginating, priorFrontmatterIssuesByNode };
  }
  for (const node of prior.nodes) {
    priorNodesByPath.set(node.path, node);
    priorNodePaths.add(node.path);
  }
  for (const link of prior.links) {
    const key = originatingNodeOf(link, priorNodePaths);
    const list = priorLinksByOriginating.get(key);
    if (list) list.push(link);
    else priorLinksByOriginating.set(key, [link]);
  }
  for (const issue of prior.issues) {
    if (issue.ruleId !== 'frontmatter-invalid' && issue.ruleId !== 'frontmatter-malformed') continue;
    if (issue.nodeIds.length !== 1) continue;
    const path = issue.nodeIds[0]!;
    const list = priorFrontmatterIssuesByNode.get(path);
    if (list) list.push(issue);
    else priorFrontmatterIssuesByNode.set(path, [issue]);
  }
  return { priorNodesByPath, priorNodePaths, priorLinksByOriginating, priorFrontmatterIssuesByNode };
}

interface IWalkAndExtractOptions {
  providers: IProvider[];
  extractors: IExtractor[];
  roots: string[];
  ignoreFilter?: IIgnoreFilter;
  emitter: ProgressEmitterPort;
  encoder: Tiktoken | null;
  strict: boolean;
  enableCache: boolean;
  prior: ScanResult | null;
  priorIndex: IPriorIndex;
  /**
   * Phase 4 / A.9 — fine-grained Extractor cache breadcrumbs from the
   * prior scan, keyed `nodePath → qualifiedExtractorId → bodyHashAtRun`.
   * `undefined` opts out of the fine-grained path (legacy callers that
   * don't track the cache); the orchestrator falls back to the pre-A.9
   * node-level cache check.
   */
  priorExtractorRuns: Map<string, Map<string, string>> | undefined;
  providerFrontmatter: IProviderFrontmatterValidator;
}

interface IWalkAndExtractResult {
  nodes: Node[];
  internalLinks: Link[];
  externalLinks: Link[];
  /** Node paths reused verbatim from the prior snapshot. Their
   *  `externalRefsCount` must NOT be zeroed before recomputation. */
  cachedPaths: Set<string>;
  /** Frontmatter-validation findings collected during the walk; the
   *  composer appends these to the rule-emitted issue list so the
   *  final ordering stays "rules first, then derived issues". */
  frontmatterIssues: Issue[];
  /**
   * Phase 4 / A.8 — per-extractor enrichment records collected from
   * `ctx.enrichNode(...)` calls during the walk. One entry per
   * `(nodePath, extractorId)` pair an Extractor enriched. The
   * persistence layer upserts these into `node_enrichments`; the
   * read-side `mergeNodeWithEnrichments` helper combines them with
   * the author frontmatter for rule consumption.
   *
   * Attribution is preserved per-Extractor: two Extractors enriching
   * the same node produce two records, not one merged value. If a
   * single Extractor calls `ctx.enrichNode(...)` multiple times within
   * one `extract()` invocation, the partials fold into one record's
   * `value` (last-write-wins per field).
   */
  enrichments: IEnrichmentRecord[];
  /** Every `IRawNode` a Provider yielded across the whole scan
   *  (including cached reuse). With one Provider it equals
   *  `nodesCount`; with future multi-Provider scans walking overlapping
   *  roots it can diverge. */
  filesWalked: number;
  /**
   * Phase 4 / A.9 — the rows the persistence layer writes into
   * `scan_extractor_runs`. Includes both freshly-run pairs (extractor
   * invoked this scan) and reused pairs (cached node, the extractor's
   * prior run still applies to the same body hash). Excludes obsolete
   * pairs (extractor was uninstalled since the prior scan).
   */
  extractorRuns: IExtractorRunRecord[];
}

/**
 * Run a set of extractors against a single node, collecting their link
 * emissions and node-enrichment partials. Each extractor is invoked
 * exactly once with a fresh `IExtractorContext`. Caller decides what
 * to do with the returned arrays (push into per-scan buffers, write to
 * a focused refresh result, etc.).
 *
 * Exported so `cli/commands/refresh.ts` can reuse the same wiring it
 * needs for re-running a single extractor against a single node — the
 * pre-extraction code in `refresh.ts` was hand-duplicating this loop
 * (audit item V4).
 *
 * Within this call, multiple `enrichNode(partial)` calls from the same
 * extractor against the same node fold into one record (last-write-wins
 * per field) — same contract as the in-scan path.
 */
export async function runExtractorsForNode(opts: {
  extractors: IExtractor[];
  node: Node;
  body: string;
  frontmatter: Record<string, unknown>;
  bodyHash: string;
  emitter: ProgressEmitterPort;
}): Promise<{
  internalLinks: Link[];
  externalLinks: Link[];
  enrichments: IEnrichmentRecord[];
}> {
  const internalLinks: Link[] = [];
  const externalLinks: Link[] = [];
  const enrichmentBuffer = new Map<string, IEnrichmentRecord>();

  for (const extractor of opts.extractors) {
    const qualifiedId = qualifiedExtensionId(extractor.pluginId, extractor.id);
    const isProb = extractor.mode === 'probabilistic';
    const emitLink = (link: Link): void => {
      const validated = validateLink(extractor, link, opts.emitter);
      if (!validated) return;
      if (isExternalUrlLink(validated)) externalLinks.push(validated);
      else internalLinks.push(validated);
    };
    const enrichNode = (partial: Partial<Node>): void => {
      const key = `${opts.node.path}\x00${qualifiedId}`;
      const existing = enrichmentBuffer.get(key);
      if (existing) {
        existing.value = { ...existing.value, ...partial };
        existing.enrichedAt = Date.now();
      } else {
        enrichmentBuffer.set(key, {
          nodePath: opts.node.path,
          extractorId: qualifiedId,
          bodyHashAtEnrichment: opts.bodyHash,
          value: { ...partial },
          enrichedAt: Date.now(),
          isProbabilistic: isProb,
        });
      }
    };
    const ctx = buildExtractorContext(
      extractor,
      opts.node,
      opts.body,
      opts.frontmatter,
      emitLink,
      enrichNode,
    );
    await extractor.extract(ctx);
  }

  return {
    internalLinks,
    externalLinks,
    enrichments: Array.from(enrichmentBuffer.values()),
  };
}

/**
 * Compute the per-(node, extractor) cache decision for a single node.
 * Returns:
 *   - `applicableExtractors` — extractors whose `applicableKinds`
 *     accepts this node's kind (or unrestricted).
 *   - `applicableQualifiedIds` — set of qualified ids of the above.
 *   - `cachedQualifiedIds` — applicable extractors whose prior run for
 *     this node's body hash is still valid.
 *   - `missingExtractors` — applicable extractors that need to run.
 *   - `fullCacheHit` — true iff the node-level hash matched AND every
 *     applicable extractor is cached (nothing to re-extract).
 *
 * Legacy fallback: when `priorExtractorRuns === undefined` the caller
 * did not load fine-grained breadcrumbs (out-of-band tests, alternate
 * driving adapters); we treat every applicable extractor as cached
 * when the node-level hashes match — preserves the pre-A.9 contract.
 */
function computeCacheDecision(opts: {
  extractors: IExtractor[];
  kind: string;
  nodePath: string;
  bodyHash: string;
  nodeHashCacheEligible: boolean;
  priorExtractorRuns: Map<string, Map<string, string>> | undefined;
}): {
  applicableExtractors: IExtractor[];
  applicableQualifiedIds: Set<string>;
  cachedQualifiedIds: Set<string>;
  missingExtractors: IExtractor[];
  fullCacheHit: boolean;
} {
  const applicableExtractors = opts.extractors.filter(
    (ex) => ex.applicableKinds === undefined || ex.applicableKinds.includes(opts.kind),
  );
  const applicableQualifiedIds = new Set(
    applicableExtractors.map((ex) => qualifiedExtensionId(ex.pluginId, ex.id)),
  );
  const cachedQualifiedIds = new Set<string>();
  const missingExtractors: IExtractor[] = [];

  if (opts.priorExtractorRuns === undefined) {
    if (opts.nodeHashCacheEligible) {
      for (const id of applicableQualifiedIds) cachedQualifiedIds.add(id);
    } else {
      for (const ex of applicableExtractors) missingExtractors.push(ex);
    }
  } else {
    const priorRunsForNode = opts.priorExtractorRuns.get(opts.nodePath) ?? new Map<string, string>();
    for (const ex of applicableExtractors) {
      const qualified = qualifiedExtensionId(ex.pluginId, ex.id);
      const priorBody = priorRunsForNode.get(qualified);
      if (opts.nodeHashCacheEligible && priorBody === opts.bodyHash) {
        cachedQualifiedIds.add(qualified);
      } else {
        missingExtractors.push(ex);
      }
    }
  }

  return {
    applicableExtractors,
    applicableQualifiedIds,
    cachedQualifiedIds,
    missingExtractors,
    fullCacheHit: opts.nodeHashCacheEligible && missingExtractors.length === 0,
  };
}

/**
 * Build the reused-node bundle for a node that fully cache-hit (body
 * + frontmatter unchanged AND every applicable extractor still has a
 * matching `scan_extractor_runs` row). Caller pushes the returned
 * arrays into its scan-wide buffers and emits the progress event.
 *
 * Reshape rules (A.9 sources):
 *   - missing source (extractor will re-emit) → drop link
 *   - all-obsolete sources → drop link
 *   - cached + obsolete → trim obsolete from `sources`
 *   - cached only → keep verbatim
 */
function reusePriorNode(opts: {
  priorNode: Node;
  bodyHash: string;
  strict: boolean;
  cachedQualifiedIds: Set<string>;
  applicableQualifiedIds: Set<string>;
  shortIdToQualified: Map<string, string[]>;
  priorLinksByOriginating: Map<string, Link[]>;
  priorFrontmatterIssuesByNode: Map<string, Issue[]>;
}): {
  node: Node;
  internalLinks: Link[];
  frontmatterIssues: Issue[];
  extractorRuns: IExtractorRunRecord[];
} {
  // Shallow-clone to avoid mutating the caller's prior snapshot when
  // `recomputeLinkCounts` resets per-node counts later.
  const node: Node = { ...opts.priorNode, bytes: { ...opts.priorNode.bytes } };
  if (opts.priorNode.tokens) node.tokens = { ...opts.priorNode.tokens };

  const internalLinks: Link[] = [];
  const reusedLinks = opts.priorLinksByOriginating.get(opts.priorNode.path) ?? [];
  for (const link of reusedLinks) {
    const reshaped = reuseCachedLink(
      link,
      opts.shortIdToQualified,
      opts.cachedQualifiedIds,
      opts.applicableQualifiedIds,
    );
    if (reshaped) internalLinks.push(reshaped);
  }

  // Re-emit the prior frontmatter issues unchanged. They were validated
  // against the same frontmatterHash, so re-validating would be wasted
  // work. `strict` can promote `warn → error` retroactively.
  const frontmatterIssues: Issue[] = [];
  const reusedFm = opts.priorFrontmatterIssuesByNode.get(opts.priorNode.path) ?? [];
  for (const issue of reusedFm) {
    frontmatterIssues.push({ ...issue, severity: opts.strict ? 'error' : 'warn' });
  }

  // Persist one `scan_extractor_runs` row per still-applicable, still-
  // cached pair so the next scan sees the cache survive even if no
  // extractor actually ran. Without this, cached pairs would silently
  // disappear on the replace-all persist.
  const ranAt = Date.now();
  const extractorRuns: IExtractorRunRecord[] = [];
  for (const qualified of opts.cachedQualifiedIds) {
    extractorRuns.push({
      nodePath: opts.priorNode.path,
      extractorId: qualified,
      bodyHashAtRun: opts.bodyHash,
      ranAt,
    });
  }

  return { node, internalLinks, frontmatterIssues, extractorRuns };
}

/**
 * Build a brand-new `Node` row from raw provider output and validate
 * its frontmatter. Used by the "no cache hit" branch of
 * `walkAndExtract`. Two frontmatter issue paths:
 *   - With a frontmatter fence: AJV-validate against the Provider's
 *     per-kind schema (Step 6.7).
 *   - Without a fence but a body that opens with malformed `---`:
 *     emit `frontmatter-malformed` (Step 9.4 follow-up).
 *
 * Severity defaults to `warn`; `strict` promotes everything to `error`.
 */
function buildFreshNodeAndValidateFrontmatter(opts: {
  raw: IRawNode;
  kind: NodeKind;
  provider: IProvider;
  bodyHash: string;
  frontmatterHash: string;
  encoder: Tiktoken | null;
  providerFrontmatter: IProviderFrontmatterValidator;
  strict: boolean;
}): { node: Node; frontmatterIssues: Issue[] } {
  const node = buildNode({
    path: opts.raw.path,
    kind: opts.kind,
    providerId: opts.provider.id,
    frontmatterRaw: opts.raw.frontmatterRaw,
    body: opts.raw.body,
    frontmatter: opts.raw.frontmatter,
    bodyHash: opts.bodyHash,
    frontmatterHash: opts.frontmatterHash,
    encoder: opts.encoder,
  });

  const frontmatterIssues: Issue[] = [];
  if (opts.raw.frontmatterRaw.length > 0) {
    const fmIssue = validateFrontmatter(
      opts.providerFrontmatter,
      opts.provider,
      opts.kind,
      opts.raw.frontmatter,
      opts.raw.path,
      opts.strict,
    );
    if (fmIssue) frontmatterIssues.push(fmIssue);
  } else {
    const malformed = detectMalformedFrontmatter(opts.raw.body, opts.raw.path, opts.strict);
    if (malformed) frontmatterIssues.push(malformed);
  }

  return { node, frontmatterIssues };
}

async function walkAndExtract(opts: IWalkAndExtractOptions): Promise<IWalkAndExtractResult> {
  const {
    providers,
    extractors,
    roots,
    ignoreFilter,
    emitter,
    encoder,
    strict,
    enableCache,
    prior,
    priorIndex,
    priorExtractorRuns,
    providerFrontmatter,
  } = opts;
  const { priorNodesByPath, priorLinksByOriginating, priorFrontmatterIssuesByNode } = priorIndex;

  const nodes: Node[] = [];
  const internalLinks: Link[] = [];
  const externalLinks: Link[] = [];
  const cachedPaths = new Set<string>();
  const frontmatterIssues: Issue[] = [];
  // A.8 enrichment buffer. `ctx.enrichNode(partial)` calls fold into a
  // per-Extractor entry keyed by `(nodePath, qualifiedExtractorId)` so the
  // persistence layer can upsert exactly one row per pair into
  // `node_enrichments`. Attribution survives across scans, which lets:
  //   - the stale flag query single-table on (extractor_id, body_hash);
  //   - `sm refresh` re-run only the Extractor whose row is stale;
  //   - the read-time merge sort by `enriched_at` for last-write-wins.
  // Within a single `extract()` invocation, multiple enrichNode calls fold
  // into the same record's `value` (last-write-wins per field).
  const enrichmentBuffer = new Map<string, IEnrichmentRecord>();
  // Phase 4 / A.9 — accumulator for `scan_extractor_runs`. One row per
  // (nodePath, qualifiedExtractorId) pair the orchestrator decided "this
  // extractor is current for this body". Includes both freshly-run pairs
  // and pairs whose prior run was reused intact via the cache.
  const extractorRuns: IExtractorRunRecord[] = [];
  let filesWalked = 0;
  let index = 0;
  const walkOptions = ignoreFilter ? { ignoreFilter } : {};

  // Build the short→qualified id map once for the whole scan. Used to
  // bridge between author-supplied `link.sources` (short id, e.g.
  // `'slash'`) and the qualified ids (`'claude/slash'`) that drive cache
  // bookkeeping. Multiple plugins can in theory expose extractors with
  // the same short id; we keep all qualifieds per short id so the
  // partial-cache filter recognises any of them as "still cached".
  const shortIdToQualified = new Map<string, string[]>();
  for (const ex of extractors) {
    const qualified = qualifiedExtensionId(ex.pluginId, ex.id);
    const list = shortIdToQualified.get(ex.id);
    if (list) list.push(qualified);
    else shortIdToQualified.set(ex.id, [qualified]);
  }

  for (const provider of providers) {
    for await (const raw of provider.walk(roots, walkOptions)) {
      filesWalked += 1;
      const bodyHash = sha256(raw.body);
      // Step 5.13 — hash a CANONICAL form of the frontmatter so a YAML
      // formatter pass (re-indent, sort keys, normalise trailing
      // newline, swap single↔double quotes) doesn't break the
      // medium-confidence rename heuristic. Fallback to raw text when
      // canonicalisation produces empty (parse failed but raw is
      // non-empty) so a malformed-YAML file still hashes
      // deterministically against itself.
      const frontmatterHash = sha256(canonicalFrontmatter(raw.frontmatter, raw.frontmatterRaw));
      const priorNode = priorNodesByPath.get(raw.path);
      // Cache reuse is gated on the explicit `enableCache` option (Step
      // 5.8). The presence of a `prior` alone is no longer enough — a
      // plain `sm scan` always re-walks deterministically; only
      // `sm scan --changed` flips `enableCache` on. The rename heuristic
      // uses `prior` independently of `enableCache`.
      //
      // Phase 4 / A.9 layered the per-(node, extractor) check on top of
      // the existing per-node body+frontmatter check. The node-level
      // hashes still gate cache eligibility (a body change forces a full
      // re-extract regardless of which extractors were registered);
      // within an eligible node we then ask "did every currently-applicable
      // extractor run against this body hash already?". A new extractor
      // registered between scans yields a partial hit: we run only the
      // newcomer.
      const nodeHashCacheEligible =
        enableCache &&
        prior !== null &&
        priorNode !== undefined &&
        priorNode.bodyHash === bodyHash &&
        priorNode.frontmatterHash === frontmatterHash;

      const kind = provider.classify(raw.path, raw.frontmatter);
      index += 1;

      // Per-node, per-extractor cache decision (only meaningful when the
      // node-level hashes already matched). For each extractor that
      // applies to this kind, ask whether the prior runs map already
      // records an entry against the current body hash. Missing entries
      // run; satisfied entries are skipped.
      //
      // Legacy fallback: when `priorExtractorRuns === undefined` the
      // caller did not load the fine-grained breadcrumbs (out-of-band
      // tests, alternate driving adapters), so we treat every applicable
      // extractor as cached when the node-level hashes match. This
      // preserves the pre-A.9 contract for callers that did not opt in.
      const cacheDecision = computeCacheDecision({
        extractors,
        kind,
        nodePath: raw.path,
        bodyHash,
        nodeHashCacheEligible,
        priorExtractorRuns,
      });
      const {
        applicableExtractors,
        applicableQualifiedIds,
        cachedQualifiedIds,
        missingExtractors,
        fullCacheHit,
      } = cacheDecision;

      if (fullCacheHit && priorNode) {
        const reused = reusePriorNode({
          priorNode,
          bodyHash,
          strict,
          cachedQualifiedIds,
          applicableQualifiedIds,
          shortIdToQualified,
          priorLinksByOriginating,
          priorFrontmatterIssuesByNode,
        });
        nodes.push(reused.node);
        cachedPaths.add(reused.node.path);
        for (const link of reused.internalLinks) internalLinks.push(link);
        for (const issue of reused.frontmatterIssues) frontmatterIssues.push(issue);
        for (const run of reused.extractorRuns) extractorRuns.push(run);
        emitter.emit(makeEvent('scan.progress', { index, path: raw.path, kind, cached: true }));
        continue;
      }

      // --- partial or full re-extract path -------------------------------
      // Either a brand-new node, a node whose body / frontmatter changed,
      // or a node whose hashes match but at least one applicable
      // extractor lacks a matching `scan_extractor_runs` row (newly
      // registered, or its prior run was against a different body hash).

      let node: Node;
      const partialCacheHit =
        nodeHashCacheEligible && cachedQualifiedIds.size > 0 && priorNode !== undefined;
      if (partialCacheHit && priorNode) {
        // Body / frontmatter unchanged AND at least one extractor is
        // still cached; reuse the prior node row but re-run the missing
        // extractors. Shallow-clone identical to the full-cache branch
        // so downstream `recomputeLinkCounts` doesn't mutate the caller's
        // prior. NOT marking the path as `cachedPaths` because some
        // extraction is happening — the `externalRefsCount` recompute
        // wants this node to be re-derived from a fresh extractor pass
        // (the missing extractor may emit URLs).
        node = { ...priorNode, bytes: { ...priorNode.bytes } };
        if (priorNode.tokens) node.tokens = { ...priorNode.tokens };
        // Reshape prior internal links per A.9 sources rules:
        //   - missing source (extractor will re-emit)  → drop
        //   - all-obsolete sources                     → drop
        //   - cached + obsolete                        → trim obsolete
        //   - cached only                              → keep verbatim
        const reusedLinks = priorLinksByOriginating.get(priorNode.path) ?? [];
        for (const link of reusedLinks) {
          const reshaped = reuseCachedLink(
            link,
            shortIdToQualified,
            cachedQualifiedIds,
            applicableQualifiedIds,
          );
          if (reshaped) internalLinks.push(reshaped);
        }
        // Re-emit prior frontmatter issues — same rationale as the
        // full-cache branch (frontmatter hash is unchanged).
        const reusedFm = priorFrontmatterIssuesByNode.get(priorNode.path) ?? [];
        for (const issue of reusedFm) {
          frontmatterIssues.push({ ...issue, severity: strict ? 'error' : 'warn' });
        }
        nodes.push(node);
      } else {
        const fresh = buildFreshNodeAndValidateFrontmatter({
          raw, kind, provider, bodyHash, frontmatterHash, encoder,
          providerFrontmatter, strict,
        });
        node = fresh.node;
        nodes.push(node);
        for (const issue of fresh.frontmatterIssues) frontmatterIssues.push(issue);
      }
      emitter.emit(makeEvent('scan.progress', {
        index,
        path: raw.path,
        kind,
        cached: false,
        ...(partialCacheHit ? { partialCache: true } : {}),
      }));

      // Decide which extractors actually run. Full re-extract → all
      // applicable. Partial cache → only the missing ones. Either way,
      // the orchestrator records a fresh `scan_extractor_runs` row for
      // each invocation AND for each cached extractor whose contribution
      // survived intact (so the cache persists across scans).
      const extractorsToRun = partialCacheHit ? missingExtractors : applicableExtractors;
      const extractResult = await runExtractorsForNode({
        extractors: extractorsToRun,
        node,
        body: raw.body,
        frontmatter: raw.frontmatter,
        bodyHash,
        emitter,
      });
      for (const link of extractResult.internalLinks) internalLinks.push(link);
      for (const link of extractResult.externalLinks) externalLinks.push(link);
      // Merge per-node enrichment records into the scan-wide buffer.
      // Keys are `${nodePath}\x00${extractorId}` and unique per node
      // (paths are unique across the scan), so `set()` is collision-free
      // — but we keep the keyed shape in case future code wants to fold
      // across providers walking the same node.
      for (const enr of extractResult.enrichments) {
        enrichmentBuffer.set(`${enr.nodePath}\x00${enr.extractorId}`, enr);
      }

      // Persist a `scan_extractor_runs` row for every applicable
      // extractor (both freshly-run AND cached ones whose contribution
      // we reused). Skipping cached entries here would let the
      // replace-all persist forget them — defeating the whole point of
      // the partial-cache path.
      const ranAt = Date.now();
      for (const ex of applicableExtractors) {
        const qualified = qualifiedExtensionId(ex.pluginId, ex.id);
        extractorRuns.push({
          nodePath: node.path,
          extractorId: qualified,
          bodyHashAtRun: bodyHash,
          ranAt,
        });
      }
    }
  }

  return {
    nodes,
    internalLinks,
    externalLinks,
    cachedPaths,
    frontmatterIssues,
    filesWalked,
    enrichments: [...enrichmentBuffer.values()],
    extractorRuns,
  };
}

/**
 * Phase 4 / A.9 — decide whether a prior link can be reused on a cached
 * node, and how its `sources` array should be reshaped.
 *
 * Three buckets per source short id:
 *   - **Cached**: short id maps to a currently-registered qualified id
 *     that has a matching `scan_extractor_runs` row for this body hash.
 *     The contribution is fresh and survives.
 *   - **Missing**: short id maps to a currently-registered qualified id
 *     that does NOT have a matching row for this body hash (newly
 *     registered, or its prior run targeted a different body). The
 *     missing extractor is about to run and will re-emit its own link
 *     row, so we drop the prior link entirely to avoid duplicates.
 *   - **Obsolete**: short id maps to no currently-registered qualified
 *     id at all (the extractor was uninstalled). The contribution is
 *     stranded but harmless — we strip the obsolete short id from
 *     `sources` and keep the link if at least one cached source remains.
 *
 * Decision rules:
 *   - Any missing source → return `null` (drop the link).
 *   - All cached, no obsolete → return the link as-is.
 *   - Cached + obsolete (no missing) → return a clone with obsolete
 *     sources filtered out.
 *   - All obsolete (no cached, no missing) → return `null` (no live
 *     extractor still claims this link).
 *
 * Source-id mapping caveat: `link.sources` carries the short id the
 * extractor author wrote (e.g. `'slash'`); the cache table keys on the
 * qualified id (`'claude/slash'`). Multiple plugins COULD declare an
 * extractor with the same short id; the map keeps every qualified id per
 * short id so this filter recognises any of them as "still cached".
 */
function reuseCachedLink(
  link: Link,
  shortIdToQualified: Map<string, string[]>,
  cachedQualifiedIds: Set<string>,
  applicableQualifiedIds: Set<string>,
): Link | null {
  if (!Array.isArray(link.sources) || link.sources.length === 0) return null;
  const cachedSources: string[] = [];
  const obsoleteSources: string[] = [];
  let hasMissing = false;
  for (const source of link.sources) {
    const candidates = shortIdToQualified.get(source);
    if (!candidates || candidates.length === 0) {
      // No registered extractor at all carries this short id → obsolete.
      obsoleteSources.push(source);
      continue;
    }
    if (candidates.some((q) => cachedQualifiedIds.has(q))) {
      cachedSources.push(source);
      continue;
    }
    if (candidates.some((q) => applicableQualifiedIds.has(q))) {
      // Registered for this kind but not cached for this body → the
      // missing extractor will re-emit; dropping the prior link avoids
      // duplicates.
      hasMissing = true;
      continue;
    }
    // Registered but not applicable to this kind → treat as obsolete
    // for this node (cannot be re-emitted here).
    obsoleteSources.push(source);
  }
  if (hasMissing) return null;
  if (cachedSources.length === 0) return null;
  if (obsoleteSources.length === 0) return link;
  // Trim the obsolete short ids from `sources` so the persisted row no
  // longer claims attribution from an extractor the user removed.
  return { ...link, sources: cachedSources };
}

/**
 * Run every registered rule over the merged graph. Rules see internal
 * links only — broken-ref / trigger-collision / superseded all reason
 * about graph relations, not URLs.
 */
async function runRules(
  rules: IRule[],
  nodes: Node[],
  internalLinks: Link[],
  emitter: ProgressEmitterPort,
  hookDispatcher: IHookDispatcher,
): Promise<Issue[]> {
  const issues: Issue[] = [];
  for (const rule of rules) {
    const emitted = await rule.evaluate({ nodes, links: internalLinks });
    for (const issue of emitted) {
      const validated = validateIssue(rule, issue, emitter);
      if (validated) issues.push(validated);
    }
    // Spec § A.11 — `rule.completed`. Aggregated per Rule, after every
    // issue has been validated. Fan-out scope: one event per Rule per
    // scan. The payload carries the qualified rule id so a hook with
    // `filter: { ruleId: '...' }` can scope to a single rule.
    const ruleId = qualifiedExtensionId(rule.pluginId, rule.id);
    const evt = makeEvent('rule.completed', { ruleId });
    emitter.emit(evt);
    await hookDispatcher.dispatch('rule.completed', evt);
  }
  return issues;
}

/**
 * The "originating node" of a link — the node whose body / frontmatter
 * the extractor was processing when it emitted the link. For most kinds
 * this equals `link.source`, but the frontmatter extractor emits inverted
 * `supersedes` links (from a node's `metadata.supersededBy`) where
 * `target` is the originating node and `source` is the (forward-pointing)
 * supersedor. The forward case (`metadata.supersedes`) keeps
 * `originating === source` like every other extractor.
 *
 * Discriminator: the supersedor path in an inverted edge is rarely a
 * real node (it points "forward" to a file that may or may not exist on
 * disk under that exact path); the originating node always exists in
 * the prior snapshot (it's the node whose extraction produced the link).
 * So for `kind === 'supersedes'`: prefer `source` when source is a known
 * prior node, otherwise fall back to `target`. This handles BOTH the
 * forward case (originating === source, which IS a known node) and the
 * inverted case (source not a node → fall through to target, the
 * originating older node).
 *
 * Frontmatter is the only extractor that emits cross-source links today;
 * if a future extractor adds another inversion case, escalate to a
 * persisted `Link.extractedFromPath` field with a schema bump rather
 * than extending this heuristic.
 */
function originatingNodeOf(link: Link, priorNodePaths: Set<string>): string {
  if (link.kind === 'supersedes' && !priorNodePaths.has(link.source)) {
    return link.target;
  }
  return link.source;
}

/**
 * Step 1 of `detectRenamesAndOrphans` — pair every `deletedPath` with a
 * `newPath` whose body hash matches. Greedy by sorted order; on first
 * hit the deletion is claimed and we move on. Mutates the supplied
 * `claimedDeleted` / `claimedNew` sets in place.
 */
function findHighConfidenceRenames(opts: {
  deletedPaths: string[];
  newPaths: string[];
  priorByPath: Map<string, Node>;
  currentByPath: Map<string, Node>;
  claimedDeleted: Set<string>;
  claimedNew: Set<string>;
}): RenameOp[] {
  const ops: RenameOp[] = [];
  for (const fromPath of opts.deletedPaths) {
    if (opts.claimedDeleted.has(fromPath)) continue;
    const fromNode = opts.priorByPath.get(fromPath)!;
    for (const toPath of opts.newPaths) {
      if (opts.claimedNew.has(toPath)) continue;
      const toNode = opts.currentByPath.get(toPath)!;
      if (toNode.bodyHash === fromNode.bodyHash) {
        ops.push({ from: fromPath, to: toPath, confidence: 'high' });
        opts.claimedDeleted.add(fromPath);
        opts.claimedNew.add(toPath);
        break;
      }
    }
  }
  return ops;
}

/**
 * Step 2 of `detectRenamesAndOrphans` — bucket every still-unclaimed
 * `newPath` by the set of still-unclaimed `deletedPath`s that share its
 * `frontmatterHash`. The map drives both the medium-confidence claim
 * pass and the ambiguous-flag pass.
 */
function buildFrontmatterRenameCandidates(opts: {
  deletedPaths: string[];
  newPaths: string[];
  priorByPath: Map<string, Node>;
  currentByPath: Map<string, Node>;
  claimedDeleted: Set<string>;
  claimedNew: Set<string>;
}): Map<string, string[]> {
  const candidatesByNew = new Map<string, string[]>();
  for (const toPath of opts.newPaths) {
    if (opts.claimedNew.has(toPath)) continue;
    const toNode = opts.currentByPath.get(toPath)!;
    const matches: string[] = [];
    for (const fromPath of opts.deletedPaths) {
      if (opts.claimedDeleted.has(fromPath)) continue;
      const fromNode = opts.priorByPath.get(fromPath)!;
      if (toNode.frontmatterHash === fromNode.frontmatterHash) {
        matches.push(fromPath);
      }
    }
    if (matches.length > 0) candidatesByNew.set(toPath, matches);
  }
  return candidatesByNew;
}

/**
 * Step 3a of `detectRenamesAndOrphans` — first pass over the candidate
 * map: a `newPath` whose surviving candidate set is a singleton wins
 * the deletion, with `auto-rename-medium`. Greedy by sorted `newPath`
 * order so a deletion claimed by an earlier singleton drops out of
 * later candidate filters. Mutates `claimedDeleted` / `claimedNew` /
 * `issues` in place.
 */
function claimSingletonRenames(opts: {
  newPaths: string[];
  candidatesByNew: Map<string, string[]>;
  claimedDeleted: Set<string>;
  claimedNew: Set<string>;
  issues: Issue[];
}): RenameOp[] {
  const ops: RenameOp[] = [];
  for (const toPath of opts.newPaths) {
    if (opts.claimedNew.has(toPath)) continue;
    const candidates = opts.candidatesByNew.get(toPath);
    if (!candidates) continue;
    const remaining = candidates.filter((p) => !opts.claimedDeleted.has(p));
    if (remaining.length === 1) {
      const fromPath = remaining[0]!;
      ops.push({ from: fromPath, to: toPath, confidence: 'medium' });
      opts.issues.push({
        ruleId: 'auto-rename-medium',
        severity: 'warn',
        nodeIds: [toPath],
        message: `Auto-rename (medium confidence): ${fromPath} → ${toPath}`,
        data: { from: fromPath, to: toPath, confidence: 'medium' },
      });
      opts.claimedDeleted.add(fromPath);
      opts.claimedNew.add(toPath);
    }
  }
  return ops;
}

/**
 * Step 3b of `detectRenamesAndOrphans` — any `newPath` left with more
 * than one viable candidate after singletons settled is ambiguous.
 * Emits one `auto-rename-ambiguous` per `newPath`. Candidates are NOT
 * claimed; they fall through to the orphan step so the user can
 * reconcile manually with `sm orphans undo-rename`.
 */
function flagAmbiguousRenames(opts: {
  newPaths: string[];
  candidatesByNew: Map<string, string[]>;
  claimedDeleted: Set<string>;
  claimedNew: Set<string>;
  issues: Issue[];
}): void {
  for (const toPath of opts.newPaths) {
    if (opts.claimedNew.has(toPath)) continue;
    const candidates = opts.candidatesByNew.get(toPath);
    if (!candidates) continue;
    const remaining = candidates.filter((p) => !opts.claimedDeleted.has(p));
    if (remaining.length > 1) {
      opts.issues.push({
        ruleId: 'auto-rename-ambiguous',
        severity: 'warn',
        nodeIds: [toPath],
        message:
          `Auto-rename ambiguous: ${toPath} matches ${remaining.length} ` +
          `prior frontmatters — pick one with \`sm orphans undo-rename ` +
          `${toPath} --from <old.path>\`.`,
        data: { to: toPath, candidates: remaining },
      });
    }
  }
}

/**
 * Step 4 of `detectRenamesAndOrphans` — every deletion left unclaimed
 * after steps 1-3 yields one `orphan` issue (info severity).
 */
function flagOrphans(opts: {
  deletedPaths: string[];
  claimedDeleted: Set<string>;
  issues: Issue[];
}): void {
  for (const fromPath of opts.deletedPaths) {
    if (opts.claimedDeleted.has(fromPath)) continue;
    opts.issues.push({
      ruleId: 'orphan',
      severity: 'info',
      nodeIds: [fromPath],
      message: `Orphan history: ${fromPath} was deleted; no rename match found.`,
      data: { path: fromPath },
    });
  }
}

/**
 * Pure rename / orphan classification per `spec/db-schema.md` §Rename
 * detection. Mutates `issues` in place — caller passes the in-progress
 * issue list; returns the `RenameOp[]` for the persistence layer to
 * apply inside its tx.
 *
 * Pipeline (1-to-1: a `newPath` claimed by one stage cannot be reused
 * by another):
 *
 *   1. **High-confidence**: pair each `deletedPath` with a `newPath`
 *      that has the same `bodyHash`. No issue, no prompt.
 *   2. **Medium-confidence (1:1)**: of the remaining deletions, pair
 *      each with the *unique* unclaimed `newPath` that shares its
 *      `frontmatterHash`. Emits `auto-rename-medium` (severity warn)
 *      with `data: { from, to, confidence: 'medium' }`.
 *   3. **Ambiguous (N:1)**: when a single `newPath` has more than one
 *      remaining frontmatter-matching candidate, emit ONE
 *      `auto-rename-ambiguous` issue per `newPath`, listing all
 *      candidates in `data.candidates`. NO migration.
 *   4. **Orphan**: every `deletedPath` left after steps 1-3 yields one
 *      `orphan` issue (severity info) with `data: { path: <deletedPath> }`.
 *
 * Determinism: `deletedPaths` and `newPaths` are iterated in lex-asc
 * order so the same input always produces the same matches —
 * required for reproducible tests and conformance fixtures (the spec
 * does not prescribe an order, but stability is the obvious contract).
 */
export function detectRenamesAndOrphans(
  prior: ScanResult,
  current: Node[],
  issues: Issue[],
): RenameOp[] {
  const priorByPath = new Map<string, Node>();
  for (const n of prior.nodes) priorByPath.set(n.path, n);
  const currentByPath = new Map<string, Node>();
  for (const n of current) currentByPath.set(n.path, n);

  // Sets / sorted lists so iteration is deterministic.
  const deletedPaths = [...priorByPath.keys()]
    .filter((p) => !currentByPath.has(p))
    .sort();
  const newPaths = [...currentByPath.keys()]
    .filter((p) => !priorByPath.has(p))
    .sort();

  const claimedDeleted = new Set<string>();
  const claimedNew = new Set<string>();
  const ops: RenameOp[] = [];

  // Step 1 — high confidence (body hash match).
  ops.push(...findHighConfidenceRenames({
    deletedPaths, newPaths, priorByPath, currentByPath, claimedDeleted, claimedNew,
  }));

  // Step 2 — bucket every `newPath` by the deletions that share its
  // frontmatterHash, used by both medium-confidence and ambiguous passes.
  const candidatesByNew = buildFrontmatterRenameCandidates({
    deletedPaths, newPaths, priorByPath, currentByPath, claimedDeleted, claimedNew,
  });

  // Step 3a — singleton candidates → medium-confidence renames.
  ops.push(...claimSingletonRenames({
    newPaths, candidatesByNew, claimedDeleted, claimedNew, issues,
  }));

  // Step 3b — multi-candidate `newPath`s left after singletons settled.
  flagAmbiguousRenames({ newPaths, candidatesByNew, claimedDeleted, claimedNew, issues });

  // Step 4 — every unclaimed deletion is an orphan.
  flagOrphans({ deletedPaths, claimedDeleted, issues });

  return ops;
}

/**
 * Any link whose target carries a URL-shaped scheme is external (counted
 * via `externalRefsCount`, dropped from `result.links`). Internal links
 * are filesystem paths — relative or absolute, no scheme.
 *
 * The regex matches RFC 3986's `scheme = ALPHA *( ALPHA / DIGIT / "+" /
 * "-" / "." )` followed by `:`, with the extra constraint of ≥ 2 chars
 * so a Windows-style absolute path (`C:\foo`) is not misclassified as a
 * URL on the rare cross-platform path that survives normalization.
 *
 * Before this regex the implementation only matched `http://` and
 * `https://`, which silently let `mailto:`, `data:`, `file:///`, `ftp://`
 * etc. pollute the graph as fake-internal links (their lookup against
 * `byPath` always missed, so counts stayed at 0, but the rows survived
 * in `result.links` and the rule pipeline saw them).
 */
const EXTERNAL_URL_SCHEME_RE = /^[a-z][a-z0-9+\-.]+:/i;

function isExternalUrlLink(link: Link): boolean {
  return EXTERNAL_URL_SCHEME_RE.test(link.target);
}

function makeEvent(type: string, data: unknown): ProgressEvent {
  return { type, timestamp: new Date().toISOString(), data };
}

/**
 * Spec § A.11 — Hook lifecycle dispatcher. Indexes the supplied hooks by
 * trigger and fans the matching event out to every subscribed
 * deterministic hook in registration order. Probabilistic hooks are
 * skipped here with a stderr advisory; they will dispatch via the job
 * subsystem at Step 10.
 *
 * Filter handling: when the hook declares a `filter` map, the dispatcher
 * walks `event.data` for each declared key and short-circuits the
 * invocation when any value disagrees. Top-level fields only in v0.x
 * (deep-path matching is deferred until a real use case justifies the
 * complexity).
 *
 * Error policy: a hook that throws is caught here, logged through a
 * synthetic `extension.error` event with kind `hook-error`, and the
 * scan continues. A buggy hook MUST NOT block the main pipeline —
 * that would invert the design intent (hooks REACT to events, they
 * never steer them).
 */
interface IHookDispatcher {
  dispatch(trigger: THookTrigger, event: ProgressEvent): Promise<void>;
}

function makeHookDispatcher(hooks: IHook[], emitter: ProgressEmitterPort): IHookDispatcher {
  if (hooks.length === 0) {
    // Cheap no-op fast path: most scans don't carry any hooks today.
    return { dispatch: async () => {} };
  }

  // Index by trigger so dispatch is O(matching) rather than O(allHooks).
  // Iteration order within a trigger preserves registration order so
  // observers see deterministic fan-out.
  const byTrigger = new Map<THookTrigger, IHook[]>();
  for (const hook of hooks) {
    if (hook.mode === 'probabilistic') {
      // Probabilistic hooks defer to the job subsystem (Step 10). Log
      // once per hook at composition time — not per-event — so a noisy
      // scan doesn't flood the logger. The hook still surfaces in
      // `sm plugins list`; it just doesn't fire today.
      const qualifiedId = qualifiedExtensionId(hook.pluginId, hook.id);
      log.warn(
        `Probabilistic hook ${qualifiedId} deferred to job subsystem (Step 10). The hook is registered but will not dispatch in-scan.`,
        { hookId: qualifiedId, mode: 'probabilistic' },
      );
      continue;
    }
    for (const trig of hook.triggers) {
      const bucket = byTrigger.get(trig);
      if (bucket) bucket.push(hook);
      else byTrigger.set(trig, [hook]);
    }
  }

  return {
    async dispatch(trigger, event) {
      const subs = byTrigger.get(trigger);
      if (!subs || subs.length === 0) return;
      for (const hook of subs) {
        if (!matchesFilter(hook, event)) continue;
        const ctx = buildHookContext(hook, trigger, event);
        try {
          await hook.on(ctx);
        } catch (err) {
          const qualifiedId = qualifiedExtensionId(hook.pluginId, hook.id);
          const message = err instanceof Error ? err.message : String(err);
          emitter.emit(
            makeEvent('extension.error', {
              kind: 'hook-error',
              extensionId: qualifiedId,
              trigger,
              message,
            }),
          );
        }
      }
    },
  };
}

function matchesFilter(hook: IHook, event: ProgressEvent): boolean {
  if (!hook.filter) return true;
  const data = (event.data ?? {}) as Record<string, unknown>;
  for (const [key, expected] of Object.entries(hook.filter)) {
    if (data[key] !== expected) return false;
  }
  return true;
}

function buildHookContext(
  _hook: IHook,
  trigger: THookTrigger,
  event: ProgressEvent,
): IHookContext {
  const data = (event.data ?? {}) as Record<string, unknown>;
  const ctx: IHookContext = {
    event: {
      type: trigger,
      timestamp: event.timestamp,
      ...(event.runId !== undefined ? { runId: event.runId } : {}),
      ...(event.jobId !== undefined ? { jobId: event.jobId } : {}),
      data: event.data,
    },
  };
  if (typeof data['extractorId'] === 'string') ctx.extractorId = data['extractorId'];
  if (typeof data['ruleId'] === 'string') ctx.ruleId = data['ruleId'];
  if (typeof data['actionId'] === 'string') ctx.actionId = data['actionId'];
  if (data['node'] && typeof data['node'] === 'object') {
    ctx.node = data['node'] as Node;
  }
  if (data['jobResult'] !== undefined) ctx.jobResult = data['jobResult'];
  return ctx;
}

interface IBuildNodeArgs {
  path: string;
  kind: Node['kind'];
  providerId: string;
  frontmatterRaw: string;
  body: string;
  frontmatter: Record<string, unknown>;
  bodyHash: string;
  frontmatterHash: string;
  encoder: Tiktoken | null;
}

function buildNode(args: IBuildNodeArgs): Node {
  const bytesFrontmatter = Buffer.byteLength(args.frontmatterRaw, 'utf8');
  const bytesBody = Buffer.byteLength(args.body, 'utf8');
  const metadata = pickMetadata(args.frontmatter);
  const node: Node = {
    path: args.path,
    kind: args.kind,
    provider: args.providerId,
    bodyHash: args.bodyHash,
    frontmatterHash: args.frontmatterHash,
    bytes: {
      frontmatter: bytesFrontmatter,
      body: bytesBody,
      total: bytesFrontmatter + bytesBody,
    },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    frontmatter: args.frontmatter,
    title: pickString(args.frontmatter['name']),
    description: pickString(args.frontmatter['description']),
    stability: pickStability(metadata?.['stability']),
    version: pickString(metadata?.['version']),
    author: pickString(args.frontmatter['author']),
  };
  if (args.encoder) {
    node.tokens = countTokens(args.encoder, args.frontmatterRaw, args.body);
  }
  return node;
}

function countTokens(encoder: Tiktoken, frontmatterRaw: string, body: string): TripleSplit {
  // Tokenize the raw frontmatter bytes (not the parsed object) so the
  // count stays reproducible from on-disk content.
  const frontmatter = frontmatterRaw.length > 0 ? encoder.encode(frontmatterRaw).length : 0;
  const bodyTokens = body.length > 0 ? encoder.encode(body).length : 0;
  return { frontmatter, body: bodyTokens, total: frontmatter + bodyTokens };
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Step 5.13 — canonical YAML form for frontmatter hashing.
 *
 * Goal: two `.md` files whose frontmatter parses to the same logical
 * value MUST produce the same `frontmatter_hash`, even if the raw bytes
 * differ in indentation, key order, quote style, or trailing whitespace.
 * Without this canonicalisation, a YAML formatter pass on the user's
 * editor (Prettier YAML, IDE autoformat, manual indent fix) silently
 * breaks the medium-confidence rename heuristic.
 *
 * Strategy:
 *   1. Take the parsed object the Provider already produced.
 *   2. Re-emit via `yaml.dump` with `sortKeys: true`, `lineWidth: -1`
 *      (no auto-wrap), `noRefs: true` (no `*alias` shorthand),
 *      `noCompatMode: true` (modern YAML 1.2 output).
 *   3. Hash the result.
 *
 * Fallback: when `parsed` is the empty object `{}` BUT `raw` is
 * non-empty, the Provider's parse failed silently. We fall back to
 * hashing the raw text — a malformed-YAML file should still hash
 * deterministically against itself across rescans, even if the
 * canonical form would be empty.
 */
function canonicalFrontmatter(
  parsed: Record<string, unknown>,
  raw: string,
): string {
  const hasParsedKeys = Object.keys(parsed).length > 0;
  const hasRawText = raw.length > 0;
  if (!hasParsedKeys && hasRawText) {
    // Parse failed but raw text exists. Hash the raw — preserves
    // identity for malformed-YAML files across scans.
    return raw;
  }
  return yaml.dump(parsed, {
    sortKeys: true,
    lineWidth: -1,
    noRefs: true,
    noCompatMode: true,
  });
}

function pickMetadata(fm: Record<string, unknown>): Record<string, unknown> | null {
  const m = fm['metadata'];
  return m && typeof m === 'object' && !Array.isArray(m) ? (m as Record<string, unknown>) : null;
}

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function pickStability(value: unknown): 'experimental' | 'stable' | 'deprecated' | null {
  if (value === 'experimental' || value === 'stable' || value === 'deprecated') return value;
  return null;
}

function buildExtractorContext(
  extractor: IExtractor,
  node: Node,
  body: string,
  frontmatter: Record<string, unknown>,
  emitLink: (link: Link) => void,
  enrichNode: (partial: Partial<Node>) => void,
): IExtractorContext {
  const scope = extractor.scope;
  return {
    node,
    body: scope === 'frontmatter' ? '' : body,
    frontmatter: scope === 'body' ? {} : frontmatter,
    emitLink,
    enrichNode,
  };
}

function validateLink(extractor: IExtractor, link: Link, emitter: ProgressEmitterPort): Link | null {
  if (!extractor.emitsLinkKinds.includes(link.kind as LinkKind)) {
    // Extractor emitted a kind outside its declared set — drop the link.
    // Surface a `extension.error` diagnostic so plugin authors see WHY a
    // link they expected vanished from the result; silent drops are the
    // worst possible plugin-author UX. The orchestrator is the last line
    // of defence against a misbehaving extractor, but the author needs to
    // know the line fired.
    //
    // `extensionId` carries the qualified form `<pluginId>/<id>` (spec
    // § A.6) so the diagnostic matches what `sm plugins list` and
    // registry lookups use. Older builds emitted just the short id; the
    // qualified form is unambiguous across plugins.
    const qualifiedId = `${extractor.pluginId}/${extractor.id}`;
    emitter.emit(
      makeEvent('extension.error', {
        kind: 'link-kind-not-declared',
        extensionId: qualifiedId,
        linkKind: link.kind,
        declaredKinds: extractor.emitsLinkKinds,
        link: { source: link.source, target: link.target, kind: link.kind },
        message: tx(ORCHESTRATOR_TEXTS.extensionErrorLinkKindNotDeclared, {
          extractorId: qualifiedId,
          linkKind: link.kind,
          declaredKinds: extractor.emitsLinkKinds.join(', '),
        }),
      }),
    );
    return null;
  }
  const confidence: Confidence = link.confidence ?? extractor.defaultConfidence;
  return { ...link, confidence };
}

/**
 * Validate a node's frontmatter against the per-kind schema declared by
 * the Provider that classified the node. Only called for files that
 * actually declared a fence (caller checks `frontmatterRaw.length > 0`).
 * Returns a single `frontmatter-invalid` issue with the AJV error
 * string, or `null` when the frontmatter is structurally valid. Severity
 * is `warn` by default; `strict` flips it to `error` so the scan exit
 * code rises to 1.
 *
 * Phase 3 (spec 0.8.0): per-kind schemas live with the Provider, not in
 * spec. The orchestrator passes the live `IProviderFrontmatterValidator`
 * (composed from every loaded Provider's `kinds[<kind>].schemaJson`)
 * plus the active Provider so the lookup is `(provider.id, kind) →
 * schema`. A Provider that does not declare an entry for the kind it
 * classified into still gets a `frontmatter-invalid` issue with errors
 * `'no-schema'` so the kernel never silently skips validation.
 */
function validateFrontmatter(
  providerFrontmatter: IProviderFrontmatterValidator,
  provider: IProvider,
  kind: NodeKind,
  frontmatter: Record<string, unknown>,
  path: string,
  strict: boolean,
): Issue | null {
  const result = providerFrontmatter.validate(provider, kind, frontmatter);
  if (result.ok) return null;
  return {
    ruleId: 'frontmatter-invalid',
    severity: strict ? 'error' : 'warn',
    nodeIds: [path],
    message: tx(ORCHESTRATOR_TEXTS.frontmatterInvalid, { path, kind, errors: result.errors }),
    data: { kind, errors: result.errors },
  };
}

/**
 * Step 9.4 follow-up — detect cases where the user clearly meant
 * frontmatter but the Provider's regex couldn't recognise the fence.
 * The Provider regex requires `^---\r?\n[\s\S]*?\r?\n---\r?\n?` —
 * column-0 open fence, column-0 close fence, CRLF or LF line endings.
 * Three real-world variants that fall through silently and silently
 * lose every metadata field:
 *
 *   - `paste-with-indent`: terminal heredoc auto-indented every line,
 *     so the open fence is `<spaces>---`. The most common variant
 *     (surfaced during Step 9 manual QA).
 *   - `byte-order-mark`: a UTF-8 BOM (﻿) precedes the fence. Some
 *     editors (notably old VS Code on Windows) inject this; the YAML
 *     parser handles BOM, but the Provider regex doesn't anchor past it.
 *   - `missing-close`: the open fence is on column 0 but the closing
 *     fence is missing or indented. Whole "frontmatter" parses as body.
 *
 * Each variant emits a `frontmatter-malformed` warn with a `data.hint`
 * tag so downstream tooling can disambiguate. `--strict` promotes to
 * `error` consistent with the strict-fence policy.
 *
 * False-positive guards:
 *
 *   - Indented `---` with no YAML-looking line after → likely a nested
 *     horizontal rule, not malformed frontmatter.
 *   - Column-0 `---` followed by prose (not a YAML key) → likely a
 *     legitimate horizontal rule with prose underneath. Tested.
 *
 * The schema-strict validator above only fires when `frontmatterRaw`
 * is non-empty; this fills the previously-silent path where the Provider
 * couldn't even recognise the fence.
 */
function detectMalformedFrontmatter(body: string, path: string, strict: boolean): Issue | null {
  const hint = classifyMalformedFrontmatter(body);
  if (!hint) return null;
  return {
    ruleId: 'frontmatter-malformed',
    severity: strict ? 'error' : 'warn',
    nodeIds: [path],
    message: malformedMessage(hint, path),
    data: { hint },
  };
}

type TMalformedHint = 'paste-with-indent' | 'byte-order-mark' | 'missing-close';

function classifyMalformedFrontmatter(body: string): TMalformedHint | null {
  // (a) BOM at the very first byte. Check before everything else
  // because a BOM offsets the column-0 anchor of the Provider's regex.
  // Pattern after BOM is the standard column-0 fence + YAML key-value
  // line, so we still require that shape to avoid false positives on
  // any BOM-prefixed prose.
  if (body.startsWith('﻿')) {
    if (/^﻿---\r?\n[\s\S]*?[A-Za-z0-9_-]+\s*:/.test(body)) {
      return 'byte-order-mark';
    }
  }

  // (b) Indented opening fence followed by a YAML-looking key-value
  // line. The most common variant (terminal heredoc auto-indent).
  if (/^[ \t]+---\r?\n[ \t]*[A-Za-z0-9_-]+\s*:/.test(body)) {
    return 'paste-with-indent';
  }

  // (c) Column-0 opening fence followed by a YAML-looking key-value
  // line, but no matching closing fence. The Provider regex needs both
  // fences; a missing close means the entire intended frontmatter
  // (plus the body) parses as body.
  //
  // Heuristic: open at column 0, then at least one `key: value` line
  // immediately, then anywhere in the file there is NO column-0 `---`
  // closing the block. If the body had been parsed as frontmatter the
  // Provider would have set `frontmatterRaw` non-empty and we wouldn't
  // be in this branch — so the absence of close means the regex
  // didn't match.
  if (/^---\r?\n[ \t]*[A-Za-z0-9_-]+\s*:/.test(body)) {
    // Search for any line that is exactly `---` (column 0, no indent).
    // If found, the Provider regex would have matched and this code
    // path is unreachable; absence here means the close is missing
    // or indented.
    const hasCloseFence = /\r?\n---(?:\r?\n|$)/.test(body);
    if (!hasCloseFence) {
      return 'missing-close';
    }
  }

  return null;
}

function malformedMessage(hint: TMalformedHint, path: string): string {
  switch (hint) {
    case 'paste-with-indent':
      return tx(ORCHESTRATOR_TEXTS.frontmatterMalformedPasteWithIndent, { path });
    case 'byte-order-mark':
      return tx(ORCHESTRATOR_TEXTS.frontmatterMalformedByteOrderMark, { path });
    case 'missing-close':
      return tx(ORCHESTRATOR_TEXTS.frontmatterMalformedMissingClose, { path });
  }
}

function validateIssue(rule: IRule, issue: Issue, emitter: ProgressEmitterPort): Issue | null {
  const severity: Severity | undefined = issue.severity;
  if (severity !== 'error' && severity !== 'warn' && severity !== 'info') {
    // Rule emitted an out-of-spec severity (or none at all) — drop the
    // issue. Surface a diagnostic so plugin authors see the issue
    // disappear FOR A REASON, instead of silently never showing up.
    // Qualified id (spec § A.6) keeps `extension.error` consumers
    // unambiguous across plugin namespaces.
    const qualifiedId = `${rule.pluginId}/${rule.id}`;
    emitter.emit(
      makeEvent('extension.error', {
        kind: 'issue-invalid-severity',
        extensionId: qualifiedId,
        severity,
        issue: { ruleId: issue.ruleId || rule.id, message: issue.message, nodeIds: issue.nodeIds },
        message: tx(ORCHESTRATOR_TEXTS.extensionErrorIssueInvalidSeverity, {
          ruleId: qualifiedId,
          severity: JSON.stringify(severity),
        }),
      }),
    );
    return null;
  }
  return { ...issue, ruleId: issue.ruleId || rule.id };
}

function recomputeLinkCounts(nodes: Node[], links: Link[]): void {
  const byPath = new Map<string, Node>();
  for (const node of nodes) {
    // Reset counts so a node reused from prior (which carries its prior
    // counts) gets re-counted from the merged internal-link list.
    node.linksOutCount = 0;
    node.linksInCount = 0;
    byPath.set(node.path, node);
  }
  for (const link of links) {
    const source = byPath.get(link.source);
    if (source) source.linksOutCount += 1;
    const target = byPath.get(link.target);
    if (target) target.linksInCount += 1;
  }
}

function recomputeExternalRefsCount(
  nodes: Node[],
  externalLinks: Link[],
  cachedPaths: Set<string>,
): void {
  const byPath = new Map<string, Node>();
  for (const node of nodes) {
    // Zero only freshly-built nodes. Cached nodes preserve their prior
    // `externalRefsCount` because external pseudo-links were never
    // persisted, so we cannot re-derive the count from a fresh extractor
    // pass — the count survives untouched in the node row.
    if (!cachedPaths.has(node.path)) node.externalRefsCount = 0;
    byPath.set(node.path, node);
  }
  for (const link of externalLinks) {
    const source = byPath.get(link.source);
    // Cached nodes never appear as the source of a freshly-emitted
    // external pseudo-link (extractors didn't run for them), so this
    // increment only ever lands on a freshly-built node — but the guard
    // is cheap and defensive.
    if (source && !cachedPaths.has(source.path)) source.externalRefsCount += 1;
  }
}

/**
 * Phase 4 / A.8 — produce the merged read-time view of a Node.
 *
 * Rules / `sm check` / `sm export` consume `node.frontmatter` directly
 * (deterministic CI-safe baseline — author intent, byte-stable). UI / future
 * rules that opt into enrichment context call this helper to merge the
 * author frontmatter with the live enrichment layer.
 *
 * Algorithm:
 *
 *   1. Filter `enrichments` down to rows targeting this node AND not
 *      flagged `stale`. Stale rows (probabilistic enrichments whose
 *      body changed since their last run) are excluded by default —
 *      stale visibility belongs to the UI layer where the marker is
 *      shown next to the value.
 *   2. Sort the survivors by `enrichedAt` ASC so iteration order is
 *      "oldest first". This makes the spread merge below
 *      last-write-wins per field — the freshest Extractor's value
 *      pisar the older one for any conflicting key.
 *   3. Spread-merge each row's `value` over `node.frontmatter`. The
 *      author's keys are the base; enrichment keys overlay them.
 *
 * The returned object is a fresh shallow copy — mutating it does not
 * touch the caller's node. The original `node.frontmatter` reference
 * remains accessible via `node.frontmatter` for callers that want the
 * pristine author baseline.
 *
 * @param node          Node to merge against; `node.frontmatter` is the base.
 * @param enrichments   Per-(node, extractor) enrichment records — typically
 *                      loaded via `loadNodeEnrichments(db, node.path)` or
 *                      pre-filtered to this node by the caller.
 * @param opts.includeStale  When true, include rows flagged stale. Defaults
 *                            to false (the safe, CI-deterministic default).
 *                            UIs that want to display "stale (last value: …)"
 *                            pass `true` and consult `enrichment.stale`
 *                            on the source rows.
 */
export function mergeNodeWithEnrichments(
  node: Node,
  enrichments: IPersistedEnrichment[],
  opts: { includeStale?: boolean } = {},
): Record<string, unknown> {
  const includeStale = opts.includeStale === true;
  const applicable = enrichments
    .filter((e) => e.nodePath === node.path)
    .filter((e) => includeStale || !e.stale)
    .sort((a, b) => a.enrichedAt - b.enrichedAt);
  const base: Record<string, unknown> = { ...(node.frontmatter ?? {}) };
  for (const row of applicable) {
    Object.assign(base, row.value);
  }
  return base;
}

/**
 * A persisted enrichment row, post-load. Mirrors the DB row shape
 * but with `value` already deserialised from JSON and `stale` /
 * `isProbabilistic` already decoded from `0 | 1`. Surfaced via
 * `loadNodeEnrichments` (driven adapter) and consumed by
 * `mergeNodeWithEnrichments` and the `sm refresh` command.
 */
export interface IPersistedEnrichment {
  nodePath: string;
  extractorId: string;
  bodyHashAtEnrichment: string;
  value: Partial<Node>;
  stale: boolean;
  enrichedAt: number;
  isProbabilistic: boolean;
}
