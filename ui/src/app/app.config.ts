import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';

import { routes } from './app.routes';
import { dataSourceFactory } from '../services/data-source/data-source.factory';
import { DATA_SOURCE } from '../services/data-source/data-source.port';
import { SKILL_MAP_MODE, readSkillMapModeFromMeta } from '../services/data-source/runtime-mode';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch()),
    providePrimeNG({
      theme: {
        preset: Aura,
        options: {
          darkModeSelector: '.app-dark',
        },
      },
    }),
    // Runtime-mode token: read once from <meta name="skill-map-mode">
    // (defaults to 'live'). The data-source factory branches on it.
    { provide: SKILL_MAP_MODE, useFactory: readSkillMapModeFromMeta },
    { provide: DATA_SOURCE, useFactory: dataSourceFactory },
  ],
};
