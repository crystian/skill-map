/**
 * Per-node execution-stats accumulator (see `spec/provider-activity.md`
 * §Execution stats). In-memory hot path, instantiated once in
 * `createServer`, CHECKPOINTED into the project DB: every mutation
 * marks its node / pair dirty, a short debounce hands the dirty rows to
 * the optional `sink` (`activity-stats-store.ts`, the `state_activity_*`
 * tables), and `hydrate()` adopts the rows back at boot so counts, the
 * recent log, the aggregates and the pair counters survive a restart.
 * Without a sink (tests, no DB) the accumulator is exactly the
 * memory-only service it used to be.
 *
 * Counting semantics (normative in the spec):
 *
 *   - Only node-attributed `phase: 'start'` payloads count. Ends,
 *     node-less owner releases and relation-only spawns never mutate.
 *   - `keepAlive` starts NEVER count and never touch the owner sets:
 *     custody is not an execution.
 *   - `sticky` starts count ONCE per `(nodePath, owner)` pair.
 *   - `access: 'shell'` starts COUNT like any other resource access
 *     (user decision 2026-08-30, reversing the 2026-08-18 no-count
 *     rule: the card's execution pill is the map's only per-node
 *     counter, and a sighted-only node was invisible there). The entry
 *     stays tagged `kind: 'shell'` in the typed recent log (both ends)
 *     so the inspector tells a sighting apart from a read; the
 *     session-journal fold admits it as a `reads` relation too.
 *   - Everything else (skill invocations, command expansions, markdown
 *     reads and writes) counts on every signal.
 *
 * Every bound below saturates or evicts oldest entries; hitting a cap
 * never errors and never blocks ingestion.
 */

import type { IActivityPairRow, IActivityStatsRow } from '../kernel/types/storage.js';
import type { INodeActivityEventData, INodeActivityStats } from './events.js';

/** Debounce window between a mutation and its checkpoint write. */
export const CHECKPOINT_FLUSH_MS = 250;

/** Distinct-owner set cap per node; the count saturates here. */
export const DISTINCT_OWNERS_CAP = 256;

/** Cap on tracked spawn pairs; new pairs past it are silently dropped. */
export const PAIR_CAP = 2048;

/**
 * Global cap on the sticky `(nodePath, owner)` dedupe memory, evicting
 * oldest-first past it. Deliberately generous: one entry per agent
 * INSTANCE per node, and a serve session sees at most a few hundred.
 */
export const STICKY_DEDUPE_CAP = 1024;

/** Per-node recent-executions ring size (most recent first). */
export const RECENT_RING_SIZE = 15;

/** Cap on the owner -> last-unit correlation memory (bounded, oldest-first eviction). */
const LAST_UNIT_OWNER_CAP = 256;

/** One recent-execution entry; `owner` absent on ownerless starts. */
export interface IActivityRecentEntry {
  at: number;
  owner?: string;
  /** Finer-grained label for the frame (the invoked MCP tool, etc.); absent when unreported. */
  detail?: string;
  /**
   * On an MCP node's entry: the invoker node path (who called the tool). On the
   * INVOKER's own mirrored entry this is absent and `target` is set instead, so
   * the two ends of one invocation carry the same `detail` from both sides.
   */
  caller?: string;
  /** On the INVOKER's mirrored entry: the accessed resource (mcp / read / write) node path. Absent on the resource's own entry. */
  target?: string;
  /** Access type of an invocation/read entry: `'mcp'` (tool call) or `'read'` (file). Absent on a plain execution. */
  kind?: 'mcp' | 'read' | 'write' | 'shell';
}

/** Per-node detail projection for the inspector endpoint. */
export interface IActivityNodeDetail {
  stats: INodeActivityStats;
  /** Most recent first, bounded by the ring size. */
  recent: IActivityRecentEntry[];
}

interface INodeStatsState {
  count: number;
  /** Unix ms of the node's first stat (the summary's `since` floor). */
  firstSeenAt: number;
  lastStartAt: number;
  lastOwner: string | undefined;
  owners: Set<string>;
  recent: IActivityRecentEntry[];
  /** Execution-summary sums (spec §Execution stats, node aggregates). */
  toolUses: number;
  tokens: number;
  summarizedRuns: number;
}

/** Per-pair spawn counter (spec §Execution stats, pair counters). */
export interface IActivityPairStats {
  count: number;
  lastStartAt: number;
}

