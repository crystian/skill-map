import { scopedKey } from '../../../../services/scoped-storage';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Component, Injectable, signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { EMPTY } from 'rxjs';
import { FSelectionChangeEvent } from '@foblex/flow';
import { DagreLayoutEngine } from '@foblex/flow-dagre-layout';

import { GraphView } from '../graph-view';
import { CollectionLoaderService } from '../../../../services/collection-loader';
import { KindRegistryService } from '../../../../services/kind-registry';
import { LivePreferencesService } from '../../../../services/live-preferences';
import { MapVisibilityService } from '../../../../services/map-visibility';
import { NodeActivityService, type INodeInvocation } from '../../../../services/node-activity';
import { NodeSparkService } from '../../../../services/node-spark';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
import { SKILL_MAP_MODE } from '../../../../services/data-source/runtime-mode';
import { MarkdownRenderer } from '../../../../services/markdown-renderer';
import type { ISpawnThread } from '../../../components/conversation-dialog/spawn-thread';
import type { INodeView } from '../../../../models/node';
import type {
  IActivitySpawnDetailApi,
  IActivitySpawnRecordApi,
  IBranchResponseApi,
  IFolderNodeLite,
  IScanResultApi,
} from '../../../../models/api';

/**
 * `GraphView`, selection / URL-sync / panel-close behaviour. Tests
 * focus on the public API surface (`selectedNodeId`, `selectedPath`,
 * `closePanel`, `onEscape`, the URL writer effect). Foblex Flow
 * rendering is skipped intentionally, the canvas mounts inside the
 * `@if (!hasData())` else-branch, and the layout/render concerns are
 * covered by `graph-layout.spec.ts` plus visual smoke in dev.
 */

@Component({ template: '' })
class BlankPage {}

interface IStubLoader {
  nodes: ReturnType<typeof signal<INodeView[]>>;
  scan: ReturnType<typeof signal<IScanResultApi | null>>;
  scanMeta: ReturnType<typeof signal<IScanResultApi | null>>;
  liteNodes: ReturnType<typeof signal<IFolderNodeLite[]>>;
  liteNodeViews: ReturnType<typeof signal<INodeView[]>>;
  corpusCount: ReturnType<typeof signal<number>>;
  branch: ReturnType<typeof signal<IBranchResponseApi | null>>;
  loading: ReturnType<typeof signal<boolean>>;
  error: ReturnType<typeof signal<string | null>>;
  hasAnyFavorites: ReturnType<typeof signal<boolean>>;
  load: ReturnType<typeof vi.fn>;
  toggleFavorite: ReturnType<typeof vi.fn>;
}

function makeNode(path: string, name: string): INodeView {
  return {
    path,
    kind: 'agent',
    frontmatter: {
      name,
      description: '',
      metadata: { version: '1.0.0' },
    },
  };
}

