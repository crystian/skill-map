/**
 * Scan orchestrator — runs the adapter → detector → rule pipeline across
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
 * `ScanResult` when an adapter walks a non-existent path — the bug
 * that wiped a populated DB via `sm scan -- --dry-run` (clipanion's
 * `--` made `--dry-run` a positional root that did not exist).
 *
 * Incremental scans (Step 4.4): when `priorSnapshot` is supplied, the
 * orchestrator walks the filesystem, hashes each file, and reuses the
 * prior node + its prior-detected internal links whenever both
 * `bodyHash` and `frontmatterHash` match. New / modified files run
 * through the full detector pipeline (including the external-url-counter
 * which produces ephemeral pseudo-links). Rules ALWAYS run over the
 * fully merged graph — issue state can change even for an unchanged node
 * (e.g. a previously broken `references` link now resolves because a new
 * node was added). For unchanged nodes the prior `externalRefsCount` is
 * preserved as-is (the external pseudo-links were never persisted, so
 * they cannot be reconstructed; the count survived in the node row).
 */

import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';

import { Tiktoken } from 'js-tiktoken/lite';
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
import { installedSpecVersion } from './adapters/plugin-loader.js';
import { loadSchemaValidators, type TSchemaName } from './adapters/schema-validators.js';
import type {
  IAdapter,
  IDetectContext,
  IDetector,
  IRule,
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
  adapters: IAdapter[];
  detectors: IDetector[];
  rules: IRule[];
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
   *      survive); only new / modified nodes run through detectors.
   *      Rules always re-run over the merged graph.
   *
   * Pass `null` (or omit) for a fresh scan with no rename detection.
   */
  priorSnapshot?: ScanResult | null;
  /**
   * Reuse unchanged nodes from `priorSnapshot` instead of re-running
   * detectors over them. Defaults to `false` so a plain `sm scan`
   * always re-walks deterministically. `sm scan --changed` flips this
   * to `true` for the perf win on unchanged files.
   *
   * Has no effect without `priorSnapshot`; setting it to `true` with
   * a null prior is a no-op (every file is "new").
   */
  enableCache?: boolean;
  /**
   * Filter that decides which paths the adapters skip. Composed by the
   * caller (typically the CLI) from bundled defaults + `config.ignore`
   * + `.skill-mapignore`. Adapters that omit this option fall back to
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
}

/**
 * Same as `runScan` but also returns the rename heuristic's `RenameOp[]`
 * — the high- and medium-confidence renames the persistence layer must
 * apply to `state_*` rows inside the same tx as the scan zone replace-
 * all (per `spec/db-schema.md` §Rename detection). Most callers want
 * `runScan` (which returns just `ScanResult`); the CLI's `sm scan`
 * uses this variant so it can hand the ops off to `persistScanResult`.
 */
