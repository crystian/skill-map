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

import { Tiktoken } from 'js-tiktoken/lite';
import cl100k_base from 'js-tiktoken/ranks/cl100k_base';

import pkg from '../package.json' with { type: 'json' };

import type { Kernel } from './index.js';
import type {
  Confidence,
  Issue,
  Link,
  LinkKind,
  Node,
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
   * Prior snapshot for incremental scans (`sm scan --changed`). When
   * provided, nodes whose `path` exists in the prior with both
   * `bodyHash` and `frontmatterHash` matching the freshly-computed
   * hashes are reused as-is (their internal links and
   * `externalRefsCount` survive); only new / modified nodes run through
   * detectors. Rules always re-run over the merged graph. Pass `null`
   * (or omit) for a full scan.
   */
  priorSnapshot?: ScanResult | null;
}

export async function runScan(
  _kernel: Kernel,
  options: RunScanOptions,
): Promise<ScanResult> {
  // Spec contract (`scan-result.schema.json#/properties/roots/minItems: 1`):
  // a ScanResult must report at least one walked root. The CLI already
  // defaults `roots` to `['.']` when no positional args are supplied, so
  // hitting this branch from the CLI surface is a programming error.
  if (options.roots.length === 0) {
    throw new Error(
      'runScan: roots must contain at least one path (spec requires minItems: 1)',
    );
  }
  const start = Date.now();
  const scannedAt = start;
  const emitter = options.emitter ?? new InMemoryProgressEmitter();
  const exts = options.extensions ?? { adapters: [], detectors: [], rules: [] };
  const tokenize = options.tokenize !== false;
  const scope: 'project' | 'global' = options.scope ?? 'project';
  // Encoder is heavyweight to construct (loads the cl100k_base BPE table
  // once); reuse a single instance across the whole scan.
  const encoder = tokenize ? new Tiktoken(cl100k_base) : null;
  const prior = options.priorSnapshot ?? null;

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
  }

  emitter.emit(makeEvent('scan.started', { roots: options.roots }));

  const nodes: Node[] = [];
  const internalLinks: Link[] = [];
  const externalLinks: Link[] = [];
  // Set of node paths that came verbatim from the prior snapshot (so
  // their `externalRefsCount` must NOT be zeroed before recomputation).
  const cachedPaths = new Set<string>();

  // --- adapters + detectors ------------------------------------------------
  // `filesWalked` counts every `IRawNode` an adapter yielded across the
  // whole scan (including cached reuse). With one adapter it equals
  // `nodesCount`; with future multi-adapter scans walking overlapping
  // roots it can diverge.
  let filesWalked = 0;
  let index = 0;
  for (const adapter of exts.adapters) {
    for await (const raw of adapter.walk(options.roots)) {
      filesWalked += 1;
      const bodyHash = sha256(raw.body);
      const frontmatterHash = sha256(raw.frontmatterRaw);
      const priorNode = priorNodesByPath.get(raw.path);
      const cached =
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
