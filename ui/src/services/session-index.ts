/**
 * Pure session index for the Sessions rail tab: given the recorder's
 * tape (`ActivityRecorderService.events`), derive the list of runtime
 * SESSIONS it witnessed (one per conversation) and, inside each, the
 * agent tree (who spawned whom, arbitrary depth) with per-node stats.
 * Sibling of `computePlaybackState`, same discipline: no timers, no
 * signals, deterministic function of the list.
 *
 * Why a separate fold instead of a projection of `IPlaybackState`: the
 * playback fold keys spawns by NODE-PATH pair and drops the owners,
 * which is exactly the information a session tree is made of. This
 * fold reads the raw frames, where the ownership story is complete:
 * activity frames carry `owner` (and sometimes `session`), spawn
 * frames carry `spawnId` / `parentOwner` / `childOwner` / `childName`.
 *
 * Session roots are derived STRUCTURALLY, never by parsing owner
 * strings beyond the `main:` prefix hint:
 *
 *   - the `parentOwner` of a spawn frame whose `parentNodePath` is
 *     ABSENT is a session context (the wire's own discriminator);
 *   - an activity owner that is never claimed as a `childOwner` is a
 *     root on first sight (covers spawn-less providers, where the
 *     conversation id is the only grouping there is).
 *
 * Agent nodes are keyed by `spawnId` (the start / handoff / end trio
 * of one spawn merges into one node). Activity frames attach to the
 * agent whose claim on their owner is the LATEST at or before the
 * frame's timestamp, so a re-spawned owner id attributes each frame
 * to the incarnation that was actually running (single pass, no
 * lookahead; probes show spawn frames precede the child's activity).
 *
 * Everything that cannot be attributed lands in the `unattributed`
 * bucket instead of being guessed at: the ring drops OLDEST frames
 * first, so a trimmed tape can lose exactly the spawn frames that
 * establish parenthood. A subtree whose parent chain is gone parents
 * there; ownerless frames with no matching `session` count there. The
 * one failure this cannot see is a trim-created FALSE ROOT (a child
 * whose spawn frame fell off but whose activity survives reads as its
 * own session); the UI surfaces `droppedCount` instead of guessing.
 */

import type { IRecordedActivityEvent, TRecordedEvent } from './activity-recorder';

/** Owner bucket for events without one (mirrors the playback fold). */
const ANONYMOUS_OWNER = '';

/** Sessionized main-owner prefix (`main:<session_id>`, adapter convention). */
const MAIN_OWNER_PREFIX = 'main:';

/**
 * One INTERNAL STEP of an agent (or of the session context itself): a
 * directly-attributed `node.activity` start, projected to what the
 * sessions panel lists as a narrow sub-row (user request 2026-08-16).
 * Only real work qualifies: unit executions (a skill / command run),
 * MCP tool calls (`access: 'mcp'`) and file reads (`access: 'read'`).
 * Custody (`keepAlive`) and lifecycle (`sticky`) claims are excluded,
 * the former is not an execution (the stats accumulator's own rule)
 * and the latter is the agent's own span, already the parent row.
 */
export interface ISessionStep {
  readonly tMs: number;
  /** Scanned node path the step touched (`mcp://…` for tool calls). */
  readonly path: string;
  /** Finer label when reported: the MCP tool, the read/write tool, the invoking tool. */
  readonly detail?: string;
  /** Resource access class; absent = the unit's own execution. */
  readonly access?: 'mcp' | 'read' | 'write' | 'shell';
}

export interface ISessionAgentNode {
  /** The spawn's wire id; unique, and the tree key. */
  readonly spawnId: string;
  /** The child's own owner id, when the runtime reported one. */
  readonly owner?: string;
  /** The child unit as the runtime named it (`childName`). */
  readonly name?: string;
  /** The child's resolved node path, when it maps to a scanned node. */
  readonly childNodePath?: string;
  readonly firstTMs: number;
  readonly lastTMs: number;
  /** Frames attributed directly to this agent (its spawn trio included). */
  readonly eventCount: number;
  /** Node paths this agent's own activity touched. */
  readonly touchedPaths: ReadonlySet<string>;
  /** The agent's own internal steps, chronological (see `ISessionStep`). */
  readonly steps: readonly ISessionStep[];
  readonly children: readonly ISessionAgentNode[];
}

