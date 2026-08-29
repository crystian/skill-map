/**
 * `UsageTrackerService`, the single UI emit point for opt-in usage analytics
 * (`spec/telemetry.md` §Usage event taxonomy).
 *
 * BOOT CONTRACT: `providedIn: 'root'` and self-wires in its constructor (the
 * theme super-property effect). `app.config.ts` calls
 * `inject(UsageTrackerService)` once at boot solely to fire that constructor.
 * Do NOT add a lazy `init()`.
 *
 * Every emit funnels through `captureUiUsage`, which is a hard no-op until the
 * PostHog surface is active (key configured + UI usage consent on). So this
 * service is safe to wire unconditionally: while dormant it does nothing and
 * the SDK is never even fetched.
 *
 * There is deliberately NO per-view / per-route event: the app has a single
 * fused workspace view, so a navigation-driven event only counted
 * interactions (filter / selection sync rewrites the URL constantly). The
 * session-presence signal is `ui.app.start`, emitted by the boot initializer.
 * Only allow-listed feature names and the active theme leave the browser,
 * never a node path, title, query string, or any content.
 */

import { Injectable, effect, inject } from '@angular/core';

import { captureUiUsage, registerUsageSuperProps } from '../core/telemetry/posthog-init';
import {
  buildAiActionEventProperties,
  buildFeatureEventProperties,
  buildFilterEventProperties,
  buildLensSelectEventProperties,
  buildNodeActionEventProperties,
  buildPluginApplyProperties,
  buildSidecarConsentEventProperties,
  type IPluginToggleChange,
} from '../core/telemetry/usage-collector';
import { ThemeService } from '../../services/theme';

/**
 * Feature surfaces tracked on explicit user gesture: modal opens, the
 * workspace rail's tabs, the files rail's coupling toggles, the topbar
 * buttons, the queue's per-job cancel, and the node favorite star (cards +
 * inspector header). The node inspector open is deliberately absent: a
 * per-selection event was interaction-level noise (`spec/telemetry.md`
 * §Usage event taxonomy).
 *
 * Surfaces owned by a dedicated tracker method (`ai-action`,
 * `node-action`, `lens-select`, `sidecar-consent`) are deliberately NOT
 * in this union: those events carry collapse / dedupe logic of their own,
 * and keeping them out makes `trackFeature('ai-action', ...)` a compile
 * error instead of a silent uncollapsed variant of the same event name.
 */
export type TUsageFeatureSurface =
  | 'settings'
  | 'quick-start'
  | 'files'
  | 'queue'
  | 'sessions'
  | 'files-search-map'
  | 'files-follow-selection'
  | 'job-cancel'
  | 'job-cancel-all'
  | 'job-clear-failed'
  | 'job-clear-finished'
  | 'live-toggle'
  | 'scan'
  | 'theme-toggle'
  | 'theme-extra'
  | 'settings-resolution'
  | 'settings-changelog'
  | 'settings-about'
  | 'favorite-toggle'
  | 'live-updates'
  | 'realtime-activity'
  | 'runtime-agents'
  | 'change-spark'
  | 'ignore-path'
  | 'capture-conversations'
  | 'hook-install'
  | 'hook-uninstall'
  | 'skill-install'
  | 'skill-uninstall'
  | 'skill-update'
  | 'follow-symlinks'
  | 'mcp-server'
  | 'skill-actions'
  | 'allow-sidecar'
  | 'use-gitignore'
  | 'reference-paths-add'
  | 'reference-paths-remove'
  | 'ignore-patterns-add'
  | 'ignore-patterns-remove'
  | 'mcp-copy'
  | 'shell-optin-copy'
  | 'mcp-check'
  | 'agent-jobs-check'
  | 'auto-fixer'
  | 'ai-action-all'
  | 'summarize'
  | 'finding-fix'
  | 'finding-dismiss'
  | 'finding-resolve'
  | 'finding-restore'
  | 'finding-delete'
  | 'auto-tag'
  | 'tags-edit'
  | 'tags-save'
  | 'findings-reveal'
  | 'reanalyze';

/**
 * Where a shared gesture was performed. A feature reachable from more than
 * one surface (Settings, Quick Start, the inspector and the files rail
 * expose some of the same actions) stamps `source` from EVERY call site,
 * so adoption of each path is comparable in PostHog; single-surface
 * features omit it.
 */
export type TUsageFeatureSource = 'settings' | 'quick-start' | 'inspector' | 'files' | 'topbar';

/** The map toolbox's filter families, the `group` property of `ui.filter`. */
export type TUsageFilterGroup = 'kind' | 'severity' | 'link' | 'favorites';

@Injectable({ providedIn: 'root' })
export class UsageTrackerService {
  private readonly theme = inject(ThemeService);

  constructor() {
    // Keep the active theme as a PostHog super-property so any metric can be
    // broken down by it. Re-fires on every theme change; a no-op while
    // dormant (the boot value is re-registered after init, see app.config).
    effect(() => this.syncTheme());
  }

