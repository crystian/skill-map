/**
 * Session-journal reader + observed-relations fold (the scan-time half of
 * `spec/provider-activity.md` §Session journal).
 *
 * `readSessionJournal(sessionsDir)` loads every `.skill-map/sessions/*.json`
 * recording, AJV-validating each file against
 * `spec/schemas/session-recording.schema.json` and SKIPPING off-shape files
 * silently: the journal is disposable machine data (Storage rule, fifth
 * home), so a corrupt or future-shaped file must never take a scan down,
 * the same posture the client recorder's hydrate takes.
 *
 * `foldObservedActivity(recordings)` collapses the recordings into the
 * observed `(source, target)` pairs the `core/observed-link-missing`
 * analyzer compares against the declared link graph, plus the per-node
 * execution counts that gate `core/observed-link-dead` (the
 * dead-design detector). Three relation shapes are folded:
 *
 *   - `invokes`: a `node.activity` start with `access: 'mcp'` (an MCP tool
 *     call landing on an `mcp://` node), attributed to its CALLING unit by
 *     owner: the last non-MCP unit node the same owner started. This
 *     mirrors the client fold's caller correlation
 *     (`ui/src/services/activity-playback-state.ts`, `correlateCaller`;
 *     cross-referenced both ways) in the simplified form a linear
 *     journal walk affords: frames arrive in order, so "the owner's most
 *     recent unit claim" is a single map overwrite.
 *   - `spawns`: an `agent.spawn` frame carrying BOTH `parentNodePath` and
 *     `childNodePath` (a scanned agent spawning a scanned child), counted
 *     ONCE per `spawnId` per recording (the start / handoff / end trio of
 *     one spawn merges, like the client session index).
 *   - `reads`: a `node.activity` start with `access: 'read'`, attributed to
 *     its READING unit by the same owner correlation the invokes class
 *     uses (2026-08-17, lifting the original reads deferral: the noise
 *     lives in the ANALYZER gates, repetition + points coverage, not in
 *     the fold). The read path never becomes the owner's current unit.
 *     Since 2026-08-30 an `access: 'shell'` sighting folds as `reads` too
 *     (user decision: the command named the file, heuristic but admitted
 *     as evidence; the analyzer gates absorb the noise). `write` frames
 *     stay unfolded until they earn a relation of their own.
 *
 * The unit correlation is TURN-BOUNDED (user call 2026-08-17): a
 * `turnEnd` frame clears its owner's current-unit claim, so an access in
 * a later turn never attributes to a unit from an earlier one. Without
 * the bound, "the owner's last unit" over-attributes: a user-driven read
 * two turns after a skill ran would count as the skill's read.
 *
 * The fold is pure over the recordings (deterministic input -> output);
 * only the reader touches the filesystem. Both run in the driving adapter
 * BEFORE `runScan`, which threads the folded map through
 * `RunScanOptions.observedRelations` into `IAnalyzerContext.observedRelations`
 * (absent when the journal is empty), the same precompute-and-project
 * pattern as `referenceablePaths`.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { loadSchemaValidators } from '../adapters/schema-validators.js';
import { MCP_NODE_PREFIX } from '../util/mcp.js';

/** One journaled frame (mirrors `session-recording.schema.json#/$defs/Frame`). */
export interface SessionRecordingFrame {
  tMs: number;
  type: 'node.activity' | 'agent.spawn';
  /** Wire payload per `type`; AJV pinned the shape, consumers narrow it. */
  data: Record<string, unknown>;
}

/** One recorded session (mirrors `session-recording.schema.json`). */
export interface SessionRecording {
  schemaVersion: number;
  sessionId?: string;
  rootOwner: string;
  provider?: string;
  startedAt: number;
  endedAt?: number;
  frames: SessionRecordingFrame[];
}

/**
 * Per-node observed EXECUTIONS folded from the journal (spec §Session
 * journal · Consumption): how many times a node ran as a UNIT across the
 * recordings. A unit run is a `start` frame naming the node with NO
 * resource access (`keepAlive` custody heartbeats do not count; a sticky
 * agent span counts once per claim, i.e. once per spawn). This is the
 * dead-design detector's VOLUME gate: absence of an observed pair means
 * nothing until the would-be source demonstrably executed.
 */
export interface IObservedExecution {
  /** Scan-relative path of the node observed running. */
  path: string;
  count: number;
  /** Distinct recordings the node ran in. */
  sessions: number;
  /** Unix-ms of the latest run. */
  lastSeenAt: number;
}

/**
 * One observed `(source, target)` relation folded from the journal.
 * `sessions` counts the DISTINCT recordings the pair appeared in, so the
 * analyzer's message can say "across N sessions" honestly; `count` totals
 * the individual observations.
 */
export interface IObservedRelation {
  /** Scan-relative path of the node observed doing the invoking / spawning. */
  source: string;
  /** Scan-relative path of the invoked / spawned node (`mcp://…` for invokes). */
  target: string;
  relation: 'invokes' | 'spawns' | 'reads';
  count: number;
  sessions: number;
  /** Unix-ms of the latest observation. */
  lastSeenAt: number;
}

