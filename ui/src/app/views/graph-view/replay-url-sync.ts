/**
 * The replay deep link (spec/provider-activity.md §Session journal,
 * "Addressable replay"): `?replay=<rootOwner>[&agent=<spawnId>][&at=<frame>]`.
 *
 *   - Reader (BOOT ONLY, like `MapViewUrlSyncService`): the params are
 *     read once when the graph mounts; the host resolves the session
 *     against the client tape and the journal (async, the journal is
 *     a GET) and enters the replay, landing PAUSED on `at` when given.
 *     An unknown target (another machine's journal, a purged session)
 *     is ignored silently and the params are dropped.
 *   - Writer: while a session-scoped replay is active the URL names it
 *     (`replay`, plus `agent` for an agent-branch scope), and carries
 *     `at` ONLY while paused: a paused replay is a moment worth
 *     sharing, a playing one is a film that starts from the top. Exit
 *     clears the three params. The write-back stays parked until the
 *     boot read resolved, so the inactive-at-boot state can never
 *     clobber a deep link mid-resolution.
 *
 * The whole-tape replay (the record control's own Stop replay) has no
 * session identity and is never linkable: `replayLinkFromPlayback`
 * answers `null` for it, so the URL stays clean and the transport's
 * Copy link hides.
 *
 * Pure helpers (`parseReplayLink`, `replayLinkFromPlayback`,
 * `replayLinkQueryParams`) are exported for the transport bar and the
 * spec; `setupReplayUrlSync` wires them to the router and must be
 * called in an injection context (a field initializer of the host).
 */

import { effect, inject, untracked, type Signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import type { TReplaySource } from '../../../services/activity-playback';
import type { IReplayTarget } from '../../../services/session-catalog';

export const REPLAY_PARAM = 'replay';
export const REPLAY_AGENT_PARAM = 'agent';
export const REPLAY_AT_PARAM = 'at';
/** The recording (`ISessionEntry.recordedAt`): a runtime session recorded twice is two links. */
export const REPLAY_REC_PARAM = 'rec';

export interface IReplayLink {
  readonly rootOwner: string;
  readonly agentSpawnId?: string;
  readonly recordedAt?: number;
  /** 0-based frame index inside the SCOPED tape; the replay lands paused there. */
  readonly at?: number;
}

/** Parse the three params (`read` answers `null` for an absent one). */
export function parseReplayLink(read: (name: string) => string | null): IReplayLink | null {
  const rootOwner = read(REPLAY_PARAM);
  if (rootOwner === null || rootOwner.length === 0) return null;
  const agent = read(REPLAY_AGENT_PARAM);
  const atRaw = read(REPLAY_AT_PARAM);
  const at = atRaw === null ? undefined : Number.parseInt(atRaw, 10);
  const recRaw = read(REPLAY_REC_PARAM);
  const rec = recRaw === null ? undefined : Number.parseInt(recRaw, 10);
  return {
    rootOwner,
    ...(agent === null || agent.length === 0 ? {} : { agentSpawnId: agent }),
    ...(rec === undefined || !Number.isInteger(rec) || rec <= 0 ? {} : { recordedAt: rec }),
    ...(at === undefined || !Number.isInteger(at) || at < 0 ? {} : { at }),
  };
}

/** The link the current transport state stands for (`null` = not linkable). */
export function replayLinkFromPlayback(
  source: TReplaySource,
  playing: boolean,
  cursor: number,
): IReplayLink | null {
  if (source.kind === 'whole-tape') return null;
  return {
    rootOwner: source.rootOwner,
    ...(source.agentSpawnId === undefined ? {} : { agentSpawnId: source.agentSpawnId }),
    ...(source.recordedAt === undefined ? {} : { recordedAt: source.recordedAt }),
    ...(!playing && cursor >= 0 ? { at: cursor } : {}),
  };
}

/** Router `queryParams` for a link; `null` values clear the param under `merge`. */
export function replayLinkQueryParams(link: IReplayLink | null): Record<string, string | null> {
  return {
    [REPLAY_PARAM]: link?.rootOwner ?? null,
    [REPLAY_AGENT_PARAM]: link?.agentSpawnId ?? null,
    [REPLAY_REC_PARAM]: link?.recordedAt === undefined ? null : String(link.recordedAt),
    [REPLAY_AT_PARAM]: link?.at === undefined ? null : String(link.at),
  };
}

export interface IReplayUrlSyncConfig {
  /** Replay transport slice (structural so the spec stubs it). */
  playback: {
    active: Signal<boolean>;
    playing: Signal<boolean>;
    cursor: Signal<number>;
    source: Signal<TReplaySource>;
  };
  /** Resolve a link's session (tape + journal); `null` when unknown. */
  resolve: (link: IReplayLink) => Promise<IReplayTarget | null>;
  /** Enter the replay (the host's `replaySessionFromTape`), paused at `at` when given. */
  enter: (target: IReplayTarget, at?: number) => void;
}

export interface IReplayUrlSyncHandle {
  /** The link the boot read found (`null` when the URL named none). */
  readonly bootLink: IReplayLink | null;
}

export function setupReplayUrlSync(config: IReplayUrlSyncConfig): IReplayUrlSyncHandle {
  const router = inject(Router);
  const route = inject(ActivatedRoute);

  const currentParam = (name: string): string | null => {
    const value = router.parseUrl(router.url).queryParams[name];
    if (Array.isArray(value)) return value[0] ?? null;
    return typeof value === 'string' && value.length > 0 ? value : null;
  };

  const write = (link: IReplayLink | null): void => {
    const current = parseReplayLink(currentParam);
    if (JSON.stringify(current) === JSON.stringify(link)) return;
    void router.navigate([], {
      relativeTo: route,
      queryParams: replayLinkQueryParams(link),
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  };

  let bootResolved = false;
  const bootLink = parseReplayLink(currentParam);
  if (bootLink === null) {
    bootResolved = true;
  } else {
    void config
      .resolve(bootLink)
      .then((target) => {
        if (target !== null) config.enter(target, bootLink.at);
      })
      .catch(() => undefined)
      .then(() => {
        bootResolved = true;
        write(
          replayLinkFromPlayback(
            config.playback.source(),
            config.playback.playing(),
            config.playback.cursor(),
          ),
        );
      });
  }

  // Transport -> URL. The guard flag is plain state, so the boot flip
  // never re-fires the effect (its one write happens above).
  effect(() => {
    const link = config.playback.active()
      ? replayLinkFromPlayback(
          config.playback.source(),
          config.playback.playing(),
          config.playback.cursor(),
        )
      : null;
    untracked(() => {
      if (bootResolved) write(link);
    });
  });

  return { bootLink };
}
