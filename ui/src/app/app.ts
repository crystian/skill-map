import { ChangeDetectionStrategy, Component, computed, inject, isDevMode, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgOptimizedImage } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { Popover, PopoverModule } from 'primeng/popover';
import { TooltipModule } from 'primeng/tooltip';

import { APP_TEXTS } from '../i18n/app.texts';
import { PROJECT_LINKS } from '../i18n/project-links';
import { GithubStarsService } from './services/github-stars';
import { SETTINGS_TEXTS } from '../i18n/settings.texts';
import { QUICK_START_TEXTS } from '../i18n/quick-start.texts';
import { THEME_TEXTS } from '../i18n/theme.texts';
import { UPDATE_CHECK_TEXTS } from '../i18n/update-check.texts';
import { CollectionLoaderService } from '../services/collection-loader';
import { NodeActivityService } from '../services/node-activity';
import { WsEventStreamService } from '../services/ws-event-stream';
import { analyzeLinks } from '../services/link-analysis';
import { A11yAnnouncerService } from './services/a11y-announcer';
import { ActivityReadinessService } from './services/activity-readiness';
import { ProcessingAgentReadinessService } from './services/processing-agent-readiness';
import { SettingsVisibilityService } from './services/settings-visibility';
import { ProjectInfoService } from './services/project-info';
import { ScanTriggerService } from './services/scan-trigger';
import { UpdateCheckService } from './services/update-check';
import { UsageTrackerService } from './services/usage-tracker';
import { ThemeService, type TThemeMode } from '../services/theme';
import { EXTRA_THEMES, findExtraTheme } from '../themes/registry';
import { ProviderRegistryService, type IProviderUi } from '../services/provider-registry';
import { DemoBanner } from './components/demo-banner/demo-banner';
import { TutorialReminderBanner } from './components/tutorial-reminder-banner/tutorial-reminder-banner';
import { ProviderMarkerDriftBanner } from './components/provider-marker-drift-banner/provider-marker-drift-banner';
import { OversizedBanner } from './components/oversized-banner/oversized-banner';
import { SkippedFilesBanner } from './components/skipped-files-banner/skipped-files-banner';
import { ConnectionBanner } from './components/connection-banner/connection-banner';
import { SettingsModal, type TSettingsSection } from './components/settings-modal/settings-modal';
import { QuickStartModal } from './components/quick-start-modal/quick-start-modal';
import { CrashReportDialog } from './components/crash-report-dialog/crash-report-dialog';
import { IgnoreConfirmDialog } from './components/ignore-confirm-dialog/ignore-confirm-dialog';
import { CrashReportConsentService } from './core/telemetry/crash-report-consent';
import {
  ProjectIgnoreService,
  type IIgnoreConfirmDecision,
} from '../services/project-ignore';
/* ViewContributionsHost: real topbar.nav.start slot mount (also ringed by the kept debug-slots overlay; see context/ui.md). */
import { ViewContributionsHost } from './components/view-contributions-host/view-contributions-host';

