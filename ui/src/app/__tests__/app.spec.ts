import { afterEach, describe, expect, it, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { computed, signal, type WritableSignal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { App } from '../app';
import { APP_TEXTS } from '../../i18n/app.texts';
import { PROJECT_LINKS } from '../../i18n/project-links';
import { ActivityReadinessService } from '../services/activity-readiness';
import { ScanTriggerService } from '../services/scan-trigger';
import { DATA_SOURCE, type IDataSourcePort } from '../../services/data-source/data-source.port';
import { NodeActivityService } from '../../services/node-activity';
import { ProjectIgnoreService } from '../../services/project-ignore';
import { SKILL_MAP_MODE } from '../../services/data-source/runtime-mode';
import { WsEventStreamService, WS_SOCKET_FACTORY, type TWsSocketFactory, type IWsLike } from '../../services/ws-event-stream';
import { UpdateCheckService } from '../services/update-check';
import { ThemeService } from '../../services/theme';
import { EMPTY } from 'rxjs';

/**
 * Inert WebSocket. The App shell test runs in `'live'` mode (so
 * <sm-demo-banner> resolves SKILL_MAP_MODE), which would otherwise make
 * WsEventStreamService open a real socket that fails under the test rig
 * and spams `[ws] socket error` / `[ws] closed` into the console. This
 * fake never invokes its handlers, so the service stays silent.
 * (Production resolves WS_SOCKET_FACTORY to `(url) => new WebSocket(url)`.)
 */
const inertWsSocketFactory: TWsSocketFactory = (): IWsLike => ({
  readyState: 0,
  close: () => undefined,
  onopen: null,
  onclose: null,
  onmessage: null,
  onerror: null,
});

const STUB_DATA_SOURCE: IDataSourcePort = {
  health: () =>
    Promise.resolve({
      ok: true,
      schemaVersion: '1',
      specVersion: '0.0.0',
      implVersion: '0.0.0',
      db: 'missing',
      cwd: '/tmp/test',
      dbPath: '/tmp/test/.skill-map/scan.db',
      mcp: false,
    }),
  mcpStatus: () =>
    Promise.resolve({
      enabled: false,
      connected: false,
      clients: 0,
      url: 'http://127.0.0.1:4242/mcp',
    }),
  agentPresence: () =>
    Promise.resolve({
      schemaVersion: '1',
      kind: 'agent-presence' as const,
      attending: false,
      lastClaimAt: null,
    }),
  loadScan: () =>
    Promise.resolve({
      schemaVersion: 1,
      scannedAt: 0,
      roots: ['.'],
      providers: [],
      nodes: [],
      links: [],
      issues: [],
      stats: {
        filesWalked: 0,
        filesSkipped: 0,
        nodesCount: 0,
        linksCount: 0,
        issuesCount: 0,
        durationMs: 0,
      },
    }),
  loadScanMeta: () =>
    Promise.resolve({
      schemaVersion: 1,
      scannedAt: 0,
      roots: ['.'],
      providers: [],
      nodes: [],
      links: [],
      issues: [],
      stats: {
        filesWalked: 0,
        filesSkipped: 0,
        nodesCount: 0,
        linksCount: 0,
        issuesCount: 0,
        durationMs: 0,
      },
    }),
  loadFolders: () => Promise.resolve([]),
  loadBranch: () =>
    Promise.resolve({
      schemaVersion: '1',
      kind: 'branch',
      branch: { paths: [], excluded: [], rootExcluded: false, total: 0, rendered: 0, truncated: false, cap: 256 },
      nodes: [],
      links: [],
      issues: [],
    }),
  listNodes: () =>
    Promise.resolve({
      schemaVersion: '1',
      kind: 'nodes',
      items: [],
      filters: {},
      counts: { total: 0, returned: 0 },
      kindRegistry: {},
    }),
  getNode: () => Promise.resolve(null),
  getNodeFindings: () =>
    Promise.resolve({
      schemaVersion: '1',
      kind: 'findings',
      items: [],
      filters: {},
      counts: { total: 0, returned: 0, dismissedExcluded: 0, fixedExcluded: 0 },
      kindRegistry: {},
    }),
  getNodeProbExtensions: () =>
    Promise.resolve({ finders: [], standalone: [], issueFixers: [] }),
  submitNodeJob: () =>
    Promise.resolve({
      schemaVersion: '1',
      kind: 'job.submitted',
      value: { jobId: 'job-1', nodePath: 'a.md', extensionId: 'x/y', supersededIds: [] },
      elapsedMs: 0,
    }),
  submitNodelessJob: vi.fn().mockResolvedValue({ value: { jobId: 'j1', nodePath: 'sm://core/ai-ping-action', extensionId: 'core/ai-ping-action', supersededIds: [] } }),
  cancelJob: () => Promise.resolve(),
  dismissFinding: () => Promise.resolve(),
  reopenFinding: () => Promise.resolve(),
  resolveFinding: () => Promise.resolve(),
  undismissFinding: () => Promise.resolve(),
  deleteFinding: () => Promise.resolve(),
  dismissIssue: () => Promise.resolve(),
  cancelAllJobs: () => Promise.resolve(),
  pruneJobs: () => Promise.resolve(),
  listJobs: () => Promise.resolve([]),
  listLinks: () =>
    Promise.resolve({
      schemaVersion: '1',
      kind: 'links',
      items: [],
      filters: {},
      counts: { total: 0, returned: 0 },
      kindRegistry: {},
    }),
  listIssues: () =>
    Promise.resolve({
      schemaVersion: '1',
      kind: 'issues',
      items: [],
      filters: {},
      counts: { total: 0, returned: 0 },
      kindRegistry: {},
    }),
  loadGraph: () => Promise.resolve(''),
  loadConfig: () => Promise.resolve({}),
  getConfigResolution: () => Promise.resolve([]),
  getNodeSummary: () => Promise.resolve([]),
  deleteNodeSummary: () => Promise.resolve(),
  listPlugins: () =>
    Promise.resolve({
      schemaVersion: '1',
      kind: 'plugins',
      items: [],
      filters: {},
      counts: { total: 0, returned: 0 },
      kindRegistry: {},
    }),
  setFavorite: () => Promise.resolve(),
  unsetFavorite: () => Promise.resolve(),
  getPreferences: () =>
    Promise.resolve({
      updateCheck: { enabled: true },
      githubStars: { enabled: true },
      ui: { dismissedNotes: [] },
      telemetry: { errorsEnabled: false, usageCliEnabled: false, usageUiEnabled: false, anonymousId: null, environment: 'prod' },
    }),
  setPreferences: () =>
    Promise.resolve({
      updateCheck: { enabled: true },
      githubStars: { enabled: true },
      ui: { dismissedNotes: [] },
      telemetry: { errorsEnabled: false, usageCliEnabled: false, usageUiEnabled: false, anonymousId: null, environment: 'prod' },
    }),
  getProjectPreferences: () =>
    Promise.resolve({
      allowSidecarWriters: true,
      scan: { referencePaths: [], followExternalSymlinks: false, respectGitignore: false },
    }),
  setProjectPreferences: () =>
    Promise.resolve({
      allowSidecarWriters: true,
      scan: { referencePaths: [], followExternalSymlinks: false, respectGitignore: false },
    }),
  getProjectIgnore: () => Promise.resolve({ patterns: [] }),
  setProjectIgnore: () => Promise.resolve({ patterns: [] }),
  getMapViews: () =>
    Promise.resolve({
      schemaVersion: '1' as const,
      kind: 'map-views' as const,
      views: [],
      skipped: [],
    }),
  putMapView: () =>
    Promise.resolve({
      schemaVersion: '1' as const,
      kind: 'map-views' as const,
      views: [],
      skipped: [],
    }),
  deleteMapView: () =>
    Promise.resolve({
      schemaVersion: '1' as const,
      kind: 'map-views' as const,
      views: [],
      skipped: [],
    }),
  getActiveProvider: () =>
    Promise.resolve({
      activeProvider: 'markdown',
      detected: [],
      source: 'default' as const,
      selectable: [],
      markerDrift: null,
    }),
  setActiveProvider: () =>
    Promise.resolve({
      activeProvider: 'markdown',
      detected: [],
      source: 'default' as const,
      selectable: [],
      markerDrift: null,
      switch: { dropped: null },
    }),
  acceptActiveProviderMarkers: () =>
    Promise.resolve({
      activeProvider: 'markdown',
      detected: [],
      source: 'default' as const,
      selectable: [],
      markerDrift: null,
    }),
  getActivityInstallStatus: () => Promise.resolve({
    provider: 'markdown',
    supported: false,
    installed: false,
    configPath: null,
    configWired: false,
    bridgePresent: false,
    events: 0,
    shellOptIn: false,
  }),
  installActivityHook: () => Promise.resolve({
    provider: 'markdown',
    supported: false,
    installed: false,
    configPath: null,
    configWired: false,
    bridgePresent: false,
    events: 0,
    shellOptIn: false,
  }),
  uninstallActivityHook: () => Promise.resolve({ ...{
    provider: 'markdown',
    supported: false,
    installed: false,
    configPath: null,
    configWired: false,
    bridgePresent: false,
    events: 0,
    shellOptIn: false,
  }, removed: false }),
  getAgentSkillInstallStatus: () => Promise.resolve({
    provider: 'markdown',
    supported: false,
    skillDir: null,
    installed: false,
    stale: false,
  }),
  installAgentSkill: () => Promise.resolve({
    provider: 'markdown',
    supported: false,
    skillDir: null,
    installed: false,
    stale: false,
    outcome: 'installed' as const,
  }),
  uninstallAgentSkill: () => Promise.resolve({
    provider: 'markdown',
    supported: false,
    skillDir: null,
    installed: false,
    stale: false,
    removed: false,
  }),
  getActivitySummary: () => Promise.resolve({ since: 0, nodes: {}, pairs: {}, runNodes: [] }),
  getNodeActivity: () =>
    Promise.resolve({
      stats: { count: 0, lastStartAt: 0, distinctOwners: 0 },
      recent: [],
      spawns: [],
      captureEnabled: false,
      runs: [],
    }),
  clearNodeActivity: () => Promise.resolve(),
  clearSessionJournal: () => Promise.resolve(),
  getSessionJournal: () => Promise.resolve({ sessions: [], recording: false, captureLevel: 'mcp', shellCapture: false }),
  setCaptureLevel: () => Promise.resolve('mcp'),
  setSessionRecording: (recording: boolean) => Promise.resolve(recording),
  getSpawnRecord: () => Promise.resolve(null),
  getActivityCapture: () => Promise.resolve({ enabled: false }),
  setActivityCapture: () => Promise.resolve({ enabled: false }),
  setPluginEnabled: () =>
    Promise.resolve({
      schemaVersion: '1',
      kind: 'plugins',
      items: [],
      filters: {},
      counts: { total: 0, returned: 0 },
      kindRegistry: {},
    }),
  setPluginExtensionEnabled: () =>
    Promise.resolve({
      schemaVersion: '1',
      kind: 'plugins',
      items: [],
      filters: {},
      counts: { total: 0, returned: 0 },
      kindRegistry: {},
    }),
  setPluginTrusted: () =>
    Promise.resolve({
      schemaVersion: '1',
      kind: 'plugins',
      items: [],
      filters: {},
      counts: { total: 0, returned: 0 },
      kindRegistry: {},
    }),
  applyPluginChanges: () =>
    Promise.resolve({
      schemaVersion: '1',
      kind: 'plugins',
      items: [],
      filters: {},
      counts: { total: 0, returned: 0 },
      kindRegistry: {},
    }),
  runScan: () =>
    Promise.resolve({
      schemaVersion: 1,
      scannedAt: 0,
      roots: [],
      nodes: [],
      links: [],
      issues: [],
      enrichments: [],
      contributions: [],
      stats: { totalNodes: 0, totalLinks: 0, totalIssues: 0 },
    } as unknown as Awaited<ReturnType<IDataSourcePort['runScan']>>),
  lookupContribution: () => Promise.resolve(null),
  dispatchAction: () =>
    Promise.resolve({
      schemaVersion: '1',
      kind: 'action.applied',
      value: { actionId: 'core/node-bump', nodePath: '' },
      elapsedMs: 0,
    }),
  getUpdateStatus: () =>
    Promise.resolve({
      current: '0.0.0',
      latest: null,
      isOutdated: false,
      checkedAt: null,
      shownAt: null,
    }),
  getRegisteredAnnotations: () => Promise.resolve([]),
  // Default stub answers "unknown", which renders no star affordance;
  // the tests that assert the affordance override it.
  getGithubStars: () => Promise.resolve({ count: null, checkedAt: null }),
  events: () => EMPTY,
};

interface IUpdateStatusStub {
  current: string;
  latest: string | null;
  isOutdated: boolean;
  checkedAt: number | null;
  shownAt: number | null;
}

/**
 * Construct an `UpdateCheckService`-shaped stub without going through
 * Angular DI. The service now injects `DATA_SOURCE` via a field
 * initializer, so `new UpdateCheckService()` outside an injection
 * context throws NG0203. Tests don't need the data-source plumbing,
 * so we cast a minimal signal bag to the service type and feed it into
 * the App via the `useValue` provider. The service's own `status` is
 * read-only (`asReadonly()`), so the writable backing signal is handed
 * back alongside the stub for the tests to drive.
 */
function makeUpdateCheckStub(): {
  service: UpdateCheckService;
  status: WritableSignal<IUpdateStatusStub | null>;
} {
  const status = signal<IUpdateStatusStub | null>(null);
  const service = {
    status,
    isOutdated: computed(() => status()?.isOutdated === true),
    latest: computed(() => status()?.latest ?? null),
    current: computed(() => status()?.current ?? null),
    load: async () => undefined,
  } as unknown as UpdateCheckService;
  return { service, status };
}

/**
 * Wire the standard TestBed providers for the shell, swapping in a
 * real-but-pre-seeded `UpdateCheckService` so tests drive the chip
 * via its writable `status` signal. We never call `load()` in tests,
 * the network is not stubbed and the service silences fetch errors,
 * so it would be a no-op anyway. Driving `status` directly keeps the
 * computed `isOutdated` / `latest` derivations exercised end-to-end.
 */
async function configure(
  updateStub: UpdateCheckService,
  dataSource: IDataSourcePort = STUB_DATA_SOURCE,
): Promise<void> {
  await TestBed.configureTestingModule({
    imports: [App],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: DATA_SOURCE, useValue: dataSource },
      // The shell mounts <sm-demo-banner>, which reads SKILL_MAP_MODE on
      // construction; provide it explicitly (the token has no default).
      { provide: SKILL_MAP_MODE, useValue: 'live' },
      // Keep the live-mode WS service from opening a real socket (see
      // inertWsSocketFactory): without this it logs connection failures.
      { provide: WS_SOCKET_FACTORY, useValue: inertWsSocketFactory },
      { provide: UpdateCheckService, useValue: updateStub },
    ],
  }).compileComponents();
}

