/**
 * Scripted scan simulator. Walks the loaded collection and emits a
 * realistic-feeling scan.* sequence on the EventBus, plus a handful of
 * issue.* events derived from frontmatter (deprecated / superseded nodes).
 *
 * This is strictly a UX demo for Step 0c. The real orchestrator lives in
 * src/ and lands at Step 1c — shapes may drift until then.
 */

import { Injectable, inject, signal } from '@angular/core';

import { SCAN_SIMULATOR_TEXTS } from '../i18n/scan-simulator.texts';
import { CollectionLoaderService } from './collection-loader';
import { EventBusService } from './event-bus';

@Injectable({ providedIn: 'root' })
export class ScanSimulatorService {
  private readonly loader = inject(CollectionLoaderService);
  private readonly bus = inject(EventBusService);

  private readonly _running = signal(false);
  readonly running = this._running.asReadonly();

  async runScan(): Promise<void> {
    if (this._running()) return;
    this._running.set(true);

    const nodes = this.loader.nodes();
    const total = nodes.length;
    const startedAt = Date.now();

    this.bus.emit({
      family: 'scan',
      name: 'scan.started',
      severity: 'info',
      message: SCAN_SIMULATOR_TEXTS.scanStarted(total),
      data: { total, scope: 'mock-collection' },
    });

    for (let i = 0; i < nodes.length; i++) {
      await delay(120);
      const n = nodes[i];
      this.bus.emit({
        family: 'scan',
        name: 'scan.progress',
        severity: 'info',
        message: SCAN_SIMULATOR_TEXTS.scanProgress(i + 1, total, n.path),
        data: { index: i + 1, total, path: n.path, kind: n.kind },
      });

      const meta = n.frontmatter.metadata ?? {};
      if (meta.stability === 'deprecated') {
        await delay(40);
        this.bus.emit({
          family: 'issue',
          name: 'issue.added',
          severity: 'warn',
          message: SCAN_SIMULATOR_TEXTS.issueDeprecated(n.path),
          data: {
            path: n.path,
            ruleId: 'deprecated-node',
            supersededBy: meta.supersededBy ?? null,
          },
        });
      }
    }

    await delay(200);
    const durationMs = Date.now() - startedAt;
    this.bus.emit({
      family: 'scan',
      name: 'scan.completed',
      severity: 'success',
      message: SCAN_SIMULATOR_TEXTS.scanCompleted((durationMs / 1000).toFixed(1), total),
      data: { total, durationMs },
    });

    this._running.set(false);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
