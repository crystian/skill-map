/**
 * Pure helpers for the replay's narration chrome
 * (spec/provider-activity.md §Roles and boundary, the UI-owned replay
 * presentation):
 *
 *   - `resolveDirectorTargets`: what the lens camera frames on the
 *     current frame. Outside a replay (or with the director off) the
 *     lens follow keeps framing the WHOLE membership, so the camera
 *     breathes out as the tape accumulates nodes. With the director on
 *     it frames ONLY the node the cursor frame is about, so the replay
 *     reads as a sequence of close-ups gliding from caller to callee
 *     (the fit math zooms a single card up to `TAG_FIT_MAX_ZOOM`, which
 *     is the dolly-in). Frames about nothing on the map (explicit ends,
 *     owner / session ends, turn boundaries, nameless spawns) return the
 *     empty set, which the follow effect treats as "hold" through its
 *     empty-fingerprint sentinel. Before the first frame and at the END
 *     of the tape the whole membership is framed again: overview in,
 *     close-ups through, pull back to reveal the route the tape walked.
 */

import type { TPlaybackCaption } from '../../../services/activity-playback-state';

export interface IDirectorInput {
  /** `ActivityPlaybackService.active`. */
  replayOn: boolean;
  /** `LivePreferencesService.directorEnabled`. */
  director: boolean;
  /** Cursor sits on the tape's last frame (auto-pause point). */
  atEnd: boolean;
  /** The fold's caption for the cursor frame (`null` before step 0). */
  caption: TPlaybackCaption | null;
  /** The lens membership, the classic follow target. */
  membership: ReadonlySet<string>;
}

/** Shared "hold the camera" sentinel (the follow's empty fingerprint). */
export const DIRECTOR_HOLD: ReadonlySet<string> = new Set();

export function resolveDirectorTargets(input: IDirectorInput): ReadonlySet<string> {
  if (!input.replayOn || !input.director) return input.membership;
  const caption = input.caption;
  if (caption === null || input.atEnd) return input.membership;
  switch (caption.kind) {
    case 'start':
      return new Set([caption.path]);
    case 'spawn':
      return caption.child === undefined ? DIRECTOR_HOLD : new Set([caption.child]);
    default:
      return DIRECTOR_HOLD;
  }
}
