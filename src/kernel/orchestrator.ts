/**
 * Scan orchestrator — runs the adapter → detector → rule pipeline across
 * every registered extension and emits `ProgressEmitterPort` events in
 * canonical order. With zero extensions registered it returns a valid,
 * zero-filled `ScanResult` — the kernel-empty-boot invariant.
 *
 * Step 1c scope:
 *
 *  - Real event emission on `scan.started` / `scan.completed` (the
 *    `scan.progress` family lights up at Step 3 when per-node work starts
 *    taking measurable time).
 *  - Real iteration over registered adapters / detectors / rules. Concrete
 *    runtime interfaces for those extensions (`adapter.walk()`,
 *    `detector.detect()`, `rule.evaluate()`) don't exist yet — they arrive
 *    with the first real extensions at Step 2. The iteration sites are
 *    wired as no-ops today but guarded with explicit TODOs so the Step 2
 *    drop-in test (adding a 4th detector) needs zero kernel edits.
 *  - An optional `ProgressEmitterPort`. When absent, the orchestrator
 *    constructs a local `InMemoryProgressEmitter` so event emission is
 *    always real.
 */

import { Registry } from './registry.js';
import type { Kernel } from './index.js';
import type { Issue, Link, Node, ScanResult } from './types.js';
import type {
  ProgressEmitterPort,
  ProgressEvent,
} from './ports/progress-emitter.js';
import { InMemoryProgressEmitter } from './adapters/in-memory-progress.js';

export interface RunScanOptions {
  roots: string[];
  emitter?: ProgressEmitterPort;
}

export async function runScan(
  kernel: Kernel,
  options: RunScanOptions,
): Promise<ScanResult> {
  const start = Date.now();
  const scannedAt = new Date().toISOString();
  const emitter = options.emitter ?? new InMemoryProgressEmitter();

  emitter.emit(makeEvent('scan.started', { roots: options.roots }));

  const registry: Registry = kernel.registry;
  const adapters = registry.all('adapter');
  const detectors = registry.all('detector');
  const rules = registry.all('rule');

  const nodes: Node[] = [];
  const links: Link[] = [];
  const issues: Issue[] = [];

  // Step 2: adapter.walk(roots) yields Node instances. Today every adapter
  // is registered only by its manifest (no callable walk yet), so the
  // outer iteration completes without producing rows — which is exactly
  // what kernel-empty-boot expects.
  for (const _adapter of adapters) {
    // TODO(step-2): await for (const node of adapter.walk(options.roots)) { ... }
  }

  // Step 2: detectors consume nodes and emit Link[]. Same deferral.
  for (const _node of nodes) {
    for (const _detector of detectors) {
      // TODO(step-2): links.push(...await detector.detect(node))
    }
  }

  // Step 2: rules evaluate the whole graph and emit Issue[]. Same deferral.
  for (const _rule of rules) {
    // TODO(step-2): issues.push(...await rule.evaluate({ nodes, links }))
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
  return {
    type,
    timestamp: new Date().toISOString(),
    data,
  };
}
