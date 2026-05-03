import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { PrimeNG, providePrimeNG } from 'primeng/config';

import { routes } from './app.routes';
import { dataSourceFactory } from '../services/data-source/data-source.factory';
import { DATA_SOURCE } from '../services/data-source/data-source.port';
import { SKILL_MAP_MODE, readSkillMapModeFromMeta } from '../services/data-source/runtime-mode';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch()),
    // PrimeNG is provided WITHOUT the Aura preset so the theme tokens
    // (~54 KB) are not pulled into the eager initial chunk. The
    // initializer below dynamic-imports Aura and feeds it through
    // PrimeNG.setThemeConfig() before first render — Angular awaits the
    // returned promise during bootstrap, so there is no flash of
    // unstyled content. See ROADMAP §Step 14.7 bundle hard cut.
    providePrimeNG({}),
    provideAppInitializer(async () => {
      // `inject()` MUST be called synchronously inside the injector
      // context provideAppInitializer establishes for the factory.
      // Capturing the PrimeNG handle BEFORE the dynamic import is
      // mandatory — after the first `await`, Angular has flushed the
      // microtask and we are no longer in an injection context, so a
      // post-await `inject()` throws NG0203 and the app never boots.
      const primeng = inject(PrimeNG);
      const { default: Aura } = await import('@primeuix/themes/aura');
      primeng.setThemeConfig({
        theme: {
          preset: Aura,
          options: {
            darkModeSelector: '.app-dark',
          },
        },
      });
    }),
    // Runtime-mode token: read once from <meta name="skill-map-mode">
    // (defaults to 'live'). The data-source factory branches on it.
    { provide: SKILL_MAP_MODE, useFactory: readSkillMapModeFromMeta },
    { provide: DATA_SOURCE, useFactory: dataSourceFactory },
  ],
};