function makeStubLoader(initialNodes: INodeView[] = []): IStubLoader {
  const meta: IScanResultApi = {
    schemaVersion: 1,
    scannedAt: 0,
    roots: ['.'],
    providers: [],
    nodes: [],
    links: [],
    issues: [],
    stats: {
      filesWalked: initialNodes.length,
      filesSkipped: 0,
      nodesCount: initialNodes.length,
      linksCount: 0,
      issuesCount: 0,
      durationMs: 0,
    },
  };
  const branchNodes = initialNodes.map((n) => ({
    path: n.path,
    kind: n.kind,
    provider: 'claude',
    bodyHash: 'h',
    frontmatterHash: 'fh',
    bytes: { frontmatter: 1, body: 1, total: 2 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
  }));
  const branch: IBranchResponseApi = {
    schemaVersion: '1',
    kind: 'branch',
    branch: {
      paths: [],
      excluded: [],
      rootExcluded: false,
      total: branchNodes.length,
      rendered: branchNodes.length,
      truncated: false,
      cap: 256,
    },
    nodes: branchNodes,
    links: [],
    issues: [],
  };
  return {
    nodes: signal(initialNodes),
    // `scan()` is branch-scoped: meta scalars fused with branch payload.
    scan: signal<IScanResultApi | null>({ ...meta, nodes: branchNodes }),
    scanMeta: signal<IScanResultApi | null>(meta),
    liteNodes: signal<IFolderNodeLite[]>(
      initialNodes.map((n) => ({
        path: n.path,
        kind: n.kind,
        linksInCount: 0,
        linksOutCount: 0,
        tokensTotal: null,
        modifiedAtMs: null,
        errorCount: 0,
        warnCount: 0,
        sidecarStatus: null,
      })),
    ),
    liteNodeViews: signal<INodeView[]>(
      initialNodes.map((n) => ({ path: n.path, kind: n.kind, frontmatter: { name: '', description: '' } }) as INodeView),
    ),
    corpusCount: signal<number>(initialNodes.length),
    branch: signal<IBranchResponseApi | null>(branch),
    loading: signal(false),
    error: signal<string | null>(null),
    hasAnyFavorites: signal(initialNodes.some((n) => n.isFavorite === true)),
    load: vi.fn().mockResolvedValue(undefined),
    toggleFavorite: vi.fn().mockResolvedValue(undefined),
  };
}

const STUB_DATA_SOURCE: IDataSourcePort = {
  health: vi.fn(),
  mcpStatus: vi.fn(),
  agentPresence: vi.fn(),
  loadScan: vi.fn(),
  loadScanMeta: vi.fn(),
  loadFolders: vi.fn().mockResolvedValue([]),
  loadBranch: vi.fn().mockResolvedValue({
    schemaVersion: '1',
    kind: 'branch',
    branch: { paths: [], excluded: [], rootExcluded: false, total: 0, rendered: 0, truncated: false, cap: 256 },
    nodes: [],
    links: [],
    issues: [],
  }),
  listNodes: vi.fn(),
  getNode: vi.fn().mockResolvedValue(null),
  getNodeFindings: vi.fn().mockResolvedValue({
    schemaVersion: '1',
    kind: 'findings',
    items: [],
    filters: {},
    counts: { total: 0, returned: 0, dismissedExcluded: 0, fixedExcluded: 0 },
    kindRegistry: {},
  }),
  getNodeProbExtensions: vi
    .fn()
    .mockResolvedValue({ finders: [], standalone: [] }),
  submitNodeJob: vi.fn().mockResolvedValue({
    schemaVersion: '1',
    kind: 'job.submitted',
    value: { jobId: 'job-1', nodePath: 'a.md', extensionId: 'x/y', supersededIds: [] },
    elapsedMs: 0,
  }),
  submitNodelessJob: vi.fn().mockResolvedValue({ value: { jobId: 'j1', nodePath: 'sm://core/ai-ping-action', extensionId: 'core/ai-ping-action', supersededIds: [] } }),
  cancelJob: vi.fn().mockResolvedValue(undefined),
  dismissFinding: vi.fn().mockResolvedValue(undefined),
  reopenFinding: vi.fn().mockResolvedValue(undefined),
  resolveFinding: vi.fn().mockResolvedValue(undefined),
  undismissFinding: vi.fn().mockResolvedValue(undefined),
  deleteFinding: vi.fn().mockResolvedValue(undefined),
  dismissIssue: vi.fn().mockResolvedValue(undefined),
  cancelAllJobs: vi.fn().mockResolvedValue(undefined),
  pruneJobs: vi.fn().mockResolvedValue(undefined),
  listJobs: vi.fn().mockResolvedValue([]),
  listLinks: vi.fn().mockResolvedValue({
    schemaVersion: '1',
    kind: 'links',
    items: [],
    filters: { kind: null, from: null, to: null },
    counts: { total: 0, returned: 0 },
    kindRegistry: {},
  }),
  listIssues: vi.fn(),
  loadGraph: vi.fn(),
  loadConfig: vi.fn(),
  getConfigResolution: vi.fn().mockResolvedValue([]),
  getNodeSummary: vi.fn().mockResolvedValue([]),
  deleteNodeSummary: vi.fn().mockResolvedValue(undefined),
  listPlugins: vi.fn(),
  setPluginEnabled: vi.fn(),
  setPluginExtensionEnabled: vi.fn(),
  setPluginTrusted: vi.fn(),
  applyPluginChanges: vi.fn(),
  runScan: vi.fn(),
  setFavorite: vi.fn().mockResolvedValue(undefined),
  unsetFavorite: vi.fn().mockResolvedValue(undefined),
  getPreferences: vi
    .fn()
    .mockResolvedValue({
      updateCheck: { enabled: true },
      telemetry: { errorsEnabled: false, usageCliEnabled: false, usageUiEnabled: false, anonymousId: null, environment: 'prod' },
    }),
  setPreferences: vi
    .fn()
    .mockResolvedValue({
      updateCheck: { enabled: true },
      telemetry: { errorsEnabled: false, usageCliEnabled: false, usageUiEnabled: false, anonymousId: null, environment: 'prod' },
    }),
  getProjectPreferences: vi
    .fn()
    .mockResolvedValue({
      allowSidecarWriters: true,
      scan: { referencePaths: [], followExternalSymlinks: false, respectGitignore: false },
    }),
  setProjectPreferences: vi
    .fn()
    .mockResolvedValue({
      allowSidecarWriters: true,
      scan: { referencePaths: [], followExternalSymlinks: false, respectGitignore: false },
    }),
  getProjectIgnore: vi.fn().mockResolvedValue({ patterns: [] }),
  setProjectIgnore: vi.fn().mockResolvedValue({ patterns: [] }),
  getMapViews: vi.fn().mockResolvedValue({
    schemaVersion: '1',
    kind: 'map-views',
    views: [],
    skipped: [],
  }),
  putMapView: vi.fn().mockResolvedValue({
    schemaVersion: '1',
    kind: 'map-views',
    views: [],
    skipped: [],
  }),
  deleteMapView: vi.fn().mockResolvedValue({
    schemaVersion: '1',
    kind: 'map-views',
    views: [],
    skipped: [],
  }),
  getActiveProvider: vi
    .fn()
    .mockResolvedValue({
      activeProvider: 'markdown',
      detected: [],
      source: 'default' as const,
      selectable: [],
      markerDrift: null,
    }),
  setActiveProvider: vi.fn().mockResolvedValue({
    activeProvider: 'markdown',
    detected: [],
    source: 'default' as const,
    selectable: [],
    markerDrift: null,
    switch: { dropped: null },
  }),
  acceptActiveProviderMarkers: vi.fn().mockResolvedValue({
    activeProvider: 'markdown',
    detected: [],
    source: 'default' as const,
    selectable: [],
    markerDrift: null,
  }),
  getActivityInstallStatus: vi.fn().mockResolvedValue({
    provider: 'markdown',
    supported: false,
    installed: false,
    configPath: null,
    configWired: false,
    bridgePresent: false,
    events: 0,
  }),
  installActivityHook: vi.fn().mockResolvedValue({
    provider: 'markdown',
    supported: false,
    installed: false,
    configPath: null,
    configWired: false,
    bridgePresent: false,
    events: 0,
  }),
  uninstallActivityHook: vi.fn().mockResolvedValue({ ...{
    provider: 'markdown',
    supported: false,
    installed: false,
    configPath: null,
    configWired: false,
    bridgePresent: false,
    events: 0,
  }, removed: false }),
  getAgentSkillInstallStatus: vi.fn().mockResolvedValue({
    provider: 'markdown',
    supported: false,
    skillDir: null,
    installed: false,
    stale: false,
  }),
  installAgentSkill: vi.fn().mockResolvedValue({
    provider: 'markdown',
    supported: false,
    skillDir: null,
    installed: false,
    stale: false,
    outcome: 'installed' as const,
  }),
  uninstallAgentSkill: vi.fn().mockResolvedValue({
    provider: 'markdown',
    supported: false,
    skillDir: null,
    installed: false,
    stale: false,
    removed: false,
  }),
  getActivitySummary: vi.fn().mockResolvedValue({ since: 0, nodes: {}, pairs: {}, runNodes: [] }),
  getNodeActivity: vi.fn().mockResolvedValue({
    stats: { count: 0, lastStartAt: 0, distinctOwners: 0 },
    recent: [],
    spawns: [],
    captureEnabled: false,
    runs: [],
  }),
  clearNodeActivity: vi.fn().mockResolvedValue(undefined),
  clearSessionJournal: vi.fn().mockResolvedValue(undefined),
  getSessionJournal: vi.fn().mockResolvedValue({ sessions: [], recording: false, captureLevel: 'mcp', shellCapture: false }),
  setCaptureLevel: vi.fn().mockResolvedValue('mcp'),
  setSessionRecording: vi.fn().mockResolvedValue(true),
  getSpawnRecord: vi.fn().mockResolvedValue(null),
  getActivityCapture: vi.fn().mockResolvedValue({ enabled: false }),
  setActivityCapture: vi.fn().mockResolvedValue({ enabled: false }),
  lookupContribution: vi.fn().mockResolvedValue(null),
  dispatchAction: vi.fn(),
  getUpdateStatus: vi.fn().mockResolvedValue({
    current: '0.0.0',
    latest: null,
    isOutdated: false,
    checkedAt: null,
    shownAt: null,
  }),
  getRegisteredAnnotations: vi.fn().mockResolvedValue([]),
  getGithubStars: vi.fn().mockResolvedValue({ count: null, checkedAt: null }),
  events: vi.fn().mockReturnValue(EMPTY),
};

@Injectable()
class FakeMarkdownRenderer extends MarkdownRenderer {
  override async render(): Promise<string> {
    return '';
  }
}

async function bootstrap(initialNodes: INodeView[]): Promise<{
  fixture: ComponentFixture<GraphView>;
  cmp: GraphView;
  loader: IStubLoader;
  router: Router;
}> {
  const loader = makeStubLoader(initialNodes);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: '', component: BlankPage },
      ]),
      { provide: CollectionLoaderService, useValue: loader },
      { provide: DATA_SOURCE, useValue: STUB_DATA_SOURCE },
      { provide: MarkdownRenderer, useClass: FakeMarkdownRenderer },
      // `WsEventStreamService` is pulled transitively (via `InspectorView` /
      // `LinkedNodesPanel`) and `inject(SKILL_MAP_MODE)` fires at instance
      // construction. Provide `'demo'` so the service short-circuits to
      // `EMPTY` and never tries to open a real socket in JSDOM.
      { provide: SKILL_MAP_MODE, useValue: 'demo' },
    ],
  });
  // Stub the dagre engine: vitest's JSDOM environment can't interop
  // the upstream `dagre` CJS module the same way the production
  // bundle does. The component-level provider from `provideFLayout`
  // wins over a root-level override, so we append our stub to the
  // component's providers via `overrideComponent({ add })`, last
  // provider wins for a given token. These tests don't probe layout
  // anyway (selection / URL sync / panel-close), the engine call is
  // muted to keep the test runner quiet.
  TestBed.overrideComponent(GraphView, {
    add: {
      providers: [
        {
          provide: DagreLayoutEngine,
          useValue: { calculate: vi.fn().mockResolvedValue({ nodes: [] }) },
        },
      ],
    },
  });
  // Seed the kind registry so the layout's per-kind splits resolve.
  TestBed.inject(KindRegistryService).ingest({
    agent: { primaryProviderId: 'claude', providers: { claude: { label: 'Agents', color: '#3b82f6' } } },
  });
  const router = TestBed.inject(Router);
  await router.navigateByUrl('/');
  const fixture = TestBed.createComponent(GraphView);
  // Construction wires the effects but DOES NOT detect changes, that
  // would render the Foblex template, which is not our concern. We
  // poke methods on the instance directly and let effects flush via
  // `flush()` below.
  return { fixture, cmp: fixture.componentInstance, loader, router };
}

