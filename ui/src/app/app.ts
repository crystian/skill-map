import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ButtonModule } from 'primeng/button';

import { APP_TEXTS } from '../i18n/app.texts';
import { THEME_TEXTS } from '../i18n/theme.texts';
import { CollectionLoaderService } from '../services/collection-loader';
import { ScanSimulatorService } from '../services/scan-simulator';
import { ThemeService } from '../services/theme';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ButtonModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit {
  private readonly loader = inject(CollectionLoaderService);
  private readonly simulator = inject(ScanSimulatorService);
  private readonly theme = inject(ThemeService);

  protected readonly texts = APP_TEXTS;
  readonly count = this.loader.count;
  readonly scanRunning = this.simulator.running;
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

  simulateScan(): void {
    void this.simulator.runScan();
  }

  toggleTheme(): void {
    this.theme.toggle();
  }
}