export interface ISessionEntry {
  /** The session context's owner id (opaque; the session key). */
  readonly rootOwner: string;
  /**
   * The runtime's session id when derivable: the `main:` prefix hint,
   * or the first `session` stamped on a frame attributed to this
   * session. Undefined for bare owners (e.g. a lone `main`).
   */
  readonly sessionId?: string;
  /** 1-based, chronological by first sighting. */
  readonly ordinal: number;
  readonly firstTMs: number;
  readonly lastTMs: number;
  /** Total frames attributed to the session (root + whole tree). */
  readonly eventCount: number;
  /** Union of node paths touched anywhere in the session. */
  readonly touchedPaths: ReadonlySet<string>;
  /**
   * The MAIN context's own internal steps (frames attributed to the
   * session itself, not to any spawned agent), chronological.
   */
  readonly steps: readonly ISessionStep[];
  /** Top-level agents; children nest arbitrarily deep. */
  readonly agents: readonly ISessionAgentNode[];
  /** Total agents across all depths (the row's counter). */
  readonly agentCount: number;
  /**
   * The recording this session belongs to: the tape frames' Record
   * stamp (`TRecordedEvent.recordedAt`), or the journal file's
   * `startedAt` once the catalog folds it. Together with `rootOwner`
   * it is the session's identity (`sessionKeyOf`): the same runtime
   * session recorded twice is two sessions. Absent on legacy tapes.
   */
  readonly recordedAt?: number;
}

/**
 * Identity of a session row: root owner + recording window. Every
 * consumer that keys on a session (expansion, replay selection, the
 * active-step match, the journal dedupe) goes through this.
 */
export function sessionKeyOf(session: { rootOwner: string; recordedAt?: number }): string {
  return `${session.rootOwner}|${session.recordedAt ?? ''}`;
}

export interface ISessionIndex {
  /** Chronological by `firstTMs` (the view decides display order). */
  readonly sessions: readonly ISessionEntry[];
  /** Frames and subtrees the tape no longer explains (trimmed chains). */
  readonly unattributed: {
    readonly eventCount: number;
    readonly firstTMs?: number;
    readonly lastTMs?: number;
    readonly agents: readonly ISessionAgentNode[];
  };
}

/**
 * Identity of a replay scope: a whole session, or one agent subtree
 * within it. Identity, not data, so the tape is re-filtered at click
 * time and a still-running session replays up to that moment.
 */
export interface ISessionReplaySelection {
  readonly rootOwner: string;
  readonly agentSpawnId?: string;
  /**
   * Recording identity (`ISessionEntry.recordedAt`): rides the replay
   * source and the deep link so a session recorded twice can be named
   * unambiguously. Identity only; the tape window filter is `tapeWindow`.
   */
  readonly recordedAt?: number;
  /**
   * Tape-native rows only: narrow the live tape to the frames stamped
   * with this Record window before scoping. Journal rows carry their
   * own `sourceFrames` instead (a file already IS one window).
   */
  readonly tapeWindow?: number;
  /**
   * Out-of-tape frame source for a JOURNAL-hydrated session
   * (2026-08-16): a session listed off `.skill-map/sessions/` has no
   * frames on the client recorder, so the selection carries the
   * recording's own frames and the replay filter runs over them
   * instead of the live tape. Absent for tape-native sessions (the
   * identity-only contract above holds there).
   */
  readonly sourceFrames?: readonly TRecordedEvent[];
}

interface IMutableAgentNode {
  spawnId: string;
  /** Record window of the node's first spawn frame (see `ISessionEntry.recordedAt`). */
  recordedAt?: number;
  owner?: string;
  name?: string;
  childNodePath?: string;
  parentOwner: string;
  /** `parentNodePath` present on the wire = the parent is an agent. */
  parentIsAgent: boolean;
  firstTMs: number;
  lastTMs: number;
  eventCount: number;
  touchedPaths: Set<string>;
  steps: ISessionStep[];
  children: IMutableAgentNode[];
}

