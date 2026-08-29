import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { By, DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { EMPTY, Subject } from 'rxjs';

import { InspectorView } from '../inspector-view';
import { InspectorActivitySection } from '../inspector-activity-section/inspector-activity-section';
import { InspectorAiActionsSection } from '../inspector-ai-actions-section/inspector-ai-actions-section';
import { NODE_OPEN_INTENT } from '../../../slots/node-open-intent';
import { ActionDispatchService } from '../../../../services/action-dispatch';
import { WsEventStreamService } from '../../../../services/ws-event-stream';
import {
  DATA_SOURCE,
  DataSourceError,
  type IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
import { SKILL_MAP_MODE } from '../../../../services/data-source/runtime-mode';
import { MarkdownRenderer } from '../../../../services/markdown-renderer';
import { CollectionLoaderService } from '../../../../services/collection-loader';
import { LivePreferencesService } from '../../../../services/live-preferences';
import { NodeActivityStatsService } from '../../../../services/node-activity-stats';
import { ProviderRegistryService } from '../../../../services/provider-registry';
import { ProjectInfoService } from '../../../services/project-info';
import { ProjectIgnoreService } from '../../../../services/project-ignore';
import { ProcessingAgentReadinessService } from '../../../services/processing-agent-readiness';
import { SettingsVisibilityService } from '../../../services/settings-visibility';
import type { INodeView, ISidecarOverlay } from '../../../../models/node';
import { activityPairKeyOf } from '../../../../models/api';
import type {
  IActivityRunApi,
  IContributionApi,
  IFindingApi,
  IFindingsEnvelopeApi,
  IIssueApi,
  IIssueFixerEntryApi,
  INodeSummaryRowApi,
  INodeDetailApi,
  INodeApi,
  INodeActivityStatsApi,
  IProbExtensionEntryApi,
  IProbExtensionsApi,
  ISkillActionEntryApi,
} from '../../../../models/api';
import type { IWsEvent, IWsJobCompletedData } from '../../../../models/ws-event';
import type { ISpawnThread } from '../../../components/conversation-dialog/spawn-thread';

/**
 * A `job.completed` envelope. Bare, it is the frame the live-refresh
 * subscribers only count; with `tagsProposed` it is a TAGGER's proposal
 * (`spec/job-events.md` §job.completed), which is what opens the tag
 * row's editor pre-filled.
 */
function makeJobCompleted(data: IWsJobCompletedData = {}): IWsEvent<IWsJobCompletedData> {
  return {
    type: 'job.completed',
    timestamp: 1_745_159_465_100,
    runId: 'r1',
    jobId: 'j1',
    data: { extensionId: 'core/ai-tagger-action', extensionKind: 'action', ...data },
  };
}

/**
 * Inspector view spec, Step 14.5.a body card lifecycle, annotations,
 * the generic action-button toolbar (contribution-driven, the bump
 * button is no longer hardcoded), and the catalog curation 2026-05-07
 * surfaces (collapsible audit / plugin / debug; vendor frontmatter
 * tier card).
 */

// Section collapse state persists in localStorage; clear it before each
// test so collapse defaults are deterministic (everything collapsed by
// default EXCEPT body + findings) and tests do not leak state into each
// other.
beforeEach(() => {
  localStorage.clear();
});

type IStubDataSource = IDataSourcePort & {
  getNode: ReturnType<typeof vi.fn>;
  listIssues: ReturnType<typeof vi.fn>;
  getNodeActivity: ReturnType<typeof vi.fn>;
  clearNodeActivity: ReturnType<typeof vi.fn>;
  clearSessionJournal: ReturnType<typeof vi.fn>;
  getSessionJournal: ReturnType<typeof vi.fn>;
  setSessionRecording: ReturnType<typeof vi.fn>;
  getNodeFindings: ReturnType<typeof vi.fn>;
  getNodeSummary: ReturnType<typeof vi.fn>;
  deleteNodeSummary: ReturnType<typeof vi.fn>;
  getNodeProbExtensions: ReturnType<typeof vi.fn>;
  mcpStatus: ReturnType<typeof vi.fn>;
  agentPresence: ReturnType<typeof vi.fn>;
  getAgentSkillInstallStatus: ReturnType<typeof vi.fn>;
  submitNodeJob: ReturnType<typeof vi.fn>;
  submitNodelessJob: ReturnType<typeof vi.fn>;
  cancelJob: ReturnType<typeof vi.fn>;
  dismissFinding: ReturnType<typeof vi.fn>;
  reopenFinding: ReturnType<typeof vi.fn>;
  resolveFinding: ReturnType<typeof vi.fn>;
  undismissFinding: ReturnType<typeof vi.fn>;
  deleteFinding: ReturnType<typeof vi.fn>;
  dismissIssue: ReturnType<typeof vi.fn>;
};

type IStubLoader = {
  nodes: ReturnType<typeof signal<INodeView[]>>;
  scanMeta: ReturnType<typeof signal<unknown>>;
  loading: ReturnType<typeof signal<boolean>>;
  load: ReturnType<typeof vi.fn>;
};

function makeNode(overrides: Partial<INodeView> = {}): INodeView {
  return {
    path: 'agents/architect.md',
    kind: 'agent',
    frontmatter: {
      name: 'architect',
      description: 'The architect.',
      metadata: { version: '1.0.0' },
    },
    // The `core/node-set-tags` contribution gates the header's tag row
    // (surface follows the plugin); default it on so the tag-row and
    // auto-tag specs keep their surface. Override with `contributions`
    // to model other rosters (it replaces this default).
    contributions: [
      {
        pluginId: 'core',
        extensionId: 'node-set-tags',
        nodePath: 'agents/architect.md',
        contributionId: 'editTagsButton',
        slot: 'inspector.surface.tags',
        payload: { actionId: 'core/node-set-tags', label: 'Edit tags', enabled: true },
      },
    ],
    ...overrides,
  };
}

function makeApiNode(overrides: Partial<INodeApi> = {}): INodeApi {
  return {
    path: 'agents/architect.md',
    kind: 'agent',
    provider: 'claude',
    bodyHash: 'h',
    frontmatterHash: 'fh',
    bytes: { frontmatter: 10, body: 20, total: 30 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    ...overrides,
  };
}

function makeDetail(item: INodeApi): INodeDetailApi {
  return {
    schemaVersion: '1',
    kind: 'node',
    item,
    links: { incoming: [], outgoing: [] },
    issues: [],
    kindRegistry: {},
  };
}

function makeStubLoader(initialNodes: INodeView[] = []): IStubLoader {
  return {
    nodes: signal(initialNodes),
    // The inspector's ngOnInit boot guard reads `scanMeta()`; a non-null
    // value keeps it from kicking a (stubbed) `load()` under test.
    scanMeta: signal<unknown>({}),
    loading: signal(false),
    load: vi.fn().mockResolvedValue(undefined),
  };
}

function makeStubDataSource(): IStubDataSource {
  return {
    health: vi.fn(),
    loadScan: vi.fn(),
    listNodes: vi.fn(),
    getNode: vi.fn(),
    listLinks: vi.fn().mockResolvedValue({
      schemaVersion: '1',
      kind: 'links',
      items: [],
      filters: { kind: null, from: null, to: null },
      counts: { total: 0, returned: 0 },
      kindRegistry: {},
    }),
    listIssues: vi.fn().mockResolvedValue({
      schemaVersion: '1',
      kind: 'issues',
      items: [],
      filters: { severity: null, analyzerId: null, node: null },
      counts: { total: 0, returned: 0 },
      kindRegistry: {},
    }),
    loadGraph: vi.fn(),
    loadConfig: vi.fn(),
    listPlugins: vi.fn(),
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
    getNodeFindings: vi.fn().mockResolvedValue({
      schemaVersion: '1',
      kind: 'findings',
      items: [],
      filters: {},
      counts: { total: 0, returned: 0, dismissedExcluded: 0, fixedExcluded: 0 },
      kindRegistry: {},
    }),
    getNodeProbExtensions: vi.fn().mockResolvedValue({
      finders: [],
      standalone: [],
      issueFixers: [],
    }),
    mcpStatus: vi.fn().mockResolvedValue({ enabled: true, connected: true, clients: 1 }),
    // Default: an agent has already claimed work on this server, so the
    // presence warning stays hidden unless a test says otherwise.
    agentPresence: vi.fn().mockResolvedValue({
      schemaVersion: '1',
      kind: 'agent-presence',
      attending: true,
      lastClaimAt: 1_700_000_000_000,
    }),
    getAgentSkillInstallStatus: vi.fn().mockResolvedValue({
      provider: 'claude',
      supported: true,
      skillDir: '.claude/skills/sm-process-jobs',
      installed: true,
      stale: false,
    }),
    submitNodelessJob: vi.fn().mockResolvedValue({ value: { jobId: 'j1', nodePath: 'sm://core/ai-ping-action', extensionId: 'core/ai-ping-action', supersededIds: [] } }),
    submitNodeJob: vi.fn().mockResolvedValue({
      schemaVersion: '1',
      kind: 'job.submitted',
      value: { jobId: 'job-1', nodePath: '', extensionId: '', supersededIds: [] },
      elapsedMs: 1,
    }),
    cancelJob: vi.fn().mockResolvedValue(undefined),
    dismissFinding: vi.fn().mockResolvedValue(undefined),
    reopenFinding: vi.fn().mockResolvedValue(undefined),
    resolveFinding: vi.fn().mockResolvedValue(undefined),
    undismissFinding: vi.fn().mockResolvedValue(undefined),
    deleteFinding: vi.fn().mockResolvedValue(undefined),
    dismissIssue: vi.fn().mockResolvedValue(undefined),
    getNodeSummary: vi.fn().mockResolvedValue([]),
    deleteNodeSummary: vi.fn().mockResolvedValue(undefined),
    dispatchAction: vi.fn().mockResolvedValue({
      schemaVersion: '1',
      kind: 'action.applied',
      value: { actionId: 'core/node-bump', nodePath: '' },
      elapsedMs: 1,
    }),
    getUpdateStatus: vi.fn().mockResolvedValue({
      current: '0.0.0',
      latest: null,
      isOutdated: false,
      checkedAt: null,
      shownAt: null,
    }),
    getRegisteredAnnotations: vi.fn().mockResolvedValue([]),
    events: vi.fn().mockReturnValue(EMPTY),
  } as unknown as IStubDataSource;
}

class FakeMarkdownRenderer extends MarkdownRenderer {
  constructor(
    private readonly sanitizerRef: DomSanitizer,
    private readonly mode: 'pass' | 'throw',
  ) {
    super();
  }

  override async render(src: string): Promise<SafeHtml> {
    if (this.mode === 'throw') throw new Error('boom');
    return this.sanitizerRef.bypassSecurityTrustHtml(`<div data-fake>${src}</div>`);
  }

  // Raw-view highlighter stub: wrap the source verbatim so tests can assert
  // on its text without loading the real highlight.js chunk in jsdom.
  override async highlightSource(src: string): Promise<SafeHtml> {
    if (this.mode === 'throw') throw new Error('boom');
    return this.sanitizerRef.bypassSecurityTrustHtml(`<span data-fake-raw>${src}</span>`);
  }
}

interface IBootstrapOpts {
  loader?: IStubLoader;
  dataSource?: IStubDataSource;
  rendererMode?: 'pass' | 'throw';
  /** Drives the body card's reactive `scan.completed` refresh. */
  scanCompleted$?: Subject<void>;
  /** Drives the Activity section's live `node.activity` re-fetch. */
  nodeActivity$?: Subject<void>;
  /** Drives the Activity section's live `agent.spawn` re-fetch. */
  agentSpawn$?: Subject<void>;
  /** Drives the AI actions card's live `job.*` re-fetch. */
  jobEvents$?: Subject<IWsEvent>;
  /** Seeds the per-node stats mirror that gates the Activity section. */
  activityStats?: ReadonlyMap<string, INodeActivityStatsApi>;
  /** Seeds the per-pair spawn counters (Activity gate, spawn side). */
  activityPairs?: ReadonlyMap<string, number>;
  /** Seeds the persistent-runs set (Activity gate, DB-history side). */
  activityRunNodes?: ReadonlySet<string>;
  /** Real-time activity preference (default ON, like the app). */
  activityEnabled?: boolean;
  /**
   * Active lens provider driving the "no processing agent set up"
   * warning's skill-status probe. Defaults to `'claude'` (a resolved
   * lens) so the probe runs; set `null` to model an unresolved lens.
   */
  activeProvider?: string | null;
}

/** Stats entry seed for the Activity visibility gate. */
function makeActivityStats(overrides: Partial<INodeActivityStatsApi> = {}): INodeActivityStatsApi {
  return { count: 1, lastStartAt: 1000, distinctOwners: 1, ...overrides };
}

function bootstrap(opts: IBootstrapOpts = {}): {
  fixture: ComponentFixture<InspectorView>;
  cmp: InspectorView;
  loader: IStubLoader;
  dataSource: IStubDataSource;
  scanCompleted$: Subject<void>;
  nodeActivity$: Subject<void>;
  agentSpawn$: Subject<void>;
  jobEvents$: Subject<IWsEvent>;
} {
  const loader = opts.loader ?? makeStubLoader();
  const dataSource = opts.dataSource ?? makeStubDataSource();
  const scanCompleted$ = opts.scanCompleted$ ?? new Subject<void>();
  const nodeActivity$ = opts.nodeActivity$ ?? new Subject<void>();
  const agentSpawn$ = opts.agentSpawn$ ?? new Subject<void>();
  const jobEvents$ = opts.jobEvents$ ?? new Subject<IWsEvent>();

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: DATA_SOURCE, useValue: dataSource },
      { provide: SKILL_MAP_MODE, useValue: 'demo' },
      { provide: CollectionLoaderService, useValue: loader },
      // Stub the WS stream: the body card subscribes to `scanCompleted$`
      // for its reactive refresh. A Subject lets tests drive it; the
      // other streams are unused here so they resolve to EMPTY.
      {
        provide: WsEventStreamService,
        useValue: {
          scanCompleted$: scanCompleted$.asObservable(),
          events$: EMPTY,
          actionApplied$: EMPTY,
          // The Activity section's live re-fetch merges these two streams;
          // Subjects let tests drive `node.activity` and `agent.spawn` frames.
          nodeActivity$: nodeActivity$.asObservable(),
          agentSpawn$: agentSpawn$.asObservable(),
          // The AI actions card re-fetches on any job lifecycle frame.
          jobEvents$: jobEvents$.asObservable(),
          jobSubmitted$: EMPTY,
        } as unknown as WsEventStreamService,
      },
      {
        provide: MarkdownRenderer,
        useFactory: (): MarkdownRenderer =>
          new FakeMarkdownRenderer(TestBed.inject(DomSanitizer), opts.rendererMode ?? 'pass'),
      },
      // The Activity section's visibility gate reads the per-node stats
      // mirror; the real service subscribes to WS streams the stub above
      // does not expose, so tests seed plain signal maps instead.
      {
        provide: NodeActivityStatsService,
        useValue: {
          stats: signal<ReadonlyMap<string, INodeActivityStatsApi>>(
            opts.activityStats ?? new Map(),
          ),
          pairCounts: signal<ReadonlyMap<string, number>>(opts.activityPairs ?? new Map()),
          runNodes: signal<ReadonlySet<string>>(opts.activityRunNodes ?? new Set()),
          // The clear-all re-hydrates the mirror after a DELETE; the stub
          // records the call so tests can assert the convergence hook.
          refresh: vi.fn().mockResolvedValue(undefined),
        } as unknown as NodeActivityStatsService,
      },
      {
        provide: LivePreferencesService,
        useValue: {
          activityEnabled: signal(opts.activityEnabled ?? true),
        } as unknown as LivePreferencesService,
      },
      // The AI actions card reads the active lens for its "no processing
      // agent set up" warning; the real service subscribes to WS streams,
      // so tests provide a plain signal seeded from `opts.activeProvider`.
      {
        provide: ProjectInfoService,
        useValue: {
          activeProvider: signal<string | null>(
            opts.activeProvider === undefined ? 'claude' : opts.activeProvider,
          ),
        } as unknown as ProjectInfoService,
      },
      // The header's Ignore affordance routes through this owner; stub
      // it so the harness (SKILL_MAP_MODE 'demo') still renders the
      // button and the wiring test can assert the routed call.
      {
        provide: ProjectIgnoreService,
        useValue: {
          available: signal(true).asReadonly(),
          errorText: signal<string | null>(null).asReadonly(),
          requestIgnore: vi.fn().mockResolvedValue('dialog'),
          clearError: vi.fn(),
        } as unknown as ProjectIgnoreService,
      },
    ],
  });
  const fixture = TestBed.createComponent(InspectorView);
  return {
    fixture,
    cmp: fixture.componentInstance,
    loader,
    dataSource,
    scanCompleted$,
    nodeActivity$,
    agentSpawn$,
    jobEvents$,
  };
}

async function flush(fixture: ComponentFixture<InspectorView>): Promise<void> {
  fixture.detectChanges();
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
}

describe('InspectorView, conversation dialog (no-fetch openThread path)', () => {
  it('hands the clicked thread to the shared controller without fetching', async () => {
    // The conversation machinery lives in the Activity section child
    // (extracted with the section), so the probe targets that component;
    // a node must be inspected for the child to mount. The Activity card
    // stays collapsed (default) so no activity fetch muddies the
    // no-fetch assertion below.
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    const probe = fixture.debugElement.query(By.directive(InspectorActivitySection))
      .componentInstance as unknown as {
      openSpawnConversation(thread: ISpawnThread): void;
      onConversationClosed(): void;
      conversationOpen(): boolean;
      conversationThread(): ISpawnThread | null;
    };
    const thread: ISpawnThread = {
      key: 'main:1|agents/worker.md',
      parentOwner: 'main:1',
      parentNodePath: 'agents/orchestrator.md',
      childNodePath: 'agents/worker.md',
      records: [],
    };

    expect(probe.conversationOpen()).toBe(false);
    probe.openSpawnConversation(thread);
    expect(probe.conversationOpen()).toBe(true);
    // Handed over verbatim: the inspector already holds the records,
    // so the controller's fetch paths (openSpawn / openHistorical)
    // must stay untouched on this surface.
    expect(probe.conversationThread()).toBe(thread);
    expect(dataSource.getNodeActivity).not.toHaveBeenCalled();

    probe.onConversationClosed();
    expect(probe.conversationOpen()).toBe(false);
  });
});

describe('InspectorView, empty states', () => {
  it('renders the no-selection empty state when path is undefined', async () => {
    const { fixture } = bootstrap();
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-empty-no-selection"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-card-body"]')).toBeNull();
  });

  it('renders the not-found empty state when the path is not in nodes()', async () => {
    const { fixture } = bootstrap();
    fixture.componentRef.setInput('path', 'agents/missing.md');
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-empty-not-found"]')).not.toBeNull();
  });
});

describe('InspectorView, body card lifecycle', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows the loading state while getNode() is in flight', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockReturnValue(new Promise(() => {}));

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-body-loading"]')).not.toBeNull();
    expect(dataSource.getNode).toHaveBeenCalledWith(node.path, { includeBody: true, includeRaw: true });
  });

  it('renders the markdown HTML when getNode() returns a body', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '# hello\n\nworld.' })));

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    const rendered = dom.querySelector('[data-testid="inspector-body-rendered"]');
    expect(rendered).not.toBeNull();
    expect(rendered!.innerHTML).toContain('# hello');
    expect(rendered!.innerHTML).toContain('data-fake');
  });

  it('hides the body section when item.body is undefined (empty)', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode()));

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    // Nothing to render -> the whole Body section is omitted (no empty
    // placeholder).
    expect(dom.querySelector('[data-testid="inspector-card-body"]')).toBeNull();
  });

  it('hides the body section when item.body is null (file missing)', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: null })));

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-card-body"]')).toBeNull();
  });

  it('hides the body section when getNode() returns null (404)', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(null);

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-card-body"]')).toBeNull();
  });

  it('hides the body section when getNode() throws', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockRejectedValue(new Error('network down'));

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-card-body"]')).toBeNull();
  });

  it('hides the body section when the markdown renderer throws', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '# trips it' })));

    const { fixture } = bootstrap({ loader, dataSource, rendererMode: 'throw' });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-card-body"]')).toBeNull();
  });

  it('drops a stale resolution when the user navigates to a different path mid-fetch', async () => {
    const nodeA = makeNode({ path: 'a.md', frontmatter: { name: 'A', description: '', metadata: { version: '' } } });
    const nodeB = makeNode({ path: 'b.md', frontmatter: { name: 'B', description: '', metadata: { version: '' } } });
    const loader = makeStubLoader([nodeA, nodeB]);
    const dataSource = makeStubDataSource();

    let resolveA!: (v: INodeDetailApi) => void;
    const pendingA = new Promise<INodeDetailApi>((res) => {
      resolveA = res;
    });
    dataSource.getNode.mockImplementation((p: string) => {
      if (p === 'a.md') return pendingA;
      return Promise.resolve(makeDetail(makeApiNode({ path: 'b.md', body: '# B body' })));
    });

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', 'a.md');
    await flush(fixture);
    fixture.componentRef.setInput('path', 'b.md');
    await flush(fixture);

    resolveA(makeDetail(makeApiNode({ path: 'a.md', body: '# A body, late' })));
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    const rendered = dom.querySelector('[data-testid="inspector-body-rendered"]');
    expect(rendered).not.toBeNull();
    expect(rendered!.innerHTML).toContain('# B body');
    expect(rendered!.innerHTML).not.toContain('A body');
  });

  it('re-fetches and re-renders the body on a scan.completed event (reactive refresh)', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '# first' })));

    const { fixture, scanCompleted$ } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    expect(
      dom.querySelector('[data-testid="inspector-body-rendered"]')!.innerHTML,
    ).toContain('# first');
    // Multiple consumers call getNode on selection (body card + the
    // linked-nodes panel), so assert the call count GROWS after the
    // event rather than pinning an exact number; the body content swap
    // below is the real proof of the reactive re-render.
    const callsBeforeEvent = dataSource.getNode.mock.calls.length;

    // The file body changes on disk and the watcher re-scans: getNode now
    // returns the new body, and the scan.completed event triggers a silent
    // re-fetch for the SAME path (no navigation, no path-signal change).
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '# second' })));
    scanCompleted$.next();
    await flush(fixture);

    expect(dataSource.getNode.mock.calls.length).toBeGreaterThan(callsBeforeEvent);
    const rendered = dom.querySelector('[data-testid="inspector-body-rendered"]');
    expect(rendered!.innerHTML).toContain('# second');
    expect(rendered!.innerHTML).not.toContain('# first');
  });

  it('ignores scan.completed when no node is selected (no fetch)', async () => {
    const dataSource = makeStubDataSource();
    const { fixture, scanCompleted$ } = bootstrap({ dataSource });
    await flush(fixture);

    scanCompleted$.next();
    await flush(fixture);

    expect(dataSource.getNode).not.toHaveBeenCalled();
  });
});