describe('App', () => {
  beforeEach(async () => {
    // Default stub: no update available, keeps the existing assertions
    // (heading, app construction) passing without touching the chip.
    await configure(makeUpdateCheckStub().service);
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('the topbar theme menu picks base modes and extra themes through the ThemeService', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const app = fixture.componentInstance as unknown as {
      pickThemeMode(mode: 'auto' | 'light' | 'dark'): void;
      pickExtraTheme(id: string): void;
      themeIcon(): string;
      themeTrigger(): string;
    };
    const theme = TestBed.inject(ThemeService);
    const root = document.documentElement;

    app.pickExtraTheme('matrix');
    TestBed.tick();
    expect(theme.extraTheme()).toBe('matrix');
    expect(root.classList.contains('app-matrix')).toBe(true);
    expect(app.themeIcon()).toBe('pi pi-palette');
    expect(app.themeTrigger()).toContain('Matrix');

    // A base mode clears the extra theme, the three of them still work.
    app.pickThemeMode('light');
    TestBed.tick();
    expect(theme.extraTheme()).toBeNull();
    expect(theme.mode()).toBe('light');
    expect(root.classList.contains('app-matrix')).toBe(false);
    expect(app.themeIcon()).toBe('pi pi-sun');

    app.pickThemeMode('auto');
    TestBed.tick();
    expect(theme.mode()).toBe('auto');
    expect(app.themeIcon()).toBe('pi pi-desktop');
  });

  it('should render the prototype heading', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('skill-map');
  });

  it('mounts the ignore-confirm dialog from the shell and routes the decision back', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();

    // Drive the REAL root service (the stub data source implements the
    // preferences + ignore reads): the shell's @defer mount must render
    // the dialog the moment the service opens it.
    const svc = TestBed.inject(ProjectIgnoreService);
    const outcome = await svc.requestIgnore('docs/notes.md', 'file', 'files');
    expect(outcome).toBe('dialog');
    await fixture.whenStable();
    fixture.detectChanges();

    // appendTo="body" portals the dialog content outside the fixture host.
    expect(document.body.querySelector('[data-testid="ignore-confirm-dialog"]')).not.toBeNull();
    expect(
      document.body.querySelector('[data-testid="ignore-confirm-pattern"]')?.textContent,
    ).toBe('/docs/notes.md');

    // Accepting through the rendered button routes the decision back into
    // the service (the shell's (decision) wiring) and closes the dialog.
    const accept = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="ignore-confirm-accept"] button',
    );
    expect(accept).not.toBeNull();
    accept!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(svc.dialogOpen()).toBe(false);
  });

  it('exposes a skip-to-content link targeting the main region (WCAG 2.4.1)', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const skip = root.querySelector('[data-testid="skip-to-main"]') as HTMLAnchorElement | null;
    expect(skip).not.toBeNull();
    expect(skip?.getAttribute('href')).toBe('#shell-main');
    const main = root.querySelector('main.shell__main');
    expect(main?.getAttribute('id')).toBe('shell-main');
    expect(main?.getAttribute('tabindex')).toBe('-1');
  });

  it('shows a persistent callout pointing at Quick Start while the tutorial reminder names it (step 0, the stub default)', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    // The stub data source's getProjectPreferences() omits
    // `tutorialReminderStep`, so the embedded banner defaults to step 0
    // (the Quick Start nudge) and emits `quickStartMentioned(true)` on
    // its own, proving the wiring end-to-end rather than just the
    // handler in isolation.
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="quick-start-callout"]')).not.toBeNull();

    const app = fixture.componentInstance as unknown as {
      quickStartHighlighted: () => boolean;
      onQuickStartMentioned: (mentioned: boolean) => void;
    };
    app.onQuickStartMentioned(false);
    expect(app.quickStartHighlighted()).toBe(false);
    fixture.detectChanges();
    expect(root.querySelector('[data-testid="quick-start-callout"]')).toBeNull();
  });
});