interface IMutableSession {
  rootOwner: string;
  recordedAt?: number;
  sessionId?: string;
  firstTMs: number;
  lastTMs: number;
  /** Frames attributed to the session CONTEXT itself (not an agent). */
  eventCount: number;
  touchedPaths: Set<string>;
  steps: ISessionStep[];
  agents: IMutableAgentNode[];
}

/** One `childOwner` claim: which spawn owned this owner from when. */
interface IOwnerClaim {
  tMs: number;
  spawnId: string;
}

const EMPTY_INDEX: ISessionIndex = {
  sessions: [],
  unattributed: { eventCount: 0, agents: [] },
};

/**
 * Fold the whole tape into the session index. O(n) in the tape plus
 * the (small) tree walks; recomputed per recorder flush while the tab
 * is mounted, which the ring cap keeps in the low milliseconds.
 */
export function computeSessionIndex(events: readonly TRecordedEvent[]): ISessionIndex {
  if (events.length === 0) return EMPTY_INDEX;

  // ---- Pass 1: spawn graph -------------------------------------------------
  // Nodes by spawnId, per-owner claim timelines, and the structural
  // root set (session-context spawn parents).
  const nodesBySpawnId = new Map<string, IMutableAgentNode>();
  const claimsByOwner = new Map<string, IOwnerClaim[]>();
  const structuralRoots = new Set<string>();

  for (const event of events) {
    if (event.type !== 'agent.spawn') continue;
    const data = event.data;
    let node = nodesBySpawnId.get(data.spawnId);
    if (node === undefined) {
      node = {
        spawnId: data.spawnId,
        ...(event.recordedAt === undefined ? {} : { recordedAt: event.recordedAt }),
        parentOwner: data.parentOwner,
        parentIsAgent: data.parentNodePath !== undefined,
        firstTMs: event.tMs,
        lastTMs: event.tMs,
        eventCount: 0,
        touchedPaths: new Set(),
        steps: [],
        children: [],
      };
      nodesBySpawnId.set(data.spawnId, node);
    }
    if (node.owner === undefined && data.childOwner !== undefined) node.owner = data.childOwner;
    if (node.name === undefined && data.childName !== undefined) node.name = data.childName;
    if (node.childNodePath === undefined && data.childNodePath !== undefined) {
      node.childNodePath = data.childNodePath;
    }
    if (data.parentNodePath !== undefined) node.parentIsAgent = true;
    if (data.parentNodePath === undefined) structuralRoots.add(data.parentOwner);
    if (data.childOwner !== undefined) {
      const claims = claimsByOwner.get(data.childOwner) ?? [];
      const lastClaim = claims[claims.length - 1];
      // handoff and end repeat the same childOwner; one claim per spawn.
      if (lastClaim === undefined || lastClaim.spawnId !== data.spawnId) {
        claims.push({ tMs: event.tMs, spawnId: data.spawnId });
        claimsByOwner.set(data.childOwner, claims);
      }
    }
  }

  /** Latest claim at or before `tMs`; earliest as the fallback. */
  const claimAt = (owner: string, tMs: number): IMutableAgentNode | undefined => {
    const claims = claimsByOwner.get(owner);
    if (claims === undefined) return undefined;
    let best: IOwnerClaim | undefined;
    for (const claim of claims) {
      if (claim.tMs <= tMs) best = claim;
      else break;
    }
    const chosen = best ?? claims[0];
    return chosen === undefined ? undefined : nodesBySpawnId.get(chosen.spawnId);
  };

  // ---- Pass 2: roots -------------------------------------------------------
  // Structural roots plus every activity owner never claimed as a
  // child (first-sight roots: spawn-less providers, and the accepted
  // trim-created false roots).
  // Keyed by `sessionKeyOf` (root owner + recording window): the same
  // runtime session across two Record gestures is two sessions.
  const sessionsByRoot = new Map<string, IMutableSession>();
  const sessionOf = (rootOwner: string, tMs: number, recordedAt?: number): IMutableSession => {
    const key = sessionKeyOf({ rootOwner, ...(recordedAt === undefined ? {} : { recordedAt }) });
    let session = sessionsByRoot.get(key);
    if (session === undefined) {
      session = {
        rootOwner,
        ...(recordedAt === undefined ? {} : { recordedAt }),
        firstTMs: tMs,
        lastTMs: tMs,
        eventCount: 0,
        touchedPaths: new Set(),
        steps: [],
        agents: [],
      };
      if (rootOwner.startsWith(MAIN_OWNER_PREFIX)) {
        const hint = rootOwner.slice(MAIN_OWNER_PREFIX.length);
        if (hint.length > 0) session.sessionId = hint;
      }
      sessionsByRoot.set(key, session);
    }
    return session;
  };

  // ---- Pass 3: attribution -------------------------------------------------
  // Chronological. Every frame lands on exactly one node, one session
  // context, or the unattributed bucket; stats accumulate where the
  // frame lands and session totals roll up at the end.
  const unattributedAgents: IMutableAgentNode[] = [];
  let unattributedCount = 0;
  let unattributedFirst: number | undefined;
  let unattributedLast: number | undefined;
  const countUnattributed = (tMs: number): void => {
    unattributedCount += 1;
    if (unattributedFirst === undefined || tMs < unattributedFirst) unattributedFirst = tMs;
    if (unattributedLast === undefined || tMs > unattributedLast) unattributedLast = tMs;
  };
  const touchNode = (node: IMutableAgentNode, tMs: number, path?: string): void => {
    node.eventCount += 1;
    if (tMs < node.firstTMs) node.firstTMs = tMs;
    if (tMs > node.lastTMs) node.lastTMs = tMs;
    if (path !== undefined) node.touchedPaths.add(path);
  };
  const touchSession = (session: IMutableSession, tMs: number, path?: string): void => {
    session.eventCount += 1;
    if (tMs < session.firstTMs) session.firstTMs = tMs;
    if (tMs > session.lastTMs) session.lastTMs = tMs;
    if (path !== undefined) session.touchedPaths.add(path);
  };

  for (const event of events) {
    if (event.type === 'agent.spawn') {
      const node = nodesBySpawnId.get(event.data.spawnId);
      if (node !== undefined) touchNode(node, event.tMs);
      continue;
    }
    const data = event.data;
    const owner = data.owner ?? ANONYMOUS_OWNER;
    const step = projectStep(data, event.tMs);
    if (owner !== ANONYMOUS_OWNER) {
      const node = claimAt(owner, event.tMs);
      if (node !== undefined) {
        touchNode(node, event.tMs, data.nodePath);
        if (step !== null) node.steps.push(step);
      } else {
        const session = sessionOf(owner, event.tMs, event.recordedAt);
        touchSession(session, event.tMs, data.nodePath);
        if (step !== null) session.steps.push(step);
        if (session.sessionId === undefined && data.session !== undefined) {
          session.sessionId = data.session;
        }
      }
      continue;
    }
    // Ownerless: a session-scoped end (or future node-less forms)
    // belongs to the session whose id it names; otherwise nothing on
    // the frame says where it goes.
    if (data.session !== undefined) {
      // Prefer the session of the frame's own recording window; a
      // legacy frame (no stamp) settles for the first id match.
      let matched: IMutableSession | undefined;
      for (const session of sessionsByRoot.values()) {
        if (session.sessionId !== data.session) continue;
        if (session.recordedAt === event.recordedAt) {
          matched = session;
          break;
        }
        matched ??= session;
      }
      if (matched !== undefined) {
        touchSession(matched, event.tMs);
        continue;
      }
    }
    countUnattributed(event.tMs);
  }

  // Structural roots that produced no activity of their own still get
  // their session shell (a session that only ever spawned).
  for (const rootOwner of structuralRoots) {
    if (!claimsByOwner.has(rootOwner)) {
      const node = firstSpawnOfParent(nodesBySpawnId, rootOwner);
      sessionOf(rootOwner, node?.firstTMs ?? 0, node?.recordedAt);
    }
  }

  // ---- Pass 4: attach the spawn nodes --------------------------------------
  for (const node of nodesBySpawnId.values()) {
    if (structuralRoots.has(node.parentOwner) && !claimsByOwner.has(node.parentOwner)) {
      sessionOf(node.parentOwner, node.firstTMs, node.recordedAt).agents.push(node);
      continue;
    }
    const parent = claimAt(node.parentOwner, node.firstTMs);
    if (parent !== undefined && parent !== node) {
      parent.children.push(node);
      continue;
    }
    const rootSession = sessionsByRoot.get(
      sessionKeyOf({
        rootOwner: node.parentOwner,
        ...(node.recordedAt === undefined ? {} : { recordedAt: node.recordedAt }),
      }),
    );
    if (rootSession !== undefined) {
      // First-sight root that also spawned (agent-context parent whose
      // own spawn frame the tape never saw, or a plain session root).
      rootSession.agents.push(node);
      continue;
    }
    // Trimmed chain: the parent is an agent the tape cannot place.
    unattributedAgents.push(node);
  }

  // ---- Rollup --------------------------------------------------------------
  const sessions = [...sessionsByRoot.values()].sort((a, b) => a.firstTMs - b.firstTMs);
  const entries: ISessionEntry[] = sessions.map((session, index) => {
    let eventCount = session.eventCount;
    let firstTMs = session.firstTMs;
    let lastTMs = session.lastTMs;
    const touchedPaths = new Set(session.touchedPaths);
    let agentCount = 0;
    const walk = (node: IMutableAgentNode): void => {
      agentCount += 1;
      eventCount += node.eventCount;
      if (node.firstTMs < firstTMs) firstTMs = node.firstTMs;
      if (node.lastTMs > lastTMs) lastTMs = node.lastTMs;
      for (const path of node.touchedPaths) touchedPaths.add(path);
      for (const child of node.children) walk(child);
    };
    for (const agent of session.agents) walk(agent);
    return {
      rootOwner: session.rootOwner,
      ...(session.recordedAt === undefined ? {} : { recordedAt: session.recordedAt }),
      ...(session.sessionId === undefined ? {} : { sessionId: session.sessionId }),
      ordinal: index + 1,
      firstTMs,
      lastTMs,
      eventCount,
      touchedPaths,
      steps: session.steps,
      agents: session.agents.map(freezeNode),
      agentCount,
    };
  });

  for (const orphan of unattributedAgents) {
    accumulateOrphan(orphan, (tMs, count) => {
      unattributedCount += count;
      if (unattributedFirst === undefined || tMs < unattributedFirst) unattributedFirst = tMs;
      if (unattributedLast === undefined || tMs > unattributedLast) unattributedLast = tMs;
    });
  }

  return {
    sessions: entries,
    unattributed: {
      eventCount: unattributedCount,
      ...(unattributedFirst === undefined ? {} : { firstTMs: unattributedFirst }),
      ...(unattributedLast === undefined ? {} : { lastTMs: unattributedLast }),
      agents: unattributedAgents.map(freezeNode),
    },
  };
}

