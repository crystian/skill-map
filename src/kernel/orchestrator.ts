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
 */

import { createHash } from 'node:crypto';

import type { Kernel } from './index.js';
import type {
  Confidence,
  Issue,
  Link,
  LinkKind,
  Node,
  ScanResult,
  Severity,
} from './types.js';
import type {
  ProgressEmitterPort,
  ProgressEvent,
} from './ports/progress-emitter.js';
import { InMemoryProgressEmitter } from './adapters/in-memory-progress.js';
import type {
  IAdapter,
  IDetectContext,
  IDetector,
  IRule,
} from './extensions/index.js';

export interface IScanExtensions {
  adapters: IAdapter[];
  detectors: IDetector[];
  rules: IRule[];
}

export interface RunScanOptions {
  roots: string[];
  emitter?: ProgressEmitterPort;
  /** Runtime extension instances. Absent → empty pipeline. */
  extensions?: IScanExtensions;
}

export async function runScan(
  _kernel: Kernel,
  options: RunScanOptions,
): Promise<ScanResult> {
  const start = Date.now();
  const scannedAt = new Date().toISOString();
  const emitter = options.emitter ?? new InMemoryProgressEmitter();
  const exts = options.extensions ?? { adapters: [], detectors: [], rules: [] };

  emitter.emit(makeEvent('scan.started', { roots: options.roots }));

  const nodes: Node[] = [];
  const links: Link[] = [];

  // --- adapters + detectors ------------------------------------------------
  let index = 0;
  for (const adapter of exts.adapters) {
    for await (const raw of adapter.walk(options.roots)) {
      const kind = adapter.classify(raw.path, raw.frontmatter);
      const node = buildNode({
        path: raw.path,
        kind,
        adapterId: adapter.id,
        frontmatterRaw: raw.frontmatterRaw,
        body: raw.body,
        frontmatter: raw.frontmatter,
      });
      nodes.push(node);
      index += 1;
      emitter.emit(makeEvent('scan.progress', { index, path: raw.path, kind }));

      for (const detector of exts.detectors) {
        const ctx = buildDetectContext(detector, node, raw.body, raw.frontmatter);
        const emitted = await detector.detect(ctx);
        for (const link of emitted) {
          const validated = validateLink(detector, link);
          if (validated) links.push(validated);
        }
      }
    }
  }

  // --- denormalise links-in / links-out counts ----------------------------
  recomputeLinkCounts(nodes, links);

  // --- rules ---------------------------------------------------------------
  const issues: Issue[] = [];
  for (const rule of exts.rules) {
    const emitted = await rule.evaluate({ nodes, links });
    for (const issue of emitted) {
      const validated = validateIssue(rule, issue);
      if (validated) issues.push(validated);
    }
  }

  const stats = {
    nodesCount: nodes.length,
    linksCount: links.length,
    issuesCount: issues.length,
    durationMs: Date.now() - start,
  };

  emitter.emit(makeEvent('scan.completed', { stats }));

  return {
    schemaVersion: 1,
    scannedAt,
    roots: options.roots,
    nodes,
    links,
    issues,
    stats,
  };
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
}

function buildNode(args: IBuildNodeArgs): Node {
  const bytesFrontmatter = Buffer.byteLength(args.frontmatterRaw, 'utf8');
  const bytesBody = Buffer.byteLength(args.body, 'utf8');
  const metadata = pickMetadata(args.frontmatter);
  const node: Node = {
    path: args.path,
    kind: args.kind,
    adapter: args.adapterId,
    bodyHash: sha256(args.body),
    frontmatterHash: sha256(args.frontmatterRaw),
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
  return node;
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
  for (const node of nodes) byPath.set(node.path, node);
  for (const link of links) {
    const source = byPath.get(link.source);
    if (source) source.linksOutCount += 1;
    const target = byPath.get(link.target);
    if (target) target.linksInCount += 1;
  }
}