describe('App, update chip', () => {
  it('renders the chip when UpdateCheckService reports an outdated status', async () => {
    TestBed.resetTestingModule();
    const stub = makeUpdateCheckStub();
    stub.status.set({
      current: '0.18.0',
      latest: '0.19.0',
      isOutdated: true,
      checkedAt: 1700000000000,
      shownAt: null,
    });
    await configure(stub.service);

    const fixture = TestBed.createComponent(App);
    // The chip is also gated on `!isDevMode()` so a developer running
    // `npm run ui:dev` doesn't see a noisy "update available" hint. In
    // the test harness `isDevMode()` returns `true`, which would mask
    // the assertion below, override the instance flag to simulate the
    // prod-build path where the chip is allowed to render.
    (fixture.componentInstance as unknown as { isDevMode: boolean }).isDevMode = false;
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const chip = compiled.querySelector('[data-testid="shell-update-chip"]');
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute('aria-label')).toContain('0.19.0');
    const npmLink = compiled.querySelector('[data-testid="shell-update-npm-link"]');
    expect(npmLink).not.toBeNull();
    expect(npmLink?.getAttribute('href')).toContain('npmjs.com/package/@skill-map/cli');
  });

  it('omits the chip in dev mode even when an update is available', async () => {
    TestBed.resetTestingModule();
    const stub = makeUpdateCheckStub();
    stub.status.set({
      current: '0.18.0',
      latest: '0.19.0',
      isOutdated: true,
      checkedAt: 1700000000000,
      shownAt: null,
    });
    await configure(stub.service);

    const fixture = TestBed.createComponent(App);
    // `isDevMode()` is true under the test harness, no override needed.
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[data-testid="shell-update-chip"]')).toBeNull();
  });

  it('omits the chip when no update is available', async () => {
    TestBed.resetTestingModule();
    const stub = makeUpdateCheckStub();
    stub.status.set({
      current: '0.18.0',
      latest: '0.18.0',
      isOutdated: false,
      checkedAt: 1700000000000,
      shownAt: null,
    });
    await configure(stub.service);

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[data-testid="shell-update-chip"]')).toBeNull();
  });
});