/**
 * Filter the tape down to one replay scope, order-preserving. The
 * output feeds `ActivityPlaybackService.enter` directly; an empty
 * result means the scope has nothing replayable (callers bail rather
 * than entering an empty replay).
 */
export function filterTapeForSession(
  events: readonly TRecordedEvent[],
  selection: ISessionReplaySelection,
): TRecordedEvent[] {
  // A tape-native row replays ITS Record window only: the same runtime
  // session recorded again lives in another window (and another row).
  const scoped =
    selection.tapeWindow === undefined
      ? events
      : events.filter((event) => event.recordedAt === selection.tapeWindow);
  const index = computeSessionIndex(scoped);
  const session = index.sessions.find(
    (s) =>
      s.rootOwner === selection.rootOwner &&
      (selection.tapeWindow === undefined || s.recordedAt === selection.tapeWindow),
  );
  if (session === undefined) return [];

  let scopeAgents: readonly ISessionAgentNode[];
  let owners: Set<string>;
  let sessionMatch: string | undefined;
  if (selection.agentSpawnId !== undefined) {
    const anchor = findAgent(session.agents, selection.agentSpawnId);
    if (anchor === undefined) return [];
    scopeAgents = [anchor];
    owners = new Set();
    // Branch scope: the session context and its id stay out; ownerless
    // session frames belong to the session, not the branch.
  } else {
    scopeAgents = session.agents;
    owners = new Set([session.rootOwner]);
    sessionMatch = session.sessionId;
  }
  const spawnIds = new Set<string>();
  const collect = (node: ISessionAgentNode): void => {
    spawnIds.add(node.spawnId);
    if (node.owner !== undefined) owners.add(node.owner);
    for (const child of node.children) collect(child);
  };
  for (const agent of scopeAgents) collect(agent);

  return scoped.filter((event) => {
    if (event.type === 'agent.spawn') {
      const data = event.data;
      if (spawnIds.has(data.spawnId)) return true;
      if (owners.has(data.parentOwner)) return true;
      return data.childOwner !== undefined && owners.has(data.childOwner);
    }
    const data = event.data;
    if (data.owner !== undefined) return owners.has(data.owner);
    return sessionMatch !== undefined && data.session === sessionMatch;
  });
}