/** Internal pair state: the counter plus the identities the checkpoint row needs. */
interface IPairState extends IActivityPairStats {
  parent: string;
  childNodePath: string;
}

/**
 * Checkpoint sink (`activity-stats-store.ts`): receives the dirty rows
 * once per debounce window. Best-effort by contract, a rejection is
 * swallowed and the rows stay dirty for the next window.
 */
export interface IActivityStatsSink {
  upsertNodes(rows: readonly IActivityStatsRow[]): Promise<void>;
  upsertPairs(rows: readonly IActivityPairRow[]): Promise<void>;
}

export interface IActivityStatsOptions {
  sink?: IActivityStatsSink;
  /** Override for tests; defaults to `CHECKPOINT_FLUSH_MS`. */
  flushDelayMs?: number;
}

/**
 * Directional pair key: parent identity (`parentNodePath` for agent
 * parents, `parentOwner` for session parents) plus the resolved child
 * node path. Mirrors the UI's edge-pair convention.
 */
export function pairKeyOf(parent: string, childNodePath: string): string {
  return `${parent}>>${childNodePath}`;
}

/**
 * True when a pair key names `nodePath` on either side (parent or
 * child). Both identities are separator-free, so a plain prefix/suffix
 * match is exact; mirrors the UI's `activityPairKeyTouches`.
 */
export function pairKeyTouches(key: string, nodePath: string): boolean {
  return key.startsWith(`${nodePath}>>`) || key.endsWith(`>>${nodePath}`);
}

export class ActivityStatsService {
  private readonly bootMs = Date.now();

  /**
   * The `since` of every summary snapshot: the earliest first-sighting
   * among the (hydrated or live) nodes, the boot time while empty.
   */
  get sinceMs(): number {
    let since = this.bootMs;
    for (const state of this.nodes.values()) {
      if (state.firstSeenAt < since) since = state.firstSeenAt;
    }
    return since;
  }

  private readonly nodes = new Map<string, INodeStatsState>();

  /** Spawn counters per directional pair, see `pairKeyOf`. */
  private readonly pairs = new Map<string, IPairState>();

  private readonly sink: IActivityStatsSink | undefined;
  private readonly flushDelayMs: number;
  private readonly dirtyNodes = new Set<string>();
  private readonly dirtyPairs = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> | null = null;

  constructor(options: IActivityStatsOptions = {}) {
    this.sink = options.sink;
    this.flushDelayMs = options.flushDelayMs ?? CHECKPOINT_FLUSH_MS;
  }

  /**
   * Adopt a checkpoint (boot). Replaces the in-memory maps wholesale
   * and marks nothing dirty: the rows came FROM the store. Malformed
   * entries are dropped one by one, never the whole checkpoint.
   */
  hydrate(nodes: readonly IActivityStatsRow[], pairs: readonly IActivityPairRow[]): void {
    this.nodes.clear();
    for (const row of nodes) {
      if (typeof row.nodePath !== 'string' || row.nodePath.length === 0) continue;
      this.nodes.set(row.nodePath, {
        count: row.count,
        firstSeenAt: row.firstSeenAt,
        lastStartAt: row.lastStartAt,
        lastOwner: row.lastOwner ?? undefined,
        owners: new Set(row.owners.slice(0, DISTINCT_OWNERS_CAP)),
        recent: row.recent.slice(0, RECENT_RING_SIZE).map((entry) => ({ ...entry }) as IActivityRecentEntry),
        toolUses: row.toolUses,
        tokens: row.tokens,
        summarizedRuns: row.summarizedRuns,
      });
    }
    this.pairs.clear();
    for (const row of pairs) {
      if (this.pairs.size >= PAIR_CAP) break;
      this.pairs.set(pairKeyOf(row.parent, row.childNodePath), {
        parent: row.parent,
        childNodePath: row.childNodePath,
        count: row.count,
        lastStartAt: row.lastStartAt,
      });
    }
  }

  /** Checkpoint rows for the given node paths (unknown paths skipped). */
  exportNodes(paths: Iterable<string>): IActivityStatsRow[] {
    const rows: IActivityStatsRow[] = [];
    for (const path of paths) {
      const state = this.nodes.get(path);
      if (!state) continue;
      rows.push({
        nodePath: path,
        count: state.count,
        firstSeenAt: state.firstSeenAt,
        lastStartAt: state.lastStartAt,
        lastOwner: state.lastOwner ?? null,
        owners: [...state.owners],
        recent: state.recent.map((entry) => ({ ...entry })),
        toolUses: state.toolUses,
        tokens: state.tokens,
        summarizedRuns: state.summarizedRuns,
      });
    }
    return rows;
  }