describe('App, scan spinner', () => {
  it('marks the refresh button spinning + disabled while a scan is in flight', async () => {
    TestBed.resetTestingModule();
    // Gate the stub's `runScan` on a promise the test resolves, so the
    // real `ScanTriggerService.run()` drives `scanning` through its
    // actual lifecycle (`scanning` is read-only outside the service:
    // set on entry, cleared in the `finally`). The topbar `scanning()`
    // ORs it with the watcher's WS `scanActive`; this proves the
    // `is-spinning` class binding is reactive, the CSS animation hangs
    // off that class.
    let finishScan!: () => void;
    const scanGate = new Promise<void>((resolve) => { finishScan = resolve; });
    await configure(makeUpdateCheckStub().service, {
      ...STUB_DATA_SOURCE,
      runScan: async () => {
        await scanGate;
        return STUB_DATA_SOURCE.runScan();
      },
    });

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();

    const btn = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-testid="shell-refresh"]',
    )!;
    expect(btn).not.toBeNull();
    expect(btn.classList.contains('is-spinning')).toBe(false);
    expect(btn.disabled).toBe(false);

    const runDone = TestBed.inject(ScanTriggerService).run();
    fixture.detectChanges();
    expect(btn.classList.contains('is-spinning')).toBe(true);
    expect(btn.disabled).toBe(true);

    finishScan();
    await runDone;
    fixture.detectChanges();
    expect(btn.classList.contains('is-spinning')).toBe(false);
    expect(btn.disabled).toBe(false);
  });
});

