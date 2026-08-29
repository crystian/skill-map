/**
 * `<sm-settings-general>`, General section of the Settings modal.
 *
 * Today renders a single toggle (`updateCheck.enabled`); the
 * component is built around a declarative `GENERAL_TOGGLES` array so
 * a future per-machine preference (locale, theme, …) is one entry
 * plus one i18n string rather than a template / component edit.
 *
 * Lifecycle: fetch on `(visible) === true` via the data-source port,
 * reflect the value into a per-key signal, dispatch `setPreferences`
 * on change with the patched sub-key. Errors bubble through
 * dedicated load / save signals so the toast region is one
 * `<p-message>` tag rather than a manual error map.
 *
 * Mirrors the lifecycle pattern in `settings-plugins.ts` so the two
 * sections share the same shape from the chassis's point of view.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { TooltipModule } from 'primeng/tooltip';

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import type { IConfigResolutionRowApi, IPreferencesApi, IPreferencesPatchApi } from '../../../models/api';
import {
  DATA_SOURCE,
  DataSourceError,
} from '../../../services/data-source/data-source.port';
import { ThemeService, type TExtraTheme } from '../../../services/theme';
import { GithubStarsService } from '../../services/github-stars';
import { UsageTrackerService } from '../../services/usage-tracker';
import { EXTRA_THEMES } from '../../../themes/registry';
import { ToggleRowDirective } from './toggle-row.directive';

/**
 * Declarative catalogue of toggles rendered in the General section.
 * Each entry binds:
 *   - the dot-path the BFF / settings.json knows the key by;
 *   - i18n label + description (resolved against `SETTINGS_TEXTS.general.toggles`);
 *   - getter / setter that read / project the corresponding value
 *     into the wire-shape `IPreferencesApi` and patch back via
 *     `IPreferencesPatchApi`.
 *
 * Adding a new toggle is one entry here plus one nested key in
 * `SETTINGS_TEXTS.general.toggles`. The template iterates this list
 * with `@for`, so no template change is needed.
 */
interface IGeneralToggleDef {
  /** Stable dot-path; doubles as the i18n catalog key. */
  key: 'updateCheck.enabled' | 'githubStars.enabled' | 'telemetry';
  /** Read the current value from a fetched envelope. */
  read(envelope: IPreferencesApi): boolean;
  /** Build the patch body for the new value. */
  patch(value: boolean): IPreferencesPatchApi;
}

/**
 * Toggles rendered ABOVE the theme selector: the two that govern what
 * the CLI and the app do on their own (probe npm, report telemetry).
 */
const TOGGLES_BEFORE_THEME: ReadonlyArray<IGeneralToggleDef> = [
  {
    key: 'updateCheck.enabled',
    read: (envelope) => envelope.updateCheck.enabled,
    patch: (value) => ({ updateCheck: { enabled: value } }),
  },
  {
    // One consolidated telemetry switch. The settings.json keeps three
    // independent fields (`errorsEnabled` / `usageCliEnabled` /
    // `usageUiEnabled`) for power users who edit the file by hand, but the UI
    // is all-or-nothing: ON only when all three are on, and applying it stamps
    // the same value onto all three (overwriting any hand-edited mix).
    key: 'telemetry',
    read: (e) =>
      e.telemetry.errorsEnabled && e.telemetry.usageCliEnabled && e.telemetry.usageUiEnabled,
    patch: (value) => ({
      telemetry: { errorsEnabled: value, usageCliEnabled: value, usageUiEnabled: value },
    }),
  },
];

/**
 * Toggles rendered BELOW the theme selector (user call 2026-08-03).
 * The split is deliberate rather than cosmetic: everything above the
 * theme row changes what skill-map DOES (probes npm, sends telemetry),
 * while the star count, like the theme itself, only changes what the
 * operator SEES. Grouping them past that divider keeps the two kinds of
 * preference from reading as one list.
 */
const TOGGLES_AFTER_THEME: ReadonlyArray<IGeneralToggleDef> = [
  {
    key: 'githubStars.enabled',
    read: (envelope) => envelope.githubStars.enabled,
    patch: (value) => ({ githubStars: { enabled: value } }),
  },
];