export async function runScanWithRenames(
  _kernel: Kernel,
  options: RunScanOptions,
): Promise<{ result: ScanResult; renameOps: RenameOp[] }> {
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
): Promise<{ result: ScanResult; renameOps: RenameOp[] }> {
  // Spec contract (`scan-result.schema.json#/properties/roots/minItems: 1`):
  // a ScanResult must report at least one walked root. The CLI already
  // defaults `roots` to `['.']` when no positional args are supplied, so
  // hitting this branch from the CLI surface is a programming error.
  if (options.roots.length === 0) {
    throw new Error(
      'runScan: roots must contain at least one path (spec requires minItems: 1)',
    );
  }
  // Validate every root exists as a directory BEFORE any IO, BEFORE the
  // tokenizer is constructed, BEFORE `scan.started` fires. Throw on the
  // first failure — single-error feedback is enough; the user fixes it
  // and re-runs. Without this guard the claude adapter's `walk()`
  // swallows ENOENT inside `readdir` and returns silently, which lets a
  // non-existent root produce a valid-looking zero-filled `ScanResult`
  // — directly enabling the `sm scan -- --dry-run` typo-trap that wipes
  // a populated DB.
  for (const root of options.roots) {
    if (!existsSync(root)) {
      throw new Error(
        `runScan: root path '${root}' does not exist or is not a directory`,
      );
    }
    if (!statSync(root).isDirectory()) {
      throw new Error(
        `runScan: root path '${root}' does not exist or is not a directory`,
      );
    }
  }
  const start = Date.now();
  const scannedAt = start;
  const emitter = options.emitter ?? new InMemoryProgressEmitter();
  const exts = options.extensions ?? { adapters: [], detectors: [], rules: [] };
  const tokenize = options.tokenize !== false;
  const scope: 'project' | 'global' = options.scope ?? 'project';
  const strict = options.strict === true;
  // Encoder is heavyweight to construct (loads the cl100k_base BPE table
  // once); reuse a single instance across the whole scan.
  const encoder = tokenize ? new Tiktoken(cl100k_base) : null;
  const prior = options.priorSnapshot ?? null;
  const enableCache = options.enableCache === true;

  // Index prior state by path so per-file lookup is O(1). The link
  // index is keyed by the **originating node** of each link — the node
  // whose body / frontmatter the detector was processing when it emitted
  // the link. For most kinds that equals `link.source`, but the
  // frontmatter detector emits inverted `supersedes` links (from a
  // node's `metadata.supersededBy`) where the originating node is
  // `link.target`. See `originatingNodeOf` below.
  const priorNodesByPath = new Map<string, Node>();
  const priorNodePaths = new Set<string>();
  const priorLinksByOriginating = new Map<string, Link[]>();
  // Per-node frontmatter-invalid issues from the prior — we reuse them
  // when the cache is hit, otherwise the incremental scan would silently
  // drop the warning that landed on the prior pass.
  const priorFrontmatterIssuesByNode = new Map<string, Issue[]>();
  if (prior) {
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
      if (issue.ruleId !== 'frontmatter-invalid') continue;
      if (issue.nodeIds.length !== 1) continue;
      const path = issue.nodeIds[0]!;
      const list = priorFrontmatterIssuesByNode.get(path);
      if (list) list.push(issue);
      else priorFrontmatterIssuesByNode.set(path, [issue]);
    }
  }

  emitter.emit(makeEvent('scan.started', { roots: options.roots }));

  const nodes: Node[] = [];
  const internalLinks: Link[] = [];
  const externalLinks: Link[] = [];
  // Set of node paths that came verbatim from the prior snapshot (so
  // their `externalRefsCount` must NOT be zeroed before recomputation).
  const cachedPaths = new Set<string>();
  // Frontmatter-validation findings collected during the walk; appended
  // to the rule-emitted `issues` array after the rules pass so the
  // ScanResult ordering stays "rules first, then derived issues".
  const frontmatterIssues: Issue[] = [];

  // --- adapters + detectors ------------------------------------------------
  // `filesWalked` counts every `IRawNode` an adapter yielded across the
  // whole scan (including cached reuse). With one adapter it equals
  // `nodesCount`; with future multi-adapter scans walking overlapping
  // roots it can diverge.
  let filesWalked = 0;
  let index = 0;
  const walkOptions = options.ignoreFilter
    ? { ignoreFilter: options.ignoreFilter }
    : {};
  for (const adapter of exts.adapters) {
    for await (const raw of adapter.walk(options.roots, walkOptions)) {
      filesWalked += 1;
      const bodyHash = sha256(raw.body);
      // Step 5.13 — hash a CANONICAL form of the frontmatter so a YAML
      // formatter pass (re-indent, sort keys, normalise trailing
      // newline, swap single↔double quotes) doesn't break the
      // medium-confidence rename heuristic. We re-emit the parsed
      // object via `yaml.dump` with sorted keys + no line-wrap +
      // no anchors. Loses comment fidelity, but comments aren't
      // semantic and never affect identity. Fallback to raw text
      // when canonicalisation produces empty (e.g., parse failed in
      // the adapter and `raw.frontmatter` is `{}` despite a
      // non-empty `raw.frontmatterRaw`) so a malformed-YAML file
      // still hashes deterministically against itself.
      const frontmatterHash = sha256(canonicalFrontmatter(raw.frontmatter, raw.frontmatterRaw));
      const priorNode = priorNodesByPath.get(raw.path);
      // Cache reuse is gated on the explicit `enableCache` option (Step
      // 5.8). The presence of a `prior` alone is no longer enough — a
      // plain `sm scan` always re-walks deterministically; only
      // `sm scan --changed` flips `enableCache` on. The rename heuristic
      // below uses `prior` independently of `enableCache`.
      const cached =
        enableCache &&
        prior !== null &&
        priorNode !== undefined &&
        priorNode.bodyHash === bodyHash &&
        priorNode.frontmatterHash === frontmatterHash;

      const kind = adapter.classify(raw.path, raw.frontmatter);
      index += 1;

      if (cached && priorNode) {
        // Reuse the prior node row verbatim; reuse its outbound internal
        // links. Detectors are NOT re-run for this node — the body
        // didn't change, so neither did anything derived from it.
        // Shallow-clone to avoid mutating the caller's prior snapshot
        // when `recomputeLinkCounts` resets per-node counts below.
        const reused: Node = { ...priorNode, bytes: { ...priorNode.bytes } };
        if (priorNode.tokens) reused.tokens = { ...priorNode.tokens };
        nodes.push(reused);
        cachedPaths.add(reused.path);
        const reusedLinks = priorLinksByOriginating.get(priorNode.path) ?? [];
        for (const link of reusedLinks) internalLinks.push(link);
        // Re-emit the prior frontmatter issues. They were validated
        // against the same frontmatterHash, so the result is identical;
        // re-validating here would be wasted work. The `strict` flag
        // can promote `warn → error` retroactively, so honor it before
        // pushing.
        const reusedFm = priorFrontmatterIssuesByNode.get(priorNode.path) ?? [];
        for (const issue of reusedFm) {
          frontmatterIssues.push({
            ...issue,
            severity: strict ? 'error' : 'warn',
          });
        }
        emitter.emit(
          makeEvent('scan.progress', {
            index,
            path: raw.path,
            kind,
            cached: true,
          }),
        );
        continue;
      }

      const node = buildNode({
        path: raw.path,
        kind,
        adapterId: adapter.id,
        frontmatterRaw: raw.frontmatterRaw,
        body: raw.body,
        frontmatter: raw.frontmatter,
        bodyHash,
        frontmatterHash,
        encoder,
      });
      nodes.push(node);

      // Step 6.7 — frontmatter strict validation. Only validate when the
      // file actually declared a frontmatter fence (an absent fence
      // produces `frontmatterRaw === ''`); empty `{}` from a missing
      // fence is not a violation. Severity defaults to `warn`; the CLI
      // promotes it to `error` via `--strict` or `scan.strict: true`.
      if (raw.frontmatterRaw.length > 0) {
        const fmIssue = validateFrontmatter(kind, raw.frontmatter, raw.path, strict);
        if (fmIssue) frontmatterIssues.push(fmIssue);
      }
      emitter.emit(
        makeEvent('scan.progress', {
          index,
          path: raw.path,
          kind,
          cached: false,
        }),
      );

      for (const detector of exts.detectors) {
        const ctx = buildDetectContext(detector, node, raw.body, raw.frontmatter);
        const emitted = await detector.detect(ctx);
        for (const link of emitted) {
          const validated = validateLink(detector, link);
          if (!validated) continue;
          if (isExternalUrlLink(validated)) externalLinks.push(validated);
          else internalLinks.push(validated);
        }
      }
    }
  }

  // --- denormalise links-in / links-out and external counts ---------------
  // External pseudo-links (target is http(s)://) drive `externalRefsCount`
  // and are then dropped: never persisted, never seen by rules, never in
  // result.links. The string-prefix check is the contract — see
  // external-url-counter/index.ts.
  recomputeLinkCounts(nodes, internalLinks);
  recomputeExternalRefsCount(nodes, externalLinks, cachedPaths);

  // --- rules ---------------------------------------------------------------
  // Rules see internal links only — broken-ref / trigger-collision /
  // superseded all reason about graph relations, not URLs. Rules ALWAYS
  // re-run over the merged graph (no shortcut for incremental scans):
  // the issue set for an "unchanged" node can flip when a sibling node
  // changes.
  const issues: Issue[] = [];
  for (const rule of exts.rules) {
    const emitted = await rule.evaluate({ nodes, links: internalLinks });
    for (const issue of emitted) {
      const validated = validateIssue(rule, issue);
      if (validated) issues.push(validated);
    }
  }
  // Frontmatter-invalid issues from the walk land here so the rename
  // heuristic (next pass) sees them and the final stats.issuesCount
  // reflects them.
  for (const issue of frontmatterIssues) issues.push(issue);

  // --- rename heuristic ---------------------------------------------------
  // Runs after rules so the merged graph is final. Adds issues for
  // medium / ambiguous / orphan classifications; high-confidence renames
  // emit no issue (per spec). The returned `RenameOp[]` flows through
  // to `persistScanResult` so FK migration lands inside the same tx as
  // the scan zone replace-all.
  const renameOps = prior
    ? detectRenamesAndOrphans(prior, nodes, issues)
    : [];

  const stats = {
    // `filesSkipped` is "files walked but not classified by any adapter".
    // Today every walked file IS classified by its adapter (the `claude`
    // adapter's `classify()` always returns a kind, falling back to
    // `'note'`), so this is always 0. Wired now so the field shape is
    // spec-conformant; meaningful once multiple adapters compete (Step 9+).
    filesWalked,
    filesSkipped: 0,
    nodesCount: nodes.length,
    linksCount: internalLinks.length,
    issuesCount: issues.length,
    durationMs: Date.now() - start,
  };

  emitter.emit(makeEvent('scan.completed', { stats }));

  return {
    result: {
      schemaVersion: 1,
      scannedAt,
      scope,
      roots: options.roots,
      adapters: exts.adapters.map((a) => a.id),
      scannedBy: SCANNED_BY,
      nodes,
      links: internalLinks,
      issues,
      stats,
    },
    renameOps,
  };
}