  /** Checkpoint rows for the given pair keys (unknown keys skipped). */
  exportPairs(keys: Iterable<string>): IActivityPairRow[] {
    const rows: IActivityPairRow[] = [];
    for (const key of keys) {
      const state = this.pairs.get(key);
      if (!state) continue;
      rows.push({
        parent: state.parent,
        childNodePath: state.childNodePath,
        count: state.count,
        lastStartAt: state.lastStartAt,
      });
    }
    return rows;
  }

  /**
   * Write every dirty row to the sink now (the debounce fires this;
   * `createServer`'s close calls it so a mutation in the last window
   * still lands). A rejected write keeps its rows dirty for the next
   * window; without a sink the dirty sets simply drain.
   */
  async flush(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.inflight) await this.inflight;
    const nodePaths = [...this.dirtyNodes];
    const pairKeys = [...this.dirtyPairs];
    this.dirtyNodes.clear();
    this.dirtyPairs.clear();
    if (!this.sink || (nodePaths.length === 0 && pairKeys.length === 0)) return;
    const sink = this.sink;
    const nodeRows = this.exportNodes(nodePaths);
    const pairRows = this.exportPairs(pairKeys);
    this.inflight = (async () => {
      try {
        if (nodeRows.length > 0) await sink.upsertNodes(nodeRows);
      } catch {
        for (const path of nodePaths) this.dirtyNodes.add(path);
      }
      try {
        if (pairRows.length > 0) await sink.upsertPairs(pairRows);
      } catch {
        for (const key of pairKeys) this.dirtyPairs.add(key);
      }
    })();
    await this.inflight;
    this.inflight = null;
  }

  private markNodeDirty(nodePath: string): void {
    this.dirtyNodes.add(nodePath);
    this.scheduleFlush();
  }

  private markPairDirty(key: string): void {
    this.dirtyPairs.add(key);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (!this.sink || this.flushTimer !== null) return;
    const timer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.flushDelayMs);
    // Never keep the process alive for a checkpoint.
    timer.unref?.();
    this.flushTimer = timer;
  }

  /**
   * Sticky dedupe memory, APPEND-ONLY by design: runtimes re-emit
   * lifecycle starts on pause/resume with the SAME owner id, and a
   * resume is not a new execution, so owners are NOT forgotten on
   * `ownerScope` ends (forgetting would recount every pause/resume
   * cycle). A fresh instance has a fresh owner id and counts again.
   * Insertion order doubles as age for the oldest-first eviction.
   */
  private readonly stickySeen = new Set<string>();

  /**
   * Owner -> most-recent NON-mcp unit lit under it. Drives caller attribution
   * for tool invocations: when an `mcp://` node records a detail-bearing start,
   * the unit last lit under the same owner is the invoker. Bounded (oldest-first
   * eviction); in-memory, dies with the process.
   */
  private readonly lastUnitByOwner = new Map<string, string>();

  /**
   * Apply one resolved `node.activity` payload. Returns a COPY of the
   * node's stats when the start counted, `null` when the payload never
   * mutates state (no node, an end, a keep-alive custody claim, or a
   * sticky pause/resume duplicate).
   */
  record(data: INodeActivityEventData): INodeActivityStats | null {
    if (data.nodePath === undefined || data.phase !== 'start') return null;
    if (data.keepAlive === true) return null;
    if (data.sticky === true && data.owner !== undefined) {
      if (!this.claimStickyOnce(data.nodePath, data.owner)) return null;
    }
    return this.count(data.nodePath, data.owner, data.detail, data.access);
  }

  /**
   * Count one spawn relation for its parent-child pair. Metadata only
   * (independent of the capture gate): counts `phase: 'start'` frames
   * whose child RESOLVED (an edge label needs both endpoints). Returns
   * the pair's current count for wire enrichment (`pairCount`), also
   * for non-start frames of an already-counted pair, or `null` when
   * the pair is untracked.
   */
  recordSpawn(spawn: {
    phase: 'start' | 'handoff' | 'end';
    parentOwner: string;
    parentNodePath?: string;
    childNodePath?: string;
  }): number | null {
    if (spawn.childNodePath === undefined) return null;
    const parent = spawn.parentNodePath ?? spawn.parentOwner;
    const key = pairKeyOf(parent, spawn.childNodePath);
    if (spawn.phase !== 'start') return this.pairs.get(key)?.count ?? null;
    return this.countPair(parent, spawn.childNodePath);
  }

  /** Increment one pair, honoring the cap for previously-unseen pairs. */
  private countPair(parent: string, childNodePath: string): number | null {
    const key = pairKeyOf(parent, childNodePath);
    const existing = this.pairs.get(key);
    if (!existing && this.pairs.size >= PAIR_CAP) return null;
    const state: IPairState = existing ?? { parent, childNodePath, count: 0, lastStartAt: 0 };
    this.pairs.set(key, state);
    state.count += 1;
    state.lastStartAt = Date.now();
    this.markPairDirty(key);
    return state.count;
  }

  /** Summary projection: every tracked node's stats, all copies. */
  snapshot(): Record<string, INodeActivityStats> {
    const out: Record<string, INodeActivityStats> = {};
    for (const [path, state] of this.nodes) {
      out[path] = projectStats(state);
    }
    return out;
  }

  /** Summary projection of the pair counters, all copies. */
  pairSnapshot(): Record<string, IActivityPairStats> {
    const out: Record<string, IActivityPairStats> = {};
    for (const [key, state] of this.pairs) {
      out[key] = { count: state.count, lastStartAt: state.lastStartAt };
    }
    return out;
  }

  /**
   * Per-node detail for the inspector endpoint. A node with no
   * recorded activity yields zeroed stats (the route's "scanned but
   * quiet" shape); copies either way.
   */
  nodeDetail(path: string): IActivityNodeDetail {
    const state = this.nodes.get(path);
    if (!state) {
      return { stats: { count: 0, lastStartAt: 0, distinctOwners: 0 }, recent: [] };
    }
    return { stats: projectStats(state), recent: state.recent.map((entry) => ({ ...entry })) };
  }

  /**
   * Forget one node's accumulated runtime activity (the clear-all,
   * `spec/provider-activity.md` §DELETE /api/activity/node): its stats
   * + recent ring, and every pair counter touching it as parent or
   * child. The sticky-dedupe memory deliberately survives (a paused
   * runtime resuming after a clear re-emits its start under the same
   * owner id, and a resume is not new activity), and so does the
   * owner->last-unit correlation (it attributes FUTURE invocations;
   * fresh activity is supposed to re-accumulate).
   */
  clearNode(path: string): void {
    this.nodes.delete(path);
    this.dirtyNodes.delete(path);
    for (const key of [...this.pairs.keys()]) {
      if (pairKeyTouches(key, path)) {
        this.pairs.delete(key);
        this.dirtyPairs.delete(key);
      }
    }
  }

  /** `true` when this `(nodePath, owner)` pair counts (first sighting). */
  private claimStickyOnce(nodePath: string, owner: string): boolean {
    const key = `${nodePath}\n${owner}`;
    if (this.stickySeen.has(key)) return false;
    this.stickySeen.add(key);
    if (this.stickySeen.size > STICKY_DEDUPE_CAP) {
      const oldest = this.stickySeen.values().next().value;
      if (oldest !== undefined) this.stickySeen.delete(oldest);
    }
    return true;
  }

  /**
   * Fold one spawn-completion execution summary into the child node's
   * aggregates (metadata, gate-independent). No-op when the summary
   * carries nothing summable.
   */
  recordExecution(
    nodePath: string,
    execution: { durationMs?: number; tokens?: number; toolUses?: number },
  ): void {
    if (execution.toolUses === undefined && execution.tokens === undefined) return;
    const state = this.stateFor(nodePath);
    state.toolUses += execution.toolUses ?? 0;
    state.tokens += execution.tokens ?? 0;
    state.summarizedRuns += 1;
  }

  /** Get-or-create one node's mutable state. */
  private stateFor(nodePath: string): INodeStatsState {
    // Every mutation path reaches its node through here, so this is
    // the single dirty-marking chokepoint for the checkpoint.
    this.markNodeDirty(nodePath);
    const existing = this.nodes.get(nodePath);
    if (existing) return existing;
    const fresh: INodeStatsState = {
      count: 0,
      firstSeenAt: Date.now(),
      lastStartAt: 0,
      lastOwner: undefined,
      owners: new Set<string>(),
      recent: [],
      toolUses: 0,
      tokens: 0,
      summarizedRuns: 0,
    };
    this.nodes.set(nodePath, fresh);
    return fresh;
  }

  /**
   * Count one start: every node-attributed start that survived the
   * gates above, a unit's own execution or a resource access (mcp /
   * read / write / shell alike, spec §Execution stats). The typed
   * recent entry lands on both ends of a resource access.
   */
  private count(
    nodePath: string,
    owner: string | undefined,
    detail: string | undefined,
    access: 'mcp' | 'read' | 'write' | 'shell' | undefined,
  ): INodeActivityStats {
    const state = this.stateFor(nodePath);
    state.count += 1;
    state.lastStartAt = Date.now();
    state.lastOwner = owner;
    if (owner !== undefined && state.owners.size < DISTINCT_OWNERS_CAP) {
      state.owners.add(owner);
    }
    const caller = this.correlateCaller(nodePath, owner, access);
    this.pushRecent(
      state,
      buildRecentEntry({ at: state.lastStartAt, owner, detail, caller, kind: access }),
    );
    this.trackAccess(nodePath, owner, detail, access, caller, state.lastStartAt);
    return projectStats(state);
  }

  /**
   * The unit that triggered a RESOURCE access (an mcp tool call or a file read):
   * the last unit lit under the same owner. Only resource accesses (`access`
   * set) have a caller; a unit's own execution has none.
   */
  private correlateCaller(
    nodePath: string,
    owner: string | undefined,
    access: 'mcp' | 'read' | 'write' | 'shell' | undefined,
  ): string | undefined {
    if (access === undefined || owner === undefined) return undefined;
    const candidate = this.lastUnitByOwner.get(owner);
    return candidate !== undefined && candidate !== nodePath ? candidate : undefined;
  }

  /**
   * Post-record bookkeeping: remember a UNIT execution (no `access`) as a future
   * caller, and mirror a resource access onto the caller's own recent ring
   * (outgoing: it accessed `nodePath`), so both ends carry the same type + tool.
   */
  private trackAccess(
    nodePath: string,
    owner: string | undefined,
    detail: string | undefined,
    access: 'mcp' | 'read' | 'write' | 'shell' | undefined,
    caller: string | undefined,
    at: number,
  ): void {
    if (owner !== undefined && access === undefined) {
      this.rememberUnit(owner, nodePath);
    }
    if (caller !== undefined) {
      this.pushRecent(
        this.stateFor(caller),
        buildRecentEntry({ at, owner, detail, target: nodePath, kind: access }),
      );
    }
  }

  private pushRecent(state: INodeStatsState, entry: IActivityRecentEntry): void {
    state.recent.unshift(entry);
    if (state.recent.length > RECENT_RING_SIZE) state.recent.pop();
  }

  private rememberUnit(owner: string, nodePath: string): void {
    this.lastUnitByOwner.delete(owner);
    this.lastUnitByOwner.set(owner, nodePath);
    if (this.lastUnitByOwner.size > LAST_UNIT_OWNER_CAP) {
      const oldest = this.lastUnitByOwner.keys().next().value;
      if (oldest !== undefined) this.lastUnitByOwner.delete(oldest);
    }
  }
}

