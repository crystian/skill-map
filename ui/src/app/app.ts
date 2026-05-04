import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

import { APP_TEXTS } from '../i18n/app.texts';
import { THEME_TEXTS } from '../i18n/theme.texts';
import { CollectionLoaderService } from '../services/collection-loader';
import { FilterUrlSyncService } from '../services/filter-url-sync';
import { ThemeService } from '../services/theme';
import { DemoBanner } from './components/demo-banner/demo-banner';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ButtonModule, TooltipModule, DemoBanner],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit {
  private readonly loader = inject(CollectionLoaderService);
  private readonly theme = inject(ThemeService);
  // Boot the URL ↔ filter sync (constructor-driven; the inject() call
  // is sufficient — the service self-wires its router subscription
  // and signal effects on construction).
  private readonly _filterUrlSync = inject(FilterUrlSyncService);

  protected readonly texts = APP_TEXTS;
  readonly count = this.loader.count;
  readonly themeMode = this.theme.mode;
  readonly themeIcon = computed(() => {
    switch (this.themeMode()) {
      case 'auto':
        return 'pi pi-desktop';
      case 'light':
        return 'pi pi-sun';
      case 'dark':
        return 'pi pi-moon';
    }
  });
  readonly themeLabel = computed(() => {
    switch (this.themeMode()) {
      case 'auto':
        return THEME_TEXTS.toggleToLight;
      case 'light':
        return THEME_TEXTS.toggleToDark;
      case 'dark':
        return THEME_TEXTS.toggleToAuto;
    }
  });
  readonly themeTooltip = computed(() => {
    switch (this.themeMode()) {
      case 'auto':
        return THEME_TEXTS.currentAuto;
      case 'light':
        return THEME_TEXTS.currentLight;
      case 'dark':
        return THEME_TEXTS.currentDark;
    }
  });

  ngOnInit(): void {
    void this.loader.load();
  }

  toggleTheme(): void {
    this.theme.toggle();
  }
}