/**
 * The "originating node" of a link — the node whose body / frontmatter
 * the detector was processing when it emitted the link. For most kinds
 * this equals `link.source`, but the frontmatter detector emits inverted
 * `supersedes` links (from a node's `metadata.supersededBy`) where
 * `target` is the originating node and `source` is the (forward-pointing)
 * supersedor. The forward case (`metadata.supersedes`) keeps
 * `originating === source` like every other detector.
 *
 * Discriminator: the supersedor path in an inverted edge is rarely a
 * real node (it points "forward" to a file that may or may not exist on
 * disk under that exact path); the originating node always exists in
 * the prior snapshot (it's the node whose detection produced the link).
 * So for `kind === 'supersedes'`: prefer `source` when source is a known
 * prior node, otherwise fall back to `target`. This handles BOTH the
 * forward case (originating === source, which IS a known node) and the
 * inverted case (source not a node → fall through to target, the
 * originating older node).
 *
 * Frontmatter is the only detector that emits cross-source links today;
 * if a future detector adds another inversion case, escalate to a
 * persisted `Link.detectedFromPath` field with a schema bump rather
 * than extending this heuristic.
 */
function originatingNodeOf(link: Link, priorNodePaths: Set<string>): string {
  if (link.kind === 'supersedes' && !priorNodePaths.has(link.source)) {
    return link.target;
  }
  return link.source;
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

  // 1. high-confidence — body hash match.
  for (const fromPath of deletedPaths) {
    if (claimedDeleted.has(fromPath)) continue;
    const fromNode = priorByPath.get(fromPath)!;
    for (const toPath of newPaths) {
      if (claimedNew.has(toPath)) continue;
      const toNode = currentByPath.get(toPath)!;
      if (toNode.bodyHash === fromNode.bodyHash) {
        ops.push({ from: fromPath, to: toPath, confidence: 'high' });
        claimedDeleted.add(fromPath);
        claimedNew.add(toPath);
        break;
      }
    }
  }

  // 2/3. frontmatter classification — bucket every newPath by the set
  //      of remaining deletions that share its frontmatterHash.
  const candidatesByNew = new Map<string, string[]>();
  for (const toPath of newPaths) {
    if (claimedNew.has(toPath)) continue;
    const toNode = currentByPath.get(toPath)!;
    const matches: string[] = [];
    for (const fromPath of deletedPaths) {
      if (claimedDeleted.has(fromPath)) continue;
      const fromNode = priorByPath.get(fromPath)!;
      if (toNode.frontmatterHash === fromNode.frontmatterHash) {
        matches.push(fromPath);
      }
    }
    if (matches.length > 0) candidatesByNew.set(toPath, matches);
  }

  // First pass: claim every `newPath` whose candidate set is a
  // singleton AND whose lone candidate is not already promised
  // elsewhere as a singleton candidate — i.e. mutual exclusivity.
  // Because each candidate path is iterated under at most one
  // surviving `newPath` (the deletion is "shared" only by virtue of
  // distinct newPaths matching it), we resolve singletons greedily by
  // sorted newPath order; a deletion claimed by an earlier singleton
  // is removed from later candidate lists.
  for (const toPath of newPaths) {
    if (claimedNew.has(toPath)) continue;
    const candidates = candidatesByNew.get(toPath);
    if (!candidates) continue;
    const remaining = candidates.filter((p) => !claimedDeleted.has(p));
    if (remaining.length === 1) {
      const fromPath = remaining[0]!;
      ops.push({ from: fromPath, to: toPath, confidence: 'medium' });
      issues.push({
        ruleId: 'auto-rename-medium',
        severity: 'warn',
        nodeIds: [toPath],
        message: `Auto-rename (medium confidence): ${fromPath} → ${toPath}`,
        data: { from: fromPath, to: toPath, confidence: 'medium' },
      });
      claimedDeleted.add(fromPath);
      claimedNew.add(toPath);
    }
  }

  // Second pass: any remaining `newPath` with more than one viable
  // candidate after singletons settled is ambiguous. Emit one
  // `auto-rename-ambiguous` issue listing every candidate; no
  // migration is applied.
  for (const toPath of newPaths) {
    if (claimedNew.has(toPath)) continue;
    const candidates = candidatesByNew.get(toPath);
    if (!candidates) continue;
    const remaining = candidates.filter((p) => !claimedDeleted.has(p));
    if (remaining.length > 1) {
      issues.push({
        ruleId: 'auto-rename-ambiguous',
        severity: 'warn',
        nodeIds: [toPath],
        message:
          `Auto-rename ambiguous: ${toPath} matches ${remaining.length} ` +
          `prior frontmatters — pick one with \`sm orphans undo-rename ` +
          `${toPath} --from <old.path>\`.`,
        data: { to: toPath, candidates: remaining },
      });
      // Note: the candidate deletions are NOT claimed — they remain as
      // orphans below so the user can reconcile them manually.
    }
  }

  // 4. orphan — every unclaimed deletion.
  for (const fromPath of deletedPaths) {
    if (claimedDeleted.has(fromPath)) continue;
    issues.push({
      ruleId: 'orphan',
      severity: 'info',
      nodeIds: [fromPath],
      message: `Orphan history: ${fromPath} was deleted; no rename match found.`,
      data: { path: fromPath },
    });
  }

  return ops;
}