/** Drive the effect runner without rendering the template. */
async function flushEffects(fixture: ComponentFixture<GraphView>): Promise<void> {
  // `detectChanges` runs the effect runner; calling it is enough to
  // surface signal-driven behaviour. We call it inside a try/catch
  // because the `@else` Foblex branch tries to render `f-flow`
  // descendants in JSDOM, geometry APIs (ResizeObserver,
  // getBoundingClientRect) may throw or return zeros, but the
  // selection / URL effects we care about already ran by the time
  // any render error surfaces.
  try {
    fixture.detectChanges();
  } catch {
    // Ignore Foblex-internal render glitches in JSDOM.
  }
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * Fire the `(fSelectionChange)` bridge the way `<f-flow fDraggable>`
 * does. The handler is `protected` (template-only surface), so the cast
 * is how the spec reaches it without widening the component API.
 */
function flowSelectionChange(cmp: GraphView, ...nodeIds: string[]): void {
  (cmp as unknown as { onFlowSelectionChange(event: FSelectionChangeEvent): void }).onFlowSelectionChange(
    new FSelectionChangeEvent(nodeIds, [], []),
  );
}

describe('GraphView, selection and URL sync', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('selects a node and exposes its path via selectedPath()', async () => {
    const node = makeNode('agents/architect.md', 'architect');
    const { fixture, cmp } = await bootstrap([node]);
    await flushEffects(fixture);

    cmp.selectedNodeId.set(node.path);
    await flushEffects(fixture);

    expect(cmp.selectedNodeId()).toBe(node.path);
  });

  it('builds an accessible node-host label naming the node, kind and selection state (WCAG 4.1.2)', async () => {
    const node = makeNode('agents/architect.md', 'architect');
    const { fixture, cmp } = await bootstrap([node]);
    await flushEffects(fixture);

    const graphNode = cmp.graph().nodes[0];
    expect(graphNode).toBeDefined();
    const unselected = cmp.nodeHostLabel(graphNode);
    expect(unselected).toContain('architect');
    expect(unselected).not.toContain('selected');

    cmp.selectedNodeId.set(node.path);
    await flushEffects(fixture);
    expect(cmp.nodeHostLabel(graphNode)).toContain('selected');
  });

  it('selects a node from the keyboard (WCAG 2.1.1)', async () => {
    const node = makeNode('agents/architect.md', 'architect');
    const { fixture, cmp } = await bootstrap([node]);
    await flushEffects(fixture);

    const graphNode = cmp.graph().nodes[0];
    cmp.selectNodeByKeyboard(graphNode, new KeyboardEvent('keydown', { key: 'Enter' }));
    await flushEffects(fixture);

    expect(cmp.selectedNodeId()).toBe(node.path);
  });

  it('mirrors a Foblex single-node selection into the app state', async () => {
    const node = makeNode('agents/architect.md', 'architect');
    const { fixture, cmp } = await bootstrap([node]);
    await flushEffects(fixture);

    flowSelectionChange(cmp, node.path);
    await flushEffects(fixture);

    expect(cmp.selectedNodeId()).toBe(node.path);
  });

  it('ignores the selection Foblex reports while a node is being dragged', async () => {
    const first = makeNode('agents/architect.md', 'architect');
    const second = makeNode('agents/reviewer.md', 'reviewer');
    const { fixture, cmp } = await bootstrap([first, second]);
    await flushEffects(fixture);

    flowSelectionChange(cmp, first.path);
    await flushEffects(fixture);

    // Grabbing `second` to move it: Foblex selects it on pointerdown and
    // reports that as soon as the drag threshold is crossed, with
    // `f-dragging` already stamped on its host. The inspector must stay
    // on `first` instead of following the grabbed node.
    const host = fixture.nativeElement.querySelector('f-flow') as HTMLElement;
    host.classList.add('f-dragging');
    flowSelectionChange(cmp, second.path);
    await flushEffects(fixture);

    expect(cmp.selectedNodeId()).toBe(first.path);

    // Same gesture released: the class is gone and a plain click selects
    // again, so the suppression is scoped to the drag.
    host.classList.remove('f-dragging');
    flowSelectionChange(cmp, second.path);
    await flushEffects(fixture);

    expect(cmp.selectedNodeId()).toBe(second.path);
  });

  it('writes the selected path into the URL `?path=` query param', async () => {
    const node = makeNode('agents/architect.md', 'architect');
    const { fixture, cmp, router } = await bootstrap([node]);
    await flushEffects(fixture);

    cmp.selectedNodeId.set(node.path);
    await flushEffects(fixture);
    // Allow router navigation microtask to land.
    await new Promise((r) => setTimeout(r, 0));

    expect(router.url).toContain(`path=${encodeURIComponent(node.path)}`);
  });

  it('removes the `?path=` param when selection is cleared via closePanel()', async () => {
    const node = makeNode('agents/architect.md', 'architect');
    const { fixture, cmp, router } = await bootstrap([node]);
    await flushEffects(fixture);

    cmp.selectedNodeId.set(node.path);
    await flushEffects(fixture);
    await new Promise((r) => setTimeout(r, 0));
    expect(router.url).toContain('path=');

    cmp.closePanel();
    await flushEffects(fixture);
    await new Promise((r) => setTimeout(r, 0));

    expect(cmp.selectedNodeId()).toBeNull();
    expect(router.url).not.toContain('path=');
  });

  it('Escape clears the selection when the panel is open', async () => {
    const node = makeNode('agents/architect.md', 'architect');
    const { fixture, cmp } = await bootstrap([node]);
    await flushEffects(fixture);

    cmp.selectedNodeId.set(node.path);
    await flushEffects(fixture);

    cmp.onEscape();
    await flushEffects(fixture);

    expect(cmp.selectedNodeId()).toBeNull();
  });

  it('Escape is a no-op when nothing is selected (does not break key propagation)', async () => {
    const { fixture, cmp } = await bootstrap([
      makeNode('agents/architect.md', 'architect'),
    ]);
    await flushEffects(fixture);

    expect(cmp.selectedNodeId()).toBeNull();
    cmp.onEscape();
    expect(cmp.selectedNodeId()).toBeNull();
  });
});

describe('GraphView, canvas click deselect shield', () => {
  /**
   * `onCanvasClick` clears the selection UNLESS the click landed inside
   * a surface marked `data-canvas-click-shield` (node cards, palettes,
   * toolbar, inspector panel, perf HUD). The attribute contract
   * replaced a hand-maintained CSS-class selector list, so the thing
   * to pin is the mechanism itself: shielded ancestor -> keep, bare
   * target -> clear.
   */
  it('keeps the selection for shielded targets and clears it on bare canvas', async () => {
    const { fixture, cmp } = await bootstrap([makeNode('a.md', 'a')]);
    await flushEffects(fixture);
    cmp.selectedNodeId.set('a.md');

    const shielded = document.createElement('div');
    shielded.setAttribute('data-canvas-click-shield', '');
    const inner = document.createElement('span');
    shielded.appendChild(inner);
    cmp.onCanvasClick({ target: inner } as unknown as MouseEvent);
    expect(cmp.selectedNodeId()).toBe('a.md');

    const bare = document.createElement('span');
    cmp.onCanvasClick({ target: bare } as unknown as MouseEvent);
    expect(cmp.selectedNodeId()).toBeNull();
  });
});

