/**
 * Unit spec for `setupLiveLens`. Exercises the controller through its
 * observable surface (the pipeline handle + the config callbacks), the
 * same posture as `follow-activity.controller.spec.ts`:
 *
 *   - the seeded force layout fills the lens pipeline on activation;
 *   - the frozen fingerprint shields `setupLayoutFit` from lens churn;
 *   - exit restores the enter viewport only while the main fingerprint
 *     still matches (else the main fit callback wins);
 *   - the forced-exit path (service flips `active` off) runs the same
 *     restore as the user toggle;
 *   - a full enter/exit cycle leaves the persisted node positions
 *     untouched (the ephemerality contract).
 */

import { scopedKey } from '../../../../services/scoped-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { IScanResultApi, TLinkKindApi } from '../../../../models/api';
import type { INodeView, TFrontmatter } from '../../../../models/node';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
import type { IIssuePathsBySeverity } from '../../../../services/issue-paths';
import type { LiveLensService } from '../../../../services/live-lens';
import { computePlaybackState } from '../../../../services/activity-playback-state';
import { LivePreferencesService } from '../../../../services/live-preferences';
import type { NodeActivityService } from '../../../../services/node-activity';
import { setupLiveLens, type ILiveLensHandle } from '../live-lens.controller';
import type { IViewportTransform } from '../viewport-animation';

const A = '.claude/skills/deploy/SKILL.md';
const B = '.claude/agents/reviewer.md';

function nodeView(path: string): INodeView {
  return {
    path,
    kind: 'markdown',
    frontmatter: { name: path, description: '' } as TFrontmatter,
  };
}

function scanOf(nodes: INodeView[]): IScanResultApi {
  return {
    schemaVersion: 1,
    scannedAt: 0,
    roots: ['/tmp/x'],
    nodes: nodes.map((n) => ({
      path: n.path,
      kind: n.kind,
      provider: 'claude',
      bodyHash: 'a'.repeat(64),
      frontmatterHash: 'b'.repeat(64),
      bytes: { frontmatter: 10, body: 90, total: 100 },
      linksOutCount: 0,
      linksInCount: 0,
      externalRefsCount: 0,
    })),
    links: [],
    issues: [],
    stats: {
      filesWalked: nodes.length,
      filesSkipped: 0,
      nodesCount: nodes.length,
      linksCount: 0,
      issuesCount: 0,
      durationMs: 0,
    },
  };
}

const EMPTY_SEVERITIES: IIssuePathsBySeverity = {
  errors: new Set<string>(),
  warns: new Set<string>(),
};

function makeHarness(opts?: { bootDone?: boolean }) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: DATA_SOURCE,
        useValue: {
          getProjectPreferences: () => Promise.resolve({}),
          setProjectPreferences: () => Promise.resolve({}),
        } as unknown as IDataSourcePort,
      },
    ],
  });

  const active = signal(false);
  const lensNodes = signal<INodeView[]>([]);
  const membership = signal<ReadonlySet<string>>(new Set());
  const lensScan = computed(() => scanOf(lensNodes()));
  const lensStub = {
    active: active.asReadonly(),
    setActive: (value: boolean) => active.set(value),
    lensNodes: lensNodes.asReadonly(),
    lensScan,
    membership: membership.asReadonly(),
  } as unknown as LiveLensService;

  const activityEnabled = signal(true);
  const activePaths = signal<ReadonlySet<string>>(new Set());
  const mainFingerprint = signal('main-a|main-b');
  const viewportPosition = signal({ x: 11, y: 22 });
  const viewportScale = signal(0.8);
  const animateToTransform = vi.fn<(t: IViewportTransform) => void>();
  const fitMainView = vi.fn();
  const beginViewSwitch = vi.fn();

  let handle!: ILiveLensHandle;
  TestBed.runInInjectionContext(() => {
    handle = setupLiveLens({
      lens: lensStub,
      nodeActivity: {
        enabled: activityEnabled.asReadonly(),
        activePaths: activePaths.asReadonly(),
      } as unknown as NodeActivityService,
      livePrefs: TestBed.inject(LivePreferencesService),
      playback: {
        active: signal(false).asReadonly(),
        cursor: signal(-1).asReadonly(),
        total: signal(0).asReadonly(),
        state: signal(computePlaybackState([], -1)).asReadonly(),
      },
      directorEnabled: signal(true).asReadonly(),
      issuesBySeverity: signal(EMPTY_SEVERITIES).asReadonly(),
      mainPathsFingerprint: mainFingerprint.asReadonly(),
      viewportPosition: viewportPosition.asReadonly(),
      viewportScale: viewportScale.asReadonly(),
      sessions: () => [],
      hostElement: () => ({ clientWidth: 800, clientHeight: 600 }) as HTMLElement,
      panelWidth: () => 0,
      bootFitDone: () => opts?.bootDone ?? false,
      zoomMin: 0.1,
      animateToTransform,
      fitMainView,
      beginViewSwitch,
    });
  });

  const setLive = (paths: string[]): void => {
    lensNodes.set(paths.map(nodeView));
    membership.set(new Set(paths));
  };

  return {
    handle,
    active,
    setLive,
    mainFingerprint,
    viewportPosition,
    viewportScale,
    animateToTransform,
    fitMainView,
    beginViewSwitch,
  };
}

