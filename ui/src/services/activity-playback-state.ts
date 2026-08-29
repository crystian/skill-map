/**
 * Pure playback fold for the Live lens replay: given the recorder's
 * tape (`ActivityRecorderService.events`), compute "what the map
 * looked like" after applying events `[0..cursor]`, in VIRTUAL time
 * (the virtual now is the cursor event's own server timestamp). No
 * timers, no signals, no re-injection into the live services: the
 * state at step K is a deterministic function of the list, which is
 * what makes scrubbing instant and the whole thing testable.
 *
 * The claim semantics MIRROR `NodeActivityService.apply` on purpose
 * (same TTL classes via the exported defaults, owner heartbeat
 * refresh, session membership, owner- and session-scoped ends, the
 * caller correlation for tool invocations, publish-per-flush pruning
 * approximated by an expiry sweep before each event). If that service
 * evolves, this fold follows; both files cross-reference each other.
 * Deliberate divergences, all in the accumulate direction because the
 * playback narrates history instead of painting a live decay:
 *
 *   - `members` accumulates every node ever seen (the lens's no-limit
 *     semantics: what the replay walks through stays on the canvas);
 *   - invocation and spawn RELATIONS accumulate instead of carrying
 *     the live TTLs (the persistent observed-links decision);
 *   - `coLitPairs` records both orientations of every simultaneously
 *     lit pair; the lens filters them against its link cache to dress
 *     the static edges with the executing spine.
 */

import type { IObservedInvocation, IObservedSpawn } from './live-lens';
import type { TRecordedEvent } from './activity-recorder';
import {
  MCP_NODE_PREFIX,
  NODE_ACTIVITY_DEFAULT_STICKY_TTL_MS,
  NODE_ACTIVITY_DEFAULT_TTL_MS,
} from './node-activity';

/** Owner bucket for events without one (mirrors the live service). */
const ANONYMOUS_OWNER = '';

/** Structured description of the cursor event, formatted by the UI. */
export type TPlaybackCaption =
  | { kind: 'start'; path: string; detail?: string; owner?: string }
  | { kind: 'end'; path: string }
  | { kind: 'owner-end'; owner: string }
  | { kind: 'session-end'; session: string }
  | {
      kind: 'spawn';
      phase: 'start' | 'handoff' | 'end';
      parent?: string;
      child?: string;
      childName?: string;
    }
  | { kind: 'turn-end' }
  | { kind: 'other' };

export interface IPlaybackState {
  /** Nodes whose claims are alive at the virtual now. */
  readonly executing: ReadonlySet<string>;
  /** Tool badge per EXECUTING node (swept with the glow, like live). */
  readonly details: ReadonlyMap<string, string>;
  /** Every node the tape touched up to the cursor (accumulative). */
  readonly members: ReadonlySet<string>;
  /**
   * Every node the tape lit, in FIRST-TOUCH order (units, mcp targets
   * and reads alike, one entry per node): the numbered route the replay
   * draws. Accumulative like `members`, which it orders; spawn frames
   * touch `members` but never the trail (a spawn is a relation, the
   * child's own start frame is the step).
   */
  readonly trail: readonly string[];
  /** Accumulated caller -> target tool invocations. */
  readonly invocations: readonly IObservedInvocation[];
  /** Accumulated node-to-node spawns. */
  readonly spawns: readonly IObservedSpawn[];
  /** Both orientations of every pair that was lit TOGETHER at some point. */
  readonly coLitPairs: ReadonlySet<string>;
  /** The cursor event, structured for the ticker. Null before step 0. */
  readonly caption: TPlaybackCaption | null;
  /** The cursor event's timestamp (0 when the cursor is -1). */
  readonly virtualNowMs: number;
}

export interface IPlaybackFoldOptions {
  ttlMs?: number;
  stickyTtlMs?: number;
}

interface IFoldClaim {
  expiresAt: number;
  ttlMs: number;
  claimedSeq: number;
}