describe('GraphView, multi-selection survival', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  /**
   * Foblex owns multi-selection (Shift+marquee via `<f-selection-area>`,
   * Ctrl/Cmd+click toggle via `SelectByPointer`). These tests pin the
   * app-side guards that used to wipe that selection: the background
   * click synthesized at marquee release, the single-id click handler,
   * the drag-end re-assert, and Escape as the keyboard way out.
   * `flow` is stubbed because the Foblex template does not render in
   * JSDOM (see the bootstrap note above).
   */
  function stubFlow(cmp: GraphView, nodes: string[]): { select: ReturnType<typeof vi.fn> } {
    const select = vi.fn();
    (cmp as unknown as { flow: () => unknown }).flow = () => ({
      getSelection: () => ({ fNodeIds: nodes, fGroupIds: [], fConnectionIds: [] }),
      select,
      hostElement: document.createElement('div'),
    });
    return { select };
  }

  it('the click concluding a background drag (marquee release) does NOT deselect', async () => {
    const { fixture, cmp } = await bootstrap([makeNode('a.md', 'a')]);
    await flushEffects(fixture);
    cmp.selectedNodeId.set('a.md');

    const bare = document.createElement('span');
    cmp.onCanvasPointerDown({ button: 0, clientX: 0, clientY: 0 } as unknown as MouseEvent);
    cmp.onCanvasClick({ target: bare, clientX: 120, clientY: 80 } as unknown as MouseEvent);
    expect(cmp.selectedNodeId()).toBe('a.md');

    // A genuine click (no travel) still deselects.
    cmp.onCanvasPointerDown({ button: 0, clientX: 10, clientY: 10 } as unknown as MouseEvent);
    cmp.onCanvasClick({ target: bare, clientX: 11, clientY: 11 } as unknown as MouseEvent);
    expect(cmp.selectedNodeId()).toBeNull();
  });

  it('modifier clicks on the background do NOT deselect (selection-building gestures)', async () => {
    const { fixture, cmp } = await bootstrap([makeNode('a.md', 'a')]);
    await flushEffects(fixture);

    const bare = document.createElement('span');
    for (const modifier of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }]) {
      cmp.selectedNodeId.set('a.md');
      cmp.onCanvasClick({ target: bare, ...modifier } as unknown as MouseEvent);
      expect(cmp.selectedNodeId()).toBe('a.md');
    }
  });

  it('modifier clicks on a node do NOT collapse the selection to that node', async () => {
    const { fixture, cmp } = await bootstrap([makeNode('a.md', 'a')]);
    await flushEffects(fixture);
    const graphNode = cmp.graph().nodes[0];

    cmp.selectNode(graphNode, new MouseEvent('click', { ctrlKey: true }));
    expect(cmp.selectedNodeId()).toBeNull();
    cmp.selectNode(graphNode, new MouseEvent('click', { shiftKey: true }));
    expect(cmp.selectedNodeId()).toBeNull();

    cmp.selectNode(graphNode, new MouseEvent('click'));
    expect(cmp.selectedNodeId()).toBe('a.md');
  });

  it('drag-end preserves a multi-node Foblex selection (group move)', async () => {
    const { fixture, cmp } = await bootstrap([makeNode('a.md', 'a'), makeNode('b.md', 'b')]);
    await flushEffects(fixture);
    const { select } = stubFlow(cmp, ['a.md', 'b.md']);

    cmp.onNodePointerDown(new PointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
    cmp.onNodePositionChange('a.md', { x: 10, y: 20 });
    document.dispatchEvent(new MouseEvent('mouseup'));
    await Promise.resolve();

    expect(select).not.toHaveBeenCalled();
  });

  it('drag-end still re-asserts the app selection after a single-node drag', async () => {
    const { fixture, cmp } = await bootstrap([makeNode('a.md', 'a')]);
    await flushEffects(fixture);
    const { select } = stubFlow(cmp, ['a.md']);

    cmp.onNodePointerDown(new PointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
    cmp.onNodePositionChange('a.md', { x: 10, y: 20 });
    document.dispatchEvent(new MouseEvent('mouseup'));
    await Promise.resolve();

    // App inspects nothing, so the re-assert pushes an empty selection.
    expect(select).toHaveBeenCalledWith([], [], false);
  });

  it('Escape clears a Foblex-only multi-selection', async () => {
    const { fixture, cmp } = await bootstrap([makeNode('a.md', 'a'), makeNode('b.md', 'b')]);
    await flushEffects(fixture);
    const { select } = stubFlow(cmp, ['a.md', 'b.md']);

    expect(cmp.selectedNodeId()).toBeNull();
    cmp.onEscape();
    expect(select).toHaveBeenCalledWith([], [], false);
  });

  it('the bridge maps a multi-node selection to "no inspected node" and back', async () => {
    const first = makeNode('a.md', 'a');
    const second = makeNode('b.md', 'b');
    const { fixture, cmp } = await bootstrap([first, second]);
    await flushEffects(fixture);

    flowSelectionChange(cmp, first.path);
    expect(cmp.selectedNodeId()).toBe(first.path);

    // Growing the set (marquee / Ctrl+click) hides the inspector...
    flowSelectionChange(cmp, first.path, second.path);
    expect(cmp.selectedNodeId()).toBeNull();

    // ...and toggling back down to one node re-opens it on that node.
    flowSelectionChange(cmp, second.path);
    expect(cmp.selectedNodeId()).toBe(second.path);
  });

  it('a connection-only selection preserves the inspected node; an empty one clears it', async () => {
    const node = makeNode('a.md', 'a');
    const { fixture, cmp } = await bootstrap([node]);
    await flushEffects(fixture);
    const bridge = cmp as unknown as {
      onFlowSelectionChange(event: FSelectionChangeEvent): void;
    };

    flowSelectionChange(cmp, node.path);
    expect(cmp.selectedNodeId()).toBe(node.path);

    // Ctrl+arrow topology walk stops on a connection: keep the node.
    bridge.onFlowSelectionChange(new FSelectionChangeEvent([], [], ['edge-1']));
    expect(cmp.selectedNodeId()).toBe(node.path);

    bridge.onFlowSelectionChange(new FSelectionChangeEvent([], [], []));
    expect(cmp.selectedNodeId()).toBeNull();
  });

  it('a non-primary-button press does not arm the background-drag guard', async () => {
    const { fixture, cmp } = await bootstrap([makeNode('a.md', 'a')]);
    await flushEffects(fixture);
    cmp.selectedNodeId.set('a.md');

    // Middle-mouse pan: its press must not leave a stale anchor that
    // would suppress the deselect of the NEXT genuine click.
    cmp.onCanvasPointerDown({ button: 1, clientX: 0, clientY: 0 } as unknown as MouseEvent);
    const bare = document.createElement('span');
    cmp.onCanvasClick({ target: bare, clientX: 120, clientY: 80 } as unknown as MouseEvent);
    expect(cmp.selectedNodeId()).toBeNull();
  });
});

describe('GraphView, deep-link reader', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('opens the panel for a node when the URL carries `?path=…`', async () => {
    const node = makeNode('agents/architect.md', 'architect');
    const loader = makeStubLoader([node]);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', component: BlankPage },
        ]),
        { provide: CollectionLoaderService, useValue: loader },
        { provide: DATA_SOURCE, useValue: STUB_DATA_SOURCE },
        { provide: MarkdownRenderer, useClass: FakeMarkdownRenderer },
        // See note in the sibling describe: `WsEventStreamService` pulls
        // `SKILL_MAP_MODE` transitively; `'demo'` keeps the socket closed.
        { provide: SKILL_MAP_MODE, useValue: 'demo' },
      ],
    });
    TestBed.inject(KindRegistryService).ingest({
      agent: { primaryProviderId: 'claude', providers: { claude: { label: 'Agents', color: '#3b82f6' } } },
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl(`/?path=${encodeURIComponent(node.path)}`);

    const fixture = TestBed.createComponent(GraphView);
    const cmp = fixture.componentInstance;
    await flushEffects(fixture);
    await new Promise((r) => setTimeout(r, 0));
    await flushEffects(fixture);

    expect(cmp.selectedNodeId()).toBe(node.path);
  });
});

describe('GraphView, isolate (1-hop neighborhood)', () => {
  beforeEach(() => {
    // Overrides persist in localStorage; clear both the current and the
    // legacy key so each isolate test starts from show-all.
    localStorage.removeItem(scopedKey('sm.map.overrides'));
    localStorage.removeItem(scopedKey('sm.map.visible-paths'));
    TestBed.resetTestingModule();
  });

  it('re-selects the node + DIRECT neighbors as the map SELECTION, excluding 2-hop nodes', async () => {
    const a = makeNode('a.md', 'a');
    const b = makeNode('b.md', 'b');
    const c = makeNode('c.md', 'c'); // 2 hops from a (a-b-c): must NOT survive
    const { fixture, cmp, loader } = await bootstrap([a, b, c]);
    // a -> b -> c. With the old connected-component scope, isolating `a`
    // would keep all three (the graph is one component); 1-hop keeps {a, b}.
    loader.scan.set({
      ...loader.scan()!,
      links: [
        { source: 'a.md', target: 'b.md', kind: 'references', confidence: 1, sources: ['x'] },
        { source: 'b.md', target: 'c.md', kind: 'references', confidence: 1, sources: ['x'] },
      ],
    });
    await flushEffects(fixture);

    const mapVisibility = TestBed.inject(MapVisibilityService);
    // Baseline: no overrides (show-all).
    expect(mapVisibility.overrides().size).toBe(0);

    cmp.isolateNeighborhood('a.md');
    await flushEffects(fixture);

    // Isolate now applies the scope SERVER-SIDE: it writes the
    // "only these" override shape (root-exclude + one include per
    // neighborhood member) so the loader re-fetches that scope; the
    // 2-hop c is excluded. The origin stays selected. The branch render
    // itself follows the loader's re-fetch (stubbed here), so we assert
    // on the overrides the gesture wrote, mirroring workspace-view.isolate.
    expect(mapVisibility.overrides().get('')).toBe('exclude');
    expect(mapVisibility.overrides().get('a.md')).toBe('include');
    expect(mapVisibility.overrides().get('b.md')).toBe('include');
    expect(mapVisibility.overrides().has('c.md')).toBe(false);
    expect(cmp.selectedNodeId()).toBe('a.md');
  });

  it('isolates an orphan node down to itself alone (scope = just the node)', async () => {
    const a = makeNode('a.md', 'a');
    const b = makeNode('b.md', 'b');
    const { fixture, cmp } = await bootstrap([a, b]);
    await flushEffects(fixture);

    cmp.isolateNeighborhood('a.md');
    await flushEffects(fixture);

    const mapVisibility = TestBed.inject(MapVisibilityService);
    expect(mapVisibility.overrides().get('')).toBe('exclude');
    expect(mapVisibility.overrides().get('a.md')).toBe('include');
    expect(mapVisibility.overrides().size).toBe(2);
  });
});

