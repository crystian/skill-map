/**
 * Scan orchestrator — runs the detector/rule pipeline across all roots.
 *
 * Step 0b: stub. Produces a well-formed empty `ScanResult` regardless of
 * input. Step 3 wires real adapters/detectors/rules behind this entry point.
 *
 * The boot invariant (`kernel-empty-boot`) is satisfied because the kernel
 * without any registered extensions still returns a valid, schema-compliant
 * result: zero nodes, zero links, zero issues.
 */

import type { Kernel } from './index.js';
import type { ScanResult } from './types.js';

export interface RunScanOptions {
  roots: string[];
}

export async function runScan(
  _kernel: Kernel,
  options: RunScanOptions,
): Promise<ScanResult> {
  const start = Date.now();
  return {
    schemaVersion: 1,
    scannedAt: new Date().toISOString(),
    roots: options.roots,
    nodes: [],
    links: [],
    issues: [],
    stats: {
      nodesCount: 0,
      linksCount: 0,
      issuesCount: 0,
      durationMs: Date.now() - start,
    },
  };
}