  /**
   * Record opening a feature surface (the settings modal, the workspace
   * rail's files / queue tabs) as `ui.feature.<feature>`. Callers emit on
   * the USER gesture only, never on an auto-open. A toggle-flavored
   * feature passes `value`, the state the gesture SET (a boolean, or a
   * closed-enum string like the theme mode); a gesture shared between
   * surfaces passes `source`. Both ride as properties and fold into
   * `$screen_name` (`<feature>[:<value>][@<source>]`). String values are
   * collapsed inside the builder (`qualifyMaybePluginValue`), so a
   * plugin-qualified id is safe to pass raw. No-op while the usage
   * surface is dormant.
   */
  trackFeature(
    surface: TUsageFeatureSurface,
    value?: boolean | string,
    source?: TUsageFeatureSource,
  ): void {
    captureUiUsage(`ui.feature.${surface}`, buildFeatureEventProperties(surface, value, source));
  }

  /**
   * Record launching one AI action from the inspector's launcher as
   * `ui.feature.ai-action`: the extension id rides as `value` (collapsed,
   * so a third-party finder / fixer never leaves by name) plus `auto_fix`,
   * whether the launch chained the fixers. The group-ALL button emits its
   * own `ai-action-all` gesture instead (one event per click, never one
   * per queued entry). No-op while dormant.
   */
  trackAiAction(extensionId: string, autoFix: boolean): void {
    captureUiUsage('ui.feature.ai-action', buildAiActionEventProperties(extensionId, autoFix));
  }

  /**
   * Record the `.sm` write-consent dialog resolution as
   * `ui.feature.sidecar-consent` (`value` = `always` / `once` /
   * `declined`, one per showing, deduped by the dialog). `context` names
   * WHAT parked behind the gate: a qualified action id (collapsed here,
   * a third-party action never leaves by name) or a findings-flow
   * literal (slash-free, ours, passes verbatim). Rides as `action`.
   */
  trackSidecarConsent(value: 'always' | 'once' | 'declined', context: string | null): void {
    captureUiUsage('ui.feature.sidecar-consent', buildSidecarConsentEventProperties(value, context));
  }

  /**
   * Record dispatching a plugin-contributed inspector action button
   * (Bump, Set stability, Edit tags, any `inspector.action.button`
   * contribution) as `ui.feature.node-action`, the action id collapsed as
   * `value`. Emitted once per REAL dispatch (a cancelled parameter prompt
   * never counts); the prompt value itself never rides. No-op while
   * dormant.
   */
  trackNodeAction(actionId: string): void {
    captureUiUsage('ui.feature.node-action', buildNodeActionEventProperties(actionId));
  }

  /**
   * Record the CONFIRMED lens switch as `ui.feature.lens-select`. The
   * collapsed target rides BOTH as `value` (the generic feature-value
   * convention) and as `lens`, the cross-event lens property `ui.app.start`
   * and the CLI's `cli.scan` / `cli.config` share, so one PostHog breakdown
   * covers every lens signal. Third-party provider ids collapse here.
   */
  trackLensSelect(lens: string, source: TUsageFeatureSource): void {
    captureUiUsage('ui.feature.lens-select', buildLensSelectEventProperties(lens, source));
  }

  /**
   * Record a map-toolbox filter gesture as ONE `ui.filter` event carrying
   * `group` (the filter family) and, for the valued families, `value`
   * (`spec/telemetry.md` §Usage event taxonomy). Kind values collapse
   * through {@link qualifyKindForUsage} (the registry is plugin-extensible);
   * severity / link values are closed unions and pass verbatim. Callers
   * emit on the USER gesture only, never on an auto-clear or URL restore.
   */
  trackFilter(group: TUsageFilterGroup, value?: string): void {
    captureUiUsage('ui.filter', buildFilterEventProperties(group, value));
  }

  /**
   * Record a committed Settings plugins Apply as `plugin.apply`, the same
   * event the CLI's `sm plugins enable / disable` emits (spec/telemetry.md
   * §Usage event taxonomy). The toggle deltas collapse through the pure
   * collector (`buildPluginApplyProperties`); a batch with no toggle
   * (settings-only edits) emits nothing. No-op while dormant.
   */
  trackPluginApply(changes: ReadonlyArray<IPluginToggleChange>): void {
    const props = buildPluginApplyProperties(changes);
    if (props !== null) captureUiUsage('plugin.apply', props);
  }

  /**
   * Push the current theme as super-properties: `theme_base` (the resolved
   * light / dark) and `theme_extra` (the active extra theme id, or `none`).
   * Called by the theme effect on change, and once from app boot after the SDK
   * activates so the initial theme is captured. No-op while dormant.
   */
  syncTheme(): void {
    registerUsageSuperProps({
      theme_base: this.theme.resolved(),
      theme_extra: this.theme.extraTheme() ?? 'none',
    });
  }
}