describe('GraphView, inspector width reservation', () => {
  // `reservedPanelWidth` feeds both the panel-blind viewport math
  // (auto-fit / center pan reserve it as `panelW`) and the floating
  // toolbar's horizontal centering (it dodges the inspector overlay via
  // `--sm-graph-inspector-w`). The CSS transform itself is verified
  // visually, here we only pin the reactive value the centering depends
  // on. Members are `protected`, so the cast reaches them the same way a
  // template binding would. Foblex is never rendered (see the file
  // header), so this stays in the JSDOM-safe API surface.
  type WithReservation = { reservedPanelWidth: () => number; clampedPanelWidth: () => number };

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('reserves zero width while no node is selected', async () => {
    const { fixture, cmp } = await bootstrap([makeNode('a.md', 'a')]);
    await flushEffects(fixture);

    expect(cmp.selectedNodeId()).toBeNull();
    expect((cmp as unknown as WithReservation).reservedPanelWidth()).toBe(0);
  });

  it('reserves the live panel width once a node is selected', async () => {
    const node = makeNode('a.md', 'a');
    const { fixture, cmp } = await bootstrap([node]);
    await flushEffects(fixture);

    cmp.selectedNodeId.set(node.path);
    await flushEffects(fixture);

    const view = cmp as unknown as WithReservation;
    expect(view.reservedPanelWidth()).toBe(view.clampedPanelWidth());
    expect(view.reservedPanelWidth()).toBeGreaterThan(0);
  });

  it('drops the reservation back to zero when the panel closes', async () => {
    const node = makeNode('a.md', 'a');
    const { fixture, cmp } = await bootstrap([node]);
    await flushEffects(fixture);

    cmp.selectedNodeId.set(node.path);
    await flushEffects(fixture);
    expect((cmp as unknown as WithReservation).reservedPanelWidth()).toBeGreaterThan(0);

    cmp.closePanel();
    await flushEffects(fixture);

    expect((cmp as unknown as WithReservation).reservedPanelWidth()).toBe(0);
  });
});

describe('GraphView, branch rendering + cap banner', () => {
  beforeEach(() => {
    // Map-visibility curation persists in localStorage; a prior isolate
    // test can leave a non-empty inclusion set that would narrow the
    // canvas here. Clear it so the branch projection is the only filter.
    localStorage.removeItem(scopedKey('sm.map.visible-paths'));
    TestBed.resetTestingModule();
  });

  it('renders the branch node set on the map (the projected graph)', async () => {
    const a = makeNode('a.md', 'a');
    const b = makeNode('b.md', 'b');
    const { fixture, cmp } = await bootstrap([a, b]);
    await flushEffects(fixture);

    // `graph()` projects the loader's branch node set; both branch nodes
    // are on the canvas.
    expect(new Set(cmp.graph().nodes.map((n) => n.id))).toEqual(new Set(['a.md', 'b.md']));
    expect(cmp.hasData()).toBe(true);
  });

  it('shows the branch-cap banner when the loaded branch is truncated', async () => {
    const { fixture, loader } = await bootstrap([makeNode('a.md', 'a')]);
    // Mark the branch truncated: more nodes in the folder than rendered.
    loader.branch.set({
      ...loader.branch()!,
      branch: { paths: [], excluded: [], rootExcluded: false, total: 900, rendered: 1, truncated: true, cap: 1 },
    });
    await flushEffects(fixture);

    const banner = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="branch-cap-banner"]',
    );
    expect(banner).not.toBeNull();
    const body = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="branch-cap-banner-body"]',
    );
    expect(body?.textContent).toContain('900');
  });

  it('hides the branch-cap banner when the branch fits under the cap', async () => {
    const { fixture, loader } = await bootstrap([makeNode('a.md', 'a')]);
    loader.branch.set({
      ...loader.branch()!,
      branch: { paths: [], excluded: [], rootExcluded: false, total: 1, rendered: 1, truncated: false, cap: 256 },
    });
    await flushEffects(fixture);

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="branch-cap-banner"]'),
    ).toBeNull();
  });
});

describe('GraphView, spawn-edge conversation thread', () => {
  /** Protected-surface probe for the conversation-dialog state. */
  interface IConvoProbe {
    onSpawnEdgeClick(spawnId: string, event: MouseEvent): void;
    conversationOpen(): boolean;
    conversationThread(): ISpawnThread | null;
    conversationCaptureEnabled(): boolean;
  }

  function makeSpawn(
    spawnId: string,
    startedAt: number,
    overrides: Partial<IActivitySpawnRecordApi> = {},
  ): IActivitySpawnRecordApi {
    return {
      spawnId,
      parentOwner: 'main:6cfe5636',
      childKind: 'agent',
      childName: 'demo-worker',
      childNodePath: '.claude/agents/demo-worker.md',
      prompt: `ask ${spawnId}`,
      response: `reply ${spawnId}`,
      startedAt,
      status: 'ended',
      ...overrides,
    };
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    // STUB_DATA_SOURCE is module-shared; pin these two mocks back to
    // their neutral defaults so tests do not leak into each other.
    vi.mocked(STUB_DATA_SOURCE.getSpawnRecord).mockReset().mockResolvedValue(null);
    vi.mocked(STUB_DATA_SOURCE.getNodeActivity).mockReset().mockResolvedValue({
      stats: { count: 0, lastStartAt: 0, distinctOwners: 0 },
      recent: [],
      spawns: [],
      captureEnabled: false,
      runs: [],
    });
  });

  /** Lets the two chained awaits of the click handler settle. */
  async function settle(): Promise<void> {
    await new Promise((r) => setTimeout(r, 0));
  }

  it('widens the clicked record to the full thread via the two fetches', async () => {
    const s1 = makeSpawn('s1', 1000);
    const s2 = makeSpawn('s2', 2000);
    const s3 = makeSpawn('s3', 3000, { status: 'running', response: undefined });
    vi.mocked(STUB_DATA_SOURCE.getSpawnRecord).mockResolvedValue({ ...s2, captureEnabled: true });
    vi.mocked(STUB_DATA_SOURCE.getNodeActivity).mockResolvedValue({
      stats: { count: 3, lastStartAt: 3000, distinctOwners: 1 },
      recent: [],
      spawns: [s3, s1, s2],
      captureEnabled: true,
      runs: [],
    });

    const { cmp } = await bootstrap([]);
    const probe = cmp as unknown as IConvoProbe;
    probe.onSpawnEdgeClick('s2', new MouseEvent('click'));
    await settle();

    expect(STUB_DATA_SOURCE.getSpawnRecord).toHaveBeenCalledWith('s2');
    expect(STUB_DATA_SOURCE.getNodeActivity).toHaveBeenCalledWith('.claude/agents/demo-worker.md');
    expect(probe.conversationOpen()).toBe(true);
    expect(probe.conversationCaptureEnabled()).toBe(true);
    expect(probe.conversationThread()?.records.map((r) => r.spawnId)).toEqual(['s1', 's2', 's3']);
  });

  it('falls back to a singleton thread when the widening fetch fails', async () => {
    const s2 = makeSpawn('s2', 2000);
    vi.mocked(STUB_DATA_SOURCE.getSpawnRecord).mockResolvedValue({ ...s2, captureEnabled: true });
    vi.mocked(STUB_DATA_SOURCE.getNodeActivity).mockRejectedValue(new Error('transport down'));

    const { cmp } = await bootstrap([]);
    const probe = cmp as unknown as IConvoProbe;
    probe.onSpawnEdgeClick('s2', new MouseEvent('click'));
    await settle();

    expect(probe.conversationOpen()).toBe(true);
    expect(probe.conversationThread()?.records.map((r) => r.spawnId)).toEqual(['s2']);
  });

  it('skips the widening fetch when the record names no scanned child', async () => {
    const record = makeSpawn('s5', 5000, { childNodePath: undefined });
    vi.mocked(STUB_DATA_SOURCE.getSpawnRecord).mockResolvedValue({
      ...record,
      captureEnabled: false,
    });

    const { cmp } = await bootstrap([]);
    const probe = cmp as unknown as IConvoProbe;
    probe.onSpawnEdgeClick('s5', new MouseEvent('click'));
    await settle();

    expect(STUB_DATA_SOURCE.getNodeActivity).not.toHaveBeenCalled();
    expect(probe.conversationOpen()).toBe(true);
    expect(probe.conversationCaptureEnabled()).toBe(false);
    expect(probe.conversationThread()?.records.map((r) => r.spawnId)).toEqual(['s5']);
  });

  it('a superseding second click drops the stale first fetch', async () => {
    let resolveFirst!: (value: IActivitySpawnDetailApi | null) => void;
    vi.mocked(STUB_DATA_SOURCE.getSpawnRecord)
      .mockImplementationOnce(
        () =>
          new Promise<IActivitySpawnDetailApi | null>((res) => {
            resolveFirst = res;
          }),
      )
      .mockImplementationOnce(async () => ({
        ...makeSpawn('s9', 9000, { childNodePath: undefined, childName: 'other-agent' }),
        captureEnabled: false,
      }));

    const { cmp } = await bootstrap([]);
    const probe = cmp as unknown as IConvoProbe;
    probe.onSpawnEdgeClick('s1', new MouseEvent('click'));
    probe.onSpawnEdgeClick('s9', new MouseEvent('click'));
    await settle();

    // The stale first record lands AFTER the second click resolved.
    resolveFirst({ ...makeSpawn('s1', 1000), captureEnabled: true });
    await settle();

    expect(probe.conversationOpen()).toBe(true);
    expect(probe.conversationThread()?.records.map((r) => r.spawnId)).toEqual(['s9']);
  });
});