function isExternalUrlLink(link: Link): boolean {
  const target = link.target;
  return target.startsWith('http://') || target.startsWith('https://');
}

function makeEvent(type: string, data: unknown): ProgressEvent {
  return { type, timestamp: new Date().toISOString(), data };
}

interface IBuildNodeArgs {
  path: string;
  kind: Node['kind'];
  adapterId: string;
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
    adapter: args.adapterId,
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
 *   1. Take the parsed object the adapter already produced.
 *   2. Re-emit via `yaml.dump` with `sortKeys: true`, `lineWidth: -1`
 *      (no auto-wrap), `noRefs: true` (no `*alias` shorthand),
 *      `noCompatMode: true` (modern YAML 1.2 output).
 *   3. Hash the result.
 *
 * Fallback: when `parsed` is the empty object `{}` BUT `raw` is
 * non-empty, the adapter's parse failed silently. We fall back to
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

function buildDetectContext(
  detector: IDetector,
  node: Node,
  body: string,
  frontmatter: Record<string, unknown>,
): IDetectContext {
  const scope = detector.scope;
  return {
    node,
    body: scope === 'frontmatter' ? '' : body,
    frontmatter: scope === 'body' ? {} : frontmatter,
  };
}

function validateLink(detector: IDetector, link: Link): Link | null {
  if (!detector.emitsLinkKinds.includes(link.kind as LinkKind)) {
    // Detector emitted a kind outside its declared set — drop the link;
    // the orchestrator is the last line of defence against a misbehaving
    // detector. A diagnostic event lands in Step 4+.
    return null;
  }
  const confidence: Confidence = link.confidence ?? detector.defaultConfidence;
  return { ...link, confidence };
}

/**
 * Validate a node's frontmatter against the kind-specific schema. Only
 * called for files that actually declared a fence (caller checks
 * `frontmatterRaw.length > 0`). Returns a single `frontmatter-invalid`
 * issue with the AJV error string, or `null` when the frontmatter is
 * structurally valid. Severity is `warn` by default; `strict` flips it
 * to `error` so the scan exit code rises to 1.
 */
function validateFrontmatter(
  kind: NodeKind,
  frontmatter: Record<string, unknown>,
  path: string,
  strict: boolean,
): Issue | null {
  const validators = loadSchemaValidators();
  const schemaName: TSchemaName = `frontmatter-${kind}` as const;
  const result = validators.validate(schemaName, frontmatter);
  if (result.ok) return null;
  return {
    ruleId: 'frontmatter-invalid',
    severity: strict ? 'error' : 'warn',
    nodeIds: [path],
    message: `Frontmatter for ${path} (${kind}) failed schema validation: ${result.errors}`,
    data: { kind, errors: result.errors },
  };
}

function validateIssue(rule: IRule, issue: Issue): Issue | null {
  const severity: Severity | undefined = issue.severity;
  if (severity !== 'error' && severity !== 'warn' && severity !== 'info') return null;
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
    // persisted, so we cannot re-derive the count from a fresh detector
    // pass — the count survives untouched in the node row.
    if (!cachedPaths.has(node.path)) node.externalRefsCount = 0;
    byPath.set(node.path, node);
  }
  for (const link of externalLinks) {
    const source = byPath.get(link.source);
    // Cached nodes never appear as the source of a freshly-detected
    // external pseudo-link (detectors didn't run for them), so this
    // increment only ever lands on a freshly-built node — but the guard
    // is cheap and defensive.
    if (source && !cachedPaths.has(source.path)) source.externalRefsCount += 1;
  }
}