/**
 * Sentinel id reserved for the "no extra theme" option. Distinct from
 * `null` because PrimeNG's selectbutton does not bind cleanly to
 * `null` option values (the `[allowEmpty]=false` path treats `null`
 * as "deselected" and breaks the ngModel round-trip), so the wire
 * layer uses the literal `'none'` string and the service layer maps
 * it back to `null` at the boundary.
 */
const EXTRA_THEME_NONE = 'none' as const;
type TExtraThemeWire = typeof EXTRA_THEME_NONE | (typeof EXTRA_THEMES)[number]['id'];

interface IExtraThemeOption {
  value: TExtraThemeWire;
  label: string;
  description: string;
}

function toExtraThemeWire(value: TExtraTheme): TExtraThemeWire {
  return value === null ? EXTRA_THEME_NONE : value;
}

function fromExtraThemeWire(value: TExtraThemeWire): TExtraTheme {
  return value === EXTRA_THEME_NONE ? null : value;
}

@Component({
  selector: 'sm-settings-general',
  imports: [ButtonModule, DialogModule, FormsModule, MessageModule, NgTemplateOutlet, SelectButtonModule, SelectModule, ToggleRowDirective, ToggleSwitchModule, TooltipModule],
  templateUrl: './settings-general.html',
  styleUrl: './settings-general.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsGeneral {
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly themeService = inject(ThemeService);
  private readonly usageTracker = inject(UsageTrackerService);
  /** Re-read after its toggle flips, see `runToggle`. */
  private readonly githubStars = inject(GithubStarsService);

  /**
   * Section visibility. The chassis flips it true when the General
   * section becomes active AND the modal itself is visible; we
   * refresh the envelope on every transition to true so a flag
   * toggled via `sm config set -g` from another terminal surfaces
   * on the next view.
   */
  readonly visible = input.required<boolean>();

  protected readonly texts = SETTINGS_TEXTS;
  protected readonly togglesBeforeTheme = TOGGLES_BEFORE_THEME;
  protected readonly togglesAfterTheme = TOGGLES_AFTER_THEME;
  /**
   * Extra-theme select options. The `none` entry comes from the i18n
   * catalog (sentinel, not a theme); the rest map straight from the
   * registry at `themes/registry.ts`, so sumar un theme new = one
   * entry there + one CSS file.
   */
  protected readonly extraThemeOptions: IExtraThemeOption[] = [
    {
      value: EXTRA_THEME_NONE,
      label: SETTINGS_TEXTS.general.extraTheme.options.none.label,
      description: SETTINGS_TEXTS.general.extraTheme.options.none.description,
    },
    ...EXTRA_THEMES.map((theme) => ({
      value: theme.id,
      label: theme.label,
      description: theme.description,
    })),
  ];
  /**
   * Wire-shape projection of the extra theme. Computed so the topbar
   * toggle (which clears `extraTheme` back to `null`) reflects in the
   * selectbutton without a manual refresh.
   */
  protected readonly extraThemeWire = computed<TExtraThemeWire>(() =>
    toExtraThemeWire(this.themeService.extraTheme()),
  );
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saveError = signal<string | null>(null);
  /** Current envelope. `null` until the first fetch resolves. */
  protected readonly preferences = signal<IPreferencesApi | null>(null);
  /** Pending toggle keys, disable the switch so a double-click doesn't
   *  fire two PATCHes. */
  protected readonly pending = signal<Set<string>>(new Set());

  constructor() {
    effect(() => {
      if (this.visible()) void this.refresh();
    });
  }

  /**
   * DOM id of the switch rendered for `key`, shared by the
   * `<p-toggleswitch [inputId]>` and the `<label [attr.for]>` that names
   * it. Derived from the toggle key (the one value guaranteed unique
   * across `GENERAL_TOGGLES`) so adding a toggle cannot silently collide
   * two labels onto the same control. Non-id characters (the dot in
   * `updateCheck.enabled`) are folded to `-` so the value stays usable
   * as a plain CSS / query selector too.
   */
  protected toggleInputId(key: IGeneralToggleDef['key']): string {
    return `settings-general-toggle-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  }

  protected toggleLabel(key: IGeneralToggleDef['key']): string {
    return SETTINGS_TEXTS.general.toggles[key].label;
  }

  protected toggleDescription(key: IGeneralToggleDef['key']): string {
    return SETTINGS_TEXTS.general.toggles[key].description;
  }

  /** Optional per-toggle hint (e.g. "reload to apply"); `null` when absent. */
  protected toggleHint(key: IGeneralToggleDef['key']): string | null {
    const entry = SETTINGS_TEXTS.general.toggles[key];
    return 'hint' in entry ? entry.hint : null;
  }

  /**
   * Read the current value from the envelope (or `false` until the
   * first fetch resolves, the toggle visually starts at "off" and
   * snaps to its real value once the BFF responds; the parent's
   * `loading` signal disables it during that window so the user
   * never sees the wrong state in an interactive way).
   */
  protected valueOf(def: IGeneralToggleDef): boolean {
    const envelope = this.preferences();
    if (!envelope) return false;
    return def.read(envelope);
  }

  protected isPending(key: string): boolean {
    return this.pending().has(key);
  }

  protected onToggle(def: IGeneralToggleDef, nextValue: boolean): void {
    void this.runToggle(def, nextValue);
  }

  /**
   * Extra-theme change handler. The catalog is mandatory
   * (`[allowEmpty]=false`), so a null collapse from PrimeNG falls
   * back to the `none` sentinel rather than crashing the mapping
   * into `TExtraTheme`.
   */
  protected onExtraThemeChange(next: TExtraThemeWire | null): void {
    // Usage analytics (opt-in, default OFF): the selected id comes from
    // the shipped registry (closed set) or the `none` sentinel, safe to
    // send verbatim. See spec/telemetry.md §Usage event taxonomy.
    this.usageTracker.trackFeature('theme-extra', next ?? EXTRA_THEME_NONE);
    this.themeService.setExtraTheme(fromExtraThemeWire(next ?? EXTRA_THEME_NONE));
  }

  /** Fetch (or re-fetch) the envelope. Errors surface in `loadError`. */
  private async refresh(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    this.saveError.set(null);
    try {
      const envelope = await this.dataSource.getPreferences();
      this.preferences.set(envelope);
    } catch (err) {
      this.loadError.set(formatErr(err));
      this.preferences.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  private async runToggle(def: IGeneralToggleDef, nextValue: boolean): Promise<void> {
    if (this.pending().has(def.key)) return;
    const next = new Set(this.pending());
    next.add(def.key);
    this.pending.set(next);
    this.saveError.set(null);
    try {
      const envelope = await this.dataSource.setPreferences(def.patch(nextValue));
      this.preferences.set(envelope);
      // Preferences that OTHER surfaces render have to be re-read there
      // too, otherwise the switch says off while the thing it governs is
      // still on screen until a reload. The star count is the only one
      // today: the shell reads it once at boot, so nothing would notice
      // the flip on its own.
      if (def.key === 'githubStars.enabled') void this.githubStars.refresh();
    } catch (err) {
      this.saveError.set(formatErr(err));
    } finally {
      const after = new Set(this.pending());
      after.delete(def.key);
      this.pending.set(after);
    }
  }

  // --- config resolution (nested dialog, user shape 2026-07-21) -----------

  /**
   * The settings-hierarchy viewer: a dialog OVER the Settings dialog
   * showing the effective config columnized, one row per leaf key with
   * the layer that won. Fetched lazily on first open, then kept (the
   * config only changes through mutating routes; close and reopen
   * re-reads nothing by design, the surface is diagnostic).
   */
  protected readonly resolutionOpen = signal(false);
  protected readonly resolutionRows = signal<IConfigResolutionRowApi[] | null>(null);
  protected readonly resolutionError = signal<string | null>(null);

  protected openResolution(): void {
    this.usageTracker.trackFeature('settings-resolution');
    this.resolutionOpen.set(true);
    if (this.resolutionRows() === null) void this.loadResolution();
  }

  private async loadResolution(): Promise<void> {
    this.resolutionError.set(null);
    try {
      this.resolutionRows.set(await this.dataSource.getConfigResolution());
    } catch (err) {
      this.resolutionError.set(formatErr(err));
    }
  }

  /** Value cell: strings bare, everything else compact JSON. */
  protected resolutionValue(row: IConfigResolutionRowApi): string {
    return typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
  }

  /** Layer chip label; the raw layer id stays on `data-layer` for styling. */
  protected resolutionLayer(row: IConfigResolutionRowApi): string {
    return SETTINGS_TEXTS.settingsResolution.layerLabels[row.layer] ?? row.layer;
  }
}

function formatErr(err: unknown): string {
  if (err instanceof DataSourceError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
