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
  type ISessionAgentNode,
  type ISessionEntry,
  type ISessionReplaySelection,
} from './session-index';

export interface IJournalCatalog {
  readonly entries: readonly ISessionEntry[];
  /** Recording frames keyed by session root owner. */
  readonly frames: ReadonlyMap<string, readonly TRecordedEvent[]>;
}

export const EMPTY_JOURNAL_CATALOG: IJournalCatalog = { entries: [], frames: new Map() };

export function foldJournalRecordings(
  tapeSessions: readonly ISessionEntry[],
  recordings: readonly ISessionRecordingApi[],
): IJournalCatalog {
  if (recordings.length === 0) return EMPTY_JOURNAL_CATALOG;
  const clientRoots = new Set(tapeSessions.map((s) => s.rootOwner));
  const entries: ISessionEntry[] = [];
  const frames = new Map<string, readonly TRecordedEvent[]>();
  for (const recording of recordings) {
    if (clientRoots.has(recording.rootOwner)) continue;
    // AJV pinned the frame shapes server-side (`session-recording.
    // schema.json`), and they ARE the recorder's own tape shape.
    const recFrames = recording.frames as unknown as readonly TRecordedEvent[];
    for (const entry of computeSessionIndex(recFrames).sessions) {
      if (clientRoots.has(entry.rootOwner) || frames.has(entry.rootOwner)) continue;
      entries.push(entry);
      frames.set(entry.rootOwner, recFrames);
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
  readonly agentSpawnId?: string;
  readonly tapeSessions: readonly ISessionEntry[];
  readonly journal: IJournalCatalog;
}

export function resolveReplayTarget(args: IResolveReplayTargetArgs): IReplayTarget | null {
  const tapeEntry = args.tapeSessions.find((s) => s.rootOwner === args.rootOwner);
  const entry = tapeEntry ?? args.journal.entries.find((s) => s.rootOwner === args.rootOwner);
  if (entry === undefined) return null;
  const sourceFrames = tapeEntry === undefined ? args.journal.frames.get(entry.rootOwner) : undefined;
  const base: ISessionReplaySelection = {
    rootOwner: entry.rootOwner,
    ...(sourceFrames === undefined ? {} : { sourceFrames }),
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
