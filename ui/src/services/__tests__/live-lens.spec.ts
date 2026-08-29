/**
 * `LiveLensService` unit tests: the watermark membership (executing ∪
 * recent-inside-window), the reset watermark, the infinite window, the
 * single self-rearming expiry timer, the stale-`lastStartAt` union
 * guarantee, and the debounced full-membership branch fetch.
 *
 * Time control: fake timers + `setSystemTime`, so `Date.now()` inside
 * the membership computed and the timer wheel advance in lock-step.
 * Effects flush via `TestBed.tick()`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import type { INodeActivityStatsApi, IScanResultApi } from '../../models/api';
import { ActivityPlaybackService } from '../activity-playback';
import type { IPlaybackState } from '../activity-playback-state';
import { AgentSpawnService, type ISpawnView } from '../agent-spawn';
import { CollectionLoaderService } from '../collection-loader';
import { DATA_SOURCE } from '../data-source/data-source.port';
import { SKILL_MAP_MODE, type TSkillMapMode } from '../data-source/runtime-mode';
import { LiveLensService } from '../live-lens';
import { NodeActivityService, type INodeInvocation } from '../node-activity';
import { NodeActivityStatsService } from '../node-activity-stats';

const T0 = 1_700_000_000_000;
const SKILL = '.claude/skills/deploy/SKILL.md';
const AGENT = '.claude/agents/reviewer.md';

function scanMetaFixture(): IScanResultApi {
  return {
    schemaVersion: 1,
    scannedAt: T0,
    roots: ['/tmp/x'],
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
  };
}

function apiNode(path: string): Record<string, unknown> {
  return {
    path,
    kind: 'markdown',
    provider: 'claude',
    bodyHash: 'a'.repeat(64),
    frontmatterHash: 'b'.repeat(64),
    bytes: { frontmatter: 10, body: 90, total: 100 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
  };
}

function statsOf(lastStartAt: number): INodeActivityStatsApi {
  return { count: 1, lastStartAt, distinctOwners: 1 };
}

const EMPTY_PLAYBACK_STATE: IPlaybackState = {
  executing: new Set(),
  details: new Map(),
  members: new Set(),
  trail: [],
  invocations: [],
  spawns: [],
  coLitPairs: new Set(),
  caption: null,
  virtualNowMs: 0,
};

function bootstrap(mode: TSkillMapMode = 'live') {
  TestBed.resetTestingModule();
  const activePaths = signal<ReadonlySet<string>>(new Set());
  const enabled = signal(true);
  const activeInvocations = signal<readonly INodeInvocation[]>([]);
  const spawnEdges = signal<readonly ISpawnView[]>([]);
  const playbackActive = signal(false);
  const playbackState = signal<IPlaybackState>(EMPTY_PLAYBACK_STATE);
  const playbackExit = vi.fn(() => playbackActive.set(false));
  const stats = signal<ReadonlyMap<string, INodeActivityStatsApi>>(new Map());
  const scanMeta = signal<IScanResultApi | null>(scanMetaFixture());
  const loadBranch = vi.fn().mockResolvedValue({ nodes: [], links: [], issues: [] });
  TestBed.configureTestingModule({
    providers: [
      {
        provide: NodeActivityService,
        useValue: {
          activePaths: activePaths.asReadonly(),
          enabled: enabled.asReadonly(),
          activeInvocations: activeInvocations.asReadonly(),
        } as unknown as NodeActivityService,
      },
      {
        provide: NodeActivityStatsService,
        useValue: { stats: stats.asReadonly() } as unknown as NodeActivityStatsService,
      },
      {
        provide: AgentSpawnService,
        useValue: { spawnEdges: spawnEdges.asReadonly() } as unknown as AgentSpawnService,
      },
      {
        provide: ActivityPlaybackService,
        useValue: {
          active: playbackActive.asReadonly(),
          state: playbackState.asReadonly(),
          exit: playbackExit,
        } as unknown as ActivityPlaybackService,
      },
      {
        provide: CollectionLoaderService,
        useValue: { scanMeta: scanMeta.asReadonly() } as unknown as CollectionLoaderService,
      },
      { provide: DATA_SOURCE, useValue: { loadBranch } },
      { provide: SKILL_MAP_MODE, useValue: mode },
    ],
  });
  const service = TestBed.inject(LiveLensService);
  return {
    service,
    activePaths,
    enabled,
    activeInvocations,
    spawnEdges,
    stats,
    loadBranch,
    playbackActive,
    playbackState,
    playbackExit,
  };
}

describe('LiveLensService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('membership is empty while the lens is off, whatever is executing', () => {
    const { service, activePaths } = bootstrap();
    activePaths.set(new Set([SKILL]));
    expect(service.membership().size).toBe(0);
  });

  it('activating shows the currently-executing nodes', () => {
    const { service, activePaths } = bootstrap();
    activePaths.set(new Set([SKILL, AGENT]));
    service.setActive(true);
    expect([...service.membership()].sort()).toEqual([AGENT, SKILL].sort());
  });

  it('a departed node STAYS on the canvas; nothing ages out mid-session (window removed 2026-08-16)', () => {
    const { service, activePaths } = bootstrap();
    service.setActive(true);
    activePaths.set(new Set([SKILL]));
    TestBed.tick();
    activePaths.set(new Set());
    TestBed.tick(); // departure stamp
    expect(service.membership().has(SKILL)).toBe(true);

    vi.advanceTimersByTime(30 * 60_000);
    TestBed.tick();
    expect(service.membership().has(SKILL)).toBe(true);
  });

  it('recency from stats().lastStartAt counts, so pre-toggle activity shows', () => {
    const { service, stats } = bootstrap();
    stats.set(new Map([[SKILL, statsOf(T0 - 60_000)]])); // 1 min ago
    service.setActive(true);
    expect(service.membership().has(SKILL)).toBe(true);
  });

  it('a stale lastStartAt is overridden by the executing union', () => {
    const { service, activePaths, stats } = bootstrap();
    // Counted start far outside the window, but the agent still runs.
    stats.set(new Map([[AGENT, statsOf(T0 - 60 * 60_000)]]));
    activePaths.set(new Set([AGENT]));
    service.setActive(true);
    expect(service.membership().has(AGENT)).toBe(true);
  });

  it('reset drops the lingering set but keeps executing nodes', () => {
    const { service, activePaths, stats } = bootstrap();
    stats.set(new Map([[SKILL, statsOf(T0 - 1000)]]));
    activePaths.set(new Set([AGENT]));
    service.setActive(true);
    expect(service.membership().has(SKILL)).toBe(true);

    vi.advanceTimersByTime(10);
    service.reset();
    TestBed.tick();
    expect(service.membership().has(SKILL)).toBe(false);
    expect(service.membership().has(AGENT)).toBe(true);
  });

  it('the canvas accumulates indefinitely, until reset', () => {
    const { service, activePaths } = bootstrap();
    service.setActive(true);
    activePaths.set(new Set([SKILL]));
    TestBed.tick();
    activePaths.set(new Set());
    TestBed.tick();

    vi.advanceTimersByTime(3 * 60 * 60_000);
    TestBed.tick();
    expect(service.membership().has(SKILL)).toBe(true);

    service.reset();
    TestBed.tick();
    expect(service.membership().has(SKILL)).toBe(false);
  });

  it('re-execution re-adds a node the reset cleared', () => {
    const { service, activePaths } = bootstrap();
    service.setActive(true);
    activePaths.set(new Set([SKILL]));
    TestBed.tick();
    activePaths.set(new Set());
    TestBed.tick();
    service.reset();
    TestBed.tick();
    expect(service.membership().has(SKILL)).toBe(false);

    activePaths.set(new Set([SKILL]));
    TestBed.tick();
    expect(service.membership().has(SKILL)).toBe(true);
  });

  it('Real Time off force-deactivates the lens', () => {
    const { service, enabled } = bootstrap();
    service.setActive(true);
    expect(service.active()).toBe(true);
    enabled.set(false);
    TestBed.tick();
    expect(service.active()).toBe(false);
  });

  it('demo mode reports unavailable and a plain setActive no-ops', () => {
    const { service } = bootstrap('demo');
    expect(service.available()).toBe(false);
    service.setActive(true);
    expect(service.active()).toBe(false);
  });

  it('demo mode admits the lens WHILE a replay is in flight (curated recordings)', () => {
    const { service, playbackActive } = bootstrap('demo');
    expect(service.replayAvailable()).toBe(true);
    playbackActive.set(true);
    service.setActive(true);
    expect(service.active()).toBe(true);
    // Exit is always legal, replay over or not.
    playbackActive.set(false);
    service.setActive(false);
    expect(service.active()).toBe(false);
  });

  it('membership growth fetches the FULL membership once, debounced', async () => {
    const { service, activePaths, loadBranch } = bootstrap();
    loadBranch.mockResolvedValue({
      nodes: [apiNode(SKILL), apiNode(AGENT)],
      links: [],
      issues: [],
    });
    service.setActive(true);
    activePaths.set(new Set([SKILL]));
    TestBed.tick();
    activePaths.set(new Set([SKILL, AGENT]));
    TestBed.tick();

    await vi.advanceTimersByTimeAsync(400);
    expect(loadBranch).toHaveBeenCalledTimes(1);
    expect(loadBranch).toHaveBeenCalledWith({
      include: [AGENT, SKILL].sort(),
      exclude: [],
      excludeRoot: true,
    });
    TestBed.tick();
    expect(service.lensNodes().map((n) => n.path)).toEqual([AGENT, SKILL].sort());
  });

  it('lensScan carries only links whose BOTH endpoints are live', async () => {
    const { service, activePaths, loadBranch } = bootstrap();
    loadBranch.mockResolvedValue({
      nodes: [apiNode(SKILL), apiNode(AGENT)],
      links: [
        { source: SKILL, target: AGENT, kind: 'invokes', confidence: 0.9, sources: ['ext'] },
        { source: SKILL, target: 'other.md', kind: 'invokes', confidence: 0.9, sources: ['ext'] },
      ],
      issues: [],
    });
    service.setActive(true);
    activePaths.set(new Set([SKILL, AGENT]));
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(400);
    TestBed.tick();

    const scan = service.lensScan();
    expect(scan?.nodes.map((n) => n.path)).toEqual([AGENT, SKILL].sort());
    expect(scan?.links).toHaveLength(1);
    expect(scan?.links[0]?.target).toBe(AGENT);
    expect(scan?.issues).toEqual([]);
  });

  it('cached members do not refetch when membership shrinks', async () => {
    const { service, activePaths, loadBranch } = bootstrap();
    loadBranch.mockResolvedValue({
      nodes: [apiNode(SKILL), apiNode(AGENT)],
      links: [],
      issues: [],
    });
    service.setActive(true);
    activePaths.set(new Set([SKILL, AGENT]));
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(400);
    TestBed.tick();
    expect(loadBranch).toHaveBeenCalledTimes(1);

    // AGENT departs; SKILL alone is fully cached, no new fetch.
    activePaths.set(new Set([SKILL]));
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(400);
    expect(loadBranch).toHaveBeenCalledTimes(1);
  });

  it('an observed invocation outlives the live overlay while both ends are members', () => {
    const { service, activePaths, activeInvocations } = bootstrap();
    service.setActive(true);
    activePaths.set(new Set([SKILL, AGENT]));
    activeInvocations.set([{ target: SKILL, caller: AGENT, detail: 'mcp__db__query' }]);
    TestBed.tick(); // sighting stamped

    // The live invocation TTL sweeps it away; the observation persists.
    activeInvocations.set([]);
    TestBed.tick();
    expect(service.observedInvocations()).toHaveLength(1);
    expect(service.observedInvocations()[0]?.label).toBe('mcp__db__query');

    // Reset clears the accumulated relations along with the canvas.
    vi.advanceTimersByTime(10);
    service.reset();
    TestBed.tick();
    expect(service.observedInvocations()).toHaveLength(0);
  });

  it('a bare main-session invocation (null caller) never records an edge', () => {
    const { service, activePaths, activeInvocations } = bootstrap();
    service.setActive(true);
    activePaths.set(new Set([SKILL]));
    activeInvocations.set([{ target: SKILL, caller: null, detail: 'mcp__db__query' }]);
    TestBed.tick();
    expect(service.observedInvocations()).toHaveLength(0);
  });

  it('an observed spawn keeps its last spawnId after the live spawn ends', () => {
    const { service, activePaths, spawnEdges } = bootstrap();
    service.setActive(true);
    activePaths.set(new Set([SKILL, AGENT]));
    spawnEdges.set([
      { spawnId: 'toolu_01', parentOwner: 'main:abc', parentNodePath: AGENT, childNodePath: SKILL },
    ]);
    TestBed.tick();

    spawnEdges.set([]); // the end frame released the live entry
    TestBed.tick();
    expect(service.observedSpawns()).toHaveLength(1);
    expect(service.observedSpawns()[0]?.lastSpawnId).toBe('toolu_01');
  });

  it('session-parent spawns (no parent node) are not recorded', () => {
    const { service, activePaths, spawnEdges } = bootstrap();
    service.setActive(true);
    activePaths.set(new Set([SKILL]));
    spawnEdges.set([
      { spawnId: 'toolu_02', parentOwner: 'main:abc', parentSession: 'main:abc', childNodePath: SKILL },
    ]);
    TestBed.tick();
    expect(service.observedSpawns()).toHaveLength(0);
  });

  it('a spine pair persists after the glow and expires with the watermark', async () => {
    const { service, activePaths, loadBranch } = bootstrap();
    loadBranch.mockResolvedValue({
      nodes: [apiNode(SKILL), apiNode(AGENT)],
      links: [
        { source: AGENT, target: SKILL, kind: 'invokes', confidence: 0.9, sources: ['ext'] },
      ],
      issues: [],
    });
    service.setActive(true);
    activePaths.set(new Set([SKILL, AGENT]));
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(400); // link cache fill
    TestBed.tick(); // spine sighting stamped against the cached link

    const key = `${AGENT}|${SKILL}`;
    expect(service.observedSpinePairs().has(key)).toBe(true);

    // Glow ends: the spine treatment persists (nothing ages out by
    // time since the window removal); only the reset watermark clears.
    activePaths.set(new Set());
    TestBed.tick();
    expect(service.observedSpinePairs().has(key)).toBe(true);

    vi.advanceTimersByTime(60 * 60_000);
    TestBed.tick();
    expect(service.observedSpinePairs().has(key)).toBe(true);

    vi.advanceTimersByTime(10);
    service.reset();
    TestBed.tick();
    expect(service.observedSpinePairs().has(key)).toBe(false);
  });

  it('a trigger-style link (raw @target, resolvedTarget set) spine-pairs and renders (queue item 9)', async () => {
    const { service, activePaths, loadBranch } = bootstrap();
    loadBranch.mockResolvedValue({
      nodes: [apiNode(SKILL), apiNode(AGENT)],
      links: [
        // The authored trigger stays in `target`; only `resolvedTarget`
        // carries the real node path (the graph keys its edges on it).
        {
          source: AGENT,
          target: '@deploy',
          kind: 'invokes',
          confidence: 1,
          sources: ['ext'],
          resolvedTarget: SKILL,
        },
      ],
      issues: [],
    });
    service.setActive(true);
    activePaths.set(new Set([SKILL, AGENT]));
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(400); // link cache fill
    TestBed.tick();

    // Spine pair keyed on the RESOLVED endpoint, the edge convention.
    expect(service.observedSpinePairs().has(`${AGENT}|${SKILL}`)).toBe(true);
    // And the lens scan carries the link (raw-target filtering dropped it).
    expect(service.lensScan()?.links).toHaveLength(1);
  });

  it('replay switches membership and relations to the playback fold', () => {
    const { service, activePaths, playbackActive, playbackState } = bootstrap();
    service.setActive(true);
    activePaths.set(new Set([AGENT])); // live watermark would show AGENT only

    playbackActive.set(true);
    playbackState.set({
      ...EMPTY_PLAYBACK_STATE,
      members: new Set([SKILL]),
      invocations: [
        { key: `${AGENT}>>${SKILL}`, caller: AGENT, target: SKILL, label: 'query', lastSeenAt: T0 },
      ],
      coLitPairs: new Set([`${AGENT}|${SKILL}`]),
    });
    expect([...service.membership()]).toEqual([SKILL]);
    expect(service.observedInvocations()).toHaveLength(1);
    expect(service.observedSpinePairs().has(`${AGENT}|${SKILL}`)).toBe(true);

    // Replay off: back to the live watermark instantly.
    playbackActive.set(false);
    expect(service.membership().has(AGENT)).toBe(true);
    expect(service.membership().has(SKILL)).toBe(false);
  });

  it('deactivating the lens exits the replay with it', () => {
    const { service, playbackActive, playbackExit } = bootstrap();
    service.setActive(true);
    playbackActive.set(true);
    service.setActive(false);
    TestBed.tick();
    expect(playbackExit).toHaveBeenCalled();
  });

  it('reset hides relations even when one endpoint keeps executing', () => {
    const { service, activePaths, activeInvocations, stats } = bootstrap();
    service.setActive(true);
    // AGENT executes and stays executing; SKILL only lingers via stats.
    stats.set(new Map([[SKILL, statsOf(T0 - 1000)]]));
    activePaths.set(new Set([AGENT]));
    activeInvocations.set([{ target: SKILL, caller: AGENT, detail: 'mcp__db__query' }]);
    TestBed.tick();
    activeInvocations.set([]);
    TestBed.tick();
    expect(service.observedInvocations()).toHaveLength(1);

    // Reset drops SKILL (linger-only member); AGENT survives as
    // executing, so the relation loses an endpoint and hides.
    vi.advanceTimersByTime(10);
    service.reset();
    TestBed.tick();
    expect(service.membership().has(AGENT)).toBe(true);
    expect(service.observedInvocations()).toHaveLength(0);
  });
});