/**
 * Read every recording under `sessionsDir`. Absent directory reads as an
 * empty journal; a file that fails JSON parse or schema validation is
 * skipped silently (see module doc). Files are visited in name order
 * (the ISO-prefixed names sort chronologically).
 */
export function readSessionJournal(sessionsDir: string): SessionRecording[] {
  return readSessionJournalDetailed(sessionsDir).recordings;
}

/**
 * `readSessionJournal` plus the skipped basenames, for surfaces that
 * report the honesty line (`GET /api/activity/sessions` lists them in
 * `skipped`, the map-views dialect). The scan-side fold keeps the
 * plain reader: a skipped file is a non-event there.
 */
export function readSessionJournalDetailed(sessionsDir: string): {
  recordings: SessionRecording[];
  skipped: string[];
} {
  if (!existsSync(sessionsDir)) return { recordings: [], skipped: [] };
  let names: string[];
  try {
    names = readdirSync(sessionsDir)
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch {
    return { recordings: [], skipped: [] };
  }
  const validators = loadSchemaValidators();
  const recordings: SessionRecording[] = [];
  const skipped: string[] = [];
  for (const name of names) {
    try {
      const raw = JSON.parse(readFileSync(join(sessionsDir, name), 'utf8')) as unknown;
      const result = validators.validate<SessionRecording>('session-recording', raw);
      if (result.ok) recordings.push(result.data);
      else skipped.push(name);
    } catch {
      // Off-shape / unreadable: skipped by contract, name reported.
      skipped.push(name);
    }
  }
  return { recordings, skipped };
}

/** Fold accumulator entry: the public relation plus its session set. */
interface IFoldEntry extends IObservedRelation {
  sessionKeys: Set<string>;
}

/** Execution accumulator entry: the public shape plus its session set. */
interface IExecutionEntry extends IObservedExecution {
  sessionKeys: Set<string>;
}

/** Per-recording fold state (owner claims + spawn dedupe reset per session). */
interface IRecordingFoldState {
  sessionKey: string;
  lastUnitByOwner: Map<string, string>;
  countedSpawnIds: Set<string>;
}

/**
 * The executions half of the fold: per-node unit-run counts plus the
 * ACTIVE-session denominator, the distinct recorded sessions that
 * produced at least one unit run (spec §Consumption: a recording where
 * nothing executed proves nothing, so "never ran" claims count against
 * active sessions, not raw files).
 */
export interface IObservedExecutions {
  /** Per-node unit-run counts keyed by node path. */
  byPath: ReadonlyMap<string, IObservedExecution>;
  /** Distinct recorded sessions with at least one unit run. */
  activeSessions: number;
}

/** The one journal fold's full product (spec §Session journal · Consumption). */
export interface IObservedActivity {
  /** `(source, target)` pairs keyed `source\x00target`. */
  relations: ReadonlyMap<string, IObservedRelation>;
  /** Per-node unit runs + the active-session denominator. */
  executions: IObservedExecutions;
}

/**
 * Fold recordings into the observed activity: relations keyed
 * `source\x00target` (a pair observed under MORE than one relation,
 * producible since reads joined: an agent file can be both read and
 * spawned, keeps its first-seen relation and keeps accumulating
 * counts) plus per-node execution counts (the dead-design
 * volume gate), both out of ONE walk over the frames.
 */
export function foldObservedActivity(
  recordings: readonly SessionRecording[],
): IObservedActivity {
  const relations = new Map<string, IFoldEntry>();
  const executions = new Map<string, IExecutionEntry>();
  const activeSessionKeys = new Set<string>();
  for (const recording of recordings) {
    const state: IRecordingFoldState = {
      // Distinct-session identity: rootOwner alone repeats across boots
      // (a bare `main`), so anchor on the recording's start too.
      sessionKey: `${recording.rootOwner}\x00${recording.startedAt}`,
      lastUnitByOwner: new Map(),
      countedSpawnIds: new Set(),
    };
    for (const frame of recording.frames) {
      if (frame.type === 'agent.spawn') foldSpawnFrame(relations, state, frame);
      else foldActivityFrame(relations, executions, activeSessionKeys, state, frame);
    }
  }
  const relationsOut = new Map<string, IObservedRelation>();
  for (const [key, entry] of relations) {
    const { sessionKeys, ...relation } = entry;
    relationsOut.set(key, { ...relation, sessions: sessionKeys.size });
  }
  const byPath = new Map<string, IObservedExecution>();
  for (const [key, entry] of executions) {
    const { sessionKeys, ...execution } = entry;
    byPath.set(key, { ...execution, sessions: sessionKeys.size });
  }
  return {
    relations: relationsOut,
    executions: { byPath, activeSessions: activeSessionKeys.size },
  };
}

/** One `agent.spawn` frame: count once per `spawnId`, both paths required. */
function foldSpawnFrame(
  relations: Map<string, IFoldEntry>,
  state: IRecordingFoldState,
  frame: SessionRecordingFrame,
): void {
  const parent = frame.data['parentNodePath'];
  const child = frame.data['childNodePath'];
  const spawnId = frame.data['spawnId'];
  if (typeof parent !== 'string' || typeof child !== 'string' || typeof spawnId !== 'string') {
    return;
  }
  if (state.countedSpawnIds.has(spawnId)) return;
  state.countedSpawnIds.add(spawnId);
  observe(relations, state.sessionKey, parent, child, 'spawns', frame.tMs);
}

/**
 * One `node.activity` frame: an MCP or READ start correlates to the
 * owner's current unit; a unit's own start (sticky / keepAlive
 * included, mirroring the client fold's claim map) becomes that
 * current unit AND counts as an execution (except `keepAlive`,
 * custody is not a run).
 */
function foldActivityFrame(
  relations: Map<string, IFoldEntry>,
  executions: Map<string, IExecutionEntry>,
  activeSessionKeys: Set<string>,
  state: IRecordingFoldState,
  frame: SessionRecordingFrame,
): void {
  const data = frame.data;
  const owner = data['owner'];
  if (typeof owner !== 'string') return;
  // Turn boundary (spec §Consumption): the unit correlation is
  // turn-bounded, so an access in a later turn never attributes to a
  // unit from an earlier one (the discrete mirror of the live TTL
  // decay). Subagent owners never see a turnEnd; their whole span is
  // their own work.
  if (data['turnEnd'] === true) {
    state.lastUnitByOwner.delete(owner);
    return;
  }
  const nodePath = data['nodePath'];
  if (data['phase'] !== 'start' || typeof nodePath !== 'string') return;
  if (data['access'] !== undefined) {
    foldAccessFrame(relations, state, owner, nodePath, data['access'], frame.tMs);
    return;
  }
  foldUnitStart(executions, activeSessionKeys, state, owner, nodePath, data['keepAlive'] === true, frame.tMs);
}

/**
 * A unit's own start: it becomes the owner's current unit (sticky and
 * keepAlive included, mirroring the client claim map) and counts as an
 * execution, except `keepAlive`: custody is not a run.
 */
function foldUnitStart(
  executions: Map<string, IExecutionEntry>,
  activeSessionKeys: Set<string>,
  state: IRecordingFoldState,
  owner: string,
  nodePath: string,
  keepAlive: boolean,
  tMs: number,
): void {
  if (nodePath.startsWith(MCP_NODE_PREFIX)) return;
  state.lastUnitByOwner.set(owner, nodePath);
  if (keepAlive) return;
  activeSessionKeys.add(state.sessionKey);
  recordExecution(executions, state.sessionKey, nodePath, tMs);
}

/**
 * One resource-access frame: the owner's current unit (when known)
 * touched the accessed path. `mcp` folds as `invokes`, `read` and
 * `shell` as `reads` (a shell sighting is a heuristic read, admitted
 * 2026-08-30); `write` and any future class are ignored until they
 * earn a fold.
 */
function foldAccessFrame(
  relations: Map<string, IFoldEntry>,
  state: IRecordingFoldState,
  owner: string,
  accessedPath: string,
  access: unknown,
  tMs: number,
): void {
  const relation =
    access === 'mcp' ? 'invokes' : access === 'read' || access === 'shell' ? 'reads' : null;
  if (relation === null) return;
  const caller = state.lastUnitByOwner.get(owner);
  if (caller !== undefined && caller !== accessedPath) {
    observe(relations, state.sessionKey, caller, accessedPath, relation, tMs);
  }
}

/** Accumulate one unit run onto the node's execution entry. */
function recordExecution(
  executions: Map<string, IExecutionEntry>,
  sessionKey: string,
  path: string,
  tMs: number,
): void {
  let entry = executions.get(path);
  if (entry === undefined) {
    entry = { path, count: 0, sessions: 0, lastSeenAt: tMs, sessionKeys: new Set() };
    executions.set(path, entry);
  }
  entry.count += 1;
  entry.sessionKeys.add(sessionKey);
  if (tMs > entry.lastSeenAt) entry.lastSeenAt = tMs;
}

/** Accumulate one observation onto the pair's fold entry. */
function observe(
  relations: Map<string, IFoldEntry>,
  sessionKey: string,
  source: string,
  target: string,
  relation: IObservedRelation['relation'],
  tMs: number,
): void {
  const key = `${source}\x00${target}`;
  let entry = relations.get(key);
  if (entry === undefined) {
    entry = {
      source,
      target,
      relation,
      count: 0,
      sessions: 0,
      lastSeenAt: tMs,
      sessionKeys: new Set(),
    };
    relations.set(key, entry);
  }
  entry.count += 1;
  entry.sessionKeys.add(sessionKey);
  if (tMs > entry.lastSeenAt) entry.lastSeenAt = tMs;
}