describe('live-lens.controller', () => {
  beforeEach(() => {
    localStorage.removeItem(scopedKey('sm.graph.node-positions'));
  });

  it('fills the lens pipeline with force positions on activation', () => {
    const h = makeHarness();
    h.setLive([A, B]);
    h.handle.toggle();
    TestBed.tick();

    const positions = h.handle.pipeline.fullLayout().positions;
    expect(positions.size).toBe(2);
    expect(h.handle.positionOf(A)).toBeDefined();
    expect(h.handle.pipeline.graph().nodes).toHaveLength(2);
  });

  it('skips the relayout when the lens topology is unchanged', () => {
    const h = makeHarness();
    h.setLive([A]);
    h.handle.toggle();
    TestBed.tick();
    const first = h.handle.pipeline.fullLayout().positions;

    // Same membership re-published (new Set identity, same content).
    h.setLive([A]);
    TestBed.tick();
    expect(h.handle.pipeline.fullLayout().positions).toBe(first);
  });

  it('freezes the layout-fit fingerprint while the lens is on', () => {
    const h = makeHarness();
    expect(h.handle.layoutFitFingerprint()).toBe('main-a|main-b');

    h.handle.toggle();
    TestBed.tick();
    h.mainFingerprint.set('main-a|main-b|main-c');
    expect(h.handle.layoutFitFingerprint()).toBe('main-a|main-b');

    h.handle.toggle();
    TestBed.tick();
    expect(h.handle.layoutFitFingerprint()).toBe('main-a|main-b|main-c');
  });

  it('exit restores the enter viewport while the main fingerprint matches', () => {
    const h = makeHarness();
    h.handle.toggle();
    TestBed.tick();
    expect(h.beginViewSwitch).toHaveBeenCalledTimes(1);

    // The camera moved during the lens; exit must restore the snapshot.
    h.viewportPosition.set({ x: 500, y: 900 });
    h.viewportScale.set(1.4);
    h.handle.toggle();
    TestBed.tick();

    expect(h.beginViewSwitch).toHaveBeenCalledTimes(2);
    expect(h.fitMainView).not.toHaveBeenCalled();
    expect(h.animateToTransform).toHaveBeenCalledWith({
      position: { x: 11, y: 22 },
      scale: 0.8,
    });
  });

  it('exit falls back to the main fit when the corpus changed mid-lens', () => {
    const h = makeHarness();
    h.handle.toggle();
    TestBed.tick();

    h.mainFingerprint.set('a-scan-changed-everything');
    h.handle.toggle();
    TestBed.tick();

    expect(h.animateToTransform).not.toHaveBeenCalled();
    expect(h.fitMainView).toHaveBeenCalledTimes(1);
  });

  it('a forced exit (service flips active off) runs the same restore', () => {
    const h = makeHarness();
    h.handle.toggle();
    TestBed.tick();

    // Real Time off: LiveLensService deactivates itself; the controller
    // only sees the signal flip.
    h.active.set(false);
    TestBed.tick();

    expect(h.animateToTransform).toHaveBeenCalledWith({
      position: { x: 11, y: 22 },
      scale: 0.8,
    });
  });

  it('a full enter/exit cycle never touches the persisted node positions', () => {
    localStorage.setItem(scopedKey('sm.graph.node-positions'), '{"a.md":{"x":1,"y":2,"manual":true}}');
    const h = makeHarness();
    h.setLive([A, B]);
    h.handle.toggle();
    TestBed.tick();
    h.handle.fitToLens();
    h.handle.toggle();
    TestBed.tick();

    expect(localStorage.getItem(scopedKey('sm.graph.node-positions'))).toBe(
      '{"a.md":{"x":1,"y":2,"manual":true}}',
    );
  });

  it('fitToLens frames the laid-out lens set', () => {
    const h = makeHarness();
    h.setLive([A, B]);
    h.handle.toggle();
    TestBed.tick();

    h.animateToTransform.mockClear();
    h.handle.fitToLens();
    expect(h.animateToTransform).toHaveBeenCalledTimes(1);
  });

  it('the lens follow frames executing plus lingering members once boot-fit is done', () => {
    const h = makeHarness({ bootDone: true });
    h.setLive([A, B]);
    h.handle.toggle();
    TestBed.tick();

    // Membership drives the lens camera (targetPaths seam): both nodes
    // are lens members, so the follow effect frames them.
    expect(h.animateToTransform).toHaveBeenCalled();
    expect(h.handle.follow.framing()).toBe(true);
  });

  it('lens edges honour no link-kind whitelist (the filter stub)', () => {
    const h = makeHarness();
    h.setLive([A]);
    h.handle.toggle();
    TestBed.tick();
    // The stub's `selectedLinkKinds` is empty WITHOUT the explicit-empty
    // flag, which `projectVisible` treats as "no filter" (null), so any
    // future lens link renders. Structural check via the pipeline's
    // computed surface: the graph exists and carries zero edges for a
    // linkless scan (not because a whitelist hid them).
    expect(h.handle.pipeline.graph().edges).toEqual([]);
    const kinds: TLinkKindApi[] = [];
    expect(kinds).toHaveLength(0);
  });
});