describe('InspectorView, body raw / rendered toggle', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  async function renderBody(body: string): Promise<ComponentFixture<InspectorView>> {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    return fixture;
  }

  it('defaults to the rendered view and shows the toggle when the body is ready', async () => {
    const dom = (await renderBody('# hello\n\nworld')).nativeElement as HTMLElement;
    expect(dom.querySelector('[data-testid="inspector-body-view-toggle"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-body-rendered"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-body-raw"]')).toBeNull();
  });

  it('swaps to the raw source on toggle and back to rendered on a second click', async () => {
    const fixture = await renderBody('# hello\n\nworld');
    const dom = fixture.nativeElement as HTMLElement;

    (dom.querySelector('[data-testid="inspector-body-view-toggle"]') as HTMLButtonElement).click();
    await flush(fixture);
    const raw = dom.querySelector('[data-testid="inspector-body-raw"]');
    expect(raw).not.toBeNull();
    // The raw view shows the source verbatim (the `#` markdown is NOT rendered).
    expect(raw!.textContent).toContain('# hello');
    expect(dom.querySelector('[data-testid="inspector-body-rendered"]')).toBeNull();

    (dom.querySelector('[data-testid="inspector-body-view-toggle"]') as HTMLButtonElement).click();
    await flush(fixture);
    expect(dom.querySelector('[data-testid="inspector-body-rendered"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-body-raw"]')).toBeNull();
  });

  it('renders the raw view as a line-numbered, highlighted editor', async () => {
    const fixture = await renderBody('# title\nbody line');
    const dom = fixture.nativeElement as HTMLElement;
    (dom.querySelector('[data-testid="inspector-body-view-toggle"]') as HTMLButtonElement).click();
    await flush(fixture);

    // Gutter: one number per source line.
    const gutter = dom.querySelector('.inspector__body-raw-gutter');
    expect(gutter).not.toBeNull();
    expect(gutter!.textContent).toBe('1\n2');

    // Code: the highlight.js container, source text intact.
    const code = dom.querySelector('[data-testid="inspector-body-raw-code"]');
    expect(code).not.toBeNull();
    expect(code!.classList.contains('hljs')).toBe(true);
    expect(code!.textContent).toContain('# title');
  });

  it('prefers item.raw (frontmatter included) for the raw view, rendering stays body-only', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    const body = '# hello\n\nworld';
    const raw = `---\nname: probe\n---\n${body}`;
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body, raw })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom = fixture.nativeElement as HTMLElement;

    // Rendered view: body only, no frontmatter leakage.
    const rendered = dom.querySelector('[data-testid="inspector-body-rendered"]');
    expect(rendered!.innerHTML).not.toContain('name: probe');

    // Raw view: full file, so the gutter (6 lines) matches the
    // file-absolute L<n> lines findings report.
    (dom.querySelector('[data-testid="inspector-body-view-toggle"]') as HTMLButtonElement).click();
    await flush(fixture);
    const code = dom.querySelector('[data-testid="inspector-body-raw-code"]');
    expect(code!.textContent).toContain('name: probe');
    const gutter = dom.querySelector('.inspector__body-raw-gutter');
    expect(gutter!.textContent).toBe('1\n2\n3\n4\n5\n6');
  });
});

describe('InspectorView, body expand dialog', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  async function renderBody(body: string): Promise<ComponentFixture<InspectorView>> {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    return fixture;
  }

  /** The p-dialog panel may render behind a portal; query the whole document. */
  function q(testid: string): HTMLElement | null {
    return document.querySelector(`[data-testid="${testid}"]`);
  }

  it('shows the Expand button when the body is ready, with no dialog content yet', async () => {
    await renderBody('# hello\n\nworld');
    expect(q('inspector-body-expand')).not.toBeNull();
    expect(q('inspector-body-dialog-rendered')).toBeNull();
    expect(q('inspector-body-dialog-raw')).toBeNull();
  });

  it('opens the dialog on Expand: node-name title + the same rendered body', async () => {
    const fixture = await renderBody('# hello\n\nworld');
    (q('inspector-body-expand') as HTMLButtonElement).click();
    await flush(fixture);

    expect(q('inspector-body-dialog-title')!.textContent).toBe('architect');
    const rendered = q('inspector-body-dialog-rendered');
    expect(rendered).not.toBeNull();
    expect(rendered!.innerHTML).toContain('# hello');
  });

  it('the dialog toggle flips the SHARED view preference (the card follows)', async () => {
    const fixture = await renderBody('# hello\n\nworld');
    (q('inspector-body-expand') as HTMLButtonElement).click();
    await flush(fixture);

    (q('inspector-body-dialog-view-toggle') as HTMLButtonElement).click();
    await flush(fixture);

    // Dialog swaps to the raw editor...
    expect(q('inspector-body-dialog-raw')).not.toBeNull();
    expect(q('inspector-body-dialog-rendered')).toBeNull();
    // ...and the card behind it follows (one session-sticky `bodyView`).
    expect(q('inspector-body-raw')).not.toBeNull();
    expect(q('inspector-body-rendered')).toBeNull();
  });
});

describe('InspectorView, codex / bodyField inline body', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  function makeCodexNode(developerInstructions: string | undefined): INodeView {
    const frontmatter: Record<string, unknown> = {
      name: 'architect',
      description: 'd',
      model: 'gpt-5-codex',
      sandbox_mode: 'read-only',
    };
    if (developerInstructions !== undefined) {
      frontmatter['developer_instructions'] = developerInstructions;
    }
    return makeNode({
      path: '.codex/agents/architect.toml',
      kind: 'agent',
      provider: 'codex',
      frontmatter: frontmatter as unknown as INodeView['frontmatter'],
    });
  }

  /** Seed the provider registry with a codex entry declaring its bodyField. */
  function seedCodexRegistry(): void {
    TestBed.inject(ProviderRegistryService).ingest({
      codex: {
        label: 'OpenAI Codex',
        color: '#22c55e',
        isLens: true,
        bodyField: 'developer_instructions',
      },
    });
  }

  it('renders developer_instructions as the body and never asks the BFF for the raw file', async () => {
    const node = makeCodexNode('# Codex prompt\n\nbody from the TOML field');
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    // If the body card ever hit the disk-read path it would render this raw
    // TOML stand-in; the inline path must win.
    dataSource.getNode.mockResolvedValue(
      makeDetail(makeApiNode({ provider: 'codex', body: 'RAW TOML never renders' })),
    );

    const { fixture } = bootstrap({ loader, dataSource });
    seedCodexRegistry();
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    const rendered = dom.querySelector('[data-testid="inspector-body-rendered"]');
    expect(rendered).not.toBeNull();
    expect(rendered!.innerHTML).toContain('# Codex prompt');
    expect(rendered!.innerHTML).not.toContain('RAW TOML');
    // The body card never requests the on-demand disk read for a bodyField
    // provider (other panels may call getNode, but not with includeBody).
    expect(dataSource.getNode).not.toHaveBeenCalledWith(node.path, { includeBody: true, includeRaw: true });
  });

  it('renders a codex skill (.md, no developer_instructions) from its fetched markdown body', async () => {
    // Regression: the codex Provider declares `bodyField: developer_instructions`
    // for its `.toml` agents, but its open-standard `.agents/skills/*/SKILL.md`
    // skills (same provider id) have no such field. They must fall back to the
    // normal body fetch, not render an empty (hidden) Body section.
    const node = makeNode({
      path: '.agents/skills/run-tests/SKILL.md',
      kind: 'skill',
      provider: 'codex',
      frontmatter: { name: 'run-tests', description: 'd' } as unknown as INodeView['frontmatter'],
    });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(
      makeDetail(makeApiNode({ provider: 'codex', kind: 'skill', body: '# Run tests\n\nDo it.' })),
    );

    const { fixture } = bootstrap({ loader, dataSource });
    seedCodexRegistry();
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    const rendered = dom.querySelector('[data-testid="inspector-body-rendered"]');
    expect(rendered).not.toBeNull();
    expect(rendered!.innerHTML).toContain('# Run tests');
    // A skill with no bodyField value pulls its body from the disk fetch.
    expect(dataSource.getNode).toHaveBeenCalledWith(node.path, { includeBody: true, includeRaw: true });
  });

  it('shows the raw developer_instructions verbatim when toggled to the raw view', async () => {
    const node = makeCodexNode('# Codex prompt\n\nbody from the TOML field');
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(
      makeDetail(makeApiNode({ provider: 'codex', body: 'RAW TOML never renders' })),
    );

    const { fixture } = bootstrap({ loader, dataSource });
    seedCodexRegistry();
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    (dom.querySelector('[data-testid="inspector-body-view-toggle"]') as HTMLButtonElement).click();
    await flush(fixture);
    const raw = dom.querySelector('[data-testid="inspector-body-raw"]');
    expect(raw).not.toBeNull();
    // The raw view is the developer_instructions source, not the BFF's raw TOML.
    expect(raw!.textContent).toContain('# Codex prompt');
    expect(raw!.textContent).not.toContain('RAW TOML');
  });

  it('hides the body section for a codex node with an empty developer_instructions (no disk fallback)', async () => {
    const node = makeCodexNode('');
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(
      makeDetail(makeApiNode({ provider: 'codex', body: 'RAW TOML never renders' })),
    );

    const { fixture } = bootstrap({ loader, dataSource });
    seedCodexRegistry();
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    // Empty effective body -> the whole section is omitted, and we never
    // fall back to the disk read (which would hand back raw TOML).
    expect(dom.querySelector('[data-testid="inspector-card-body"]')).toBeNull();
    expect(dataSource.getNode).not.toHaveBeenCalledWith(node.path, { includeBody: true, includeRaw: true });
  });
});

describe('InspectorView, vendor frontmatter card (catalog curation)', () => {
  it('renders the vendor frontmatter card on every kind that has a vendor surface', async () => {
    const node = makeNode({
      kind: 'agent',
      frontmatter: {
        name: 'architect',
        description: 'd',
        model: 'opus',
        metadata: { version: '1.0.0' },
      } as INodeView['frontmatter'],
    });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-card-vendor-frontmatter"]')).not.toBeNull();
  });
});

// Smoke: confirm the router is reachable so node-open navigation
// (via NODE_OPEN_INTENT's default Router-backed implementation) wires up.
describe('InspectorView, router smoke', () => {
  it('has a router available for in-app navigation links', () => {
    bootstrap();
    expect(TestBed.inject(Router)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Action toolbar (contribution-driven) + annotations panel
// ---------------------------------------------------------------------------

function makeNodeWithSidecar(overlay: ISidecarOverlay | undefined): INodeView {
  const view: INodeView = {
    path: 'agents/architect.md',
    kind: 'agent',
    frontmatter: {
      name: 'architect',
      description: 'd',
      metadata: { version: '1' },
    },
  };
  if (overlay) view.sidecar = overlay;
  return view;
}

describe('InspectorView, actions section (contribution-driven)', () => {
  it('renders the Actions section hosting the inspector.action.button slot when the node has action contributions', async () => {
    const node: INodeView = {
      path: 'agents/architect.md',
      kind: 'agent',
      frontmatter: { name: 'architect', description: 'd', metadata: { version: '1' } },
      contributions: [
        {
          pluginId: 'my-plugin',
          extensionId: 'my-action',
          nodePath: 'agents/architect.md',
          contributionId: 'myButton',
          slot: 'inspector.action.button',
          payload: { actionId: 'my-plugin/my-action', label: 'Do it', enabled: true },
        },
        // Set stability AND Bump moved to the header chips (user calls
        // 2026-07-21): neither renders inside the Actions section.
        {
          pluginId: 'core',
          extensionId: 'node-set-stability',
          nodePath: 'agents/architect.md',
          contributionId: 'setStabilityButton',
          slot: 'inspector.surface.stability',
          payload: { actionId: 'core/node-set-stability', label: 'Set stability', enabled: true },
        },
        {
          pluginId: 'core',
          extensionId: 'node-bump',
          nodePath: 'agents/architect.md',
          contributionId: 'bumpButton',
          slot: 'inspector.surface.version',
          payload: { actionId: 'core/node-bump', label: 'Bump', enabled: true },
        },
      ],
    };
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    const section = dom.querySelector('[data-testid="inspector-card-actions"]');
    expect(section).not.toBeNull();
    // The slot host is mounted inside the (default-expanded) section.
    expect(section!.querySelector('sm-view-contributions-host')).not.toBeNull();
    // No hardcoded bump button; it arrives as a contribution.
    expect(dom.querySelector('[data-testid="inspector-bump"]')).toBeNull();
    // The set-stability and bump buttons are EXCLUDED from the section
    // (they live on the header's stability / version chips now).
    expect(section!.querySelector('[data-testid="action-core/node-set-stability"]')).toBeNull();
    expect(section!.querySelector('[data-testid="action-core/node-bump"]')).toBeNull();
    // The neutral third-party action still renders.
    expect(section!.querySelector('[data-testid="action-my-plugin/my-action"]')).not.toBeNull();
  });

  it('does NOT render the Actions section when the node has no action contributions', async () => {
    const node = makeNodeWithSidecar(undefined);
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-card-actions"]')).toBeNull();
  });

  it('renders the consent dialog component (driven by the dispatch service)', async () => {
    const node = makeNodeWithSidecar(undefined);
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    // The standalone dialog component is mounted in the template; its
    // inner `<p-dialog>` stays hidden (open=false) until a dispatch hits
    // the consent gate, so we assert on the component host element.
    expect(fixture.nativeElement.querySelector('sm-sidecar-consent-dialog')).not.toBeNull();
  });
});

describe('InspectorView, annotations card (Step 9.6.5)', () => {
  it('does NOT render the annotations card when no sidecar overlay is present', async () => {
    const node = makeNodeWithSidecar(undefined);
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-card-annotations"]')).toBeNull();
  });

  it('renders the annotations card when the sidecar carries renderable annotations', async () => {
    const node = makeNodeWithSidecar({
      present: true,
      status: 'fresh',
      annotations: { source: 'https://example.com/repo' },
    });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-card-annotations"]')).not.toBeNull();
  });

  it('does NOT render the annotations card when the sidecar is present but has no renderable annotations', async () => {
    // version / stability are node properties shown elsewhere, not in the
    // annotations panel (which renders provenance / repository / docs), so
    // a sidecar carrying only those has nothing to show and the section is
    // hidden entirely instead of rendering an empty panel.
    const node = makeNodeWithSidecar({
      present: true,
      status: 'fresh',
      annotations: { version: 3, stability: 'stable' },
    });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-card-annotations"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Catalog curation 2026-05-07, collapsibles + debug toggle + banner
// ---------------------------------------------------------------------------

describe('InspectorView, collapsible sections (catalog curation)', () => {
  async function renderInspector(overlay?: ISidecarOverlay): Promise<HTMLElement> {
    const node = makeNodeWithSidecar(overlay);
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    return fixture.nativeElement as HTMLElement;
  }

  it('renders the metadata section collapsed by default', async () => {
    const node = makeNodeWithSidecar({ present: true, status: 'fresh', annotations: {} });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    // The section renders (the node has a sidecar), but collapsed: its
    // body (the debug panel) is NOT in the DOM until the user expands it.
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-card-metadata"]'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-debug-panel"]'),
    ).toBeNull();
  });

  it('expands the metadata section on header click', async () => {
    const node = makeNodeWithSidecar({ present: true, status: 'fresh', annotations: {} });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    // Collapsed by default: the metadata body is absent.
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-debug-panel"]'),
    ).toBeNull();
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-metadata-toggle"]',
    ) as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    toggle.click();
    await flush(fixture);
    // After expanding, the body appears in the DOM.
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-debug-panel"]'),
    ).not.toBeNull();
  });

  it('does NOT render the plugin contributions section when sidecar has no non-reserved keys', async () => {
    const dom = await renderInspector();
    // The card chrome only renders when the sidecar carries at least
    // one non-reserved root key (catalog curation, empty cards were
    // painting blank borders on plain nodes).
    expect(dom.querySelector('[data-testid="inspector-card-plugins"]')).toBeNull();
  });

  it('renders the plugin contributions section when sidecar root carries a non-reserved key', async () => {
    const node = makeNodeWithSidecar({
      present: true,
      status: 'fresh',
      annotations: {},
      root: { 'my-plugin': { foo: 1 } },
    });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-card-plugins"]'),
    ).not.toBeNull();
    // Collapsed by default, so the namespace block is not rendered until
    // the user expands the section.
    expect(
      fixture.nativeElement.querySelector('[data-testid="plugin-contributions-ns-my-plugin"]'),
    ).toBeNull();
  });

  it('persists a section collapse to localStorage', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    // Body must have content so the (default-expanded) body section
    // renders and its toggle is present to click.
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '# body' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-body-toggle"]',
    ) as HTMLButtonElement;
    // Body defaults to expanded, so the first toggle collapses it.
    toggle.click();
    await flush(fixture);
    const stored = JSON.parse(
      localStorage.getItem('skill-map.ui.inspector.sections') ?? '{}',
    ) as Record<string, boolean>;
    expect(stored['body']).toBe(false);
  });
});

describe('InspectorView, debug panel inside the merged metadata section', () => {
  it('renders the debug panel inside the metadata section when expanded', async () => {
    const node = makeNodeWithSidecar({ present: true, status: 'fresh', annotations: {} });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    // Metadata is collapsed by default, so the debug panel starts hidden.
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-debug-panel"]')).toBeNull();
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-metadata-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-metadata-section"]'),
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-debug-panel"]')).not.toBeNull();
  });

  it('does not render the metadata section for a node without a sidecar', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    // No sidecar -> the metadata section (and the debug panel it hosts)
    // is omitted entirely.
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-card-metadata"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-debug-panel"]')).toBeNull();
  });

  it('toggles the audit + debug panels on metadata expand/collapse', async () => {
    const node = makeNodeWithSidecar({ present: true, status: 'fresh', annotations: {} });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-metadata-toggle"]',
    ) as HTMLButtonElement;
    // Collapsed by default.
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-debug-panel"]')).toBeNull();
    toggle.click(); // expand
    await flush(fixture);
    // The debug grid appears (the audit panel self-hides here: this node's
    // sidecar carries no populated audit block).
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-debug-panel"]')).not.toBeNull();
    toggle.click(); // collapse again
    await flush(fixture);
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-debug-panel"]')).toBeNull();
  });
});

describe('InspectorView, activity section visibility gate', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('hides the section entirely for a node with no recorded activity', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-card-activity"]'),
    ).toBeNull();
  });

  it('does not fetch the detail for a hidden section even with a persisted-open state', async () => {
    localStorage.setItem('skill-map.ui.inspector.sections', JSON.stringify({ activity: true }));
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(dataSource.getNodeActivity).not.toHaveBeenCalled();
  });

  it('shows the section when the stats mirror carries the node', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats()]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-card-activity"]'),
    ).not.toBeNull();
  });

  it('shows the section on PERSISTENT run history alone (server restarted, counters reset)', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    // No stats entry, no spawn pair: only the summary's runNodes carries
    // the node (its state_executions history survived the reboot).
    const { fixture } = bootstrap({
      loader,
      dataSource,
      activityRunNodes: new Set([node.path]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-card-activity"]'),
    ).not.toBeNull();
  });

  it('shows the section when a spawn pair touches the node as child', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({
      loader,
      dataSource,
      activityPairs: new Map([[activityPairKeyOf('main:6cfe5636', node.path), 2]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-card-activity"]'),
    ).not.toBeNull();
  });

  it('keeps the section available while real-time activity is OFF (mirror unknowable)', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource, activityEnabled: false });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-card-activity"]'),
    ).not.toBeNull();
  });
});

