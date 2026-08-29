/**
 * Pure helpers over the session index shared by the Sessions rail and
 * the replay deep link (`graph-view/replay-url-sync.ts`):
 *
 *   - `foldJournalRecordings`: the journal-ONLY sessions (recordings
 *     listed off `.skill-map/sessions/`), folded through the same
 *     `computeSessionIndex` as the client tape so rows / agents / steps
 *     reuse every template unchanged; roots the tape already carries
 *     are skipped (the live version wins, it is still updating). The
 *     frames map feeds the replay selection (`sourceFrames`), the
 *     client recorder never saw these frames.
 *   - `sessionTitle`: the session's display title, the touched-node
 *     names in first-touch order (user call 2026-08-17), falling back
 *     to the counters when nothing was touched.
 *   - `resolveReplayTarget`: a replay link's `(rootOwner, agent?)` to
 *     the replay selection + transport label, tape first then journal,
 *     `null` when neither knows the session (a link from another
 *     machine's journal, or a purged one).
 */

import { SESSIONS_VIEW_TEXTS } from '../i18n/sessions-view.texts';
import type { ISessionRecordingApi } from '../models/api';
import type { TRecordedEvent } from './activity-recorder';
import { pathBasenameForLink } from './path-basename';
import {
  computeSessionIndex,
  sessionKeyOf,
  type ISessionAgentNode,
  type ISessionEntry,
  type ISessionReplaySelection,
} from './session-index';

export interface IJournalCatalog {
  readonly entries: readonly ISessionEntry[];
  /** Recording frames keyed by `sessionKeyOf(entry)` (root owner + recording). */
  readonly frames: ReadonlyMap<string, readonly TRecordedEvent[]>;
}

/**
 * Does a tape session already narrate the recording that started at
 * `startedAt` for the same root? The tape stamps its own window on
 * every frame (`recordedAt`, the client clock at Record) and the
 * journal's `startedAt` is the first server frame inside it, so the
 * window contains it; a legacy tape (no stamp) falls back to its frame
 * span. Both memories hold the same frames, the live one wins.
 */
function tapeCovers(tapeSessions: readonly ISessionEntry[], rootOwner: string, startedAt: number): boolean {
  return tapeSessions.some(
    (t) =>
      t.rootOwner === rootOwner &&
      (t.recordedAt ?? t.firstTMs) <= startedAt &&
      startedAt <= Math.max(t.lastTMs, t.recordedAt ?? 0),
  );
}

export const EMPTY_JOURNAL_CATALOG: IJournalCatalog = { entries: [], frames: new Map() };

export function foldJournalRecordings(
  tapeSessions: readonly ISessionEntry[],
  recordings: readonly ISessionRecordingApi[],
): IJournalCatalog {
  if (recordings.length === 0) return EMPTY_JOURNAL_CATALOG;
  const entries: ISessionEntry[] = [];
  const frames = new Map<string, readonly TRecordedEvent[]>();
  for (const recording of recordings) {
    // Every recording FILE is its own row (user decision 2026-08-29:
    // each press of Record is a new session), identified by root owner
    // + the file's `startedAt`; the tape hides only the window it
    // already narrates itself.
    if (tapeCovers(tapeSessions, recording.rootOwner, recording.startedAt)) continue;
    // AJV pinned the frame shapes server-side (`session-recording.
    // schema.json`), and they ARE the recorder's own tape shape.
    const recFrames = recording.frames as unknown as readonly TRecordedEvent[];
    for (const folded of computeSessionIndex(recFrames).sessions) {
      const entry: ISessionEntry = { ...folded, recordedAt: recording.startedAt };
      const key = sessionKeyOf(entry);
      if (frames.has(key)) continue;
      entries.push(entry);
      frames.set(key, recFrames);
    }
  }
  return { entries, frames };
}

export function sessionTitle(session: ISessionEntry): string {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const path of session.touchedPaths) {
    const name = pathBasenameForLink(path);
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  if (names.length === 0) {
    return SESSIONS_VIEW_TEXTS.stats(
      session.eventCount,
      session.touchedPaths.size,
      session.agentCount,
    );
  }
  return names.join(SESSIONS_VIEW_TEXTS.touchedSeparator);
}

/** Depth-first search of the agent tree by spawn id. */
export function findSessionAgent(
  agents: readonly ISessionAgentNode[],
  spawnId: string,
): ISessionAgentNode | undefined {
  for (const agent of agents) {
    if (agent.spawnId === spawnId) return agent;
    const nested = findSessionAgent(agent.children, spawnId);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export interface IReplayTarget {
  readonly selection: ISessionReplaySelection;
  /** What the transport's scope chip shows (session title, or `title / agent`). */
  readonly label: string;
}

export interface IResolveReplayTargetArgs {
  readonly rootOwner: string;
  /** Recording identity; when absent the LATEST recording of the root wins. */
  readonly recordedAt?: number;
  readonly agentSpawnId?: string;
  readonly tapeSessions: readonly ISessionEntry[];
  readonly journal: IJournalCatalog;
}

/** Latest (by first frame) session of `rootOwner`, or the exact recording when named. */
function pickSession(
  sessions: readonly ISessionEntry[],
  rootOwner: string,
  recordedAt: number | undefined,
): ISessionEntry | undefined {
  const candidates = sessions.filter(
    (s) => s.rootOwner === rootOwner && (recordedAt === undefined || s.recordedAt === recordedAt),
  );
  return candidates.reduce<ISessionEntry | undefined>(
    (best, s) => (best === undefined || s.firstTMs > best.firstTMs ? s : best),
    undefined,
  );
}

export function resolveReplayTarget(args: IResolveReplayTargetArgs): IReplayTarget | null {
  const tapeEntry = pickSession(args.tapeSessions, args.rootOwner, args.recordedAt);
  const entry = tapeEntry ?? pickSession(args.journal.entries, args.rootOwner, args.recordedAt);
  if (entry === undefined) return null;
  const sourceFrames = tapeEntry === undefined ? args.journal.frames.get(sessionKeyOf(entry)) : undefined;
  const base: ISessionReplaySelection = {
    rootOwner: entry.rootOwner,
    ...(entry.recordedAt === undefined ? {} : { recordedAt: entry.recordedAt }),
    ...(sourceFrames === undefined
      ? tapeEntry?.recordedAt === undefined
        ? {}
        : { tapeWindow: tapeEntry.recordedAt }
      : { sourceFrames }),
  };
  const title = sessionTitle(entry);
  if (args.agentSpawnId === undefined) return { selection: base, label: title };
  const agent = findSessionAgent(entry.agents, args.agentSpawnId);
  if (agent === undefined) return null;
  return {
    selection: { ...base, agentSpawnId: agent.spawnId },
    label: SESSIONS_VIEW_TEXTS.agentLabel(title, agent.name ?? SESSIONS_VIEW_TEXTS.unnamedAgent),
  };
}