@Component({
  selector: 'sm-root',
  imports: [RouterOutlet, ButtonModule, InputTextModule, PopoverModule, TooltipModule, FormsModule, NgOptimizedImage, DemoBanner, TutorialReminderBanner, ProviderMarkerDriftBanner, OversizedBanner, SkippedFilesBanner, ConnectionBanner, SettingsModal, QuickStartModal, CrashReportDialog, IgnoreConfirmDialog, /* DEBUG-SLOTS */ ViewContributionsHost],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly loader = inject(CollectionLoaderService);
  private readonly theme = inject(ThemeService);
  private readonly projectInfo = inject(ProjectInfoService);
  private readonly providerRegistry = inject(ProviderRegistryService);
  private readonly scanTrigger = inject(ScanTriggerService);
  private readonly wsEvents = inject(WsEventStreamService);
  private readonly usageTracker = inject(UsageTrackerService);
  private readonly nodeActivity = inject(NodeActivityService);
  private readonly activityReadiness = inject(ActivityReadinessService);
  private readonly announcer = inject(A11yAnnouncerService);
  private readonly processingAgentReadiness = inject(ProcessingAgentReadinessService);
  private readonly settingsVisibility = inject(SettingsVisibilityService);
  // `FilterUrlSyncService` and `DebugSlotsService` are eagerly
  // instantiated via `provideAppInitializer` in `app.config.ts`. They
  // self-wire on construction; the App component does not need to
  // reach into them.
  protected readonly updateCheck = inject(UpdateCheckService);

  protected readonly texts = APP_TEXTS;
  /** Canonical outbound URLs behind the brand mark + wordmark. */
  protected readonly links = PROJECT_LINKS;
  /** Star count behind the action-cluster affordance; null renders nothing. */
  protected readonly stars = inject(GithubStarsService);
  protected readonly settingsTexts = SETTINGS_TEXTS;
  protected readonly quickStartTexts = QUICK_START_TEXTS;
  /**
   * Settings modal visibility. The modal is `@defer`-wrapped in the
   * template so its chunk (Dialog + ToggleSwitch + Message) only loads
   * on first open. Once loaded it stays mounted; subsequent opens flip
   * the signal and the modal's effect re-fetches the plugin list.
   */
  protected readonly settingsOpen = signal(false);

  /**
   * Section the Settings modal lands on when it next opens. `null` keeps
   * the modal's own default; the drift banner sets it to `project` so
   * "Switch lens" deep-links to the active-lens dropdown. Reset on close
   * so a plain gear-click opens on the default section again.
   */
  protected readonly settingsInitialSection = signal<TSettingsSection | null>(null);

  protected openSettings(): void {
    this.settingsOpen.set(true);
    this.usageTracker.trackFeature('settings');
  }

  /**
   * Quick Start modal visibility. Like Settings, the modal is
   * `@defer`-wrapped in the template so its chunk (Dialog + Message +
   * ConfirmDialog + rows) only loads on first open; subsequent opens flip
   * the signal and the modal's effects re-probe every row.
   */
  protected readonly quickStartOpen = signal(false);

  protected openQuickStart(): void {
    this.quickStartOpen.set(true);
    this.usageTracker.trackFeature('quick-start');
  }

  protected onQuickStartVisibleChange(open: boolean): void {
    this.quickStartOpen.set(open);
  }

  /**
   * Per-incident crash-report consent (spec/telemetry.md §Per-incident
   * crash-report consent). The dialog is `@defer`-wrapped like the other
   * global modals; the service owns the state, the shell only mirrors it.
   */
  private readonly crashConsent = inject(CrashReportConsentService);
  protected readonly crashReportOpen = this.crashConsent.open;
  protected readonly crashReportPreview = this.crashConsent.preview;

  /**
   * Ignore-confirmation dialog (files rail rows + inspector header):
   * single shell mount driven by the owning service's signals, same
   * shape as the crash-report dialog above.
   */
  private readonly projectIgnore = inject(ProjectIgnoreService);
  protected readonly ignoreConfirmOpen = this.projectIgnore.dialogOpen;
  protected readonly ignoreConfirmTarget = this.projectIgnore.dialogTarget;

  protected onIgnoreConfirmDecision(decision: IIgnoreConfirmDecision): void {
    this.projectIgnore.resolveDecision(decision);
  }

  protected onCrashReportDecision(send: boolean): void {
    void this.crashConsent.resolve(send);
  }

  /**
   * Marks the topbar Quick Start button while the tutorial reminder's
   * step-0 message (the one that names Quick Start) is showing, so the
   * nudge and the button it points at read as one thing. Driven by the
   * banner's `quickStartMentioned` output.
   */
  protected readonly quickStartHighlighted = signal(false);

  protected onQuickStartMentioned(mentioned: boolean): void {
    this.quickStartHighlighted.set(mentioned);
  }

  /**
   * "Switch lens" from the provider-marker drift banner: open Settings on
   * the Project section, where the existing active-lens dropdown lives.
   * Reuses the same lens-switch flow (the dropdown), no lens logic here.
   * On Settings close, `onSettingsVisibleChange` re-probes the active
   * provider, so a switch clears the drift notice automatically.
   */
  protected onSwitchLens(): void {
    this.settingsInitialSection.set('project');
    this.openSettings();
  }

  /**
   * Settings modal visibility handler. On close, re-probe the active
   * provider lens so the topbar chip (and the provider-marker drift
   * notice) reflect a lens switch made in the Project section without
   * needing a full page reload, and reset the deep-link section.
   */
  protected onSettingsVisibleChange(open: boolean): void {
    this.settingsOpen.set(open);
    if (!open) {
      this.settingsInitialSection.set(null);
      void this.projectInfo.reloadActiveProvider();
      // Re-probe the hook-install gate: the Project section is where
      // installs / lens switches happen, so the topbar Real Time toggle
      // must reflect them the moment the modal closes.
      void this.activityReadiness.refresh();
      // Same for the processing-agent gate: the "Agent process skill"
      // install lives in that very section, so every submit affordance
      // must unlock as soon as the modal closes, not on the next scan.
      void this.processingAgentReadiness.refresh();
      // And tick the shared close stream so deep consumers (the
      // inspector's AI actions launcher catalog) re-fetch what Settings
      // may have changed: plugin extension toggles, the skill-actions
      // offering toggle.
      this.settingsVisibility.notifyClosed();
    }
  }

  /**
   * Topbar Real Time toggle state. `enabled` is the SAME preference
   * signal the Settings switch binds (NodeActivityService re-exposes
   * it), so the two surfaces mirror for free. The gates replicate the
   * Settings switch's disable conditions: no live socket wanted, or
   * the active lens's hook is known-missing (`null` = unknown fails
   * OPEN, a probe hiccup never locks a local rendering preference).
   */
  protected readonly liveActivityOn = this.nodeActivity.enabled;
  protected readonly liveActivityBlocked = computed(
    () => !this.wsEvents.enabled() || this.activityReadiness.hookInstalled() === false,
  );
  /**
   * ON: plain accent icon (primary severity, text button). OFF: gray
   * icon with a diagonal "prohibited" slash drawn over it by CSS on
   * the wrapper (mic-off pattern). A filled ON button was tried first
   * and read as too visually invasive; severity alone was too subtle.
   */
  protected readonly liveActivityActive = computed(
    () => this.liveActivityOn() && !this.liveActivityBlocked(),
  );
  protected readonly liveActivitySeverity = computed(() =>
    this.liveActivityActive() ? 'primary' : 'secondary',
  );
  protected readonly liveActivityTooltip = computed(() => {
    if (!this.wsEvents.enabled()) return APP_TEXTS.liveActivity.tooltipNoWs;
    if (this.activityReadiness.hookInstalled() === false) {
      return APP_TEXTS.liveActivity.tooltipNoHook;
    }
    return this.liveActivityOn()
      ? APP_TEXTS.liveActivity.tooltipOn
      : APP_TEXTS.liveActivity.tooltipOff;
  });
  protected readonly liveActivityAria = computed(() =>
    this.liveActivityOn() ? APP_TEXTS.liveActivity.ariaOn : APP_TEXTS.liveActivity.ariaOff,
  );

  protected toggleLiveActivity(): void {
    if (this.liveActivityBlocked()) return;
    const next = !this.liveActivityOn();
    this.usageTracker.trackFeature('live-toggle', next);
    this.nodeActivity.setEnabled(next);
  }

  /**
   * In-flight flag for the topbar refresh button (spinner + disabled
   * state). True for a MANUAL scan (the refresh button or a settings-modal
   * apply, owned by `ScanTriggerService` so concurrent triggers reject
   * against one source of truth) OR while a SERVER-side scan runs, surfaced
   * over `/ws` as `scan.started` → `scan.completed`. The latter is what
   * makes a watcher re-scan after a file save spin the same arrows a manual
   * refresh does, so the user gets feedback that the map is updating.
   */
  protected readonly scanning = computed(
    () => this.scanTrigger.scanning() || this.wsEvents.scanActive(),
  );
  /**
   * Last manual-scan failure, `null` after a successful run (cleared on
   * the next `run()` start by `ScanTriggerService`). Rendered on the
   * refresh button itself: error tint + tooltip / aria-label carrying
   * the message, so a failed refresh is never silent (the spinner used
   * to stop with nothing but a console warning).
   */
  protected readonly scanError = this.scanTrigger.scanError;

  protected triggerScan(): Promise<void> {
    this.usageTracker.trackFeature('scan');
    return this.scanTrigger.run();
  }
  /**
   * Briefly `true` after the chip is clicked and the install command
   * has been written to the clipboard. Drives the in-chip label + icon
   * swap (and the tooltip swap as a secondary signal) so the user gets
   * unambiguous feedback. Reverts ~2s later.
   */
  protected readonly updateChipCopied = signal(false);
  /**
   * `true` after a clipboard write was blocked (insecure context or
   * denied permission). Swaps the tooltip / aria-label to carry the
   * literal install command so the click stays recoverable by hand;
   * cleared by the next successful copy.
   */
  protected readonly updateChipCopyFailed = signal(false);
  /** Handle of the pending "Copied!" revert, cleared before re-arming so
   *  a second click inside the 2s window restarts the full window. */
  private updateChipResetTimer: ReturnType<typeof setTimeout> | null = null;
  protected readonly updateChipText = computed(() =>
    this.updateChipCopied() ? UPDATE_CHECK_TEXTS.copiedLabel : UPDATE_CHECK_TEXTS.available,
  );
  protected readonly updateChipIcon = computed(() =>
    this.updateChipCopied() ? 'pi pi-check' : 'pi pi-download',
  );
  protected readonly updateChipTooltip = computed(() => {
    if (this.updateChipCopied()) return UPDATE_CHECK_TEXTS.copiedTooltip;
    if (this.updateChipCopyFailed()) return UPDATE_CHECK_TEXTS.copyFailedTooltip;
    return UPDATE_CHECK_TEXTS.tooltip(this.updateCheck.latest() ?? '');
  });
  protected readonly updateChipA11y = computed(() =>
    this.updateChipCopyFailed()
      ? UPDATE_CHECK_TEXTS.copyFailedA11y
      : UPDATE_CHECK_TEXTS.a11yLabel(this.updateCheck.latest() ?? ''),
  );
  protected readonly npmLinkUrl = UPDATE_CHECK_TEXTS.npmLinkUrl;
  protected readonly npmLinkTooltip = UPDATE_CHECK_TEXTS.npmLinkTooltip;
  protected readonly npmLinkA11y = UPDATE_CHECK_TEXTS.npmLinkA11y;

  /**
   * Writes the npm install command (`npm i -g @skill-map/cli@latest`) to
   * the clipboard and toggles the chip into its "Copied!" tooltip state
   * for a couple of seconds. The revert timer is cleared before
   * re-arming so a second click restarts the full 2s window instead of
   * inheriting the first click's deadline. When the Clipboard API is
   * blocked (insecure context or denied permission) the failure is NOT
   * silent: the tooltip / aria-label swap to the literal command and
   * the live region announces it, so the click stays recoverable.
   */
  protected async copyUpdateCommand(): Promise<void> {
    try {
      await navigator.clipboard.writeText(UPDATE_CHECK_TEXTS.copyCommand);
      this.updateChipCopyFailed.set(false);
      this.updateChipCopied.set(true);
      if (this.updateChipResetTimer !== null) clearTimeout(this.updateChipResetTimer);
      this.updateChipResetTimer = setTimeout(() => this.updateChipCopied.set(false), 2000);
    } catch {
      this.updateChipCopyFailed.set(true);
      this.announcer.announce(UPDATE_CHECK_TEXTS.copyFailedA11y);
    }
  }
  protected readonly versionLabel = computed(() =>
    UPDATE_CHECK_TEXTS.versionLabel(this.updateCheck.current() ?? ''),
  );
  protected readonly versionTooltip = computed(() =>
    UPDATE_CHECK_TEXTS.versionTooltip(this.updateCheck.current() ?? ''),
  );
  protected readonly versionA11y = computed(() =>
    UPDATE_CHECK_TEXTS.versionA11yLabel(this.updateCheck.current() ?? ''),
  );
  /**
   * `true` when the BFF reported `/api/health.dev = true` (local
   * checkout, not an installed package). Drives the yellow `dev` chip
   * the template renders next to the version. Stays `false` until
   * health resolves so the chip never flickers in.
   */
  protected readonly isDevBuild = this.projectInfo.dev;

  /**
   * Active-lens chip for the topbar. Mirrors the card provider badge's
   * colors (`ProviderRegistryService` is the single source) so the lens
   * the user is viewing through reads identically up top and inside the
   * cards. `null` (chip hidden) when no lens is active.
   */
  protected readonly lensChip = computed<IProviderUi | null>(() =>
    this.providerRegistry.lensChip(this.projectInfo.activeProvider()),
  );
  protected readonly count = this.loader.count;
  /**
   * Link reconciliation between `scan.links.length` (raw extractor
   * output, same number the CLI prints) and the edges actually drawn
   * on the graph canvas. The two diverge when a link points at a
   * non-existent target, is a self-loop, or duplicates another link.
   * The topbar tooltip shows the breakdown so the operator does not
   * see "19 links" in the CLI and "13 edges" on the canvas as a bug.
   */
  protected readonly linkAnalysis = computed(() =>
    analyzeLinks(this.loader.nodes(), this.loader.scan()),
  );
  protected readonly linkCount = computed(() => this.linkAnalysis().raw);
  protected readonly mapInfoTooltip = computed(() =>
    APP_TEXTS.badge.mapInfo(this.count(), this.linkAnalysis()),
  );
  protected readonly mapInfoA11y = computed(() =>
    APP_TEXTS.badge.mapInfoA11y(this.count(), this.linkAnalysis()),
  );
  /**
   * Refresh-button surface strings: the map stats normally, the last
   * scan failure while `scanError` is set. One computed pair so the
   * tooltip and the aria-label can never disagree about which state
   * the button is in.
   */
  protected readonly refreshTooltip = computed(() => {
    const error = this.scanError();
    return error !== null ? APP_TEXTS.scanError.tooltip(error) : this.mapInfoTooltip();
  });
  protected readonly refreshA11y = computed(() => {
    const error = this.scanError();
    return error !== null ? APP_TEXTS.scanError.a11y(error) : this.mapInfoA11y();
  });
  /**
   * Project path surfaced under the brand mark. Prefers `/api/health`'s
   * `cwd` (the absolute project root, tilde-anonymised by the BFF) so
   * the user sees the real folder they're scanning. Falls back to the
   * first scan root for the demo path where `health.cwd` may be unset
   * or generic. Empty string suppresses the line entirely.
   */
  protected readonly rootLabel = computed(() => {
    const cwd = this.projectInfo.cwd();
    if (cwd && cwd !== '.') return cwd;
    const roots = this.loader.scan()?.roots ?? [];
    if (roots.length === 0) return '';
    const trimmed = roots[0].replace(/[\\/]+$/, '');
    if (!trimmed || trimmed === '.') return '';
    return trimmed;
  });
  protected readonly isDevMode = isDevMode();
  protected readonly themeTexts = THEME_TEXTS;
  protected readonly themeMode = this.theme.mode;
  protected readonly markSrc = this.theme.markSrc;
  protected readonly extraTheme = this.theme.extraTheme;
  /** The registry's extra themes, rendered after the tri-state in the menu. */
  protected readonly extraThemes = EXTRA_THEMES;
  private readonly themeMenu = viewChild<Popover>('themeMenu');

  /**
   * Topbar trigger glyph: the base mode's icon, or the palette while
   * an extra theme is on (the extras sit on top of the tri-state, so
   * the mode icon alone would misreport what the eye sees).
   */
  protected readonly themeIcon = computed(() => {
    if (this.extraTheme() !== null) return 'pi pi-palette';
    switch (this.themeMode()) {
      case 'auto':
        return 'pi pi-desktop';
      case 'light':
        return 'pi pi-sun';
      case 'dark':
        return 'fa-regular fa-moon';
    }
  });

  /** What the trigger names: the extra theme's label, else the mode. */
  protected readonly themeCurrentLabel = computed(() => {
    const extra = findExtraTheme(this.extraTheme());
    if (extra !== null) return extra.label;
    switch (this.themeMode()) {
      case 'auto':
        return THEME_TEXTS.currentAuto;
      case 'light':
        return THEME_TEXTS.currentLight;
      case 'dark':
        return THEME_TEXTS.currentDark;
    }
  });
  protected readonly themeTrigger = computed(() => THEME_TEXTS.trigger(this.themeCurrentLabel()));

  /**
   * The topbar theme button opens a menu (user call 2026-08-29): the
   * tri-state base (auto / light / dark, the three the toggle used to
   * cycle) plus every extra theme from the registry, so the specialty
   * looks stop being a Settings-only affordance. Popover appended to
   * <body> like the map-view switcher's.
   */
  protected openThemeMenu(event: Event): void {
    this.themeMenu()?.toggle(event);
  }

  protected isModeActive(mode: TThemeMode): boolean {
    return this.extraTheme() === null && this.themeMode() === mode;
  }

  /** Base mode row: clears any extra theme and sets the tri-state. */
  protected pickThemeMode(mode: TThemeMode): void {
    this.themeMenu()?.hide();
    this.theme.setExtraTheme(null);
    this.theme.set(mode);
    // `value` is the mode the gesture SET (`auto` / `light` / `dark`).
    this.usageTracker.trackFeature('theme-toggle', mode);
  }

  /** Extra-theme row: the registry id, stamped `topbar` (Settings stamps `settings`). */
  protected pickExtraTheme(id: string): void {
    this.themeMenu()?.hide();
    this.theme.setExtraTheme(id);
    this.usageTracker.trackFeature('theme-extra', id, 'topbar');
  }
}