describe('App, scan error surface', () => {
  it('tints the refresh button and swaps its tooltip strings while scanError is set', async () => {
    TestBed.resetTestingModule();
    // First run() rejects so the service's own catch branch persists
    // the message (`scanError` is read-only outside the service); the
    // second run() succeeds and must clear it on entry. The button must
    // surface the failure (UX: a failed manual scan is never silent).
    let failScan = true;
    await configure(makeUpdateCheckStub().service, {
      ...STUB_DATA_SOURCE,
      runScan: () => failScan
        ? Promise.reject(new Error('boom: db locked'))
        : STUB_DATA_SOURCE.runScan(),
    });

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();

    const btn = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-testid="shell-refresh"]',
    )!;
    expect(btn.classList.contains('is-error')).toBe(false);
    expect(btn.getAttribute('aria-label')).not.toContain('Scan failed');

    const scanTrigger = TestBed.inject(ScanTriggerService);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await scanTrigger.run();
    fixture.detectChanges();
    expect(btn.classList.contains('is-error')).toBe(true);
    expect(btn.getAttribute('aria-label')).toContain('Scan failed: boom: db locked');

    failScan = false;
    await scanTrigger.run();
    warnSpy.mockRestore();
    fixture.detectChanges();
    expect(btn.classList.contains('is-error')).toBe(false);
    expect(btn.getAttribute('aria-label')).not.toContain('Scan failed');
  });
});