describe('InspectorView, activity thread rows (spawn grouping)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  function makeSpawn(spawnId: string, startedAt: number, status: string): Record<string, unknown> {
    return {
      spawnId,
      parentOwner: 'main:6cfe5636',
      childKind: 'agent',
      childName: 'demo-worker',
      childNodePath: '.claude/agents/demo-worker.md',
      prompt: `ask ${spawnId}`,
      response: `reply ${spawnId}`,
      startedAt,
      status,
    };
  }

  it('groups 3 spawn records of the same pair into ONE thread row with "3 exchanges"', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeActivity.mockResolvedValue({
      stats: { count: 3, lastStartAt: 3000, distinctOwners: 1 },
      recent: [],
      spawns: [makeSpawn('s2', 2000, 'ended'), makeSpawn('s1', 1000, 'ended'), makeSpawn('s3', 3000, 'running')],
      captureEnabled: true,
      runs: [],
    });

    const { fixture } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats({ count: 3, lastStartAt: 3000 })]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    // Activity is collapsed by default; expand it to trigger the fetch.
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    await flush(fixture);

    expect(dataSource.getNodeActivity).toHaveBeenCalledWith(node.path);
    const rows = fixture.nativeElement.querySelectorAll(
      '[data-testid="inspector-activity-thread"]',
    );
    expect(rows.length).toBe(1);
    // Child name + exchange counter + status of the LAST turn.
    expect(rows[0]!.textContent).toContain('demo-worker');
    expect(rows[0]!.textContent).toContain('3 exchanges');
    expect(rows[0]!.textContent).toContain('running');
    // One View-conversation button per thread, not per record.
    expect(
      fixture.nativeElement.querySelectorAll(
        '[data-testid="inspector-activity-view-conversation"]',
      ).length,
    ).toBe(1);
    // Capture chip shows: the gate is on AND this node has captured spawns.
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-activity-capture-chip"]'),
    ).not.toBeNull();
  });

  it('hides the capture chip when the gate is on but no conversations were captured', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeActivity.mockResolvedValue({
      stats: { count: 1, lastStartAt: 1000, distinctOwners: 1 },
      recent: [],
      spawns: [],
      captureEnabled: true,
      runs: [],
    });

    const { fixture } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats()]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    await flush(fixture);

    // Gate on but spawns empty: the chip stays hidden (no noise).
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-activity-capture-chip"]'),
    ).toBeNull();
  });

  it('caps the conversation threads shown per node at 10', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    // 12 DISTINCT pairs (distinct childNodePath => distinct thread key).
    const spawns = Array.from({ length: 12 }, (_, i) => ({
      ...makeSpawn(`s${i}`, (i + 1) * 1000, 'ended'),
      childNodePath: `.claude/agents/w${i}.md`,
    }));
    dataSource.getNodeActivity.mockResolvedValue({
      stats: { count: 12, lastStartAt: 12000, distinctOwners: 1 },
      recent: [],
      spawns,
      captureEnabled: true,
      runs: [],
    });

    const { fixture } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats({ count: 12, lastStartAt: 12000 })]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    await flush(fixture);

    // 12 distinct conversations exist, but only the 10 newest render.
    expect(
      fixture.nativeElement.querySelectorAll('[data-testid="inspector-activity-thread"]').length,
    ).toBe(10);
  });
});

describe('InspectorView, activity execution aggregates (stats totals row)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /** Boots on a node, expands the Activity section, settles the fetch. */
  async function bootWithStats(stats: Record<string, unknown>): Promise<HTMLElement> {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeActivity.mockResolvedValue({
      stats,
      recent: [],
      spawns: [],
      captureEnabled: false,
      runs: [],
    });

    const { fixture } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats()]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    await flush(fixture);
    return fixture.nativeElement as HTMLElement;
  }

  it('never renders the stats grid (dropped 2026-07-17: the timeline carries the story)', async () => {
    const dom = await bootWithStats({
      count: 3,
      lastStartAt: 3000,
      distinctOwners: 1,
      toolUses: 14,
      tokens: 8300,
      summarizedRuns: 2,
    });
    expect(dom.querySelector('[data-testid="inspector-activity-stats"]')).toBeNull();
    expect(dom.querySelector('[data-testid="inspector-activity-exec-totals"]')).toBeNull();
  });
});

describe('InspectorView, activity recent tool detail', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders the per-run tool detail when present and skips it when absent', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeActivity.mockResolvedValue({
      stats: { count: 2, lastStartAt: 3000, distinctOwners: 1 },
      recent: [
        { at: 3000, owner: 'main:abc', detail: 'notion-create-pages' },
        { at: 2000, owner: 'main:abc' },
      ],
      spawns: [],
      captureEnabled: false,
    });

    const { fixture } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats({ count: 2, lastStartAt: 3000 })]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    await flush(fixture);

    const rows = fixture.nativeElement.querySelectorAll(
      '[data-testid="inspector-activity-recent-row"]',
    );
    expect(rows.length).toBe(2);
    // Only the frame that carried a detail paints the tool label.
    const details = fixture.nativeElement.querySelectorAll(
      '[data-testid="inspector-activity-recent-detail"]',
    );
    expect(details.length).toBe(1);
    expect(details[0]!.textContent).toContain('notion-create-pages');
  });
});

describe('InspectorView, activity recent directional invocations', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /** Boots on a node, expands the Activity section with the given recent ring. */
  async function bootWithRecent(
    recent: readonly Record<string, unknown>[],
  ): Promise<ComponentFixture<InspectorView>> {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeActivity.mockResolvedValue({
      stats: { count: recent.length, lastStartAt: 3000, distinctOwners: 1 },
      recent,
      spawns: [],
      captureEnabled: false,
      runs: [],
    });

    const { fixture } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats({ count: recent.length })]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    await flush(fixture);
    return fixture;
  }

  it('renders an MCP INCOMING row (caller): type icon, node link, tool, and navigates', async () => {
    const fixture = await bootWithRecent([
      {
        at: 3000,
        owner: 'main:abc',
        kind: 'mcp',
        detail: 'notion-create-pages',
        caller: '.claude/skills/deploy/SKILL.md',
      },
    ]);
    const dom: HTMLElement = fixture.nativeElement;
    // MCP type icon (wrench), not the read icon.
    expect(dom.querySelector('[data-testid="inspector-activity-recent-icon-mcp"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-activity-recent-icon-read"]')).toBeNull();
    const link = dom.querySelector(
      '[data-testid="inspector-activity-recent-node"]',
    ) as HTMLButtonElement | null;
    expect(link).not.toBeNull();
    // Counterpart (the caller) shown as its readable node label, raw path in title.
    expect(link!.textContent).toContain('deploy');
    expect(link!.getAttribute('title')).toBe('.claude/skills/deploy/SKILL.md');
    // An mcp row carries the trailing tool segment.
    const tool = dom.querySelector('[data-testid="inspector-activity-recent-tool"]');
    expect(tool).not.toBeNull();
    expect(tool!.textContent).toContain('notion-create-pages');
    expect(dom.querySelector('[data-testid="inspector-activity-recent-detail"]')).toBeNull();

    // Clicking the link navigates via the shared node-open intent.
    const openSpy = vi.spyOn(TestBed.inject(NODE_OPEN_INTENT), 'open');
    link!.click();
    expect(openSpy).toHaveBeenCalledWith('.claude/skills/deploy/SKILL.md');
  });

  it('renders an MCP OUTGOING row (target) with the mcp server name and navigates', async () => {
    const fixture = await bootWithRecent([
      { at: 3000, owner: 'main:abc', kind: 'mcp', detail: 'notion-create-pages', target: 'mcp://notion' },
    ]);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-activity-recent-icon-mcp"]')).not.toBeNull();
    const link = dom.querySelector(
      '[data-testid="inspector-activity-recent-node"]',
    ) as HTMLButtonElement | null;
    expect(link).not.toBeNull();
    // Counterpart (the target) shown as the mcp server name, not `mcp://notion`.
    expect(link!.textContent).toContain('notion');
    expect(link!.textContent).not.toContain('mcp://');
    expect(link!.getAttribute('title')).toBe('mcp://notion');
    expect(dom.querySelector('[data-testid="inspector-activity-recent-tool"]')).not.toBeNull();

    const openSpy = vi.spyOn(TestBed.inject(NODE_OPEN_INTENT), 'open');
    link!.click();
    expect(openSpy).toHaveBeenCalledWith('mcp://notion');
  });

  it('renders a READ row (kind read, no detail): type icon + node link, NO tool segment', async () => {
    const fixture = await bootWithRecent([
      { at: 3000, owner: 'main:abc', kind: 'read', target: 'docs/architecture.md' },
    ]);
    const dom: HTMLElement = fixture.nativeElement;
    // Read type icon (document), not the mcp icon.
    expect(dom.querySelector('[data-testid="inspector-activity-recent-icon-read"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-activity-recent-icon-mcp"]')).toBeNull();
    const link = dom.querySelector(
      '[data-testid="inspector-activity-recent-node"]',
    ) as HTMLButtonElement | null;
    expect(link).not.toBeNull();
    expect(link!.textContent).toContain('architecture');
    expect(link!.getAttribute('title')).toBe('docs/architecture.md');
    // A read has no tool, so NO trailing tool segment (and no plain chip).
    expect(dom.querySelector('[data-testid="inspector-activity-recent-tool"]')).toBeNull();
    expect(dom.querySelector('[data-testid="inspector-activity-recent-detail"]')).toBeNull();

    const openSpy = vi.spyOn(TestBed.inject(NODE_OPEN_INTENT), 'open');
    link!.click();
    expect(openSpy).toHaveBeenCalledWith('docs/architecture.md');
  });

  it('renders a PLAIN row (neither caller nor target) with the short owner and no node link', async () => {
    const fixture = await bootWithRecent([{ at: 3000, owner: 'main:abc', detail: 'read-tool' }]);
    const dom: HTMLElement = fixture.nativeElement;
    // Plain detail chip, no node link.
    expect(dom.querySelector('[data-testid="inspector-activity-recent-detail"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-activity-recent-node"]')).toBeNull();
    // The short owner still renders on the row.
    const row = dom.querySelector('[data-testid="inspector-activity-recent-row"]');
    expect(row!.textContent).toContain('main:abc');
  });
});

/** AI-run entry seed for the merged-timeline suites. */
function makeRun(overrides: Partial<IActivityRunApi> = {}): IActivityRunApi {
  return {
    executionId: 'exec-1',
    extensionId: 'core/ai-redundancy-analyzer',
    status: 'completed',
    model: 'claude-sonnet',
    durationMs: 2000,
    finishedAt: 2000,
    failureReason: null,
    ...overrides,
  };
}

/** Boots on a node, expands Activity, settles the fetch of the given detail. */
async function bootWithTimeline(
  recent: readonly Record<string, unknown>[],
  runs: readonly IActivityRunApi[],
): Promise<ComponentFixture<InspectorView>> {
  const node = makeNode();
  const loader = makeStubLoader([node]);
  const dataSource = makeStubDataSource();
  dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
  dataSource.getNodeActivity.mockResolvedValue({
    stats: { count: recent.length, lastStartAt: 3000, distinctOwners: 1 },
    recent,
    spawns: [],
    captureEnabled: false,
    runs,
  });
  const { fixture } = bootstrap({
    loader,
    dataSource,
    activityStats: new Map([[node.path, makeActivityStats()]]),
  });
  fixture.componentRef.setInput('path', node.path);
  await flush(fixture);
  const toggle = fixture.nativeElement.querySelector(
    '[data-testid="inspector-activity-toggle"]',
  ) as HTMLButtonElement;
  toggle.click();
  await flush(fixture);
  await flush(fixture);
  return fixture;
}

describe('InspectorView, activity merged timeline (runtime + AI runs)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('interleaves AI runs into the timeline, newest first, timestampless runs last', async () => {
    const fixture = await bootWithTimeline(
      [
        { at: 3000, owner: 'main:abc' },
        { at: 1000, owner: 'main:abc' },
      ],
      [
        makeRun({ executionId: 'e1', finishedAt: 2000 }),
        // Unfinished run: no timestamp, must sink to the end.
        makeRun({
          executionId: 'e2',
          status: 'running',
          finishedAt: null,
          durationMs: null,
          model: null,
        }),
      ],
    );
    const dom: HTMLElement = fixture.nativeElement;
    // querySelectorAll returns document order, i.e. render order.
    const rows = dom.querySelectorAll(
      '[data-testid="inspector-activity-recent-row"], [data-testid="inspector-activity-run-row"]',
    );
    expect(rows.length).toBe(4);
    expect(rows[0]!.getAttribute('data-testid')).toBe('inspector-activity-recent-row'); // at 3000
    expect(rows[1]!.getAttribute('data-testid')).toBe('inspector-activity-run-row'); // finished 2000
    expect(rows[2]!.getAttribute('data-testid')).toBe('inspector-activity-recent-row'); // at 1000
    expect(rows[3]!.getAttribute('data-testid')).toBe('inspector-activity-run-row'); // null, sinks
  });

  it('renders an AI-run row visually distinguished: sparkles icon + extension · duration (no core/ prefix, no model, completed status omitted)', async () => {
    const fixture = await bootWithTimeline(
      [{ at: 3000, owner: 'main:abc' }],
      [makeRun({ executionId: 'e1', finishedAt: 2000 })],
    );
    const dom: HTMLElement = fixture.nativeElement;
    const row = dom.querySelector('[data-testid="inspector-activity-run-row"]');
    expect(row).not.toBeNull();
    // Own glyph (sparkles), distinct from the runtime wrench / document icons.
    const icon = row!.querySelector('[data-testid="inspector-activity-run-icon"]');
    expect(icon).not.toBeNull();
    expect(icon!.classList.contains('pi-sparkles')).toBe(true);
    // The `core/` built-in prefix and the model are dropped from the row
    // (user call 2026-07-20); the happy-path `completed` status is omitted.
    expect(row!.textContent).toContain('ai-redundancy-analyzer · 2s');
    expect(row!.textContent).not.toContain('core/');
    expect(row!.textContent).not.toContain('claude-sonnet');
    expect(row!.textContent).not.toContain('completed');
    // A clean run carries no failure tooltip.
    expect(row!.getAttribute('title')).toBeNull();
  });

  it('surfaces the failureReason as the failed run row tooltip', async () => {
    const fixture = await bootWithTimeline(
      [],
      [
        makeRun({
          executionId: 'e1',
          status: 'failed',
          finishedAt: 2000,
          failureReason: 'agent timed out',
        }),
      ],
    );
    const row = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="inspector-activity-run-row"]',
    );
    expect(row!.getAttribute('title')).toBe('agent timed out');
    // A non-completed status IS surfaced, on the prefix-stripped id.
    expect(row!.textContent).toContain('ai-redundancy-analyzer · failed · 2s');
  });

  it('shows AI runs even when the runtime half is quiet (empty stats)', async () => {
    const fixture = await bootWithTimeline([], [makeRun({ executionId: 'e1', finishedAt: 2000 })]);
    const dom: HTMLElement = fixture.nativeElement;
    // Not the quiet-node empty line: the persistent runs still show.
    expect(dom.querySelector('[data-testid="inspector-activity-empty"]')).toBeNull();
    expect(dom.querySelectorAll('[data-testid="inspector-activity-run-row"]').length).toBe(1);
  });

  it('a sighted-only node (count 0, shell entry in the log) shows its timeline, not the quiet line', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeActivity.mockResolvedValue({
      stats: { count: 0, lastStartAt: 0, distinctOwners: 0 },
      recent: [{ at: 3000, owner: 'main:abc', detail: 'Bash', caller: 'skills/deploy/SKILL.md' }],
      spawns: [],
      captureEnabled: false,
      runs: [],
    });
    const { fixture } = bootstrap({
      loader,
      dataSource,
      // The sighting frame rides the node's count-0 stats, so the mirror knows the node.
      activityStats: new Map([[node.path, makeActivityStats({ count: 0, lastStartAt: 0, distinctOwners: 0 })]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    toggle.click();
    await flush(fixture);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-activity-empty"]')).toBeNull();
    expect(dom.querySelectorAll('[data-testid="inspector-activity-recent-row"]').length).toBe(1);
    // The sighting row names the shell tool (a typed access row, not the plain-detail shape).
    expect(dom.querySelector('[data-testid="inspector-activity-recent-row"]')!.textContent).toContain('Bash');
  });

  it('renders the runtime-only timeline unchanged when runs is empty', async () => {
    const fixture = await bootWithTimeline(
      [{ at: 3000, owner: 'main:abc', detail: 'read-tool' }],
      [],
    );
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelectorAll('[data-testid="inspector-activity-recent-row"]').length).toBe(1);
    expect(dom.querySelectorAll('[data-testid="inspector-activity-run-row"]').length).toBe(0);
    expect(
      dom.querySelector('[data-testid="inspector-activity-recent-detail"]')!.textContent,
    ).toContain('read-tool');
  });

  it('filters the timeline by provenance via the three-state control', async () => {
    const fixture = await bootWithTimeline(
      [{ at: 3000, owner: 'main:abc' }],
      [makeRun({ executionId: 'e1', finishedAt: 2000 })],
    );
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-activity-filter"]')).not.toBeNull();
    // Default 'all': both provenances visible.
    expect(dom.querySelectorAll('[data-testid="inspector-activity-recent-row"]').length).toBe(1);
    expect(dom.querySelectorAll('[data-testid="inspector-activity-run-row"]').length).toBe(1);

    (dom.querySelector('[data-testid="inspector-activity-filter-runtime"]') as HTMLElement).click();
    await flush(fixture);
    expect(dom.querySelectorAll('[data-testid="inspector-activity-recent-row"]').length).toBe(1);
    expect(dom.querySelectorAll('[data-testid="inspector-activity-run-row"]').length).toBe(0);

    (dom.querySelector('[data-testid="inspector-activity-filter-ai"]') as HTMLElement).click();
    await flush(fixture);
    expect(dom.querySelectorAll('[data-testid="inspector-activity-recent-row"]').length).toBe(0);
    expect(dom.querySelectorAll('[data-testid="inspector-activity-run-row"]').length).toBe(1);

    (dom.querySelector('[data-testid="inspector-activity-filter-all"]') as HTMLElement).click();
    await flush(fixture);
    expect(dom.querySelectorAll('[data-testid="inspector-activity-recent-row"]').length).toBe(1);
    expect(dom.querySelectorAll('[data-testid="inspector-activity-run-row"]').length).toBe(1);
  });

  it('shows the filtered-empty line when the active filter matches nothing', async () => {
    const fixture = await bootWithTimeline([{ at: 3000, owner: 'main:abc' }], []);
    const dom: HTMLElement = fixture.nativeElement;
    (dom.querySelector('[data-testid="inspector-activity-filter-ai"]') as HTMLElement).click();
    await flush(fixture);
    expect(dom.querySelector('[data-testid="inspector-activity-filter-empty"]')).not.toBeNull();
    expect(dom.querySelectorAll('[data-testid="inspector-activity-recent-row"]').length).toBe(0);
  });
});

describe('InspectorView, activity clear-all', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /** `bootWithTimeline` shape, but keeping the stub refs for assertions. */
  async function bootForClear(): Promise<{
    fixture: ComponentFixture<InspectorView>;
    dataSource: IStubDataSource;
  }> {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeActivity.mockResolvedValue({
      stats: { count: 1, lastStartAt: 3000, distinctOwners: 1 },
      recent: [{ at: 3000, owner: 'main:abc' }],
      spawns: [],
      captureEnabled: false,
      runs: [makeRun({ executionId: 'e1', finishedAt: 2000 })],
    });
    const { fixture } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats()]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    await flush(fixture);
    return { fixture, dataSource };
  }

  it('DELETEs the node activity on click, re-fetches, and re-hydrates the stats mirror', async () => {
    const { fixture, dataSource } = await bootForClear();
    const dom: HTMLElement = fixture.nativeElement;
    const btn = dom.querySelector(
      '[data-testid="inspector-activity-clear"] button',
    ) as HTMLButtonElement;
    expect(btn).not.toBeNull();

    // The cleared server answers empty on the authoritative re-fetch.
    dataSource.getNodeActivity.mockResolvedValue({
      stats: { count: 0, lastStartAt: 0, distinctOwners: 0 },
      recent: [],
      spawns: [],
      captureEnabled: false,
      runs: [],
    });
    const fetchesBefore = dataSource.getNodeActivity.mock.calls.length;
    btn.click();
    await flush(fixture);
    await flush(fixture);

    expect(dataSource.clearNodeActivity).toHaveBeenCalledWith('agents/architect.md');
    expect(dataSource.getNodeActivity.mock.calls.length).toBeGreaterThan(fetchesBefore);
    // The panel reflects the cleared detail (quiet-node empty line).
    expect(dom.querySelectorAll('[data-testid="inspector-activity-recent-row"]').length).toBe(0);
    expect(dom.querySelectorAll('[data-testid="inspector-activity-run-row"]').length).toBe(0);
    // The mirror re-hydration is what retires the section gate / pill.
    const statsService = TestBed.inject(NodeActivityStatsService) as unknown as {
      refresh: ReturnType<typeof vi.fn>;
    };
    expect(statsService.refresh).toHaveBeenCalled();
  });

  it('keeps the panel untouched when the DELETE fails (progressive enhancement)', async () => {
    const { fixture, dataSource } = await bootForClear();
    const dom: HTMLElement = fixture.nativeElement;
    dataSource.clearNodeActivity.mockRejectedValue(new Error('demo-readonly'));
    const fetchesBefore = dataSource.getNodeActivity.mock.calls.length;

    (dom.querySelector('[data-testid="inspector-activity-clear"] button') as HTMLButtonElement).click();
    await flush(fixture);
    await flush(fixture);

    // No re-fetch, no mirror refresh, rows still shown.
    expect(dataSource.getNodeActivity.mock.calls.length).toBe(fetchesBefore);
    const statsService = TestBed.inject(NodeActivityStatsService) as unknown as {
      refresh: ReturnType<typeof vi.fn>;
    };
    expect(statsService.refresh).not.toHaveBeenCalled();
    expect(dom.querySelectorAll('[data-testid="inspector-activity-recent-row"]').length).toBe(1);
    expect(dom.querySelectorAll('[data-testid="inspector-activity-run-row"]').length).toBe(1);
  });
});