/** Build a recent-ring entry, dropping every undefined optional (exactOptionalPropertyTypes). */
function buildRecentEntry(p: {
  at: number;
  owner?: string | undefined;
  detail?: string | undefined;
  caller?: string | undefined;
  target?: string | undefined;
  kind?: 'mcp' | 'read' | 'write' | 'shell' | undefined;
}): IActivityRecentEntry {
  const entry: IActivityRecentEntry = { at: p.at };
  if (p.owner !== undefined) entry.owner = p.owner;
  if (p.detail !== undefined) entry.detail = p.detail;
  if (p.caller !== undefined) entry.caller = p.caller;
  if (p.target !== undefined) entry.target = p.target;
  if (p.kind !== undefined) entry.kind = p.kind;
  return entry;
}

function projectStats(state: INodeStatsState): INodeActivityStats {
  const stats: INodeActivityStats = {
    count: state.count,
    lastStartAt: state.lastStartAt,
    distinctOwners: state.owners.size,
  };
  if (state.lastOwner !== undefined) stats.lastOwner = state.lastOwner;
  if (state.summarizedRuns > 0) {
    stats.toolUses = state.toolUses;
    stats.tokens = state.tokens;
    stats.summarizedRuns = state.summarizedRuns;
  }
  return stats;
}