describe('App, Real Time toggle', () => {

  /** Readiness stub: the gate state is driven per-test, no probing. */
  function readinessStub(hookInstalled: boolean | null): ActivityReadinessService {
    return {
      hookInstalled: signal(hookInstalled).asReadonly(),
      refresh: () => Promise.resolve(),
    } as unknown as ActivityReadinessService;
  }

  async function configureWithReadiness(hookInstalled: boolean | null): Promise<void> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: DATA_SOURCE, useValue: STUB_DATA_SOURCE },
        { provide: SKILL_MAP_MODE, useValue: 'live' },
        { provide: WS_SOCKET_FACTORY, useValue: inertWsSocketFactory },
        { provide: UpdateCheckService, useValue: makeUpdateCheckStub().service },
        { provide: ActivityReadinessService, useValue: readinessStub(hookInstalled) },
      ],
    }).compileComponents();
  }

  function toggleButton(root: HTMLElement): HTMLButtonElement {
    return root.querySelector<HTMLButtonElement>(
      '[data-testid="shell-live-activity-toggle"] button',
    )!;
  }

  it('follows the setup rocket in the actions cluster and toggles the shared activity preference', async () => {
    await configureWithReadiness(true);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const actions = root.querySelector('.shell__actions')!;
    // The Real Time toggle wrapper (which hosts the button) leads the
    // cluster; the Quick Start rocket sits to its right. Compared by DOM
    // order (not a fixed child index): the stub's default step-0 reminder
    // renders a callout sibling right before the Quick Start wrap, which
    // would shift a fixed index.
    expect(actions.firstElementChild?.getAttribute('data-testid')).toBe(
      'shell-live-activity-tooltip-wrap',
    );
    const liveActivityWrap = root.querySelector('[data-testid="shell-live-activity-tooltip-wrap"]')!;
    const quickStartWrap = root.querySelector('[data-testid="action-quick-start"]')!;
    expect(
      liveActivityWrap.compareDocumentPosition(quickStartWrap) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const btn = toggleButton(root);
    expect(btn.disabled).toBe(false);

    const activity = TestBed.inject(NodeActivityService);
    const persistSpy = vi.spyOn(STUB_DATA_SOURCE, 'setProjectPreferences');
    expect(activity.enabled()).toBe(true);
    btn.click();
    fixture.detectChanges();
    expect(activity.enabled()).toBe(false);
    // The preference persisted through the SAME owner Settings uses,
    // now a project-preferences PATCH (settings.local.json) instead of
    // the retired localStorage key.
    expect(persistSpy).toHaveBeenCalledWith({ ui: { realtimeActivity: false } });
    btn.click();
    fixture.detectChanges();
    expect(activity.enabled()).toBe(true);
    persistSpy.mockRestore();
  });

  it('disables when live updates are off (WS gate)', async () => {
    await configureWithReadiness(true);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();

    TestBed.inject(WsEventStreamService).setEnabled(false);
    fixture.detectChanges();
    expect(toggleButton(fixture.nativeElement as HTMLElement).disabled).toBe(true);
  });

  it('disables when the hook is known-missing, and FAILS OPEN on unknown', async () => {
    await configureWithReadiness(false);
    const missing = TestBed.createComponent(App);
    await missing.whenStable();
    missing.detectChanges();
    expect(toggleButton(missing.nativeElement as HTMLElement).disabled).toBe(true);

    await configureWithReadiness(null);
    const unknown = TestBed.createComponent(App);
    await unknown.whenStable();
    unknown.detectChanges();
    expect(toggleButton(unknown.nativeElement as HTMLElement).disabled).toBe(false);
  });
});

