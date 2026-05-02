import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ButtonModule } from 'primeng/button';

import { APP_TEXTS } from '../i18n/app.texts';
import { THEME_TEXTS } from '../i18n/theme.texts';
import { CollectionLoaderService } from '../services/collection-loader';
import { FilterUrlSyncService } from '../services/filter-url-sync';
import { ThemeService } from '../services/theme';
import { DemoBanner } from './components/demo-banner/demo-banner';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ButtonModule, DemoBanner],
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
  readonly themeIcon = computed(() =>
    this.themeMode() === 'dark' ? 'pi pi-sun' : 'pi pi-moon',
  );
  readonly themeLabel = computed(() =>
    this.themeMode() === 'dark' ? THEME_TEXTS.toggleToLight : THEME_TEXTS.toggleToDark,
  );

  ngOnInit(): void {
    void this.loader.load();
  }

  toggleTheme(): void {
    this.theme.toggle();
  }
}