describe('GraphView, spawn-active static edges', () => {
  interface IStaticEdgeProbe {
    onStaticEdgeClick(
      edge: { id: string; from: string; to: string },
      event: MouseEvent,
    ): void;
    spawnActiveIdFor(edge: { from: string; to: string }): string | null;
    conversationOpen(): boolean;
    conversationThread(): ISpawnThread | null;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.mocked(STUB_DATA_SOURCE.getSpawnRecord).mockReset().mockResolvedValue(null);
    vi.mocked(STUB_DATA_SOURCE.getNodeActivity).mockReset().mockResolvedValue({
      stats: { count: 0, lastStartAt: 0, distinctOwners: 0 },
      recent: [],
      spawns: [],
      captureEnabled: false,
      runs: [],
    });
  });

  async function settle(): Promise<void> {
    await new Promise((r) => setTimeout(r, 0));
  }

  it('routes a spawn-active static edge click into the SAME conversation path as the dashed edge', async () => {
    const record: IActivitySpawnRecordApi = {
      spawnId: 's7',
      parentOwner: 'main:6cfe5636',
      parentNodePath: 'agents/orchestrator.md',
      childName: 'demo-worker',
      startedAt: 7000,
      status: 'running',
      prompt: 'go',
    };
    vi.mocked(STUB_DATA_SOURCE.getSpawnRecord).mockResolvedValue({
      ...record,
      captureEnabled: true,
    });

    const { cmp } = await bootstrap([]);
    const probe = cmp as unknown as IStaticEdgeProbe;
    // Pin the pair lookup: the overlay -> pairKey mapping is pure and
    // covered by spawn-overlay.spec; this test owns the click routing.
    (probe as { spawnActiveIdFor(edge: unknown): string | null }).spawnActiveIdFor = () => 's7';

    probe.onStaticEdgeClick(
      { id: 'e1', from: 'agents/orchestrator.md', to: 'agents/worker.md' },
      new MouseEvent('click'),
    );
    await settle();

    expect(STUB_DATA_SOURCE.getSpawnRecord).toHaveBeenCalledWith('s7');
    expect(probe.conversationOpen()).toBe(true);
    expect(probe.conversationThread()?.records.map((r) => r.spawnId)).toEqual(['s7']);
  });

  it('a label-less static edge click does nothing (no fetch, no dialog)', async () => {
    const { cmp } = await bootstrap([]);
    const probe = cmp as unknown as IStaticEdgeProbe;

    // Real lookups: no live spawns and no pair counters, so every
    // static edge is plain AND label-less, and the click stays inert.
    expect(
      probe.spawnActiveIdFor({ from: 'agents/orchestrator.md', to: 'agents/worker.md' }),
    ).toBeNull();
    probe.onStaticEdgeClick(
      { id: 'e1', from: 'agents/orchestrator.md', to: 'agents/worker.md' },
      new MouseEvent('click'),
    );
    await settle();

    expect(STUB_DATA_SOURCE.getSpawnRecord).not.toHaveBeenCalled();
    expect(STUB_DATA_SOURCE.getNodeActivity).not.toHaveBeenCalled();
    expect(probe.conversationOpen()).toBe(false);
  });
});