describe('App, beta chip', () => {
  it('shows the beta chip', async () => {
    TestBed.resetTestingModule();
    await configure(makeUpdateCheckStub().service);

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();

    const chip = (fixture.nativeElement as HTMLElement).querySelector('.shell__beta');
    expect(chip?.textContent?.trim()).toBe('BETA');
  });
});

describe('App, brand links', () => {
  /**
   * The mark and the wordmark point at DIFFERENT places (site vs
   * repository) and both open a new tab. The pairing is easy to swap by
   * accident, and `target="_blank"` without `rel="noopener"` hands the
   * opened page a handle on this one, so both are pinned here.
   */
  async function brandLinks(): Promise<{ mark: HTMLAnchorElement; wordmark: HTMLAnchorElement }> {
    TestBed.resetTestingModule();
    await configure(makeUpdateCheckStub().service);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    return {
      mark: root.querySelector('[data-testid="shell-brand-mark-link"]') as HTMLAnchorElement,
      wordmark: root.querySelector(
        '[data-testid="shell-brand-wordmark-link"]',
      ) as HTMLAnchorElement,
    };
  }

  it('sends the mark to the project site and the wordmark to the repository', async () => {
    const { mark, wordmark } = await brandLinks();

    expect(mark.getAttribute('href')).toBe(PROJECT_LINKS.website);
    expect(wordmark.getAttribute('href')).toBe(PROJECT_LINKS.github);
    expect(wordmark.textContent?.trim()).toBe(APP_TEXTS.brand);
  });

  it('opens both in a new tab without leaking a window handle', async () => {
    const { mark, wordmark } = await brandLinks();

    for (const link of [mark, wordmark]) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
    }
  });

  it('names both links, since the mark image is decorative', async () => {
    const { mark, wordmark } = await brandLinks();

    // Without this the mark's link has no accessible name at all: its
    // <img> is aria-hidden with an empty alt.
    expect(mark.getAttribute('aria-label')).toBe(APP_TEXTS.brandMarkLinkA11y);
    expect(wordmark.getAttribute('aria-label')).toBe(APP_TEXTS.brandWordmarkLinkA11y);
    // Two adjacent links to different destinations must not read alike.
    expect(mark.getAttribute('aria-label')).not.toBe(wordmark.getAttribute('aria-label'));
  });

  it('keeps the wordmark inside the heading', async () => {
    const { wordmark } = await brandLinks();
    expect(wordmark.closest('h1')).not.toBeNull();
  });
});

