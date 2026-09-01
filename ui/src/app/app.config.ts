import {
  ApplicationConfig,
  ErrorHandler,
  Injector,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { TitleStrategy, provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { PrimeNG, providePrimeNG } from 'primeng/config';

import { routes } from './app.routes';
import { dataSourceFactory } from '../services/data-source/data-source.factory';
import { DATA_SOURCE } from '../services/data-source/data-source.port';
import { SKILL_MAP_MODE, readSkillMapModeFromMeta } from '../services/data-source/runtime-mode';
import { SKILL_MAP_EMBED, readEmbedConfigFromLocation } from '../services/embed-mode';
import { CollectionLoaderService } from '../services/collection-loader';
import { LivePreferencesService } from '../services/live-preferences';
import { DebugSlotsService } from './services/debug-slots';
import { ActivityRecorderService } from '../services/activity-recorder';
import { FilterUrlSyncService } from './services/filter-url-sync';
import { MapViewUrlSyncService } from './services/map-view-url-sync';
import { ProjectInfoService } from './services/project-info';
import { SmTitleStrategy } from './services/title-strategy';
import { UpdateCheckService } from './services/update-check';
import { initUiSentry } from './core/telemetry/sentry-init';
import { captureUiUsage, initUiUsage, registerUsageSuperProps } from './core/telemetry/posthog-init';
import { buildAppStartEventProperties } from './core/telemetry/usage-collector';
import { CrashReportConsentService } from './core/telemetry/crash-report-consent';
import { SentryUiErrorHandler } from './core/telemetry/sentry-error-handler';
import { UsageTrackerService } from './services/usage-tracker';

/**
 * Fire-and-forget kickoff for cold-start data probes. Each loader is
 * responsible for its own error handling; failures are silent so the
 * shell still renders. Centralised here so the `provideAppInitializer`
 * factory stays a one-liner and the boot contract ("these services
 * load on app start") lives in one place.
 */
interface IColdStartLoadable {
  load(): Promise<unknown> | unknown;
}

function kickoffColdStart(...services: readonly IColdStartLoadable[]): void {
  for (const s of services) {
    void Promise.resolve(s.load());
  }
}

/**
 * Boot sequence for the live channel + cold-start probes, deliberately ONE
 * awaited initializer. Sibling app-initializers do NOT await each other
 * (Angular invokes every factory synchronously in registration order and
 * only `Promise.all`s the returned promises), so the live-updates
 * preference MUST settle HERE, before the first service that subscribes to
 * the `/ws` stream is constructed. `CollectionLoaderService` opens the
 * socket on that first subscription (in its constructor) unless
 * `ui.liveUpdates` is already known to be false. When this lived in two
 * separate initializers, the cold-start factory ran synchronously while the
 * awaited `load()` GET was still in flight, so the socket flash-opened on
 * the ON default and a persisted OFF never closed it: the toggle read OFF
 * while the map kept live-updating on watcher scans. Awaiting `load()`
 * before constructing the loader is the fix. Exported so the ordering
 * contract is unit-testable without booting the whole shell.
 */
export async function settleLivePrefsThenColdStart(injector: Injector): Promise<void> {
  await injector.get(LivePreferencesService).load();
  kickoffColdStart(
    injector.get(CollectionLoaderService),
    injector.get(UpdateCheckService),
    injector.get(ProjectInfoService),
  );
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Angular ErrorHandler that funnels uncaught errors to the UI Sentry
    // client (`spec/telemetry.md`, surface `skill-map-ui`). It is wired
    // UNCONDITIONALLY because it is inert until telemetry activates: the
    // wrapper logs to the console (Angular's default behaviour) and only
    // forwards to Sentry once `initUiSentry` has loaded the SDK, which is
    // a no-op while the feature is dormant (the UI DSN placeholder is
    // empty AND consent defaults OFF, so nothing is captured or sent
    // today). It is a thin wrapper (not `Sentry.createErrorHandler()`) on
    // purpose: that keeps the `@sentry/angular` SDK out of the eager
    // bundle (dynamic-imported only on the active path in
    // `sentry-init.ts`). Capture starts working the moment a real DSN
    // lands and the operator opts in, with no provider changes.
    // Under per-incident consent the wrapper never captures directly: it
    // hands the error to CrashReportConsentService (dedupe + consent
    // dialog + capture-on-accept), see the handler's doc block.
    { provide: ErrorHandler, useClass: SentryUiErrorHandler },
    provideRouter(routes, withComponentInputBinding()),
    { provide: TitleStrategy, useClass: SmTitleStrategy },
    provideHttpClient(withFetch()),
    // PrimeNG is provided WITHOUT the Aura preset so the theme tokens
    // (~54 KB) are not pulled into the eager initial chunk. The
    // initializer below dynamic-imports Aura and feeds it through
    // PrimeNG.setThemeConfig() before first render: Angular awaits the
    // returned promise during bootstrap, so there is no flash of
    // unstyled content. See ROADMAP §Step 14.7 bundle hard cut.
    //
    // WCAG 1.4.13 (hoverable tooltips, a11y audit finding M7) CANNOT be
    // fixed from here, verified against the pinned primeng@21.1.9 rather
    // than assumed. `Tooltip.autoHide` defaults to `true`, which hides the
    // tooltip the moment the pointer moves onto it, exactly what 1.4.13
    // forbids for content a magnifier user has to pan across. There is no
    // global default for it: `PrimeNG.setConfig` reads only
    // `csp / ripple / inputStyle / inputVariant / theme / overlayOptions /
    // translation / filterMatchModeOptions / overlayAppendTo / zIndex /
    // ptOptions / pt / unstyled`; the Tooltip directive consults the config
    // for just `overlayAppendTo` and `zIndex.tooltip`; and `pt` carries DOM
    // attributes and classes, not directive inputs. The remaining fixes are
    // `[autoHide]="false"` on each of the ~100 `[pTooltip]` bindings or a
    // host directive that supplies the default, both of which reach far
    // outside this file. Left open deliberately; dismissal (`hideOnEscape`)
    // and persistence already conform.
    providePrimeNG({}),
    provideAppInitializer(async () => {
      // `inject()` MUST be called synchronously inside the injector
      // context provideAppInitializer establishes for the factory.
      // Capturing the PrimeNG handle BEFORE the dynamic import is
      // mandatory: after the first `await`, Angular has flushed the
      // microtask and we are no longer in an injection context, so a
      // post-await `inject()` throws NG0203 and the app never boots.
      const primeng = inject(PrimeNG);
      const [{ default: Aura }, { definePreset }] = await Promise.all([
        import('@primeuix/themes/aura'),
        import('@primeuix/themes'),
      ]);
      // Aura ships with an emerald primary palette. The skill-map shell
      // uses violet across topbar, public site, and ROADMAP visuals, so
      // we re-key Aura's `primary.*` stops to the `--sm-violet-*` ramp
      // in `ui/src/styles.css`. Anything PrimeNG-driven (highlights,
      // focus rings, demo banner, p-button severity=primary) inherits
      // violet without per-component overrides.
      const SkillMapPreset = definePreset(Aura, {
        semantic: {
          primary: {
            50: '#F5F3FF',
            100: '#EDE9FE',
            200: '#DDD6FE',
            300: '#C4B5FD',
            400: '#A78BFA',
            500: '#8B5CF6',
            600: '#7C3AED',
            700: '#6D28D9',
            800: '#4C1D95',
            900: '#2E1065',
            950: '#1E0A4D',
          },
        },
      });
      primeng.setThemeConfig({
        theme: {
          preset: SkillMapPreset,
          options: {
            darkModeSelector: '.app-dark',
          },
        },
      });
    }),
    // Runtime-mode token: read once from <meta name="skill-map-mode">
    // (defaults to 'live'). The data-source factory branches on it.
    { provide: SKILL_MAP_MODE, useFactory: readSkillMapModeFromMeta },
    // Embed flag (`?embed=1`): canvas-only rendering for a framed boot,
    // read once from the location the same way (see embed-mode.ts).
    { provide: SKILL_MAP_EMBED, useFactory: readEmbedConfigFromLocation },
    { provide: DATA_SOURCE, useFactory: dataSourceFactory },
    // Telemetry arm-up (`spec/telemetry.md`, surface `skill-map-ui`).
    // Runs as an app initializer so it resolves BEFORE the shell renders,
    // arming error capture ahead of the cold-start data probes below. It
    // fetches the per-machine consent flag (`/api/preferences` →
    // `telemetry.errorsEnabled`) and the running impl version
    // (`/api/health` → `implVersion`, the base of the `skill-map-cli@<version>`
    // Sentry release tag), then calls `initUiSentry`. A real DSN ships in
    // `public-config.ts`, so consent is the live gate: the init is a hard
    // no-op while consent is OFF (the default), and the per-crash dialog
    // gates every send after it. The whole fetch is wrapped so ANY
    // failure leaves telemetry OFF and the app boots normally: a broken
    // /api call must never block the shell.
    provideAppInitializer(async () => {
      const dataSource = inject(DATA_SOURCE);
      // Synchronous inject (before any await) per the NG0203 rule. Constructs
      // the tracker (theme super-property wiring, see its BOOT CONTRACT) and
      // lets us re-register the initial theme once the SDK activates below.
      const usageTracker = inject(UsageTrackerService);
      const crashConsent = inject(CrashReportConsentService);
      try {
        const [preferences, health, lens] = await Promise.all([
          dataSource.getPreferences(),
          dataSource.health(),
          // Best-effort lens probe for the `ui.app.start` property; its
          // own catch so a failure never blocks the consent bootstrap.
          dataSource.getActiveProvider().catch(() => null),
        ]);
        // Per-incident crash-report consent: the service needs the
        // release / environment / project-root facts for a late
        // (accept-time) SDK arm. A fetch failure leaves the defaults
        // (no release, prod, home-only scrubbing).
        crashConsent.configure({
          release: health.implVersion ? `skill-map-cli@${health.implVersion}` : null,
          environment: preferences.telemetry.environment,
          projectRoot: health.cwd ?? null,
        });
        await Promise.all([
          initUiSentry({
            consentEnabled: preferences.telemetry.errorsEnabled,
            release: health.implVersion ? `skill-map-cli@${health.implVersion}` : null,
            environment: preferences.telemetry.environment,
            projectRoot: health.cwd ?? null,
          }),
          // Usage analytics (PostHog) shares the same consent probe. The CLI
          // and UI reuse one anonymous id (`telemetry.anonymousId`) so they
          // are attributed to one install. Hard no-op while the UI key
          // placeholder is empty AND while UI usage consent is OFF.
          initUiUsage({
            consentEnabled: preferences.telemetry.usageUiEnabled,
            distinctId: preferences.telemetry.anonymousId,
          }),
        ]);
        // The SDK is now active (or not); register the session super-props so
        // every event carries them from the first capture: the environment
        // (dev / production, from the BFF) and the boot theme.
        registerUsageSuperProps({ environment: preferences.telemetry.environment });
        usageTracker.syncTheme();
        // Session-presence signal (`spec/telemetry.md` §Usage event
        // taxonomy): one `ui.app.start` per boot, no-op while dormant,
        // carrying the active lens (third-party provider ids collapse
        // inside the builder). There is deliberately no per-view /
        // per-route event.
        captureUiUsage(
          'ui.app.start',
          buildAppStartEventProperties(lens !== null ? lens.activeProvider : null),
        );
      } catch {
        // Consent / version probe is best-effort. A failure means
        // telemetry stays OFF; the app must still boot.
      }
    }),
    // Live-channel preference (`ui.liveUpdates`, project-local
    // `settings.local.json`) THEN the cold-start data probes, in one awaited
    // initializer. The order is load-critical: the socket owner decides at
    // first `/ws` subscription whether to open the live channel, and the
    // loader (the first subscriber) is constructed inside the cold-start
    // kickoff, so a persisted OFF must be resolved BEFORE it. Splitting this
    // into two sibling initializers let the socket flash-open on the ON
    // default while the preference GET was still in flight. See
    // `settleLivePrefsThenColdStart` for the full rationale. A failed GET
    // keeps the ON defaults.
    provideAppInitializer(() => settleLivePrefsThenColdStart(inject(Injector))),
    // Boot-time service wiring: each listed service exposes a "self-wire
    // on construct" contract (router subscriptions, signal effects, root
    // class toggles); see the BOOT CONTRACT note on each service. The
    // bare `inject()` is intentional: we only need the constructor to
    // run before the first route activation. Adding a service here means
    // keeping the same contract (no lazy `init()`); removing one means
    // accepting that its side effects fire on first consumer injection
    // instead of at boot.
    provideAppInitializer(() => {
      inject(FilterUrlSyncService);
      inject(MapViewUrlSyncService);
      inject(DebugSlotsService);
      // The replay tape must start recording with the page: `events$`
      // never replays to late subscribers, so a lazily-injected
      // recorder would silently miss everything before the first
      // Live-lens replay. Same self-wire-on-construct contract as the
      // services above.
      inject(ActivityRecorderService);
      // UsageTrackerService is deliberately NOT injected here: the
      // telemetry initializer above already constructs it at boot, and
      // there is no per-view / per-route usage event to wire (see the
      // tracker's class doc).
    }),
  ],
};