describe('GraphView, follow-the-activity camera', () => {
  const FOLLOW_KEY = 'sm.live.follow-activity';

  /** Protected-surface probe for the follow feature. The fingerprint /
   *  framing internals moved to `follow-activity.controller.ts` and are
   *  covered by `follow-activity.controller.spec.ts`; this suite keeps
   *  the component-level wiring (toggle, gesture disable, boot gating). */
  interface IFollowProbe {
    followActivity(): boolean;
    toggleFollowActivity(): void;
    onCanvasChange(event: { position: { x: number; y: number }; scale: number }): void;
    fitToScreen(): void;
    zoomIn(): void;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    // Seed the preference OFF: the default flipped to ON (user call
    // 2026-07-26), and this suite exercises the explicit toggle-on
    // wiring, so it starts from a stored opt-out.
    localStorage.setItem(FOLLOW_KEY, 'false');
    localStorage.removeItem(scopedKey('sm.map.visible-paths'));
    localStorage.removeItem(scopedKey('sm.graph.viewport'));
  });

  /**
   * Local bootstrap: same harness as the shared `bootstrap()` plus a
   * stubbed `NodeActivityService` whose `activePaths` / `enabled`
   * signals the test drives directly (the real service only moves on
   * WS frames, which demo mode never opens).
   */
  async function bootstrapWithActivity(
    initialNodes: INodeView[],
    active: ReturnType<typeof signal<ReadonlySet<string>>>,
    activityEnabled: ReturnType<typeof signal<boolean>>,
  ): Promise<{ fixture: ComponentFixture<GraphView>; cmp: GraphView; probe: IFollowProbe }> {
    const loader = makeStubLoader(initialNodes);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '', component: BlankPage }]),
        { provide: CollectionLoaderService, useValue: loader },
        { provide: DATA_SOURCE, useValue: STUB_DATA_SOURCE },
        { provide: MarkdownRenderer, useClass: FakeMarkdownRenderer },
        { provide: SKILL_MAP_MODE, useValue: 'demo' },
        {
          provide: NodeActivityService,
          useValue: {
            enabled: activityEnabled.asReadonly(),
            activePaths: active.asReadonly(),
            activeInvocations: signal<readonly INodeInvocation[]>([]).asReadonly(),
            executionDetails: signal<ReadonlyMap<string, string>>(new Map()).asReadonly(),
            setEnabled: vi.fn(),
          } as unknown as NodeActivityService,
        },
      ],
    });
    TestBed.overrideComponent(GraphView, {
      add: {
        providers: [
          {
            provide: DagreLayoutEngine,
            useValue: { calculate: vi.fn().mockResolvedValue({ nodes: [] }) },
          },
        ],
      },
    });
    TestBed.inject(KindRegistryService).ingest({
      agent: { primaryProviderId: 'claude', providers: { claude: { label: 'Agents', color: '#3b82f6' } } },
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/');
    const fixture = TestBed.createComponent(GraphView);
    return {
      fixture,
      cmp: fixture.componentInstance,
      probe: fixture.componentInstance as unknown as IFollowProbe,
    };
  }

  /** Flush effects + the boot-fit `queueMicrotask` + the follow effect re-run. */
  async function settleBoot(fixture: ComponentFixture<GraphView>): Promise<void> {
    await flushEffects(fixture);
    await new Promise((r) => setTimeout(r, 0));
    await flushEffects(fixture);
  }

  it('toggle flips the persisted preference through LivePreferencesService', async () => {
    const active = signal<ReadonlySet<string>>(new Set());
    const { fixture, probe } = await bootstrapWithActivity(
      [makeNode('a.md', 'a')],
      active,
      signal(true),
    );
    await settleBoot(fixture);

    expect(probe.followActivity()).toBe(false);
    probe.toggleFollowActivity();
    expect(probe.followActivity()).toBe(true);
    expect(TestBed.inject(LivePreferencesService).followActivityEnabled()).toBe(true);
    expect(localStorage.getItem(FOLLOW_KEY)).toBe('true');

    probe.toggleFollowActivity();
    expect(probe.followActivity()).toBe(false);
    expect(localStorage.getItem(FOLLOW_KEY)).toBe('false');
  });

  it('spine comets: one track per executing pair, none while only one endpoint runs', async () => {
    const active = signal<ReadonlySet<string>>(new Set());
    const { fixture, cmp } = await bootstrapWithActivity(
      [makeNode('a.md', 'a'), makeNode('b.md', 'b')],
      active,
      signal(true),
    );
    const loader = TestBed.inject(CollectionLoaderService) as unknown as IStubLoader;
    // Two link kinds on the same directed pair: they collapse into ONE
    // comet track (two overlaid trains would smear).
    loader.scan.set({
      ...loader.scan()!,
      links: [
        { source: 'a.md', target: 'b.md', kind: 'references', confidence: 1, sources: ['x'] },
        { source: 'a.md', target: 'b.md', kind: 'mentions', confidence: 1, sources: ['x'] },
      ],
    });
    await settleBoot(fixture);
    const comets = (cmp as unknown as { cometEdges: () => readonly { key: string }[] }).cometEdges;
    expect(comets()).toHaveLength(0);

    active.set(new Set(['a.md']));
    await flushEffects(fixture);
    expect(comets()).toHaveLength(0);

    active.set(new Set(['a.md', 'b.md']));
    await flushEffects(fixture);
    expect(comets().map((c) => c.key)).toEqual(['a.md>>b.md']);

    active.set(new Set());
    await flushEffects(fixture);
    expect(comets()).toHaveLength(0);
  });

  it('a canvas gesture while the camera RESTS keeps follow armed', async () => {
    const active = signal<ReadonlySet<string>>(new Set());
    const { fixture, probe } = await bootstrapWithActivity(
      [makeNode('a.md', 'a')],
      active,
      signal(true),
    );
    await settleBoot(fixture);

    probe.toggleFollowActivity();
    expect(probe.followActivity()).toBe(true);

    // Foblex only emits fCanvasChange for user gestures; simulate one
    // with no camera tween in flight: looking around between
    // executions must not disarm the follow preference.
    probe.onCanvasChange({ position: { x: 5, y: 5 }, scale: 1 });
    expect(probe.followActivity()).toBe(true);
  });

  it('a canvas gesture that interrupts an in-flight camera move switches follow off', async () => {
    const active = signal<ReadonlySet<string>>(new Set());
    const { fixture, cmp, probe } = await bootstrapWithActivity(
      [makeNode('a.md', 'a')],
      active,
      signal(true),
    );
    await settleBoot(fixture);

    probe.toggleFollowActivity();
    expect(probe.followActivity()).toBe(true);

    // Drive the shared tween entry point directly (the follow effect
    // reaches it through dagre positions, unavailable under jsdom) so
    // the camera counts as moving, then interrupt it with a gesture.
    (cmp as unknown as {
      animateToTransform(t: { position: { x: number; y: number }; scale: number }): void;
    }).animateToTransform({ position: { x: 100, y: 100 }, scale: 1 });
    probe.onCanvasChange({ position: { x: 5, y: 5 }, scale: 1 });
    expect(probe.followActivity()).toBe(false);
  });

  it('canvas events during boot do NOT kill a persisted follow preference', async () => {
    localStorage.setItem(FOLLOW_KEY, 'true');
    const active = signal<ReadonlySet<string>>(new Set());
    // Empty node set: `visibleNodes` stays empty, the boot fit never
    // completes, so the boot-time imperative fit's own emission must
    // leave the preference alone.
    const { fixture, probe } = await bootstrapWithActivity([], active, signal(true));
    await settleBoot(fixture);

    expect(probe.followActivity()).toBe(true);
    probe.onCanvasChange({ position: { x: 5, y: 5 }, scale: 1 });
    expect(probe.followActivity()).toBe(true);
  });

  it('an animated camera move persists the destination viewport for reload', async () => {
    const active = signal<ReadonlySet<string>>(new Set());
    const { fixture, cmp } = await bootstrapWithActivity(
      [makeNode('a.md', 'a')],
      active,
      signal(true),
    );
    await settleBoot(fixture);

    // Nothing persisted from boot (beforeEach cleared the key; the boot
    // fit is suppressed only when a saved viewport exists, and there is
    // none here, so the boot writes come from the fit itself). Drive the
    // shared tween entry point like a toolbox tool would (fit / reset /
    // show-all / isolate all funnel through it), then assert the target
    // landed in localStorage so an F5 restores it instead of the
    // pre-click position.
    (cmp as unknown as {
      animateToTransform(t: { position: { x: number; y: number }; scale: number }): void;
    }).animateToTransform({ position: { x: 100, y: 240 }, scale: 1.5 });

    const raw = localStorage.getItem(scopedKey('sm.graph.viewport'));
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ x: 100, y: 240, scale: 1.5 });
  });

  it('toolbar camera buttons (fit / zoom) keep follow armed', async () => {
    const active = signal<ReadonlySet<string>>(new Set());
    const { fixture, probe } = await bootstrapWithActivity(
      [makeNode('a.md', 'a')],
      active,
      signal(true),
    );
    await settleBoot(fixture);

    probe.toggleFollowActivity();
    expect(probe.followActivity()).toBe(true);
    // Neither fit-to-screen nor zoom hand control back anymore: the
    // camera repositions now and follow re-grabs it on the next activity
    // change (the operator only turns follow off via its own toggle).
    probe.fitToScreen();
    expect(probe.followActivity()).toBe(true);
    probe.zoomIn();
    expect(probe.followActivity()).toBe(true);
  });

  // Fingerprint semantics (visible-only membership, sort-insensitivity,
  // empty-set sentinel) and the re-frame cadence are covered by
  // `follow-activity.controller.spec.ts` against the extracted
  // controller's observable surface.
});

describe('GraphView, change spark', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    localStorage.removeItem(scopedKey('sm.map.visible-paths'));
    localStorage.removeItem(scopedKey('sm.graph.viewport'));
  });

  /**
   * Shared-`bootstrap` shape plus stubbed `NodeSparkService` /
   * `NodeActivityService` signals the test drives directly (the real
   * services only move on WS frames, which demo mode never opens).
   */
  async function bootstrapWithSpark(
    initialNodes: INodeView[],
    spark: ReturnType<typeof signal<ReadonlySet<string>>>,
    active: ReturnType<typeof signal<ReadonlySet<string>>>,
  ): Promise<{ fixture: ComponentFixture<GraphView>; cmp: GraphView }> {
    const loader = makeStubLoader(initialNodes);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '', component: BlankPage }]),
        { provide: CollectionLoaderService, useValue: loader },
        { provide: DATA_SOURCE, useValue: STUB_DATA_SOURCE },
        { provide: MarkdownRenderer, useClass: FakeMarkdownRenderer },
        { provide: SKILL_MAP_MODE, useValue: 'demo' },
        {
          provide: NodeActivityService,
          useValue: {
            enabled: signal(true).asReadonly(),
            activePaths: active.asReadonly(),
            activeInvocations: signal<readonly INodeInvocation[]>([]).asReadonly(),
            executionDetails: signal<ReadonlyMap<string, string>>(new Map()).asReadonly(),
            setEnabled: vi.fn(),
          } as unknown as NodeActivityService,
        },
        {
          provide: NodeSparkService,
          useValue: {
            enabled: signal(true).asReadonly(),
            sparkPaths: spark.asReadonly(),
            setEnabled: vi.fn(),
          } as unknown as NodeSparkService,
        },
      ],
    });
    TestBed.overrideComponent(GraphView, {
      add: {
        providers: [
          {
            provide: DagreLayoutEngine,
            useValue: { calculate: vi.fn().mockResolvedValue({ nodes: [] }) },
          },
        ],
      },
    });
    TestBed.inject(KindRegistryService).ingest({
      agent: { primaryProviderId: 'claude', providers: { claude: { label: 'Agents', color: '#3b82f6' } } },
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/');
    const fixture = TestBed.createComponent(GraphView);
    return { fixture, cmp: fixture.componentInstance };
  }

  function sparkEl(fixture: ComponentFixture<GraphView>, id: string): Element | null {
    const host = (fixture.nativeElement as HTMLElement).querySelector(
      `[data-testid="graph-node-${id}"]`,
    );
    return host?.querySelector('.sm-gnode__spark') ?? null;
  }

  it('mounts the spark element while the path is in sparkPaths, unmounts on clear', async () => {
    const spark = signal<ReadonlySet<string>>(new Set());
    const active = signal<ReadonlySet<string>>(new Set());
    const { fixture, cmp } = await bootstrapWithSpark([makeNode('a.md', 'a')], spark, active);
    await flushEffects(fixture);
    expect(cmp.isSparking('a.md')).toBe(false);
    expect(sparkEl(fixture, 'a.md')).toBeNull();

    spark.set(new Set(['a.md']));
    await flushEffects(fixture);
    expect(cmp.isSparking('a.md')).toBe(true);
    expect(sparkEl(fixture, 'a.md')).not.toBeNull();

    spark.set(new Set());
    await flushEffects(fixture);
    expect(sparkEl(fixture, 'a.md')).toBeNull();
  });

  it('the executing glow wins: a lit node never shows the spark element', async () => {
    const spark = signal<ReadonlySet<string>>(new Set(['a.md']));
    const active = signal<ReadonlySet<string>>(new Set(['a.md']));
    const { fixture } = await bootstrapWithSpark([makeNode('a.md', 'a')], spark, active);
    await flushEffects(fixture);

    expect(sparkEl(fixture, 'a.md')).toBeNull();
    const host = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="graph-node-a.md"]',
    );
    expect(host?.querySelector('.sm-gnode__halo')).not.toBeNull();
  });
});