/**
 * Star affordance in the action cluster (user decision 2026-08-03:
 * placement 3 + the About card). It renders ONLY when a count arrived:
 * skill-map is expected to work with no network, so a zero or an error
 * in the chrome would make a healthy offline install look broken. The
 * service collapses toggle-off / offline / rate-limited into one `null`
 * precisely so the template has a single condition.
 */
describe('App, GitHub star affordance', () => {
  async function shellWithStars(count: number | null): Promise<HTMLElement> {
    TestBed.resetTestingModule();
    await configure(makeUpdateCheckStub().service, {
      ...STUB_DATA_SOURCE,
      getGithubStars: () => Promise.resolve({ count, checkedAt: count === null ? null : 1 }),
    });
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the count and links to the repository in a new tab', async () => {
    const root = await shellWithStars(27);

    const link = root.querySelector('[data-testid="shell-stars"]') as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain('27');
    expect(link?.getAttribute('href')).toBe(PROJECT_LINKS.github);
    expect(link?.getAttribute('href')).toBe(PROJECT_LINKS.github);
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toContain('noopener');
  });

  it('renders NOTHING when the count is unknown', async () => {
    // Offline, rate-limited, or opted out: all arrive as null, and none
    // of them may leave a zero, an error or a placeholder on screen.
    const root = await shellWithStars(null);

    expect(root.querySelector('[data-testid="shell-stars"]')).toBeNull();
    // No placeholder either: not a dash, not a zero, not a spinner.
    expect(root.querySelector('.shell__stars')).toBeNull();
    expect(root.textContent).not.toContain(APP_TEXTS.starsTooltip);
  });

  it('shortens a big count but keeps the exact figure reachable', async () => {
    // User call 2026-08-03: compact in the chip, since the row already
    // scrolls on narrow windows. Compact loses precision, so the
    // accessible name carries the full number instead of hiding it.
    const root = await shellWithStars(123_456);

    const link = root.querySelector('[data-testid="shell-stars"]');
    expect(link?.textContent).toContain('123.5K');
    expect(link?.textContent).not.toContain('123456');
    expect(link?.getAttribute('aria-label')).toContain('123,456');
  });

  it('leaves a count under a thousand literal', async () => {
    const root = await shellWithStars(999);

    expect(root.querySelector('[data-testid="shell-stars"]')?.textContent).toContain('999');
  });

  it('names the link with the count for screen readers', async () => {
    const root = await shellWithStars(1);

    const link = root.querySelector('[data-testid="shell-stars"]');
    // Singular at 1: the label is read aloud, not just scanned.
    expect(link?.getAttribute('aria-label')).toBe(APP_TEXTS.starsA11y(1));
    expect(link?.getAttribute('aria-label')).toContain('1 star so far');
    expect(APP_TEXTS.starsA11y(123_456)).toContain('123,456 stars so far');
  });
});