/** DFS by spawnId over a frozen tree. */
function findAgent(
  agents: readonly ISessionAgentNode[],
  spawnId: string,
): ISessionAgentNode | undefined {
  for (const agent of agents) {
    if (agent.spawnId === spawnId) return agent;
    const nested = findAgent(agent.children, spawnId);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

/** The earliest spawn node a given parent owner produced, if any. */
function firstSpawnOfParent(
  nodes: Map<string, IMutableAgentNode>,
  parentOwner: string,
): IMutableAgentNode | undefined {
  let earliest: IMutableAgentNode | undefined;
  for (const node of nodes.values()) {
    if (node.parentOwner !== parentOwner) continue;
    if (earliest === undefined || node.firstTMs < earliest.firstTMs) earliest = node;
  }
  return earliest;
}

/** Fold an orphan subtree's stats into the unattributed totals. */
function accumulateOrphan(
  node: IMutableAgentNode,
  add: (tMs: number, count: number) => void,
): void {
  add(node.firstTMs, node.eventCount);
  add(node.lastTMs, 0);
  for (const child of node.children) accumulateOrphan(child, add);
}

/** Mutable build node -> the exported readonly shape. */
function freezeNode(node: IMutableAgentNode): ISessionAgentNode {
  return {
    spawnId: node.spawnId,
    ...(node.owner === undefined ? {} : { owner: node.owner }),
    ...(node.name === undefined ? {} : { name: node.name }),
    ...(node.childNodePath === undefined ? {} : { childNodePath: node.childNodePath }),
    firstTMs: node.firstTMs,
    lastTMs: node.lastTMs,
    eventCount: node.eventCount,
    touchedPaths: node.touchedPaths,
    steps: node.steps,
    children: [...node.children]
      .sort((a, b) => a.firstTMs - b.firstTMs)
      .map(freezeNode),
  };
}

/**
 * Project one attributed `node.activity` frame to a listed step, or
 * `null` when it is not one (see `ISessionStep` for the qualifying
 * rule: starts with a node only, custody and lifecycle claims out).
 */
function projectStep(
  data: IRecordedActivityEvent['data'],
  tMs: number,
): ISessionStep | null {
  if (data.phase !== 'start' || data.nodePath === undefined) return null;
  if (data.keepAlive === true || data.sticky === true) return null;
  return {
    tMs,
    path: data.nodePath,
    ...(data.detail === undefined ? {} : { detail: data.detail }),
    ...(data.access === undefined ? {} : { access: data.access }),
  };
}