describe('GraphView, edge conversation-count labels + historical click', () => {
  const PARENT = 'agents/orchestrator.md';
  const CHILD = 'agents/worker.md';
  const PAIR_KEY = `${PARENT}>>${CHILD}`;
  const EDGE = { id: 'e1', from: PARENT, to: CHILD };

  /** Protected-surface probe for the count lookups + historical path. */
  interface IConvoCountProbe {
    convoCountFor(edge: { from: string; to: string }): number;
    convoCountForKey(pairKey: string): number;
    spawnActiveIdFor(edge: { from: string; to: string }): string | null;
    onStaticEdgeClick(edge: { id: string; from: string; to: string }, event: MouseEvent): void;
    conversationOpen(): boolean;
    conversationThread(): ISpawnThread | null;
    conversationCaptureEnabled(): boolean;
  }

  function makeHistoricalRecord(
    spawnId: string,
    startedAt: number,
    overrides: Partial<IActivitySpawnRecordApi> = {},
  ): IActivitySpawnRecordApi {
    return {
      spawnId,
      parentOwner: 'main:6cfe5636',
      parentNodePath: PARENT,
      childKind: 'agent',
      childName: 'worker',
      childNodePath: CHILD,
      prompt: `ask ${spawnId}`,
      response: `reply ${spawnId}`,
      startedAt,
      status: 'ended',
      ...overrides,
    };
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    // The REAL NodeActivityStatsService hydrates pairCounts from the
    // summary; each test seeds the mock BEFORE bootstrap.
    vi.mocked(STUB_DATA_SOURCE.getActivitySummary)
      .mockReset()
      .mockResolvedValue({ since: 0, nodes: {}, pairs: {}, runNodes: [] });
    vi.mocked(STUB_DATA_SOURCE.getSpawnRecord).mockReset().mockResolvedValue(null);
    vi.mocked(STUB_DATA_SOURCE.getNodeActivity).mockReset().mockResolvedValue({
      stats: { count: 0, lastStartAt: 0, distinctOwners: 0 },
      recent: [],
      spawns: [],
      captureEnabled: false,
      runs: [],
    });
  });

  function seedPairs(pairs: Record<string, { count: number; lastStartAt: number }>): void {
    vi.mocked(STUB_DATA_SOURCE.getActivitySummary).mockResolvedValue({
      since: 0,
      nodes: {},
      pairs,
      runNodes: [],
    });
  }

  async function settle(): Promise<void> {
    await new Promise((r) => setTimeout(r, 0));
  }

  it('exposes the hydrated pair count for a static edge and via the key form (dashed edges)', async () => {
    seedPairs({ [PAIR_KEY]: { count: 3, lastStartAt: 1000 } });
    const { cmp } = await bootstrap([]);
    await settle();
    const probe = cmp as unknown as IConvoCountProbe;

    // Static edges (plain AND spawn-active) resolve through the edge
    // form; the dashed spawn edges use the precomputed key form
    // (session parents key by the raw owner).
    expect(probe.convoCountFor(EDGE)).toBe(3);
    expect(probe.convoCountForKey(PAIR_KEY)).toBe(3);
    expect(probe.convoCountForKey(`main:6cfe5636>>${CHILD}`)).toBe(0);
    expect(probe.convoCountFor({ from: CHILD, to: PARENT })).toBe(0); // directional
  });

  it('historical click opens the MOST RECENT thread of the pair, filtered to this parent', async () => {
    seedPairs({ [PAIR_KEY]: { count: 3, lastStartAt: 3000 } });
    // Two sessions talked over this edge (two threads); a foreign
    // parent's record must not leak into either.
    const oldTurn = makeHistoricalRecord('h0', 500, { parentOwner: 'main:older' });
    const t1 = makeHistoricalRecord('h1', 1000);
    const t2 = makeHistoricalRecord('h2', 2000);
    const foreign = makeHistoricalRecord('x1', 3000, { parentNodePath: 'agents/other.md' });
    vi.mocked(STUB_DATA_SOURCE.getNodeActivity).mockResolvedValue({
      stats: { count: 3, lastStartAt: 3000, distinctOwners: 2 },
      recent: [],
      spawns: [oldTurn, t1, t2, foreign],
      captureEnabled: true,
      runs: [],
    });

    const { cmp } = await bootstrap([]);
    await settle();
    const probe = cmp as unknown as IConvoCountProbe;
    probe.onStaticEdgeClick(EDGE, new MouseEvent('click'));
    await settle();

    expect(STUB_DATA_SOURCE.getNodeActivity).toHaveBeenCalledWith(CHILD);
    expect(STUB_DATA_SOURCE.getSpawnRecord).not.toHaveBeenCalled();
    expect(probe.conversationOpen()).toBe(true);
    expect(probe.conversationCaptureEnabled()).toBe(true);
    // Most recent thread (the main:6cfe5636 session) wins; its records
    // are chronological and the foreign parent is filtered out.
    expect(probe.conversationThread()?.records.map((r) => r.spawnId)).toEqual(['h1', 'h2']);
  });

  it('historical click with nothing retained opens the empty-records thread carrying the pair naming', async () => {
    seedPairs({ [PAIR_KEY]: { count: 2, lastStartAt: 2000 } });
    // Capture gate off / server restarted: detail comes back empty.
    vi.mocked(STUB_DATA_SOURCE.getNodeActivity).mockResolvedValue({
      stats: { count: 0, lastStartAt: 0, distinctOwners: 0 },
      recent: [],
      spawns: [],
      captureEnabled: false,
      runs: [],
    });

    const { cmp } = await bootstrap([]);
    await settle();
    const probe = cmp as unknown as IConvoCountProbe;
    probe.onStaticEdgeClick(EDGE, new MouseEvent('click'));
    await settle();

    expect(probe.conversationOpen()).toBe(true);
    expect(probe.conversationCaptureEnabled()).toBe(false);
    const thread = probe.conversationThread();
    expect(thread?.records).toEqual([]);
    expect(thread?.parentNodePath).toBe(PARENT);
    expect(thread?.childNodePath).toBe(CHILD);
  });

  it('a live spawn riding the edge still wins over the historical path', async () => {
    seedPairs({ [PAIR_KEY]: { count: 5, lastStartAt: 5000 } });
    vi.mocked(STUB_DATA_SOURCE.getSpawnRecord).mockResolvedValue({
      ...makeHistoricalRecord('s7', 7000, { status: 'running', response: undefined }),
      captureEnabled: true,
    });

    const { cmp } = await bootstrap([]);
    await settle();
    const probe = cmp as unknown as IConvoCountProbe;
    // Pin the pair lookup (overlay -> pairKey mapping is covered by
    // spawn-overlay.spec); the count is ALSO > 0, live must win.
    (probe as { spawnActiveIdFor(edge: unknown): string | null }).spawnActiveIdFor = () => 's7';

    probe.onStaticEdgeClick(EDGE, new MouseEvent('click'));
    await settle();

    expect(STUB_DATA_SOURCE.getSpawnRecord).toHaveBeenCalledWith('s7');
    expect(probe.conversationOpen()).toBe(true);
    expect(probe.conversationThread()?.records.map((r) => r.spawnId)).toEqual(['s7']);
  });
});