const EMPTY_STATE: IPlaybackState = {
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

/**
 * Fold `events[0..cursor]` into the playback state. `cursor` is the
 * index of the LAST applied event; -1 yields the empty state. O(cursor)
 * per call by design: a 50k-frame tape folds in low milliseconds, so
 * neither stepping nor scrubbing needs memoization.
 */
export function computePlaybackState(
  events: readonly TRecordedEvent[],
  cursor: number,
  options?: IPlaybackFoldOptions,
): IPlaybackState {
  const last = Math.min(cursor, events.length - 1);
  if (last < 0) return EMPTY_STATE;
  const ttlMs = options?.ttlMs ?? NODE_ACTIVITY_DEFAULT_TTL_MS;
  const stickyTtlMs = options?.stickyTtlMs ?? NODE_ACTIVITY_DEFAULT_STICKY_TTL_MS;

  const claims = new Map<string, Map<string, IFoldClaim>>();
  const detailByPath = new Map<string, string>();
  const lastUnitByOwner = new Map<string, string>();
  const sessionByOwner = new Map<string, string>();
  const members = new Set<string>();
  const trail: string[] = [];
  const touched = new Set<string>();
  const invocations = new Map<string, IObservedInvocation>();
  const spawns = new Map<string, IObservedSpawn>();
  const coLitPairs = new Set<string>();
  let claimSeq = 0;
  let caption: TPlaybackCaption | null = null;

  const sweepExpired = (now: number): void => {
    for (const [path, owners] of claims) {
      for (const [owner, claim] of owners) {
        if (claim.expiresAt <= now) owners.delete(owner);
      }
      if (owners.size === 0) claims.delete(path);
    }
  };

  const releaseOwnerEverywhere = (owner: string): void => {
    for (const [path, owners] of claims) {
      owners.delete(owner);
      if (owners.size === 0) claims.delete(path);
    }
    lastUnitByOwner.delete(owner);
    sessionByOwner.delete(owner);
    // Unlike live, accumulated invocation RELATIONS survive an owner
    // end (history does not un-happen); only the glow machinery drops.
  };

  const correlateCaller = (target: string, owner: string): string | null => {
    let caller: string | null = null;
    let bestSeq = -1;
    for (const [path, owners] of claims) {
      if (path === target) continue;
      if (path.startsWith(MCP_NODE_PREFIX)) continue;
      const claim = owners.get(owner);
      if (claim === undefined) continue;
      if (claim.claimedSeq > bestSeq) {
        bestSeq = claim.claimedSeq;
        caller = path;
      }
    }
    if (caller !== null) return caller;
    const lastUnit = lastUnitByOwner.get(owner);
    if (lastUnit !== undefined && lastUnit !== target && !lastUnit.startsWith(MCP_NODE_PREFIX)) {
      return lastUnit;
    }
    return null;
  };

  for (let i = 0; i <= last; i++) {
    const event = events[i];
    if (event === undefined) continue;
    const now = event.tMs;
    // Publish-per-flush approximation: the live service prunes expired
    // claims once per frame batch; the fold prunes before each event so
    // the heartbeat refresh can never resurrect an already-decayed claim.
    sweepExpired(now);
    caption = null;

    if (event.type === 'agent.spawn') {
      const data = event.data;
      const parent = data.parentNodePath;
      const child = data.childNodePath;
      if (parent !== undefined) members.add(parent);
      if (child !== undefined) members.add(child);
      if (parent !== undefined && child !== undefined && data.phase !== 'end') {
        const key = `${parent}>>${child}`;
        spawns.set(key, {
          key,
          parent,
          child,
          lastSpawnId: data.spawnId,
          lastSeenAt: now,
        });
      }
      caption = {
        kind: 'spawn',
        phase: data.phase,
        ...(parent === undefined ? {} : { parent }),
        ...(child === undefined ? {} : { child }),
        ...(data.childName === undefined ? {} : { childName: data.childName }),
      };
      continue;
    }

    const data = event.data;
    const owner = data.owner ?? ANONYMOUS_OWNER;

    // Owner heartbeat (mirrors live): any signal refreshes every claim
    // the owner holds, each to its own window class.
    if (data.owner !== undefined) {
      for (const owners of claims.values()) {
        const claim = owners.get(owner);
        if (claim) claim.expiresAt = now + claim.ttlMs;
      }
    }
    if (data.owner !== undefined && data.session !== undefined) {
      sessionByOwner.set(data.owner, data.session);
    }

    if (data.phase === 'end' && data.sessionScope === true && data.session !== undefined) {
      const session = data.session;
      for (const [sessionOwner, s] of [...sessionByOwner.entries()]) {
        if (s === session) releaseOwnerEverywhere(sessionOwner);
      }
      caption = { kind: 'session-end', session };
      continue;
    }
    if (data.phase === 'end' && data.ownerScope === true && data.owner !== undefined) {
      releaseOwnerEverywhere(owner);
      caption = { kind: 'owner-end', owner };
      continue;
    }
    if (data.nodePath === undefined) {
      // Node-less custody frames still narrate (a blank ticker reads as
      // a broken step): the turn boundary by name, the rest generically.
      caption = data.turnEnd === true ? { kind: 'turn-end' } : { kind: 'other' };
      continue;
    }

    members.add(data.nodePath);
    if (data.phase === 'start') {
      if (!touched.has(data.nodePath)) {
        touched.add(data.nodePath);
        trail.push(data.nodePath);
      }
      const ttl = data.sticky === true ? stickyTtlMs : ttlMs;
      if (data.detail !== undefined && data.nodePath.startsWith(MCP_NODE_PREFIX)) {
        const caller = correlateCaller(data.nodePath, owner);
        if (caller !== null) {
          const key = `${caller}>>${data.nodePath}`;
          invocations.set(key, {
            key,
            caller,
            target: data.nodePath,
            label: data.detail,
            lastSeenAt: now,
          });
        }
      }
      if (data.detail !== undefined) {
        detailByPath.set(data.nodePath, data.detail);
      }
      if (!data.nodePath.startsWith(MCP_NODE_PREFIX)) {
        lastUnitByOwner.set(owner, data.nodePath);
      }
      // Co-lit sighting: every path lit at this instant pairs with the
      // starter, both orientations (the lens filters by its link cache,
      // which knows the real direction).
      for (const [litPath, owners] of claims) {
        if (litPath === data.nodePath) continue;
        let alive = false;
        for (const claim of owners.values()) {
          if (claim.expiresAt > now) {
            alive = true;
            break;
          }
        }
        if (!alive) continue;
        coLitPairs.add(`${litPath}|${data.nodePath}`);
        coLitPairs.add(`${data.nodePath}|${litPath}`);
      }
      const owners = claims.get(data.nodePath) ?? new Map<string, IFoldClaim>();
      owners.set(owner, { expiresAt: now + ttl, ttlMs: ttl, claimedSeq: ++claimSeq });
      claims.set(data.nodePath, owners);
      caption = {
        kind: 'start',
        path: data.nodePath,
        ...(data.detail === undefined ? {} : { detail: data.detail }),
        ...(data.owner === undefined ? {} : { owner: data.owner }),
      };
      continue;
    }
    const owners = claims.get(data.nodePath);
    if (owners) {
      owners.delete(owner);
      if (owners.size === 0) claims.delete(data.nodePath);
    }
    caption = { kind: 'end', path: data.nodePath };
  }

  const lastEvent = events[last];
  const virtualNowMs = lastEvent?.tMs ?? 0;
  const executing = new Set<string>();
  for (const [path, owners] of claims) {
    for (const claim of owners.values()) {
      if (claim.expiresAt > virtualNowMs) {
        executing.add(path);
        break;
      }
    }
  }
  const details = new Map<string, string>();
  for (const [path, detail] of detailByPath) {
    if (executing.has(path)) details.set(path, detail);
  }

  return {
    executing,
    details,
    members,
    trail,
    invocations: [...invocations.values()],
    spawns: [...spawns.values()],
    coLitPairs,
    caption,
    virtualNowMs,
  };
}