describe('InspectorView, activity filter persistence (inspector-level)', () => {
  const STORAGE_KEY = 'skill-map.ui.inspector.activityFilter';

  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('applies a persisted filter at init', async () => {
    localStorage.setItem(STORAGE_KEY, 'ai');
    const fixture = await bootWithTimeline(
      [{ at: 3000, owner: 'main:abc' }],
      [makeRun({ executionId: 'e1', finishedAt: 2000 })],
    );
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelectorAll('[data-testid="inspector-activity-recent-row"]').length).toBe(0);
    expect(dom.querySelectorAll('[data-testid="inspector-activity-run-row"]').length).toBe(1);
  });

  it('persists a filter change back to localStorage', async () => {
    const fixture = await bootWithTimeline(
      [{ at: 3000, owner: 'main:abc' }],
      [makeRun({ executionId: 'e1', finishedAt: 2000 })],
    );
    const dom: HTMLElement = fixture.nativeElement;
    (dom.querySelector('[data-testid="inspector-activity-filter-runtime"]') as HTMLElement).click();
    await flush(fixture);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('runtime');
  });

  it('falls back to "all" on an unknown stored value (defensive parse)', async () => {
    localStorage.setItem(STORAGE_KEY, 'bogus');
    const fixture = await bootWithTimeline(
      [{ at: 3000, owner: 'main:abc' }],
      [makeRun({ executionId: 'e1', finishedAt: 2000 })],
    );
    const dom: HTMLElement = fixture.nativeElement;
    // Both provenances visible, i.e. the filter resolved to 'all'.
    expect(dom.querySelectorAll('[data-testid="inspector-activity-recent-row"]').length).toBe(1);
    expect(dom.querySelectorAll('[data-testid="inspector-activity-run-row"]').length).toBe(1);
  });
});

describe('InspectorView, activity live refresh (node.activity re-fetch)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('re-fetches the activity detail on a node.activity frame while the section is open', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeActivity.mockResolvedValue({
      stats: { count: 1, lastStartAt: 1000, distinctOwners: 1 },
      recent: [],
      spawns: [],
      captureEnabled: true,
      runs: [],
    });

    const { fixture, nodeActivity$ } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats()]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    // Expand the Activity section: the first (loud) fetch.
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    await flush(fixture);
    expect(dataSource.getNodeActivity).toHaveBeenCalledWith(node.path);
    const before = dataSource.getNodeActivity.mock.calls.length;

    // A live execution frame lands: after the debounce window the section
    // silently re-fetches the SAME node's detail (no navigation, no scan).
    vi.useFakeTimers();
    try {
      nodeActivity$.next();
      vi.advanceTimersByTime(400);
    } finally {
      vi.useRealTimers();
    }
    await flush(fixture);

    expect(dataSource.getNodeActivity.mock.calls.length).toBeGreaterThan(before);
  });

  it('re-fetches the activity detail on a job.completed frame while the section is open (AI-run history stays live)', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeActivity.mockResolvedValue({
      stats: { count: 1, lastStartAt: 1000, distinctOwners: 1 },
      recent: [],
      spawns: [],
      captureEnabled: true,
      runs: [],
    });

    const { fixture, jobEvents$ } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats()]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    await flush(fixture);
    expect(dataSource.getNodeActivity).toHaveBeenCalledWith(node.path);
    const before = dataSource.getNodeActivity.mock.calls.length;

    // `sm record` writes the `state_executions` AI-run row then pushes
    // `job.completed`, a frame that carries NO `node.activity`. Without the
    // job stream in the Activity refresh merge, a finder / summarizer run
    // (which touches no file, so no re-scan follows) never surfaced until an
    // unrelated refresh. Here the section re-fetches after the debounce.
    vi.useFakeTimers();
    try {
      jobEvents$.next(makeJobCompleted());
      vi.advanceTimersByTime(400);
    } finally {
      vi.useRealTimers();
    }
    await flush(fixture);

    expect(dataSource.getNodeActivity.mock.calls.length).toBeGreaterThan(before);
  });

  it('coalesces a burst of node.activity frames into ONE re-fetch (debounced)', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeActivity.mockResolvedValue({
      stats: { count: 1, lastStartAt: 1000, distinctOwners: 1 },
      recent: [],
      spawns: [],
      captureEnabled: true,
      runs: [],
    });

    const { fixture, nodeActivity$ } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats()]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    await flush(fixture);
    const before = dataSource.getNodeActivity.mock.calls.length;

    // Five frames inside one debounce window collapse to a single trailing
    // re-fetch, not five GETs.
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 5; i++) {
        nodeActivity$.next();
        vi.advanceTimersByTime(100);
      }
      vi.advanceTimersByTime(400);
    } finally {
      vi.useRealTimers();
    }
    await flush(fixture);

    expect(dataSource.getNodeActivity.mock.calls.length).toBe(before + 1);
  });

  it('re-fetches the activity detail on an agent.spawn frame while the section is open', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeActivity.mockResolvedValue({
      stats: { count: 1, lastStartAt: 1000, distinctOwners: 1 },
      recent: [],
      spawns: [],
      captureEnabled: true,
      runs: [],
    });

    const { fixture, agentSpawn$ } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats()]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    await flush(fixture);
    const before = dataSource.getNodeActivity.mock.calls.length;

    // A spawn thread starts: the section's spawn rows must refresh live too.
    vi.useFakeTimers();
    try {
      agentSpawn$.next();
      vi.advanceTimersByTime(400);
    } finally {
      vi.useRealTimers();
    }
    await flush(fixture);

    expect(dataSource.getNodeActivity.mock.calls.length).toBeGreaterThan(before);
  });

  it('ignores node.activity frames when the section was never opened (no fetch)', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));

    const { fixture, nodeActivity$ } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats()]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    // Section is collapsed by default: never fetched, so the guard holds.
    expect(dataSource.getNodeActivity).not.toHaveBeenCalled();

    vi.useFakeTimers();
    try {
      nodeActivity$.next();
      vi.advanceTimersByTime(400);
    } finally {
      vi.useRealTimers();
    }
    await flush(fixture);

    expect(dataSource.getNodeActivity).not.toHaveBeenCalled();
  });
});

