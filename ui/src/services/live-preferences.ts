/**
 * `LivePreferencesService`, user-tunable switches for the live server
 * channel, shown in Settings → Project:
 *
 *   - `wsEnabled`, whether the SPA opens the live `/ws` channel at all.
 *     OFF means no live updates of any kind: no scan refreshes, no
 *     event log frames, no node activity. The map still works through
 *     plain HTTP reads (manual refresh).
 *   - `activityEnabled`, whether real-time node activity (the executing
 *     glow driven by `node.activity` frames, `spec/provider-activity.md`)
 *     lights up the map. OFF keeps the socket (and every other live
 *     feature) untouched; only the activity lighting goes inert.
 *   - `changeSparkEnabled`, whether the map flashes a node once when
 *     the live watcher detects its file changed on disk (the "change
 *     spark"). Subordinate to `wsEnabled` only. Behaviour owner:
 *     `NodeSparkService.setEnabled` (clears the live sparks on
 *     disable), mirroring the activity pair.
 *   - `followActivityEnabled`, whether the graph camera auto-frames the
 *     executing nodes ("Follow the Activity", the map-toolbar toggle).
 *     Default ON (user call 2026-07-26: watching the agent run IS the
 *     point of Real Time, so the camera follows out of the box); the
 *     operator can switch it off and the choice persists per browser.
 *
 * Persistence is split by nature. `wsEnabled` / `activityEnabled` are
 * project-scoped preferences: they live in the checkout's gitignored
 * `.skill-map/settings.local.json` (`ui.liveUpdates` /
 * `ui.realtimeActivity`), read at boot through
 * `GET /api/project-preferences` (see `load()`, wired as an app
 * initializer so the values are settled BEFORE any consumer opens the
 * socket) and written through `PATCH /api/project-preferences`
 * (write-behind: the signal flips immediately, the PATCH follows; a
 * failed write only logs, matching the old swallow-quota-errors
 * posture). `followActivityEnabled` stays in `localStorage`: it is a
 * per-browser camera habit, not project state.
 *
 * This service is the STORAGE seam only: it owns the persistence, the
 * defaults, and the signals. The behaviour lives with each feature
 * owner, `WsEventStreamService.setEnabled()` (closes / reopens the
 * socket) and `NodeActivityService.setEnabled()` (clears the lit set),
 * both of which persist through the setters here. UI code flips the
 * switches through those owners, never through this service directly,
 * so the preference and the runtime state can never diverge. The
 * follow-activity switch is the one exception: its behaviour owner is
 * `GraphView` (the camera lives there) and it has no runtime state
 * beyond the preference itself, so the component reads and writes the
 * setter here directly, nothing can diverge.
 */

import { Injectable, Injector, inject, signal } from '@angular/core';

import { DATA_SOURCE, type IDataSourcePort } from './data-source/data-source.port';

const FOLLOW_ACTIVITY_KEY = 'sm.live.follow-activity';
const DIRECTOR_KEY = 'sm.live.director';

@Injectable({ providedIn: 'root' })
export class LivePreferencesService {
  /**
   * DATA_SOURCE is resolved LAZILY (first `load()` / `persist()` call),
   * never at construction: the live `DATA_SOURCE` factory builds
   * `RestDataSource(WsEventStreamService)`, and the WS service injects
   * THIS service, so an eager `inject(DATA_SOURCE)` here closes an
   * NG0200 circular-DI loop at boot. By the time `load()` runs (app
   * initializer) or a setter persists (user action), the token is
   * fully constructed.
   */
  private readonly injector = inject(Injector);

  private get dataSource(): IDataSourcePort {
    return this.injector.get(DATA_SOURCE);
  }

  private readonly _wsEnabled = signal(true);
  private readonly _activityEnabled = signal(true);
  private readonly _showRuntimeAgents = signal(true);
  private readonly _changeSpark = signal(true);
  private readonly _followActivity = signal(readStoredBool(FOLLOW_ACTIVITY_KEY, true));
  private readonly _director = signal(readStoredBool(DIRECTOR_KEY, true));