describe('InspectorView, header version (catalog curation)', () => {
  it('renders sidecar.annotations.version on the bump chip while core/node-bump is enabled', async () => {
    // The version chip is the Bump affordance (user call 2026-07-21):
    // it renders only while the `core/node-bump` contribution is present.
    const node = makeNodeWithSidecar({
      present: true,
      status: 'fresh',
      annotations: { version: 7 },
    });
    node.contributions = [
      {
        pluginId: 'core',
        extensionId: 'node-bump',
        nodePath: node.path,
        contributionId: 'bumpButton',
        slot: 'inspector.surface.version',
        payload: { actionId: 'core/node-bump', label: 'Bump', enabled: false, disabledReason: 'fresh' },
      },
    ];
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const v = fixture.nativeElement.querySelector('[data-testid="inspector-version"]');
    expect(v).not.toBeNull();
    expect(v!.textContent).toContain('v7');
  });

  it('shows NO version surface with the plugin disabled (no contribution)', async () => {
    const node = makeNodeWithSidecar({
      present: true,
      status: 'fresh',
      annotations: { version: 7 },
    });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-version"]'),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AI actions card (Step 16 piece 1, the findings workbench)
// ---------------------------------------------------------------------------

function makeFinding(overrides: Partial<IFindingApi> = {}): IFindingApi {
  return {
    id: 12,
    nodeId: 'agents/architect.md',
    extensionId: 'core/todo-finder',
    extensionVersion: '1.0.0',
    origin: 'extension',
    type: 'stale-todo',
    severity: 'warn',
    message: 'The TODO at line 4 looks abandoned.',
    detail: null,
    confidence: 0.87,
    model: 'claude-opus-4',
    resolution: null,
    resolutionActor: null,
    resolutionNote: null,
    resolutionBy: null,
    resolutionAt: null,
    stale: false,
    generatedAt: 1_700_000_000_000,
    jobId: 'job-1',
    ...overrides,
  };
}

function makeFindingsEnvelope(
  items: IFindingApi[],
  countsOverrides: Partial<IFindingsEnvelopeApi['counts']> = {},
): IFindingsEnvelopeApi {
  return {
    schemaVersion: '1',
    kind: 'findings',
    items,
    filters: {},
    counts: {
      total: items.length,
      returned: items.length,
      dismissedExcluded: 0,
      fixedExcluded: 0,
      ...countsOverrides,
    },
    kindRegistry: {},
  };
}

function makeProbEntry(overrides: Partial<IProbExtensionEntryApi> = {}): IProbExtensionEntryApi {
  return {
    id: 'core/todo-finder',
    description: 'Judges whether TODO markers look abandoned.',
    state: 'idle',
    // Idle default: no active job handle. Queued/running fixtures pass
    // an explicit id (the stop/restart companions hang off it).
    jobId: null,
    lastJudged: null,
    // Two-state defaults: no fixer, no open findings (the Detect-only
    // shape). Finder-with-fixer fixtures pass an explicit `fixerIds`;
    // the Fix state fixtures additionally pass `hasOpenFindings: true`.
    fixerIds: [],
    hasOpenFindings: false,
    // No stored rows: a clean (or never-judged) verdict by default.
    findingsMaxSeverity: null,
    // No active fixer job: every row's fix affordance idle.
    fixerBusy: null,
    ...overrides,
  };
}

function makeProbExtensions(overrides: Partial<IProbExtensionsApi> = {}): IProbExtensionsApi {
  return { finders: [], standalone: [], issueFixers: [], ...overrides };
}

function makeIssueFixer(overrides: Partial<IIssueFixerEntryApi> = {}): IIssueFixerEntryApi {
  return {
    id: 'core/ai-reference-action',
    description: 'Repairs broken references.',
    state: 'idle',
    jobId: null,
    lastJudged: null,
    // The SHORT persisted form (`scan_issues.analyzerId`), the row-match key.
    analyzerIds: ['reference-broken'],
    ...overrides,
  };
}

/**
 * One `skills` bucket entry (`spec/skill-actions.md`): the id is the
 * verbatim `skill:<dirname>` submit target while `name` is the
 * frontmatter label; the two differ on purpose in fixtures so a test
 * asserting the label proves it came from `name`, never from the id.
 */
function makeSkillEntry(overrides: Partial<ISkillActionEntryApi> = {}): ISkillActionEntryApi {
  return {
    id: 'skill:skill-optimizer',
    name: 'skill-optimizer',
    description: 'Tightens the skill body.',
    version: '2.0.0',
    state: 'idle',
    jobId: null,
    lastJudged: null,
    ...overrides,
  };
}

/** A dedicated-surface claim (`inspector.surface.*`) for boot fixtures. */
function makeSurfaceClaim(slot: string, actionId: string): IContributionApi {
  const extensionId = actionId.slice(actionId.indexOf('/') + 1);
  return {
    pluginId: 'core',
    extensionId,
    nodePath: 'agents/architect.md',
    contributionId: 'surface',
    slot,
    payload: { actionId, label: extensionId, enabled: true },
  };
}

function makeIssue(overrides: Partial<IIssueApi> = {}): IIssueApi {
  return {
    analyzerId: 'reference-broken',
    severity: 'error',
    nodeIds: ['skills/deploy/SKILL.md'],
    message: 'references arrow points at "docs/missing.md" which is not in the scan',
    ...overrides,
  };
}

describe('InspectorView, AI actions card (Step 16 piece 1)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  interface IAiActionsBoot {
    findings?: IFindingsEnvelopeApi;
    probs?: IProbExtensionsApi;
    summaries?: INodeSummaryRowApi[];
    /** Deterministic `scan_issues` rows for the findings card (issue-fixer cases). */
    issues?: IIssueApi[];
    /** Extra node contributions (e.g. `inspector.surface.*` claims). */
    contributions?: IContributionApi[];
    /**
     * The shared processing-agent gate as the BFF answers it:
     * `installed` (open, the stub default), `missing` (closed, nothing
     * can be submitted), `unknown` (the probe fails, which must FAIL
     * OPEN).
     */
    agentSkill?: 'installed' | 'missing' | 'unknown';
    /**
     * Processing-agent presence as `GET /api/agent/presence` answers it:
     * `attending` (the stub default, a claim was observed), `absent` (no
     * claim since the server booted, which raises the second heads-up)
     * or `unknown` (the probe fails, which must stay silent).
     */
    presence?: 'attending' | 'absent' | 'unknown';
}

  async function bootAiActions(opts: IAiActionsBoot = {}): Promise<{
    fixture: ComponentFixture<InspectorView>;
    dataSource: IStubDataSource;
    node: INodeView;
    jobEvents$: Subject<IWsEvent>;
  }> {
    const node = makeNode(opts.contributions ? { contributions: opts.contributions } : {});
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    if (opts.findings) dataSource.getNodeFindings.mockResolvedValue(opts.findings);
    if (opts.probs) dataSource.getNodeProbExtensions.mockResolvedValue(opts.probs);
    if (opts.issues) {
      dataSource.listIssues.mockResolvedValue({
        schemaVersion: '1',
        kind: 'issues',
        items: opts.issues,
        filters: { severity: null, analyzerId: null, node: null },
        counts: { total: opts.issues.length, returned: opts.issues.length },
        kindRegistry: {},
      });
    }
    if (opts.summaries) dataSource.getNodeSummary.mockResolvedValue(opts.summaries);
    if (opts.agentSkill === 'missing') {
      dataSource.getAgentSkillInstallStatus.mockResolvedValue({
        provider: 'claude',
        supported: true,
        skillDir: '.claude/skills/sm-process-jobs',
        installed: false,
        stale: false,
      });
    } else if (opts.agentSkill === 'unknown') {
      dataSource.getAgentSkillInstallStatus.mockRejectedValue(new Error('down'));
    }
    if (opts.presence === 'absent') {
      dataSource.agentPresence.mockResolvedValue({
        schemaVersion: '1',
        kind: 'agent-presence',
        attending: false,
        lastClaimAt: null,
      });
    } else if (opts.presence === 'unknown') {
      dataSource.agentPresence.mockRejectedValue(new Error('down'));
    }
    const { fixture, jobEvents$ } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    await flush(fixture);
    return { fixture, dataSource, node, jobEvents$ };
  }

  it('hides the card entirely when there are no launchers, no findings, and nothing hidden', async () => {
    const { fixture } = await bootAiActions();
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-card-ai-actions"]'),
    ).toBeNull();
  });

  it('shows the no-processing-agent warning when the lens skill is supported but not installed', async () => {
    const dataSource = makeStubDataSource();
    dataSource.getAgentSkillInstallStatus.mockResolvedValue({
      provider: 'claude',
      supported: true,
      skillDir: '.claude/skills/sm-process-jobs',
      installed: false,
      stale: false,
    });
    const node = makeNode();
    const loader = makeStubLoader([node]);
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeProbExtensions.mockResolvedValue(
      makeProbExtensions({ standalone: [makeProbEntry({ id: 'core/summarizer' })] }),
    );
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(
      dom.querySelector('[data-testid="inspector-ai-actions-no-agent-warning"]'),
    ).not.toBeNull();
  });

  it('hides the no-processing-agent warning when the skill is installed', async () => {
    const { fixture } = await bootAiActions({
      probs: makeProbExtensions({ standalone: [makeProbEntry({ id: 'core/summarizer' })] }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    // The card renders (a launcher exists), but with the skill installed
    // (the stub default) the warning must not.
    expect(dom.querySelector('[data-testid="inspector-card-ai-actions"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-ai-actions-no-agent-warning"]')).toBeNull();
  });

  it('hides the no-processing-agent warning when the lens has no skill to install (supported:false)', async () => {
    const dataSource = makeStubDataSource();
    dataSource.getAgentSkillInstallStatus.mockResolvedValue({
      provider: 'claude',
      supported: false,
      skillDir: null,
      installed: false,
      stale: false,
    });
    const node = makeNode();
    const loader = makeStubLoader([node]);
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeProbExtensions.mockResolvedValue(
      makeProbExtensions({ standalone: [makeProbEntry({ id: 'core/summarizer' })] }),
    );
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-ai-actions-no-agent-warning"]')).toBeNull();
  });

  it('shows only the no-agent warning when the skill is missing, regardless of agent presence', async () => {
    const { fixture } = await bootAiActions({
      agentSkill: 'missing',
      presence: 'absent',
      probs: makeProbExtensions({ standalone: [makeProbEntry({ id: 'core/summarizer' })] }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    expect(
      dom.querySelector('[data-testid="inspector-ai-actions-no-agent-warning"]'),
    ).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-ai-actions-attending-warning"]')).toBeNull();
  });

  it('shows the attending warning when the skill is installed but no agent has claimed work', async () => {
    const { fixture } = await bootAiActions({
      presence: 'absent',
      probs: makeProbExtensions({ standalone: [makeProbEntry({ id: 'core/summarizer' })] }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    expect(
      dom.querySelector('[data-testid="inspector-ai-actions-attending-warning"]'),
    ).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-ai-actions-no-agent-warning"]')).toBeNull();
  });

  it('shows neither warning when the skill is installed and an agent has claimed work', async () => {
    const { fixture } = await bootAiActions({
      probs: makeProbExtensions({ standalone: [makeProbEntry({ id: 'core/summarizer' })] }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-ai-actions-no-agent-warning"]')).toBeNull();
    expect(dom.querySelector('[data-testid="inspector-ai-actions-attending-warning"]')).toBeNull();
  });

  it('shows neither warning while the presence probe is unknown (it failed)', async () => {
    const { fixture } = await bootAiActions({
      presence: 'unknown',
      probs: makeProbExtensions({ standalone: [makeProbEntry({ id: 'core/summarizer' })] }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-ai-actions-no-agent-warning"]')).toBeNull();
    expect(dom.querySelector('[data-testid="inspector-ai-actions-attending-warning"]')).toBeNull();
  });

  it('shows neither warning while the skill probe is unknown, even with no agent attending', async () => {
    const { fixture } = await bootAiActions({
      agentSkill: 'unknown',
      presence: 'absent',
      probs: makeProbExtensions({ standalone: [makeProbEntry({ id: 'core/summarizer' })] }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-ai-actions-no-agent-warning"]')).toBeNull();
    expect(dom.querySelector('[data-testid="inspector-ai-actions-attending-warning"]')).toBeNull();
  });

  it('renders TWO launcher rows: finders (with their ALL) on top, standalone (with theirs) below', async () => {
    const { fixture } = await bootAiActions({
      probs: makeProbExtensions({
        finders: [makeProbEntry({ fixerIds: ['core/todo-fixer'] })],
        standalone: [makeProbEntry({ id: 'core/summarizer', description: 'Summarizes the node.' })],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-card-ai-actions"]')).not.toBeNull();
    // Two rows (user call 2026-07-22), each led by its type-scoped ALL.
    expect(
      dom.querySelector('[data-testid="inspector-ai-actions-launchers-row-finders"]'),
    ).not.toBeNull();
    expect(
      dom.querySelector('[data-testid="inspector-ai-actions-launchers-row-standalone"]'),
    ).not.toBeNull();
    // Each group header carries its quiet "(run all)" link right after
    // the title (user pick 2026-07-23, replacing the ALL buttons).
    const allFinders = dom.querySelector(
      '[data-testid="inspector-ai-action-launch-all-finders"]',
    );
    const allStandalone = dom.querySelector(
      '[data-testid="inspector-ai-action-launch-all-standalone"]',
    );
    expect(allFinders).not.toBeNull();
    expect(allStandalone).not.toBeNull();
    expect(allFinders!.textContent).toContain('(run all)');
    expect(allStandalone!.textContent).toContain('(run all)');
    // The button LABEL is always the kind (short name); the Detect/Fix
    // state rides `data-action` + the icon, not the label (user call
    // 2026-07-18).
    const finder = dom.querySelector('[data-testid="inspector-ai-action-launch-core/todo-finder"]');
    expect(finder).not.toBeNull();
    expect(finder!.textContent).toContain('todo-finder');
    expect(finder!.textContent).not.toContain('Detect');
    expect(finder!.getAttribute('data-action')).toBe('detect');
    // Standalone button shows the short extension name (segment after the slash).
    const standalone = dom.querySelector(
      '[data-testid="inspector-ai-action-launch-core/summarizer"]',
    );
    expect(standalone).not.toBeNull();
    expect(standalone!.textContent).toContain('summarizer');
    expect(standalone!.textContent).not.toContain('core/');
    expect(standalone!.getAttribute('data-action')).toBe('run');
    // No fresh findings: no list and no filler either, the launchers
    // stand alone (empty-state removed per user call 2026-07-17).
    expect(dom.querySelector('[data-testid="inspector-ai-actions-empty"]')).toBeNull();
    expect(dom.querySelector('[data-testid="inspector-ai-actions-list"]')).toBeNull();
  });

  it('a single-group card keeps the same "(run all)" link (no group-qualified label)', async () => {
    const { fixture } = await bootAiActions({
      probs: makeProbExtensions({
        finders: [makeProbEntry({ fixerIds: ['core/todo-fixer'] })],
      }),
    });
    const all = fixture.nativeElement.querySelector(
      '[data-testid="inspector-ai-action-launch-all-finders"]',
    ) as HTMLElement;
    expect(all).not.toBeNull();
    expect(all.textContent).toContain('(run all)');
  });

  // -------------------------------------------------------------------
  // Skills launcher group (skill actions, spec/skill-actions.md): the
  // optional third bucket of the prob-extensions payload, rendered as a
  // launcher group AFTER standalone and finders through the SAME button
  // template (mapped with fixerIds: [], hasOpenFindings: false, no
  // verdict fields).
  // -------------------------------------------------------------------

  it('renders the skills group LAST ([standalone, finders, skills]), labelled from the wire name, book icon', async () => {
    const { fixture } = await bootAiActions({
      probs: makeProbExtensions({
        finders: [makeProbEntry({ fixerIds: ['core/todo-fixer'] })],
        standalone: [makeProbEntry({ id: 'core/summarizer', description: 'Summarizes.' })],
        skills: [makeSkillEntry({ name: 'optimizer-pro' })],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    // Group order is DOM order: standalone, finders, then skills.
    const rows = Array.from(
      dom.querySelectorAll('[data-testid^="inspector-ai-actions-launchers-row-"]'),
    ).map((el) => el.getAttribute('data-testid'));
    expect(rows).toEqual([
      'inspector-ai-actions-launchers-row-standalone',
      'inspector-ai-actions-launchers-row-finders',
      'inspector-ai-actions-launchers-row-skills',
    ]);
    // The group header carries the Skills title and its own run-all.
    const skillsRow = dom.querySelector(
      '[data-testid="inspector-ai-actions-launchers-row-skills"]',
    ) as HTMLElement;
    expect(skillsRow.textContent).toContain('Skills');
    expect(
      dom.querySelector('[data-testid="inspector-ai-action-launch-all-skills"]'),
    ).not.toBeNull();
    // The button labels with the wire `name` VERBATIM (the fixture's
    // name differs from the id's dirname on purpose): never the
    // `skill:` id, never the shortening helper.
    const launcher = dom.querySelector(
      '[data-testid="inspector-ai-action-launch-skill:skill-optimizer"]',
    ) as HTMLElement;
    expect(launcher).not.toBeNull();
    expect(launcher.textContent).toContain('optimizer-pro');
    expect(launcher.textContent).not.toContain('skill:');
    // Single-action semantics like standalone (`data-action` run), with
    // the book glyph as the idle icon.
    expect(launcher.getAttribute('data-action')).toBe('run');
    expect(launcher.getAttribute('data-state')).toBe('idle');
    expect(launcher.querySelector('.pi-book')).not.toBeNull();
  });

  it('a skills-only catalog still renders the card (available includes skills)', async () => {
    const { fixture } = await bootAiActions({
      probs: makeProbExtensions({ skills: [makeSkillEntry()] }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-card-ai-actions"]')).not.toBeNull();
    expect(
      dom.querySelector('[data-testid="inspector-ai-actions-launchers-row-skills"]'),
    ).not.toBeNull();
    // No finders: the Automatic toggle has nothing to govern.
    expect(dom.querySelector('[data-testid="inspector-auto-fix-toggle"]')).toBeNull();
  });

  it('an absent skills bucket (older server) and an empty catalog both render no skills row', async () => {
    // Absent: `makeProbExtensions` emits no `skills` key at all, the
    // wire shape of a server predating skill actions.
    const absent = await bootAiActions({
      probs: makeProbExtensions({ finders: [makeProbEntry()] }),
    });
    expect(
      absent.fixture.nativeElement.querySelector(
        '[data-testid="inspector-ai-actions-launchers-row-skills"]',
      ),
    ).toBeNull();
    // Empty: the feature is live, the catalog just has nothing installed.
    const empty = await bootAiActions({
      probs: makeProbExtensions({ finders: [makeProbEntry()], skills: [] }),
    });
    expect(
      empty.fixture.nativeElement.querySelector(
        '[data-testid="inspector-ai-actions-launchers-row-skills"]',
      ),
    ).toBeNull();
  });

  it('clicking a skill posts its skill: id VERBATIM with autoFix false and flips to queued', async () => {
    const { fixture, dataSource, node } = await bootAiActions({
      probs: makeProbExtensions({ skills: [makeSkillEntry()] }),
    });
    const host = fixture.nativeElement.querySelector(
      '[data-testid="inspector-ai-action-launch-skill:skill-optimizer"]',
    ) as HTMLElement;
    (host.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);
    // The SAME submit path as every launcher: the entry id verbatim as
    // the `extension` body field, autoFix never true for a skill.
    expect(dataSource.submitNodeJob).toHaveBeenCalledWith(node.path, 'skill:skill-optimizer', false);
    expect(host.getAttribute('data-state')).toBe('queued');
    expect((host.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('the skills (run all) queues every skill sequentially, and ONLY skills', async () => {
    const { fixture, dataSource, node } = await bootAiActions({
      probs: makeProbExtensions({
        finders: [makeProbEntry({ fixerIds: ['core/todo-fixer'] })],
        skills: [
          makeSkillEntry(),
          makeSkillEntry({ id: 'skill:changelog-writer', name: 'changelog-writer' }),
        ],
      }),
    });
    (
      fixture.nativeElement.querySelector(
        '[data-testid="inspector-ai-action-launch-all-skills"] button',
      ) as HTMLButtonElement
    ).click();
    await flush(fixture);
    expect(dataSource.submitNodeJob).toHaveBeenCalledTimes(2);
    // Catalog order, both with autoFix false; the finder never rides.
    expect(dataSource.submitNodeJob).toHaveBeenNthCalledWith(
      1,
      node.path,
      'skill:skill-optimizer',
      false,
    );
    expect(dataSource.submitNodeJob).toHaveBeenNthCalledWith(
      2,
      node.path,
      'skill:changelog-writer',
      false,
    );
  });

  it('a queued skill renders the stop companion off its server job handle; stop cancels it', async () => {
    const { fixture, dataSource } = await bootAiActions({
      probs: makeProbExtensions({
        skills: [makeSkillEntry({ state: 'queued', jobId: 'job-42' })],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    const stop = dom.querySelector(
      '[data-testid="inspector-ai-action-stop-skill:skill-optimizer"]',
    ) as HTMLElement;
    expect(stop).not.toBeNull();
    (stop.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);
    expect(dataSource.cancelJob).toHaveBeenCalledWith('job-42');
    // Optimistic idle flip, same as every launcher.
    const launcher = dom.querySelector(
      '[data-testid="inspector-ai-action-launch-skill:skill-optimizer"]',
    ) as HTMLElement;
    expect(launcher.getAttribute('data-state')).toBe('idle');
  });

  it('a server-confirmed payload reconciles the optimistic skill flip (the stop appears on refetch)', async () => {
    const { fixture, dataSource, jobEvents$ } = await bootAiActions({
      probs: makeProbExtensions({ skills: [makeSkillEntry()] }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    const host = dom.querySelector(
      '[data-testid="inspector-ai-action-launch-skill:skill-optimizer"]',
    ) as HTMLElement;
    (host.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);
    // Optimistically queued, no server job handle yet: no companion.
    expect(host.getAttribute('data-state')).toBe('queued');
    expect(
      dom.querySelector('[data-testid="inspector-ai-action-stop-skill:skill-optimizer"]'),
    ).toBeNull();

    // The refetch lands the server truth: still queued, now with the
    // job handle, which retires the optimistic flip (reconcile over the
    // skills bucket) and mounts the stop companion.
    dataSource.getNodeProbExtensions.mockResolvedValue(
      makeProbExtensions({ skills: [makeSkillEntry({ state: 'queued', jobId: 'job-9' })] }),
    );
    vi.useFakeTimers();
    try {
      jobEvents$.next(makeJobCompleted());
      vi.advanceTimersByTime(400);
    } finally {
      vi.useRealTimers();
    }
    // Twice: the debounced callback's fetch settles through its own
    // await chain (same drain as the job-terminal stop test above).
    await flush(fixture);
    await flush(fixture);
    expect(host.getAttribute('data-state')).toBe('queued');
    expect(
      dom.querySelector('[data-testid="inspector-ai-action-stop-skill:skill-optimizer"]'),
    ).not.toBeNull();
  });

  it('a judged idle skill renders NO verdict mark (skills carry no findings verdict)', async () => {
    const { fixture } = await bootAiActions({
      probs: makeProbExtensions({
        skills: [
          makeSkillEntry({ lastJudged: { at: 1_700_000_000_000, model: 'claude-opus-4' } }),
        ],
      }),
    });
    // `findingsMaxSeverity` stays ABSENT on the mapped entry, which the
    // verdict contract reads as "no verdict reported": no mark, not a
    // false clean check.
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="inspector-ai-action-verdict-skill:skill-optimizer"]',
      ),
    ).toBeNull();
  });

  it('each ALL button queues ONLY its own type', async () => {
    const { fixture, dataSource, node } = await bootAiActions({
      probs: makeProbExtensions({
        finders: [makeProbEntry({ fixerIds: ['core/todo-fixer'], hasOpenFindings: false })],
        standalone: [makeProbEntry({ id: 'core/summarizer', description: 'Summarizes the node.' })],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    const allFinders = dom.querySelector(
      '[data-testid="inspector-ai-action-launch-all-finders"] button',
    ) as HTMLButtonElement;
    allFinders.click();
    await flush(fixture);
    expect(dataSource.submitNodeJob).toHaveBeenCalledWith(node.path, 'core/todo-finder', false);
    expect(dataSource.submitNodeJob).toHaveBeenCalledTimes(1);

    const allStandalone = dom.querySelector(
      '[data-testid="inspector-ai-action-launch-all-standalone"] button',
    ) as HTMLButtonElement;
    allStandalone.click();
    await flush(fixture);
    expect(dataSource.submitNodeJob).toHaveBeenCalledWith(node.path, 'core/summarizer', false);
    expect(dataSource.submitNodeJob).toHaveBeenCalledTimes(2);
  });

  it('a finder with open findings sits DISABLED (no more Detect => Fix morph)', async () => {
    // No open findings: the button submits the FINDER on click.
    const detect = await bootAiActions({
      probs: makeProbExtensions({
        finders: [makeProbEntry({ fixerIds: ['core/todo-fixer'], hasOpenFindings: false })],
      }),
    });
    const detectBtn = detect.fixture.nativeElement.querySelector(
      '[data-testid="inspector-ai-action-launch-core/todo-finder"]',
    ) as HTMLElement;
    expect(detectBtn.textContent).toContain('todo-finder');
    expect(detectBtn.getAttribute('data-action')).toBe('detect');
    (detectBtn.querySelector('button') as HTMLButtonElement).click();
    await flush(detect.fixture);
    expect(detect.dataSource.submitNodeJob).toHaveBeenCalledWith(
      detect.node.path,
      'core/todo-finder',
      false,
    );

    // Open findings: the button DISABLES (re-running is pointless; the
    // fix lives on each finding row, user call 2026-07-20).
    const open = await bootAiActions({
      probs: makeProbExtensions({
        finders: [
          makeProbEntry({
            fixerIds: ['core/todo-fixer', 'core/todo-fixer-2'],
            hasOpenFindings: true,
          }),
        ],
      }),
    });
    const openBtn = open.fixture.nativeElement.querySelector(
      '[data-testid="inspector-ai-action-launch-core/todo-finder"] button',
    ) as HTMLButtonElement;
    expect(openBtn.disabled).toBe(true);
    openBtn.click();
    await flush(open.fixture);
    expect(open.dataSource.submitNodeJob).not.toHaveBeenCalled();
  });

  it('the per-finding wrench queues the fixer(s); rows without a fixer render none', async () => {
    const { fixture, dataSource, node } = await bootAiActions({
      findings: makeFindingsEnvelope([
        makeFinding(),
        makeFinding({ id: 30, extensionId: 'core/orphan-finder' }),
      ]),
      probs: makeProbExtensions({
        finders: [
          makeProbEntry({
            fixerIds: ['core/todo-fixer', 'core/todo-fixer-2'],
            hasOpenFindings: true,
          }),
        ],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    // The finding of an unknown finder (no catalog entry) has no wrench.
    expect(dom.querySelector('[data-testid="inspector-finding-fix-30"]')).toBeNull();

    (
      dom.querySelector('[data-testid="inspector-finding-fix-12"] button') as HTMLButtonElement
    ).click();
    await flush(fixture);
    // Chains all fixers, autoFix false, TARGETING ONLY THIS ROW's
    // finding (user decision 2026-07-22: per-finding fix jobs), and
    // never submits the finder itself.
    expect(dataSource.submitNodeJob).toHaveBeenCalledWith(node.path, 'core/todo-fixer', false, [12]);
    expect(dataSource.submitNodeJob).toHaveBeenCalledWith(node.path, 'core/todo-fixer-2', false, [12]);
    expect(dataSource.submitNodeJob).not.toHaveBeenCalledWith(
      node.path,
      'core/todo-finder',
      expect.anything(),
    );
    // No flicker (user report 2026-07-22): the submit round-trip ended
    // but the refetched entry does not yet report the fixer job; the
    // optimistic overlay keeps THIS row's bolt disabled until a payload
    // confirms, while the sibling row stays free.
    expect(
      (dom.querySelector('[data-testid="inspector-finding-fix-12"] button') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('deterministic issue rows: the sparkles queues the issue fixer; unmatched rows render none', async () => {
    // Issue-fixer placement (user decision 2026-07-22): the fix
    // affordance of a deterministic-analyzer fixer rides the ISSUE row
    // it resolves, matched by the entry's SHORT analyzerIds; an issue
    // no enabled fixer covers renders no button, and the fixer never
    // appears in the launcher rows.
    const { fixture, dataSource, node } = await bootAiActions({
      issues: [makeIssue(), makeIssue({ analyzerId: 'name-collision', severity: 'warn' })],
      probs: makeProbExtensions({ issueFixers: [makeIssueFixer()] }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    const fixBtn = dom.querySelector(
      '[data-testid="inspector-issue-fix-reference-broken"] button',
    ) as HTMLButtonElement;
    expect(fixBtn).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-issue-fix-name-collision"]')).toBeNull();
    // The fixer is NOT a launcher button (it left the standalone row).
    expect(
      dom.querySelector('[data-testid="inspector-ai-action-launch-core/ai-reference-action"]'),
    ).toBeNull();

    fixBtn.click();
    await flush(fixture);
    expect(dataSource.submitNodeJob).toHaveBeenCalledWith(
      node.path,
      'core/ai-reference-action',
      false,
    );
    // Optimistic queued flip: the button disables until a payload confirms.
    expect(
      (
        dom.querySelector(
          '[data-testid="inspector-issue-fix-reference-broken"] button',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('observed-link-missing rows group under the "Observed in sessions" sub-header', async () => {
    // Design-vs-reality grouping (spec/provider-activity.md, Session
    // journal): the analyzer's rows render apart from the design-defect
    // issues, under their own muted sub-header, with the SAME row
    // anatomy (the shared ng-template), so they read as reality
    // commenting on the design, never as code defects.
    const { fixture } = await bootAiActions({
      issues: [
        makeIssue(),
        makeIssue({
          analyzerId: 'observed-link-missing',
          severity: 'info',
          message: 'Observed 3 invocations across 2 sessions; no declared link connects this node to the target.',
          data: { target: 'mcp://notion' },
        }),
      ],
    });
    const dom: HTMLElement = fixture.nativeElement;
    const header = dom.querySelector('[data-testid="inspector-observed-sessions-header"]');
    expect(header).not.toBeNull();
    expect(header!.textContent).toContain('Observed in sessions');
    const observedList = dom.querySelector(
      '[data-testid="inspector-observed-sessions-list"]',
    ) as HTMLElement;
    expect(observedList.querySelectorAll('[data-testid="inspector-finding"]').length).toBe(1);
    // Both lists render the shared row anatomy; the design row stays out
    // of the observed group and vice versa.
    expect(dom.querySelectorAll('[data-testid="inspector-finding"]').length).toBe(2);
    expect(observedList.textContent).toContain('observed-link-missing');
    expect(observedList.textContent).not.toContain('reference-broken');
  });

  it('the observed-sessions sub-header hides when no observed rows exist', async () => {
    const { fixture } = await bootAiActions({ issues: [makeIssue()] });
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-observed-sessions-header"]'),
    ).toBeNull();
  });

  it('an active issue-fixer job renders the row sparkles busy', async () => {
    const { fixture } = await bootAiActions({
      issues: [makeIssue()],
      probs: makeProbExtensions({
        issueFixers: [makeIssueFixer({ state: 'running', jobId: 'job-9' })],
      }),
    });
    const btn = fixture.nativeElement.querySelector(
      '[data-testid="inspector-issue-fix-reference-broken"] button',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('the issue dismiss X sends the (analyzer, value) key verbatim and prunes the row', async () => {
    // Per-issue dismiss (2026-07-27): keyed by the row's SHORT
    // analyzerId + its verbatim data.target; a row without a target has
    // no dismiss key, so it renders no X at all.
    const { fixture, dataSource, node } = await bootAiActions({
      issues: [
        makeIssue({ data: { target: '@ApiSecurity' } }),
        makeIssue({ analyzerId: 'name-collision', severity: 'warn' }),
      ],
    });
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelectorAll('[data-testid="inspector-finding"]').length).toBe(2);
    expect(dom.querySelector('[data-testid="inspector-issue-dismiss-name-collision"]')).toBeNull();
    (
      dom.querySelector(
        '[data-testid="inspector-issue-dismiss-reference-broken"] button',
      ) as HTMLButtonElement
    ).click();
    await flush(fixture);
    // Verbatim key halves, no consent flags on the first attempt.
    expect(dataSource.dismissIssue).toHaveBeenCalledWith(
      node.path,
      'reference-broken',
      '@ApiSecurity',
      {},
    );
    // The server deleted the matching rows; the local list pruned in
    // place (no refetch), so only the sibling row survives.
    expect(dom.querySelectorAll('[data-testid="inspector-finding"]').length).toBe(1);
    expect(
      dom.querySelector('[data-testid="inspector-issue-dismiss-reference-broken"]'),
    ).toBeNull();
  });

  it('a consent gate parks the issue dismiss behind the shared dialog and retries with the grant', async () => {
    // The dismissal is a `.sm` sidecar write: the first write in a
    // project without a standing grant answers 412 confirm-required
    // (details.key = allowEditSmFiles), which parks the retry behind the
    // SAME consent dialog the findings restore / delete flows use.
    const { fixture, dataSource, node } = await bootAiActions({
      issues: [makeIssue({ data: { target: 'docs/missing.md' } })],
    });
    dataSource.dismissIssue.mockRejectedValueOnce(
      new DataSourceError('confirm-required', 'Confirm .sm writes first.', {
        key: 'allowEditSmFiles',
      }),
    );
    (
      fixture.nativeElement.querySelector(
        '[data-testid="inspector-issue-dismiss-reference-broken"] button',
      ) as HTMLButtonElement
    ).click();
    await flush(fixture);
    const dispatcher = TestBed.inject(ActionDispatchService);
    expect(dispatcher.consentOpen()).toBe(true);
    // Accepting re-runs the dismiss with the granted flags.
    dispatcher.resolveConsent({ accepted: true, always: false });
    await flush(fixture);
    expect(dataSource.dismissIssue).toHaveBeenLastCalledWith(
      node.path,
      'reference-broken',
      'docs/missing.md',
      { confirm: true },
    );
  });

  it('the header summarize ? queues the summarizer; the summarizer never rides the launcher row', async () => {
    const { fixture, dataSource, node } = await bootAiActions({
      // The affordance is claimed via the surface CONTRIBUTION (no id
      // literals in the UI, kernel-agnosticism sweep 2026-07-23); the
      // catalog entry supplies the live queue state.
      contributions: [makeSurfaceClaim('inspector.surface.summary', 'core/ai-summarizer-action')],
      probs: makeProbExtensions({
        standalone: [
          makeProbEntry({ id: 'core/ai-summarizer-action', description: 'Summarizes.' }),
          makeProbEntry({ id: 'core/other-action', description: 'Other.' }),
        ],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    // Excluded from the launchers (it owns the header affordance)...
    expect(
      dom.querySelector('[data-testid="inspector-ai-action-launch-core/ai-summarizer-action"]'),
    ).toBeNull();
    expect(
      dom.querySelector('[data-testid="inspector-ai-action-launch-core/other-action"]'),
    ).not.toBeNull();
    // ...and the header shows the idle ?-with-magic button.
    const btn = dom.querySelector('[data-testid="inspector-summarize"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('data-state')).toBe('idle');
    btn.click();
    await flush(fixture);
    expect(dataSource.submitNodeJob).toHaveBeenCalledWith(
      node.path,
      'core/ai-summarizer-action',
      false,
    );
  });

  it('the tag-row sparkles queues the auto-tagger; the tagger never rides the launcher row', async () => {
    const { fixture, dataSource, node } = await bootAiActions({
      contributions: [
        // The tag ROW mounts off the tags-surface claim; the sparkles
        // rides it via the auto-tag claim.
        makeSurfaceClaim('inspector.surface.tags', 'core/node-set-tags'),
        makeSurfaceClaim('inspector.surface.auto-tag', 'core/ai-tagger-action'),
      ],
      probs: makeProbExtensions({
        standalone: [
          makeProbEntry({ id: 'core/ai-tagger-action', description: 'Tags.' }),
          makeProbEntry({ id: 'core/other-action', description: 'Other.' }),
        ],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    // Excluded from the launchers (it owns the tag-row affordance)...
    expect(
      dom.querySelector('[data-testid="inspector-ai-action-launch-core/ai-tagger-action"]'),
    ).toBeNull();
    expect(
      dom.querySelector('[data-testid="inspector-ai-action-launch-core/other-action"]'),
    ).not.toBeNull();
    // ...and the tag row shows the idle sparkles button.
    const btn = dom.querySelector('[data-testid="node-tags-auto"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('data-state')).toBe('idle');
    btn.click();
    await flush(fixture);
    expect(dataSource.submitNodeJob).toHaveBeenCalledWith(
      node.path,
      'core/ai-tagger-action',
      false,
    );
  });

  it('without the tagger extension the tag row shows no sparkles button', async () => {
    const { fixture } = await bootAiActions({
      probs: makeProbExtensions({
        standalone: [makeProbEntry({ id: 'core/other-action', description: 'Other.' })],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="node-tags-auto"]')).toBeNull();
  });

  // -------------------------------------------------------------------
  // Auto-tag proposal (user report 2026-07-25, reframed 2026-07-25 with
  // the tagger's redesign, simplified the same day). The tagger WRITES
  // NOTHING: it proposes tags on `job.completed` (`tagsProposed`) and the
  // operator saves the ones they want. Launched from the inspector and
  // recorded over MCP, the CLI output reaches nobody, so without this the
  // operator saw a completed job that changed nothing ("no está poniendo
  // tags, sin embargo veo que se ejecuta").
  //
  // The proposal has NO surface of its own: it manifests as the ORDINARY
  // tags editor opening pre-filled and unsaved, where saving raises the
  // usual `.sm` handshake. No path applies a tag on the operator's behalf.
  // -------------------------------------------------------------------

  it('opens the tag editor pre-filled when a completion carries tagsProposed', async () => {
    const { fixture, dataSource, jobEvents$ } = await bootAiActions();
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="node-tags-editor"]')).toBeNull();

    jobEvents$.next(makeJobCompleted({ tagsProposed: ['deploy-pipeline'] }));
    await flush(fixture);

    expect(dom.querySelector('[data-testid="node-tags-editor"]')).not.toBeNull();
    // Opening is not applying: the write still waits for Save.
    expect(dataSource.dispatchAction).not.toHaveBeenCalled();
  });

  it('stays silent on a plain job.completed (no tagger proposal field)', async () => {
    const { fixture, jobEvents$ } = await bootAiActions();
    const dom: HTMLElement = fixture.nativeElement;

    jobEvents$.next(makeJobCompleted());
    await flush(fixture);

    expect(dom.querySelector('[data-testid="node-tags-editor"]')).toBeNull();
  });

  // Path-keyed proposal (2026-07-26): the completion's `nodeId` scopes
  // the offer, so a run that finishes while the operator inspects a
  // DIFFERENT node neither opens the editor there nor mis-attributes
  // the tags; the offer waits for its node.
  it('a proposal for another node opens nothing on the inspected one', async () => {
    const { fixture, jobEvents$ } = await bootAiActions();
    const dom: HTMLElement = fixture.nativeElement;
    const host = fixture.componentInstance as unknown as {
      autoTagProposedTags(): readonly string[];
    };

    jobEvents$.next(makeJobCompleted({ tagsProposed: ['ci'], nodeId: 'other/file.md' }));
    await flush(fixture);

    expect(dom.querySelector('[data-testid="node-tags-editor"]')).toBeNull();
    expect(host.autoTagProposedTags()).toEqual([]);
  });

  it('a proposal explicitly carrying the inspected node id opens the editor', async () => {
    const { fixture, node, jobEvents$ } = await bootAiActions();
    const dom: HTMLElement = fixture.nativeElement;

    jobEvents$.next(makeJobCompleted({ tagsProposed: ['ci'], nodeId: node.path }));
    await flush(fixture);

    expect(dom.querySelector('[data-testid="node-tags-editor"]')).not.toBeNull();
  });

  // The record path omits the field entirely when the report carried no
  // usable tags, so an EXPLICIT empty array is the forward-compat case:
  // an emitter that says "this tagger proposed nothing" opens nothing.
  // An absent field still means "not a tagger" and is covered above.
  it('an explicit empty tagsProposed opens nothing and never reopens a closed editor', async () => {
    const { fixture, jobEvents$ } = await bootAiActions();
    const dom: HTMLElement = fixture.nativeElement;

    jobEvents$.next(makeJobCompleted({ tagsProposed: [] }));
    await flush(fixture);
    expect(dom.querySelector('[data-testid="node-tags-editor"]')).toBeNull();

    jobEvents$.next(makeJobCompleted({ tagsProposed: ['ci'] }));
    await flush(fixture);
    (dom.querySelector('[data-testid="node-tags-cancel"] button') as HTMLButtonElement).click();
    await flush(fixture);
    expect(dom.querySelector('[data-testid="node-tags-editor"]')).toBeNull();

    jobEvents$.next(makeJobCompleted({ tagsProposed: [] }));
    await flush(fixture);

    expect(dom.querySelector('[data-testid="node-tags-editor"]')).toBeNull();
  });

  it('saving the pre-filled editor dispatches the tags and leaves edit mode', async () => {
    const { fixture, dataSource, node, jobEvents$ } = await bootAiActions();
    const dom: HTMLElement = fixture.nativeElement;
    jobEvents$.next(makeJobCompleted({ tagsProposed: ['ci', 'infra'] }));
    await flush(fixture);
    expect(dom.querySelector('[data-testid="node-tags-editor"]')).not.toBeNull();

    // Save: the ordinary deterministic dispatch (its 412 would open the
    // shared consent dialog; the stub answers 200 here).
    (
      dom.querySelector('[data-testid="node-tags-save"] button') as HTMLButtonElement
    ).click();
    // Twice: the dispatch resolves through the service's own await chain,
    // so the row only reports `tagsSaved` a couple of microtasks later.
    await flush(fixture);
    await flush(fixture);

    expect(dataSource.dispatchAction).toHaveBeenCalledWith('core/node-set-tags', node.path, {
      input: { tags: ['ci', 'infra'] },
    });
    expect(dom.querySelector('[data-testid="node-tags-editor"]')).toBeNull();
  });

  // Submitting a new run makes the previous proposal stale, so the click
  // retires it. That is also what re-arms the row's once-per-proposal
  // guard: without it, a second run inferring the very same tags the
  // operator just dismissed would read as an already-consumed proposal
  // and open nothing.
  it('queueing another run retires the pending proposal', async () => {
    const { fixture, jobEvents$ } = await bootAiActions({
      contributions: [
        makeSurfaceClaim('inspector.surface.tags', 'core/node-set-tags'),
        makeSurfaceClaim('inspector.surface.auto-tag', 'core/ai-tagger-action'),
      ],
      probs: makeProbExtensions({
        standalone: [makeProbEntry({ id: 'core/ai-tagger-action', description: 'Tags.' })],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    const host = fixture.componentInstance as unknown as {
      autoTagProposedTags(): readonly string[];
    };

    jobEvents$.next(makeJobCompleted({ tagsProposed: ['ci'] }));
    await flush(fixture);
    (dom.querySelector('[data-testid="node-tags-cancel"] button') as HTMLButtonElement).click();
    await flush(fixture);
    expect(host.autoTagProposedTags()).toEqual(['ci']);

    (dom.querySelector('[data-testid="node-tags-auto"]') as HTMLButtonElement).click();
    await flush(fixture);
    expect(host.autoTagProposedTags()).toEqual([]);

    // Same tags as before, and the editor opens again.
    jobEvents$.next(makeJobCompleted({ tagsProposed: ['ci'] }));
    await flush(fixture);

    expect(dom.querySelector('[data-testid="node-tags-editor"]')).not.toBeNull();
  });

  // The proposal is scoped to the node that was open when the frame
  // landed, so inspecting another one drops it: the editor closes with
  // the node change and the retired proposal cannot reopen it over the
  // newly selected file.
  it('clears the proposal when the operator inspects another node', async () => {
    const first = makeNode();
    const second = makeNode({ path: 'agents/reviewer.md' });
    const loader = makeStubLoader([first, second]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture, cmp, jobEvents$ } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', first.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    const host = cmp as unknown as { autoTagProposedTags(): readonly string[] };

    jobEvents$.next(makeJobCompleted({ tagsProposed: ['ci'] }));
    await flush(fixture);
    expect(host.autoTagProposedTags()).toEqual(['ci']);
    expect(dom.querySelector('[data-testid="node-tags-editor"]')).not.toBeNull();

    fixture.componentRef.setInput('path', second.path);
    await flush(fixture);

    expect(host.autoTagProposedTags()).toEqual([]);
    expect(dom.querySelector('[data-testid="node-tags-editor"]')).toBeNull();
  });

  it('with a stored summary the header button is ready and toggles the analysis block', async () => {
    const { fixture } = await bootAiActions({
      contributions: [makeSurfaceClaim('inspector.surface.summary', 'core/ai-summarizer-action')],
      probs: makeProbExtensions({
        standalone: [makeProbEntry({ id: 'core/ai-summarizer-action', description: 'S.' })],
      }),
      summaries: [
        {
          summarizerActionId: 'core/ai-summarizer-action',
          generatedAt: 1000,
          stale: false,
          report: {
            whatItCovers: 'Deploys the service to production.',
            topics: ['deploy', 'ops'],
            keyFacts: ['Runs on push to main.'],
            qualityNotes: ['The rollback step is undocumented.'],
          },
        },
      ],
    });
    const dom: HTMLElement = fixture.nativeElement;
    const btn = dom.querySelector('[data-testid="inspector-summarize"]') as HTMLButtonElement;
    expect(btn.getAttribute('data-state')).toBe('ready');
    // A summarized node opens with its analysis VISIBLE (user call
    // 2026-07-21); the button collapses / re-expands it.
    const block = dom.querySelector('[data-testid="inspector-summary"]');
    expect(block).not.toBeNull();
    expect(block!.textContent).toContain('Deploys the service to production.');
    // Topics and related files are deliberately NOT rendered (user call
    // 2026-07-21); facts and quality notes are.
    expect(block!.textContent).toContain('Runs on push to main.');
    expect(block!.textContent).toContain('The rollback step is undocumented.');
    btn.click();
    await flush(fixture);
    expect(dom.querySelector('[data-testid="inspector-summary"]')).toBeNull();
  });

  it('the summary delete X removes the analysis and the header falls back to idle', async () => {
    const { fixture, dataSource, node } = await bootAiActions({
      contributions: [makeSurfaceClaim('inspector.surface.summary', 'core/ai-summarizer-action')],
      probs: makeProbExtensions({
        standalone: [makeProbEntry({ id: 'core/ai-summarizer-action', description: 'S.' })],
      }),
      summaries: [
        {
          summarizerActionId: 'core/ai-summarizer-action',
          generatedAt: 1000,
          stale: false,
          report: { whatItCovers: 'Covers deploys.' },
        },
      ],
    });
    const dom: HTMLElement = fixture.nativeElement;
    // Auto-expanded on load; after the delete the refetch returns empty.
    expect(dom.querySelector('[data-testid="inspector-summary"]')).not.toBeNull();
    dataSource.getNodeSummary.mockResolvedValue([]);
    (
      dom.querySelector('[data-testid="inspector-summary-delete"]') as HTMLButtonElement
    ).click();
    await flush(fixture);
    await flush(fixture);
    expect(dataSource.deleteNodeSummary).toHaveBeenCalledWith(
      node.path,
      'core/ai-summarizer-action',
    );
    expect(dom.querySelector('[data-testid="inspector-summary"]')).toBeNull();
    // Back to the idle invitation state.
    expect(
      dom.querySelector('[data-testid="inspector-summarize"]')!.getAttribute('data-state'),
    ).toBe('idle');
  });

  it('a human-decision row shows the needs-decision mark and NO fix button', async () => {
    // The fixer left this one to the author (resolution = human-decision):
    // the submit gate refuses to re-inject it, so the bolt must not
    // render; mark-fixed + dismiss remain as the two valid exits.
    const { fixture } = await bootAiActions({
      findings: makeFindingsEnvelope([
        makeFinding({ resolution: 'human-decision', resolutionActor: 'fixer' }),
      ]),
      probs: makeProbExtensions({
        finders: [makeProbEntry({ fixerIds: ['core/todo-fixer'], hasOpenFindings: true })],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-finding-fix-12"]')).toBeNull();
    const mark = dom.querySelector('[data-testid="inspector-finding-decision-12"]');
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toContain('needs decision');
    expect(dom.querySelector('[data-testid="inspector-finding-resolve-12"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-finding-dismiss-12"]')).not.toBeNull();
  });

  it('a subset fixer job disables ONLY its row; the sibling stays clickable', async () => {
    // Per-finding fix (user decision 2026-07-22): the entry reports an
    // active fixer job frozen to finding 12; row 30 (same finder) must
    // stay fully actionable.
    const { fixture } = await bootAiActions({
      findings: makeFindingsEnvelope([makeFinding(), makeFinding({ id: 30 })]),
      probs: makeProbExtensions({
        finders: [
          makeProbEntry({
            fixerIds: ['core/todo-fixer'],
            hasOpenFindings: true,
            state: 'queued',
            jobId: 'job-9',
            fixerBusy: { all: false, findingIds: [12] },
          }),
        ],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    const busyBtn = dom.querySelector(
      '[data-testid="inspector-finding-fix-12"] button',
    ) as HTMLButtonElement;
    const freeBtn = dom.querySelector(
      '[data-testid="inspector-finding-fix-30"] button',
    ) as HTMLButtonElement;
    expect(busyBtn.disabled).toBe(true);
    expect(freeBtn.disabled).toBe(false);
  });

  it('an active fix disables the row: wrench, resolve and dismiss all sit disabled', async () => {
    // The finder entry reports a RUNNING job (the fixer union lights it),
    // so the whole row must lock: acting on a finding mid-fix contradicts
    // the fixer already working on it.
    const { fixture } = await bootAiActions({
      findings: makeFindingsEnvelope([makeFinding()]),
      probs: makeProbExtensions({
        finders: [
          makeProbEntry({
            fixerIds: ['core/todo-fixer'],
            hasOpenFindings: true,
            state: 'running',
            jobId: 'job-9',
          }),
        ],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    for (const action of ['fix', 'resolve', 'dismiss']) {
      const btn = dom.querySelector(
        `[data-testid="inspector-finding-${action}-12"] button`,
      ) as HTMLButtonElement;
      expect(btn, action).not.toBeNull();
      expect(btn.disabled, action).toBe(true);
    }
  });

  it('renders finding rows with severity, type, message, provenance, and the dimmed id', async () => {
    const { fixture } = await bootAiActions({
      findings: makeFindingsEnvelope([
        makeFinding(),
        makeFinding({ id: 13, severity: 'error', type: 'secret-leak', model: null, confidence: 0.5 }),
      ]),
    });
    const dom: HTMLElement = fixture.nativeElement;
    const rows = dom.querySelectorAll('[data-testid^="inspector-ai-action-1"]');
    const first = dom.querySelector('[data-testid="inspector-ai-action-12"]');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(first).not.toBeNull();
    expect(first!.getAttribute('data-severity')).toBe('warn');
    expect(first!.textContent).toContain('stale-todo');
    expect(first!.textContent).toContain('The TODO at line 4 looks abandoned.');
    expect(first!.textContent).toContain('#12');
    // Provenance: the confidence percent alone (the model was dropped
    // from the row, user call 2026-07-20; the terminal still shows it).
    expect(
      dom.querySelector('[data-testid="inspector-ai-action-provenance-12"]')!.textContent,
    ).toBe('(87%)');
    expect(
      dom.querySelector('[data-testid="inspector-ai-action-provenance-13"]')!.textContent,
    ).toBe('(50%)');
    // Findings without launchers still show the card; no empty state.
    expect(dom.querySelector('[data-testid="inspector-ai-actions-empty"]')).toBeNull();
  });

  it('orders finding rows by severity, then by confidence descending inside each tier', async () => {
    const { fixture } = await bootAiActions({
      findings: makeFindingsEnvelope([
        makeFinding({ id: 1, severity: 'warn', confidence: 0.4 }),
        makeFinding({ id: 2, severity: 'error', confidence: 0.6 }),
        makeFinding({ id: 3, severity: 'warn', confidence: 0.9 }),
        makeFinding({ id: 4, severity: 'error', confidence: 0.95 }),
        makeFinding({ id: 5, severity: 'info', confidence: 0.2 }),
      ]),
    });
    const dom: HTMLElement = fixture.nativeElement;
    const ids = [...dom.querySelectorAll('[data-testid^="inspector-ai-action-"]')]
      .map((el) => el.getAttribute('data-testid') ?? '')
      .filter((id) => /^inspector-ai-action-\d+$/.test(id))
      .map((id) => Number(id.replace('inspector-ai-action-', '')));
    expect(ids).toEqual([4, 2, 3, 1, 5]);
  });

  it('a stale row rides the DEFAULT tray inline with the stale mark (no stale bucket)', async () => {
    const { fixture } = await bootAiActions({
      findings: makeFindingsEnvelope([
        makeFinding(),
        makeFinding({ id: 21, stale: true }),
      ]),
    });
    const dom: HTMLElement = fixture.nativeElement;
    // Both rows render; only the stale one carries the mark.
    expect(dom.querySelector('[data-testid="inspector-ai-action-21"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-finding-stale-21"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-finding-stale-12"]')).toBeNull();
    // And there is no stale reveal chip anymore.
    expect(dom.querySelector('[data-testid="inspector-ai-hidden-stale"]')).toBeNull();
  });

  it('a kernel-origin row carries the kernel mark; an extension-origin row does not', async () => {
    // The safety lane synthesizes these from the report's `safety` block
    // and stamps them with the RUN that surfaced them, so row 22 says
    // `core/todo-finder` while the judgment is the kernel's. Without the
    // mark the operator reads it as the finder's own verdict.
    const { fixture } = await bootAiActions({
      findings: makeFindingsEnvelope([
        makeFinding(),
        makeFinding({ id: 22, origin: 'kernel', type: 'injection-detected', severity: 'error' }),
      ]),
    });
    const dom: HTMLElement = fixture.nativeElement;
    const mark = dom.querySelector('[data-testid="inspector-finding-kernel-22"]');
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toContain('kernel');
    expect(dom.querySelector('[data-testid="inspector-finding-kernel-12"]')).toBeNull();
  });

  it('renders no honesty line (the run history lives in Activity, user call 2026-07-17)', async () => {
    const { fixture } = await bootAiActions({
      findings: makeFindingsEnvelope([], { total: 3, fixedExcluded: 2, dismissedExcluded: 1 }),
      probs: makeProbExtensions({ finders: [makeProbEntry()] }),
    });
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-ai-actions-hidden"]'),
    ).toBeNull();
  });

  it('keeps the FINDINGS card up on hidden-only counts: the reveal chips are its content', async () => {
    // The reveal / restore surface rides the Findings card since the
    // rows moved there (user call 2026-07-22); hiding it would strand an
    // all-dismissed node with no way back from the UI. The AI actions
    // card gates on launchers alone, so with none composed it hides.
    const { fixture } = await bootAiActions({
      findings: makeFindingsEnvelope([], { total: 1, fixedExcluded: 1 }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-findings"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-card-ai-actions"]')).toBeNull();
    const chip = dom.querySelector('[data-testid="inspector-ai-hidden-fixed"]');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain('1 fixed');
  });

  it('submits the extension on click and flips the button to queued optimistically', async () => {
    const { fixture, dataSource, node } = await bootAiActions({
      probs: makeProbExtensions({ finders: [makeProbEntry()] }),
    });
    const host = fixture.nativeElement.querySelector(
      '[data-testid="inspector-ai-action-launch-core/todo-finder"]',
    ) as HTMLElement;
    (host.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);

    expect(dataSource.submitNodeJob).toHaveBeenCalledWith(node.path, 'core/todo-finder', false);
    expect(host.getAttribute('data-state')).toBe('queued');
    expect((host.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-ai-actions-error"]'),
    ).toBeNull();
  });

  it('treats a duplicate-job refusal as already queued (no error banner)', async () => {
    const { fixture, dataSource } = await bootAiActions({
      probs: makeProbExtensions({ finders: [makeProbEntry()] }),
    });
    dataSource.submitNodeJob.mockRejectedValue(
      new DataSourceError('duplicate-job', 'An identical job is already active.', {
        existingId: 'job-9',
      }),
    );
    const host = fixture.nativeElement.querySelector(
      '[data-testid="inspector-ai-action-launch-core/todo-finder"]',
    ) as HTMLElement;
    (host.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);

    expect(host.getAttribute('data-state')).toBe('queued');
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-ai-actions-error"]'),
    ).toBeNull();
  });

  it('no-processing-agent: friendly UI message plus the Settings + skill-invocation hint', async () => {
    const { fixture, dataSource } = await bootAiActions({
      probs: makeProbExtensions({ finders: [makeProbEntry()] }),
    });
    dataSource.submitNodeJob.mockRejectedValue(
      new DataSourceError(
        'no-processing-agent',
        'No processing agent skill is installed for this project.',
      ),
    );
    const host = fixture.nativeElement.querySelector(
      '[data-testid="inspector-ai-action-launch-core/todo-finder"]',
    ) as HTMLElement;
    (host.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    const error = dom.querySelector('[data-testid="inspector-ai-actions-error"]');
    expect(error).not.toBeNull();
    // The strip swaps the CLI-worded envelope message for the UI's own
    // wording (user call 2026-07-22); the hint names the Settings path
    // first, the CLI verb as the alternate.
    expect(error!.textContent).toContain('no agent is set up to process jobs');
    expect(error!.textContent).not.toContain('No processing agent skill is installed');
    const hint = dom.querySelector('[data-testid="inspector-ai-actions-agent-hint"]');
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toContain('Settings');
    expect(hint!.textContent).toContain('/sm-process-jobs');
    // The refusal never flips the button: it stays idle and clickable.
    expect(host.getAttribute('data-state')).toBe('idle');
  });

  it('shows the envelope message for other error codes without the agent hint', async () => {
    const { fixture, dataSource } = await bootAiActions({
      probs: makeProbExtensions({ finders: [makeProbEntry()] }),
    });
    dataSource.submitNodeJob.mockRejectedValue(
      new DataSourceError('node-drifted', 'The node drifted; run sm scan first.'),
    );
    const host = fixture.nativeElement.querySelector(
      '[data-testid="inspector-ai-action-launch-core/todo-finder"]',
    ) as HTMLElement;
    (host.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    expect(
      dom.querySelector('[data-testid="inspector-ai-actions-error"]')!.textContent,
    ).toContain('The node drifted; run sm scan first.');
    expect(dom.querySelector('[data-testid="inspector-ai-actions-agent-hint"]')).toBeNull();
    // Dismiss clears the banner.
    (
      dom.querySelector(
        '[data-testid="inspector-ai-actions-error-dismiss"]',
      ) as HTMLButtonElement
    ).click();
    await flush(fixture);
    expect(dom.querySelector('[data-testid="inspector-ai-actions-error"]')).toBeNull();
  });

  /**
   * Processing-agent gate (the submit gate): with no agent set up to
   * drain the queue for the active lens, EVERY control that would
   * enqueue a job sits disabled (visible, tooltips untouched) while the
   * non-submitting ones keep working. `null` (probe failed) FAILS OPEN.
   */
  function gateFixture(agentSkill: IAiActionsBoot['agentSkill']): Promise<{
    fixture: ComponentFixture<InspectorView>;
    dataSource: IStubDataSource;
    node: INodeView;
    jobEvents$: Subject<IWsEvent>;
  }> {
    return bootAiActions({
      agentSkill,
      issues: [makeIssue()],
      findings: makeFindingsEnvelope([makeFinding()]),
      probs: makeProbExtensions({
        finders: [makeProbEntry({ fixerIds: ['core/todo-fixer'] })],
        standalone: [makeProbEntry({ id: 'core/summarizer' })],
        issueFixers: [makeIssueFixer()],
        skills: [makeSkillEntry()],
      }),
    });
  }

  function gateButton(
    fixture: ComponentFixture<InspectorView>,
    testid: string,
  ): HTMLButtonElement {
    return (fixture.nativeElement as HTMLElement).querySelector(
      `[data-testid="${testid}"] button`,
    ) as HTMLButtonElement;
  }

  /** Every submitting control of the section, by test id. */
  const SUBMITTING_CONTROLS = [
    'inspector-ai-action-launch-core/todo-finder',
    'inspector-ai-action-launch-core/summarizer',
    'inspector-ai-action-launch-skill:skill-optimizer',
    'inspector-ai-action-launch-all-finders',
    'inspector-ai-action-launch-all-standalone',
    'inspector-ai-action-launch-all-skills',
    'inspector-finding-fix-12',
    'inspector-issue-fix-reference-broken',
  ];

  it('gate CLOSED: every submitting control is disabled, the rest stay live', async () => {
    const { fixture } = await gateFixture('missing');
    for (const testid of SUBMITTING_CONTROLS) {
      expect(gateButton(fixture, testid).disabled, testid).toBe(true);
    }
    // Non-submitting row actions are local decisions, never gated.
    expect(gateButton(fixture, 'inspector-finding-resolve-12').disabled).toBe(false);
    expect(gateButton(fixture, 'inspector-finding-dismiss-12').disabled).toBe(false);
  });

  it('gate OPEN (skill installed): every submitting control is enabled', async () => {
    const { fixture } = await gateFixture('installed');
    for (const testid of SUBMITTING_CONTROLS) {
      expect(gateButton(fixture, testid).disabled, testid).toBe(false);
    }
  });

  /**
   * The agent-silent half: the skill IS installed, but a manual
   * full-circuit check ran and no agent answered, so a submit would sit
   * in the queue with nobody to drain it. Same closure as a missing
   * skill. (The MCP session count plays no part here, user decision
   * 2026-07-28: a CLI-draining agent holds no session.)
   */
  it('gate CLOSED by a silent agent (red check): every submitting control is disabled', async () => {
    const { fixture } = await gateFixture('installed');
    TestBed.inject(ProcessingAgentReadinessService).noteAgentAlive(false);
    await flush(fixture);
    for (const testid of SUBMITTING_CONTROLS) {
      expect(gateButton(fixture, testid).disabled, testid).toBe(true);
    }
    expect(gateButton(fixture, 'inspector-finding-resolve-12').disabled).toBe(false);
  });

  /**
   * The Auto-fixer switch only decides what the NEXT finder click
   * submits, so with nothing able to drain the queue it has no reachable
   * effect and rides the same gate (user call 2026-07-25).
   */
  it('gate CLOSED: the Auto-fixer switch is disabled too, and enabled again when open', async () => {
    const autoFixInput = (fixture: ComponentFixture<InspectorView>): HTMLInputElement =>
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="inspector-auto-fix-toggle"] input',
      ) as HTMLInputElement;

    const missing = await gateFixture('missing');
    expect(autoFixInput(missing.fixture).disabled).toBe(true);

    const silent = await gateFixture('installed');
    TestBed.inject(ProcessingAgentReadinessService).noteAgentAlive(false);
    await flush(silent.fixture);
    expect(autoFixInput(silent.fixture).disabled).toBe(true);

    const open = await gateFixture('installed');
    expect(autoFixInput(open.fixture).disabled).toBe(false);
  });

  /**
   * Fail-closed at boot (user decision 2026-08-09, superseding the
   * 2026-07-26 fail-open call): an UNKNOWN reading (probe pending or
   * failed) disables every submitting control until the automatic probe
   * confirms the setup, with the dedicated `probe-pending` reason. A
   * green check verdict (or any observed answer) still opens the gate
   * without waiting for the skill probe.
   */
  it('unknown gate (probe pending / failed) FAILS CLOSED: every submitting control is disabled', async () => {
    const { fixture } = await gateFixture('unknown');
    for (const testid of SUBMITTING_CONTROLS) {
      expect(gateButton(fixture, testid).disabled, testid).toBe(true);
    }

    // Drainage evidence opens it live, no skill probe needed.
    TestBed.inject(ProcessingAgentReadinessService).noteAgentAlive(true);
    await flush(fixture);
    for (const testid of SUBMITTING_CONTROLS) {
      expect(gateButton(fixture, testid).disabled, testid).toBe(false);
    }
  });

  it('renders queued / running server states as disabled buttons', async () => {
    const { fixture } = await bootAiActions({
      probs: makeProbExtensions({
        finders: [
          makeProbEntry({ id: 'core/a-finder', state: 'queued', jobId: 'job-a' }),
          makeProbEntry({ id: 'core/b-finder', state: 'running', jobId: 'job-b' }),
        ],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    const queued = dom.querySelector(
      '[data-testid="inspector-ai-action-launch-core/a-finder"]',
    ) as HTMLElement;
    const running = dom.querySelector(
      '[data-testid="inspector-ai-action-launch-core/b-finder"]',
    ) as HTMLElement;
    expect(queued.getAttribute('data-state')).toBe('queued');
    expect((queued.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    expect(running.getAttribute('data-state')).toBe('running');
    expect((running.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('re-fetches both reads on a job.* frame (debounced live refresh)', async () => {
    const { fixture, dataSource, jobEvents$ } = await bootAiActions({
      probs: makeProbExtensions({ finders: [makeProbEntry()] }),
    });
    const findingsBefore = dataSource.getNodeFindings.mock.calls.length;
    const probsBefore = dataSource.getNodeProbExtensions.mock.calls.length;

    vi.useFakeTimers();
    try {
      jobEvents$.next(makeJobCompleted());
      vi.advanceTimersByTime(400);
    } finally {
      vi.useRealTimers();
    }
    await flush(fixture);

    expect(dataSource.getNodeFindings.mock.calls.length).toBeGreaterThan(findingsBefore);
    expect(dataSource.getNodeProbExtensions.mock.calls.length).toBeGreaterThan(probsBefore);
  });

  it('re-fetches the launcher catalog when Settings closes (toggles may have changed it)', async () => {
    const { fixture, dataSource } = await bootAiActions({
      probs: makeProbExtensions({ finders: [makeProbEntry()] }),
    });
    const probsBefore = dataSource.getNodeProbExtensions.mock.calls.length;

    vi.useFakeTimers();
    try {
      // The app shell ticks this on modal close; plugin extension
      // toggles and the skill-actions offering live in that modal.
      TestBed.inject(SettingsVisibilityService).notifyClosed();
      vi.advanceTimersByTime(400);
    } finally {
      vi.useRealTimers();
    }
    await flush(fixture);

    expect(dataSource.getNodeProbExtensions.mock.calls.length).toBeGreaterThan(probsBefore);
  });

  // -------------------------------------------------------------------
  // Stop / restart companions (user decision 2026-07-17)
  // -------------------------------------------------------------------

  it('renders no stop/restart companions for an idle entry (jobId null)', async () => {
    const { fixture } = await bootAiActions({
      probs: makeProbExtensions({ finders: [makeProbEntry()] }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-ai-action-stop-core/todo-finder"]')).toBeNull();
    expect(
      dom.querySelector('[data-testid="inspector-ai-action-restart-core/todo-finder"]'),
    ).toBeNull();
  });

  it('keeps the companions hidden on an optimistic queued flip (no server jobId yet)', async () => {
    const { fixture } = await bootAiActions({
      probs: makeProbExtensions({ finders: [makeProbEntry()] }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    const host = dom.querySelector(
      '[data-testid="inspector-ai-action-launch-core/todo-finder"]',
    ) as HTMLElement;
    (host.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);

    // Optimistically queued, but the server has not confirmed a job
    // handle: nothing to cancel, so no companions until the refresh lands.
    expect(host.getAttribute('data-state')).toBe('queued');
    expect(dom.querySelector('[data-testid="inspector-ai-action-stop-core/todo-finder"]')).toBeNull();
    expect(
      dom.querySelector('[data-testid="inspector-ai-action-restart-core/todo-finder"]'),
    ).toBeNull();
  });

  it('renders the stop companion beside a queued entry that carries a jobId', async () => {
    const { fixture } = await bootAiActions({
      probs: makeProbExtensions({
        finders: [makeProbEntry({ state: 'queued', jobId: 'job-7' })],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    expect(
      dom.querySelector('[data-testid="inspector-ai-action-stop-core/todo-finder"]'),
    ).not.toBeNull();
    // The restart twin was dropped (user call 2026-07-17): never rendered.
    expect(
      dom.querySelector('[data-testid="inspector-ai-action-restart-core/todo-finder"]'),
    ).toBeNull();
  });

  it('stop cancels the active job and flips the launcher to idle optimistically', async () => {
    const { fixture, dataSource } = await bootAiActions({
      probs: makeProbExtensions({
        finders: [makeProbEntry({ state: 'queued', jobId: 'job-7' })],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    const stop = dom.querySelector(
      '[data-testid="inspector-ai-action-stop-core/todo-finder"]',
    ) as HTMLElement;
    (stop.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);

    expect(dataSource.cancelJob).toHaveBeenCalledWith('job-7');
    const launcher = dom.querySelector(
      '[data-testid="inspector-ai-action-launch-core/todo-finder"]',
    ) as HTMLElement;
    // Optimistic idle: launcher re-enabled, companions gone (the WS
    // frame + debounced refresh confirm server-side).
    expect(launcher.getAttribute('data-state')).toBe('idle');
    expect((launcher.querySelector('button') as HTMLButtonElement).disabled).toBe(false);
    expect(dom.querySelector('[data-testid="inspector-ai-action-stop-core/todo-finder"]')).toBeNull();
    expect(
      dom.querySelector('[data-testid="inspector-ai-actions-error"]'),
    ).toBeNull();
  });

  it('treats a job-terminal stop refusal as a silent race: no error, just a re-fetch', async () => {
    const { fixture, dataSource } = await bootAiActions({
      probs: makeProbExtensions({
        finders: [makeProbEntry({ state: 'queued', jobId: 'job-7' })],
      }),
    });
    dataSource.cancelJob.mockRejectedValue(
      new DataSourceError('job-terminal', 'Job job-7 is already terminal.'),
    );
    const probsBefore = dataSource.getNodeProbExtensions.mock.calls.length;
    const stop = fixture.nativeElement.querySelector(
      '[data-testid="inspector-ai-action-stop-core/todo-finder"]',
    ) as HTMLElement;
    (stop.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);
    await flush(fixture);

    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-ai-actions-error"]'),
    ).toBeNull();
    // No WS cancel frame is coming for a job that already finished, so
    // the handle re-fetches the authoritative state directly.
    expect(dataSource.getNodeProbExtensions.mock.calls.length).toBeGreaterThan(probsBefore);
  });

  it('surfaces other stop failures in the error strip without flipping the state', async () => {
    const { fixture, dataSource } = await bootAiActions({
      probs: makeProbExtensions({
        finders: [makeProbEntry({ state: 'queued', jobId: 'job-7' })],
      }),
    });
    dataSource.cancelJob.mockRejectedValue(
      new DataSourceError('not-found', 'No job with id job-7.'),
    );
    const stop = fixture.nativeElement.querySelector(
      '[data-testid="inspector-ai-action-stop-core/todo-finder"]',
    ) as HTMLElement;
    (stop.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    expect(
      dom.querySelector('[data-testid="inspector-ai-actions-error"]')!.textContent,
    ).toContain('No job with id job-7.');
    expect(
      (
        dom.querySelector(
          '[data-testid="inspector-ai-action-launch-core/todo-finder"]',
        ) as HTMLElement
      ).getAttribute('data-state'),
    ).toBe('queued');
  });



  it('disables the stop companion while the cancel round-trip is in flight', async () => {
    const { fixture, dataSource } = await bootAiActions({
      probs: makeProbExtensions({
        finders: [makeProbEntry({ state: 'queued', jobId: 'job-7' })],
      }),
    });
    let resolveCancel: () => void = () => undefined;
    dataSource.cancelJob.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCancel = resolve;
        }),
    );
    const dom: HTMLElement = fixture.nativeElement;
    const stop = dom.querySelector(
      '[data-testid="inspector-ai-action-stop-core/todo-finder"]',
    ) as HTMLElement;
    (stop.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);

    expect((stop.querySelector('button') as HTMLButtonElement).disabled).toBe(true);

    resolveCancel();
    await flush(fixture);
    // Settled: the optimistic idle flip retires the companion entirely.
    expect(dom.querySelector('[data-testid="inspector-ai-action-stop-core/todo-finder"]')).toBeNull();
  });

  // -------------------------------------------------------------------
  // Two-state finder button + automatic toggle (Step 16)
  // -------------------------------------------------------------------

  it('renders a finder-without-fixer and a standalone action as single-action buttons', async () => {
    // Both land in the `standalone` bucket (label = short name); clicking
    // either submits its own extension with autoFix false.
    const { fixture, dataSource, node } = await bootAiActions({
      probs: makeProbExtensions({
        standalone: [
          makeProbEntry({ id: 'core/orphan-finder', description: 'A finder with no fixer.' }),
          makeProbEntry({ id: 'core/summarizer', description: 'Summarizes the node.' }),
        ],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    const summarizer = dom.querySelector(
      '[data-testid="inspector-ai-action-launch-core/summarizer"]',
    ) as HTMLElement;
    expect(summarizer.textContent).toContain('summarizer');
    expect(summarizer.getAttribute('data-action')).toBe('run');
    (summarizer.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);
    expect(dataSource.submitNodeJob).toHaveBeenCalledWith(node.path, 'core/summarizer', false);
  });

  it('shows the automatic toggle only when a finder-with-fixer button exists', async () => {
    const standaloneOnly = await bootAiActions({
      probs: makeProbExtensions({
        standalone: [makeProbEntry({ id: 'core/summarizer', description: 'Summarizes.' })],
      }),
    });
    expect(
      standaloneOnly.fixture.nativeElement.querySelector(
        '[data-testid="inspector-auto-fix-toggle"]',
      ),
    ).toBeNull();

    const withFinder = await bootAiActions({
      probs: makeProbExtensions({ finders: [makeProbEntry({ fixerIds: ['core/todo-fixer'] })] }),
    });
    expect(
      withFinder.fixture.nativeElement.querySelector('[data-testid="inspector-auto-fix-toggle"]'),
    ).not.toBeNull();
  });

  it('with the automatic toggle ON, one click submits the finder with autoFix true', async () => {
    // The persisted preference is read at init.
    localStorage.setItem('skill-map.ui.inspector.autoFix', 'true');
    const { fixture, dataSource, node } = await bootAiActions({
      probs: makeProbExtensions({
        finders: [makeProbEntry({ fixerIds: ['core/todo-fixer'], hasOpenFindings: false })],
      }),
    });
    const btn = fixture.nativeElement.querySelector(
      '[data-testid="inspector-ai-action-launch-core/todo-finder"]',
    ) as HTMLElement;
    // Automatic flips the action: data-action becomes detectAndFix (the
    // label stays the kind).
    expect(btn.textContent).toContain('todo-finder');
    expect(btn.getAttribute('data-action')).toBe('detectAndFix');
    (btn.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);
    // Submits the FINDER (not the fixer) with the autoFix flag; the kernel chains.
    expect(dataSource.submitNodeJob).toHaveBeenCalledWith(node.path, 'core/todo-finder', true);
    expect(dataSource.submitNodeJob).not.toHaveBeenCalledWith(
      node.path,
      'core/todo-fixer',
      expect.anything(),
    );
  });

  it('persists the automatic toggle to localStorage (round-trip) and defaults / parses defensively', async () => {
    const KEY = 'skill-map.ui.inspector.autoFix';
    interface IAutoFixProto {
      autoFixEnabled(): boolean;
      onAutoFixToggle(v: boolean): void;
    }
    // The Automatic toggle lives in the AI actions section child
    // (extracted with the section), so the proto probe targets it.
    const aiActionsSection = (fixture: ComponentFixture<InspectorView>): IAutoFixProto =>
      fixture.debugElement.query(By.directive(InspectorAiActionsSection))
        .componentInstance as unknown as IAutoFixProto;

    // Default OFF when unset.
    const fresh = await bootAiActions({
      probs: makeProbExtensions({ finders: [makeProbEntry({ fixerIds: ['core/todo-fixer'] })] }),
    });
    const proto = aiActionsSection(fresh.fixture);
    expect(proto.autoFixEnabled()).toBe(false);

    // Round-trip: a change writes 'true' / 'false' back to storage.
    proto.onAutoFixToggle(true);
    await flush(fresh.fixture);
    expect(localStorage.getItem(KEY)).toBe('true');
    proto.onAutoFixToggle(false);
    await flush(fresh.fixture);
    expect(localStorage.getItem(KEY)).toBe('false');

    // A bogus stored value resolves to false (only the literal 'true' is on).
    localStorage.setItem(KEY, 'yes-please');
    const bogus = await bootAiActions({
      probs: makeProbExtensions({ finders: [makeProbEntry({ fixerIds: ['core/todo-fixer'] })] }),
    });
    expect(aiActionsSection(bogus.fixture).autoFixEnabled()).toBe(false);
    const btn = bogus.fixture.nativeElement.querySelector(
      '[data-testid="inspector-ai-action-launch-core/todo-finder"]',
    ) as HTMLElement;
    expect(btn.getAttribute('data-action')).toBe('detect');
  });

  it('the dismiss X dismisses DIRECTLY (no prompt, no note)', async () => {
    const { fixture, dataSource, node } = await bootAiActions({
      findings: makeFindingsEnvelope([makeFinding()]),
    });
    (
      fixture.nativeElement.querySelector(
        '[data-testid="inspector-finding-dismiss-12"] button',
      ) as HTMLButtonElement
    ).click();
    await flush(fixture);
    expect(dataSource.dismissFinding).toHaveBeenCalledWith(node.path, 12, {});
  });

  it('the row X dismisses ONLY this finding: no consent, row-grain body', async () => {
    // 2026-07-22 user decision: the X is a resolution state on the row,
    // not the class suppression, so no `.sm` write and no consent gate.
    const { fixture, dataSource, node } = await bootAiActions({
      findings: makeFindingsEnvelope([makeFinding()]),
    });
    (
      fixture.nativeElement.querySelector(
        '[data-testid="inspector-finding-dismiss-12"] button',
      ) as HTMLButtonElement
    ).click();
    await flush(fixture);
    const dispatcher = TestBed.inject(ActionDispatchService);
    expect(dispatcher.consentOpen()).toBe(false);
    expect(dataSource.dismissFinding).toHaveBeenCalledWith(node.path, 12, {});
  });


  it('the check mark resolves a finding (fixed by the operator)', async () => {
    const { fixture, dataSource, node } = await bootAiActions({
      findings: makeFindingsEnvelope([makeFinding()]),
    });
    (
      fixture.nativeElement.querySelector(
        '[data-testid="inspector-finding-resolve-12"] button',
      ) as HTMLButtonElement
    ).click();
    await flush(fixture);
    expect(dataSource.resolveFinding).toHaveBeenCalledWith(node.path, 12);
  });

  it('hidden chips reveal a bucket; restore un-dismisses from the dismissed rows', async () => {
    const hiddenOnly = makeFindingsEnvelope([], { dismissedExcluded: 1 });
    const { fixture, dataSource, node } = await bootAiActions({ findings: hiddenOnly });
    // The FINDINGS card stays up on hidden-only content (the reveal
    // surface lives there since the rows moved, user call 2026-07-22).
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-findings"]')).not.toBeNull();
    const chip = dom.querySelector(
      '[data-testid="inspector-ai-hidden-dismissed"]',
    ) as HTMLButtonElement;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain('1 dismissed');

    // Revealing fetches the bucket rows (the ?dismissed=1 filter).
    dataSource.getNodeFindings.mockImplementation(
      (_path: string, bucket?: string): Promise<IFindingsEnvelopeApi> =>
        Promise.resolve(
          bucket === 'dismissed' ? makeFindingsEnvelope([makeFinding({ id: 33 })]) : hiddenOnly,
        ),
    );
    chip.click();
    await flush(fixture);
    expect(dataSource.getNodeFindings).toHaveBeenCalledWith(node.path, 'dismissed');
    const revealed = dom.querySelector('[data-testid="inspector-ai-revealed-33"]');
    expect(revealed).not.toBeNull();

    // Restore un-dismisses with the row's EXACT class identity.
    (
      dom.querySelector('[data-testid="inspector-finding-restore-33"] button') as HTMLButtonElement
    ).click();
    await flush(fixture);
    expect(dataSource.undismissFinding).toHaveBeenCalledWith(
      node.path,
      { extension: 'core/todo-finder', type: 'stale-todo' },
      {},
    );
  });

  it('a zero-count chip never renders: emptying the revealed bucket collapses chip + sublist', async () => {
    const hiddenOnly = makeFindingsEnvelope([], { dismissedExcluded: 1 });
    const { fixture, dataSource } = await bootAiActions({ findings: hiddenOnly });
    const dom: HTMLElement = fixture.nativeElement;
    dataSource.getNodeFindings.mockImplementation(
      (_path: string, bucket?: string): Promise<IFindingsEnvelopeApi> =>
        Promise.resolve(
          bucket === 'dismissed' ? makeFindingsEnvelope([makeFinding({ id: 33 })]) : hiddenOnly,
        ),
    );
    (
      dom.querySelector('[data-testid="inspector-ai-hidden-dismissed"]') as HTMLButtonElement
    ).click();
    await flush(fixture);
    expect(dom.querySelector('[data-testid="inspector-ai-revealed-33"]')).not.toBeNull();

    // Restoring the LAST row: the refetched counts drop to zero, so the
    // chip disappears and the revealed sublist auto-collapses with it.
    dataSource.getNodeFindings.mockResolvedValue(
      makeFindingsEnvelope([makeFinding({ id: 33 })], { dismissedExcluded: 0 }),
    );
    (
      dom.querySelector('[data-testid="inspector-finding-restore-33"] button') as HTMLButtonElement
    ).click();
    // Two rounds: the restore settles, then its tray refetch lands.
    await flush(fixture);
    await flush(fixture);
    expect(dom.querySelector('[data-testid="inspector-ai-hidden-dismissed"]')).toBeNull();
    expect(dom.querySelector('[data-testid="inspector-ai-revealed-list"]')).toBeNull();
  });

  it('a revealed dismissed row also carries a delete X that hard-deletes the row', async () => {
    const hiddenOnly = makeFindingsEnvelope([], { dismissedExcluded: 1 });
    const { fixture, dataSource, node } = await bootAiActions({ findings: hiddenOnly });
    const dom: HTMLElement = fixture.nativeElement;
    dataSource.getNodeFindings.mockImplementation(
      (_path: string, bucket?: string): Promise<IFindingsEnvelopeApi> =>
        Promise.resolve(
          bucket === 'dismissed' ? makeFindingsEnvelope([makeFinding({ id: 33 })]) : hiddenOnly,
        ),
    );
    (
      dom.querySelector('[data-testid="inspector-ai-hidden-dismissed"]') as HTMLButtonElement
    ).click();
    await flush(fixture);

    (
      dom.querySelector('[data-testid="inspector-finding-delete-33"] button') as HTMLButtonElement
    ).click();
    await flush(fixture);
    expect(dataSource.deleteFinding).toHaveBeenCalledWith(node.path, 33, {});
  });

  it('revealed fixed rows carry the delete X (no restore) and delete hard-removes', async () => {
    const hiddenOnly = makeFindingsEnvelope([], { fixedExcluded: 1 });
    const { fixture, dataSource, node } = await bootAiActions({ findings: hiddenOnly });
    const dom: HTMLElement = fixture.nativeElement;
    dataSource.getNodeFindings.mockImplementation(
      (_path: string, bucket?: string): Promise<IFindingsEnvelopeApi> =>
        Promise.resolve(
          bucket === 'fixed' ? makeFindingsEnvelope([makeFinding({ id: 44 })]) : hiddenOnly,
        ),
    );
    (
      dom.querySelector('[data-testid="inspector-ai-hidden-fixed"]') as HTMLButtonElement
    ).click();
    await flush(fixture);

    // Fixed rows: delete only, no restore (nothing to un-dismiss).
    expect(dom.querySelector('[data-testid="inspector-finding-restore-44"]')).toBeNull();
    (
      dom.querySelector('[data-testid="inspector-finding-delete-44"] button') as HTMLButtonElement
    ).click();
    await flush(fixture);
    expect(dataSource.deleteFinding).toHaveBeenCalledWith(node.path, 44, {});
  });

describe('findings severity chips + clear all (2026-08-08)', () => {
  it('sorts AI findings by severity (error, warn, info) and shows one chip per present tier with combined counts', async () => {
    const { fixture } = await bootAiActions({
      issues: [makeIssue()], // one deterministic error
      findings: makeFindingsEnvelope([
        makeFinding({ id: 1, severity: 'info', type: 'note-a' }),
        makeFinding({ id: 2, severity: 'error', type: 'err-a' }),
        makeFinding({ id: 3, severity: 'warn', type: 'warn-a' }),
      ]),
    });
    const dom: HTMLElement = fixture.nativeElement;

    // AI rows severity-ordered: error (2), warn (3), info (1).
    const rows = [...dom.querySelectorAll('li[data-testid^="inspector-ai-action-"]')];
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'inspector-ai-action-2',
      'inspector-ai-action-3',
      'inspector-ai-action-1',
    ]);

    // Chips: error combines the issue + the finding; warn / info are 1 each.
    const chip = (sev: string) =>
      dom.querySelector(`[data-testid="inspector-findings-chip-${sev}"]`);
    expect(chip('error')!.textContent).toContain('2');
    expect(chip('warn')!.textContent).toContain('1');
    expect(chip('info')!.textContent).toContain('1');
    // All on by default.
    expect(chip('error')!.classList.contains('is-on')).toBe(true);
  });

  it('toggling a chip hides that tier in both lists; all-off shows the filtered-empty line', async () => {
    const { fixture } = await bootAiActions({
      issues: [makeIssue()],
      findings: makeFindingsEnvelope([makeFinding({ id: 2, severity: 'error', type: 'err-a' })]),
    });
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelectorAll('[data-testid="inspector-finding"]').length).toBe(1);
    expect(dom.querySelector('[data-testid="inspector-ai-action-2"]')).not.toBeNull();

    (dom.querySelector('[data-testid="inspector-findings-chip-error"]') as HTMLButtonElement).click();
    await flush(fixture);

    // Both lists lose their error rows; only errors existed, so the
    // filtered-empty line takes over. The chip stays for toggling back.
    expect(dom.querySelectorAll('[data-testid="inspector-finding"]').length).toBe(0);
    expect(dom.querySelector('[data-testid="inspector-ai-action-2"]')).toBeNull();
    expect(dom.querySelector('[data-testid="inspector-findings-filter-empty"]')).not.toBeNull();

    (dom.querySelector('[data-testid="inspector-findings-chip-error"]') as HTMLButtonElement).click();
    await flush(fixture);
    expect(dom.querySelector('[data-testid="inspector-ai-action-2"]')).not.toBeNull();
  });

  it('Dismiss all row-dismisses every VISIBLE AI finding (filter-scoped), never the deterministic issues', async () => {
    const { fixture, dataSource, node } = await bootAiActions({
      issues: [makeIssue()],
      findings: makeFindingsEnvelope([
        makeFinding({ id: 2, severity: 'error', type: 'err-a' }),
        makeFinding({ id: 3, severity: 'warn', type: 'warn-a' }),
        makeFinding({ id: 1, severity: 'info', type: 'note-a' }),
      ]),
    });
    const dom: HTMLElement = fixture.nativeElement;

    // Narrow to errors+info first: the warn row leaves the sweep's scope.
    (dom.querySelector('[data-testid="inspector-findings-chip-warn"]') as HTMLButtonElement).click();
    await flush(fixture);

    (dom.querySelector('[data-testid="inspector-findings-dismiss-all"]') as HTMLButtonElement).click();
    await flush(fixture);
    await flush(fixture);

    expect(dataSource.dismissFinding).toHaveBeenCalledWith(node.path, 2, {});
    expect(dataSource.dismissFinding).toHaveBeenCalledWith(node.path, 1, {});
    expect(dataSource.dismissFinding).not.toHaveBeenCalledWith(node.path, 3, {});
    // The deterministic issue is untouched (its dismissal is the
    // consent-gated sidecar hammer, never part of Clear all).
    expect(dataSource.dismissIssue).not.toHaveBeenCalled();
  });

  it('Delete all hard-removes every REVEALED row (and only those)', async () => {
    // A tray with one live row plus two hidden dismissed ones: the
    // sweep must reach the revealed pair and never the live row.
    const live = makeFinding({ id: 7, type: 'live-one' });
    const trayEnvelope = makeFindingsEnvelope([live], { dismissedExcluded: 2 });
    const { fixture, dataSource, node } = await bootAiActions({ findings: trayEnvelope });
    const dom: HTMLElement = fixture.nativeElement;
    dataSource.getNodeFindings.mockImplementation(
      (_path: string, bucket?: string): Promise<IFindingsEnvelopeApi> =>
        Promise.resolve(
          bucket === 'dismissed'
            ? makeFindingsEnvelope([
                makeFinding({ id: 21, resolution: 'dismissed' }),
                makeFinding({ id: 22, resolution: 'dismissed' }),
              ])
            : trayEnvelope,
        ),
    );

    // No Delete all until a bucket is revealed.
    expect(dom.querySelector('[data-testid="inspector-ai-revealed-delete-all"]')).toBeNull();
    (dom.querySelector('[data-testid="inspector-ai-hidden-dismissed"]') as HTMLButtonElement).click();
    await flush(fixture);

    (dom.querySelector('[data-testid="inspector-ai-revealed-delete-all"]') as HTMLButtonElement).click();
    await flush(fixture);
    await flush(fixture);

    expect(dataSource.deleteFinding).toHaveBeenCalledWith(node.path, 21, {});
    expect(dataSource.deleteFinding).toHaveBeenCalledWith(node.path, 22, {});
    // The live tray row is not part of the revealed bucket's sweep.
    expect(dataSource.deleteFinding).not.toHaveBeenCalledWith(node.path, 7, {});
  });

  /**
   * Reveal the dismissed bucket holding `ids`. A launcher entry rides
   * along so the AI actions card (which owns the shared error strip the
   * sweeps report into) is actually mounted.
   */
  async function bootRevealedDismissed(ids: readonly number[]): Promise<{
    fixture: ComponentFixture<InspectorView>;
    dataSource: IStubDataSource;
    node: INodeView;
  }> {
    const trayEnvelope = makeFindingsEnvelope([], { dismissedExcluded: ids.length });
    const { fixture, dataSource, node } = await bootAiActions({
      findings: trayEnvelope,
      probs: makeProbExtensions({ standalone: [makeProbEntry()] }),
    });
    dataSource.getNodeFindings.mockImplementation(
      (_path: string, bucket?: string): Promise<IFindingsEnvelopeApi> =>
        Promise.resolve(
          bucket === 'dismissed'
            ? makeFindingsEnvelope(ids.map((id) => makeFinding({ id, resolution: 'dismissed' })))
            : trayEnvelope,
        ),
    );
    (
      fixture.nativeElement.querySelector(
        '[data-testid="inspector-ai-hidden-dismissed"]',
      ) as HTMLButtonElement
    ).click();
    await flush(fixture);
    return { fixture, dataSource, node };
  }

  it('Delete all parks the REMAINING rows behind ONE consent dialog and resumes on accept', async () => {
    const { fixture, dataSource, node } = await bootRevealedDismissed([31, 32, 33]);
    // Deleting the last row of a dismissed class lifts its `.sm`
    // suppression, so the gate can fire partway through the sweep. It
    // fires on the SECOND row here.
    const consentError = new DataSourceError('confirm-required', 'consent needed', {
      key: 'allowEditSmFiles',
    });
    dataSource.deleteFinding.mockImplementation(
      (_path: string, id: number, consent: Record<string, unknown>) =>
        id === 32 && !('confirm' in consent)
          ? Promise.reject(consentError)
          : Promise.resolve(undefined),
    );

    (
      fixture.nativeElement.querySelector(
        '[data-testid="inspector-ai-revealed-delete-all"]',
      ) as HTMLButtonElement
    ).click();
    await flush(fixture);
    await flush(fixture);

    // Row 31 went through; 32 hit the gate and 33 was NOT attempted
    // (one dialog for the remainder, never one prompt per row).
    const dispatcher = TestBed.inject(ActionDispatchService);
    expect(dispatcher.consentOpen()).toBe(true);
    expect(dataSource.deleteFinding).toHaveBeenCalledWith(node.path, 31, {});
    expect(dataSource.deleteFinding).not.toHaveBeenCalledWith(node.path, 33, {});

    // Accepting resumes exactly where the sweep stopped, with the grant.
    dispatcher.resolveConsent({ accepted: true, always: false });
    await flush(fixture);
    await flush(fixture);
    expect(dataSource.deleteFinding).toHaveBeenCalledWith(node.path, 32, { confirm: true });
    expect(dataSource.deleteFinding).toHaveBeenCalledWith(node.path, 33, { confirm: true });
  });

  it('Delete all: a failing row does not abort the sweep', async () => {
    const { fixture, dataSource, node } = await bootRevealedDismissed([41, 42]);
    dataSource.deleteFinding.mockImplementation((_path: string, id: number) =>
      id === 41 ? Promise.reject(new DataSourceError('internal', 'boom')) : Promise.resolve(undefined),
    );

    (
      fixture.nativeElement.querySelector(
        '[data-testid="inspector-ai-revealed-delete-all"]',
      ) as HTMLButtonElement
    ).click();
    await flush(fixture);
    await flush(fixture);

    // The survivor is still deleted, and the failure surfaces on the
    // shared error strip rather than silently vanishing.
    expect(dataSource.deleteFinding).toHaveBeenCalledWith(node.path, 42, {});
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-ai-actions-error"]'),
    ).not.toBeNull();
  });

  it('Dismiss all: a failing row does not abort the sweep either', async () => {
    const { fixture, dataSource, node } = await bootAiActions({
      findings: makeFindingsEnvelope([
        makeFinding({ id: 51, severity: 'warn' }),
        makeFinding({ id: 52, severity: 'warn' }),
      ]),
      // The error strip lives in the AI actions card; mount it.
      probs: makeProbExtensions({ standalone: [makeProbEntry()] }),
    });
    dataSource.dismissFinding.mockImplementation((_path: string, id: number) =>
      id === 51 ? Promise.reject(new DataSourceError('internal', 'boom')) : Promise.resolve(undefined),
    );

    (
      fixture.nativeElement.querySelector(
        '[data-testid="inspector-findings-dismiss-all"]',
      ) as HTMLButtonElement
    ).click();
    await flush(fixture);
    await flush(fixture);

    expect(dataSource.dismissFinding).toHaveBeenCalledWith(node.path, 52, {});
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-ai-actions-error"]'),
    ).not.toBeNull();
  });

  it('a per-row resolve refetches the launcher catalog (what keeps the verdict marks live)', async () => {
    const { fixture, dataSource } = await bootAiActions({
      findings: makeFindingsEnvelope([makeFinding({ id: 61 })]),
      probs: makeProbExtensions({
        finders: [makeProbEntry({ lastJudged: { at: 1, model: null }, findingsMaxSeverity: 'warn' })],
      }),
    });
    const before = dataSource.getNodeProbExtensions.mock.calls.length;

    (
      fixture.nativeElement.querySelector(
        '[data-testid="inspector-finding-resolve-61"] button',
      ) as HTMLButtonElement
    ).click();
    await flush(fixture);
    await flush(fixture);

    // The catalog (and therefore every verdict mark) is re-read after a
    // findings-panel action; without this the marks would go stale until
    // the next navigation.
    expect(dataSource.getNodeProbExtensions.mock.calls.length).toBeGreaterThan(before);
  });
});

describe('AI actions verdict mark (2026-08-08)', () => {
  it('clean pass: green check on an idle judged launcher with no stored rows', async () => {
    const { fixture } = await bootAiActions({
      probs: makeProbExtensions({
        standalone: [
          makeProbEntry({
            id: 'core/ai-summarizer-action',
            lastJudged: { at: 1_700_000_000_000, model: 'claude-opus-4' },
          }),
        ],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    const mark = dom.querySelector(
      '[data-testid="inspector-ai-action-verdict-core/ai-summarizer-action"]',
    );
    expect(mark).not.toBeNull();
    expect(mark!.getAttribute('data-severity')).toBe('clean');
    expect(mark!.classList.contains('pi-check')).toBe(true);
  });

  it('reports the highest found severity with the matching glyph', async () => {
    const { fixture } = await bootAiActions({
      probs: makeProbExtensions({
        finders: [
          makeProbEntry({
            id: 'core/error-finder',
            lastJudged: { at: 1, model: null },
            findingsMaxSeverity: 'error',
            hasOpenFindings: true,
          }),
          makeProbEntry({
            id: 'core/warn-finder',
            lastJudged: { at: 1, model: null },
            findingsMaxSeverity: 'warn',
          }),
          makeProbEntry({
            id: 'core/info-finder',
            lastJudged: { at: 1, model: null },
            findingsMaxSeverity: 'info',
          }),
        ],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    const mark = (id: string) =>
      dom.querySelector(`[data-testid="inspector-ai-action-verdict-${id}"]`);
    // Open findings are exactly what the mark reports (the severity is
    // the OUTSTANDING one), so a Fix-state entry still carries it.
    expect(mark('core/error-finder')!.getAttribute('data-severity')).toBe('error');
    expect(mark('core/error-finder')!.classList.contains('pi-times-circle')).toBe(true);
    expect(mark('core/warn-finder')!.getAttribute('data-severity')).toBe('warn');
    expect(mark('core/warn-finder')!.classList.contains('pi-exclamation-triangle')).toBe(true);
    expect(mark('core/info-finder')!.getAttribute('data-severity')).toBe('info');
    expect(mark('core/info-finder')!.classList.contains('pi-info-circle')).toBe(true);
  });

  it('no mark while busy, never judged, or when the server omits the field', async () => {
    const { fixture } = await bootAiActions({
      probs: makeProbExtensions({
        finders: [
          makeProbEntry({
            id: 'core/busy-finder',
            lastJudged: { at: 1, model: null },
            state: 'queued',
            jobId: 'j9',
          }),
          makeProbEntry({ id: 'core/never-finder' }),
          // A server predating the field: ABSENT is not `null`, so it
          // must NOT read as a clean check (contract: render no mark).
          makeProbEntry({
            id: 'core/legacy-finder',
            lastJudged: { at: 1, model: null },
            findingsMaxSeverity: undefined,
          }),
        ],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-ai-action-verdict-core/busy-finder"]')).toBeNull();
    expect(dom.querySelector('[data-testid="inspector-ai-action-verdict-core/never-finder"]')).toBeNull();
    expect(dom.querySelector('[data-testid="inspector-ai-action-verdict-core/legacy-finder"]')).toBeNull();
  });
});
});

describe('InspectorView, header Ignore wiring', () => {
  it('routes the header ignoreClick into ProjectIgnoreService with the inspector source', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const { fixture } = bootstrap({ loader });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    const probe = fixture.componentInstance as unknown as {
      onHeaderIgnore(path: string): void;
    };
    probe.onHeaderIgnore(node.path);

    const svc = TestBed.inject(ProjectIgnoreService) as unknown as {
      requestIgnore: ReturnType<typeof vi.fn>;
    };
    expect(svc.requestIgnore).toHaveBeenCalledWith(node.path, 'file', 'inspector');
  });
});