  /** Live `/ws` channel wanted at all. Default ON. */
  readonly wsEnabled = this._wsEnabled.asReadonly();
  /** Real-time node activity lighting wanted. Default ON. */
  readonly activityEnabled = this._activityEnabled.asReadonly();
  /**
   * Agent capsules for runtime sub-agents with no scanned node wanted
   * (`ui.showRuntimeAgents`). Default ON; subordinate to
   * `activityEnabled`. Like the follow switch, the behaviour owner is
   * `GraphView` (the overlay projection reads it directly) and there is
   * no runtime state beyond the preference, so the Settings row writes
   * the setter here directly.
   */
  readonly showRuntimeAgents = this._showRuntimeAgents.asReadonly();
  /**
   * Change spark wanted (`ui.changeSpark`): flash a node once when the
   * watcher detects its file changed on disk. Default ON; subordinate
   * to `wsEnabled` only (no live channel, no scan frames). Behaviour
   * owner: `NodeSparkService.setEnabled`.
   */
  readonly changeSparkEnabled = this._changeSpark.asReadonly();
  /** Camera auto-frames the executing nodes. Default ON (user call 2026-07-26). */
  readonly followActivityEnabled = this._followActivity.asReadonly();
  /**
   * Replay director camera (default ON): the replay frames the node
   * each step is about instead of the whole route (`director.ts`).
   * Browser-local like follow: a camera taste, not project config.
   */
  readonly directorEnabled = this._director.asReadonly();

  /**
   * Fetch the persisted `ui.*` preferences and settle the signals.
   * Registered as an app initializer (`app.config.ts`), so it completes
   * BEFORE any component subscribes to the event stream; without that
   * ordering a `liveUpdates: false` checkout would flash-open the
   * socket. A failed fetch keeps the ON defaults, the map stays live.
   */
  async load(): Promise<void> {
    try {
      const prefs = await this.dataSource.getProjectPreferences();
      this._wsEnabled.set(prefs.ui?.liveUpdates ?? true);
      this._activityEnabled.set(prefs.ui?.realtimeActivity ?? true);
      this._showRuntimeAgents.set(prefs.ui?.showRuntimeAgents ?? true);
      this._changeSpark.set(prefs.ui?.changeSpark ?? true);
    } catch {
      // Offline BFF or older envelope: keep the ON defaults.
    }
  }

  setWsEnabled(value: boolean): void {
    if (this._wsEnabled() === value) return;
    this._wsEnabled.set(value);
    this.persist({ ui: { liveUpdates: value } });
  }

  setActivityEnabled(value: boolean): void {
    if (this._activityEnabled() === value) return;
    this._activityEnabled.set(value);
    this.persist({ ui: { realtimeActivity: value } });
  }

  setShowRuntimeAgents(value: boolean): void {
    if (this._showRuntimeAgents() === value) return;
    this._showRuntimeAgents.set(value);
    this.persist({ ui: { showRuntimeAgents: value } });
  }

  setChangeSparkEnabled(value: boolean): void {
    if (this._changeSpark() === value) return;
    this._changeSpark.set(value);
    this.persist({ ui: { changeSpark: value } });
  }

  setFollowActivityEnabled(value: boolean): void {
    if (this._followActivity() === value) return;
    this._followActivity.set(value);
    writeStoredBool(FOLLOW_ACTIVITY_KEY, value);
  }

  setDirectorEnabled(value: boolean): void {
    if (this._director() === value) return;
    this._director.set(value);
    writeStoredBool(DIRECTOR_KEY, value);
  }

  /**
   * Write-behind persist for the server-backed pair. The signal already
   * flipped (the runtime owners applied the behaviour); a failed PATCH
   * is logged and swallowed, the same posture the localStorage era took
   * with quota errors. Next boot re-reads whatever the server holds.
   */
  private persist(patch: {
    ui: {
      liveUpdates?: boolean;
      realtimeActivity?: boolean;
      showRuntimeAgents?: boolean;
      changeSpark?: boolean;
    };
  }): void {
    void this.dataSource.setProjectPreferences(patch).catch((err: unknown) => {
      console.warn('live-preferences: persisting the toggle failed', err);
    });
  }
}

function readStoredBool(key: string, fallback: boolean): boolean {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return fallback;
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
}

function writeStoredBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? 'true' : 'false');
  } catch {
    // Quota exceeded or storage blocked, swallow (matches the other
    // preference services).
  }
}
