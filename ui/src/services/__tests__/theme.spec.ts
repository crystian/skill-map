import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { ThemeService } from '../theme';

const STORAGE_KEY = 'skill-map.ui.theme';
const EXTRA_STORAGE_KEY = 'skill-map.ui.extra-theme';
const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

interface IFakeMediaQueryList {
  matches: boolean;
  addEventListener: (type: 'change', listener: (event: MediaQueryListEvent) => void) => void;
  removeEventListener: (type: 'change', listener: (event: MediaQueryListEvent) => void) => void;
  fire: (matches: boolean) => void;
}

let originalMatchMedia: ((query: string) => MediaQueryList) | undefined;

function installFakeMatchMedia(initialDark: boolean): IFakeMediaQueryList {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mql: IFakeMediaQueryList = {
    matches: initialDark,
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
    fire: (matches) => {
      mql.matches = matches;
      for (const l of listeners) l({ matches } as MediaQueryListEvent);
    },
  };
  (window as unknown as { matchMedia: (q: string) => unknown }).matchMedia = (query: string) => {
    if (query !== SYSTEM_DARK_QUERY) throw new Error(`unexpected query: ${query}`);
    return mql;
  };
  return mql;
}

describe('ThemeService', () => {
  let doc: Document;
  let faviconLink: HTMLLinkElement;

  beforeEach(() => {
    localStorage.clear();
    doc = document;
    doc.documentElement.classList.remove('app-dark', 'dark', 'app-matrix');
    // The favicon swap reads / writes `link[rel="icon"][type="image/svg+xml"]`.
    // jsdom does not ship the index.html chrome, install a fresh stub so
    // the matrix tests can assert `href` flips.
    doc.head.querySelectorAll('link[rel="icon"][type="image/svg+xml"]').forEach((el) => el.remove());
    faviconLink = doc.createElement('link');
    faviconLink.rel = 'icon';
    faviconLink.type = 'image/svg+xml';
    faviconLink.href = 'favicon.svg';
    doc.head.appendChild(faviconLink);
    originalMatchMedia = (window as unknown as { matchMedia?: (q: string) => MediaQueryList })
      .matchMedia;
    installFakeMatchMedia(false);
  });

  afterEach(() => {
    if (originalMatchMedia === undefined) {
      delete (window as unknown as { matchMedia?: unknown }).matchMedia;
    } else {
      (window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia =
        originalMatchMedia;
    }
    doc.documentElement.classList.remove('app-dark', 'dark', 'app-matrix');
    faviconLink.remove();
    TestBed.resetTestingModule();
  });

  it('defaults to auto when storage is empty and resolves via system pref (light)', () => {
    const svc = TestBed.inject(ThemeService);
    expect(svc.mode()).toBe('auto');
    expect(svc.resolved()).toBe('light');
    TestBed.tick();
    expect(doc.documentElement.classList.contains('app-dark')).toBe(false);
    expect(doc.documentElement.classList.contains('dark')).toBe(false);
  });

  it('defaults to auto and resolves to dark when system prefers dark', () => {
    installFakeMatchMedia(true);
    const svc = TestBed.inject(ThemeService);
    expect(svc.mode()).toBe('auto');
    expect(svc.resolved()).toBe('dark');
    TestBed.tick();
    expect(doc.documentElement.classList.contains('app-dark')).toBe(true);
    expect(doc.documentElement.classList.contains('dark')).toBe(true);
  });

  it('restores a previously stored mode from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, 'dark');
    const svc = TestBed.inject(ThemeService);
    expect(svc.mode()).toBe('dark');
    expect(svc.resolved()).toBe('dark');
  });

  it('falls back to auto when stored value is unknown', () => {
    localStorage.setItem(STORAGE_KEY, 'banana');
    const svc = TestBed.inject(ThemeService);
    expect(svc.mode()).toBe('auto');
  });

  it('toggle cycles auto → light → dark → auto', () => {
    const svc = TestBed.inject(ThemeService);
    expect(svc.mode()).toBe('auto');
    svc.toggle();
    expect(svc.mode()).toBe('light');
    svc.toggle();
    expect(svc.mode()).toBe('dark');
    svc.toggle();
    expect(svc.mode()).toBe('auto');
  });

  it('persists the chosen mode (not the resolved theme) to localStorage', () => {
    installFakeMatchMedia(true); // system dark, but user picks light explicitly
    const svc = TestBed.inject(ThemeService);
    svc.set('light');
    TestBed.tick();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
    expect(svc.resolved()).toBe('light');
  });

  it('reacts live to system pref changes while in auto mode', () => {
    const mql = installFakeMatchMedia(false);
    const svc = TestBed.inject(ThemeService);
    expect(svc.resolved()).toBe('light');
    mql.fire(true);
    expect(svc.resolved()).toBe('dark');
    TestBed.tick();
    expect(doc.documentElement.classList.contains('app-dark')).toBe(true);
  });

  it('ignores system pref changes once a fixed mode is chosen', () => {
    const mql = installFakeMatchMedia(false);
    const svc = TestBed.inject(ThemeService);
    svc.set('light');
    mql.fire(true); // system flips to dark
    expect(svc.resolved()).toBe('light'); // user override wins
  });

  describe('brand mark (markSrc)', () => {
    it('serves the dark-stroke mark on light and the light-stroke mark on dark', () => {
      const svc = TestBed.inject(ThemeService);
      svc.set('light');
      expect(svc.markSrc()).toBe('skill-map-mark-dark.svg');
      svc.set('dark');
      expect(svc.markSrc()).toBe('skill-map-mark-light.svg');
    });

    it('serves the retinted mark of every extra theme, and falls back on clear', () => {
      const svc = TestBed.inject(ThemeService);
      for (const id of ['matrix', 'neon-blue', 'neon-green', 'neon-red', 'blueprint', 'paper'] as const) {
        svc.setExtraTheme(id);
        expect(svc.markSrc()).toBe(`skill-map-mark-${id}.svg`);
      }
      svc.setExtraTheme(null);
      svc.set('light');
      expect(svc.markSrc()).toBe('skill-map-mark-dark.svg');
    });
  });

  describe('extra theme (paper, forcesLight)', () => {
    it('drops the dark classes even under a dark mode, and restores them on clear', () => {
      const svc = TestBed.inject(ThemeService);
      svc.set('dark');
      TestBed.tick();
      expect(document.documentElement.classList.contains('app-dark')).toBe(true);
      svc.setExtraTheme('paper');
      TestBed.tick();
      expect(document.documentElement.classList.contains('app-paper')).toBe(true);
      expect(document.documentElement.classList.contains('app-dark')).toBe(false);
      expect(document.documentElement.classList.contains('dark')).toBe(false);
      svc.setExtraTheme(null);
      TestBed.tick();
      expect(document.documentElement.classList.contains('app-paper')).toBe(false);
      expect(document.documentElement.classList.contains('app-dark')).toBe(true);
    });
  });

  describe('extra theme (matrix)', () => {
    it('starts at null with empty storage', () => {
      const svc = TestBed.inject(ThemeService);
      expect(svc.extraTheme()).toBe(null);
      TestBed.tick();
      expect(doc.documentElement.classList.contains('app-matrix')).toBe(false);
    });

    it('restores a stored matrix value from localStorage', () => {
      localStorage.setItem(EXTRA_STORAGE_KEY, 'matrix');
      const svc = TestBed.inject(ThemeService);
      expect(svc.extraTheme()).toBe('matrix');
      TestBed.tick();
      expect(doc.documentElement.classList.contains('app-matrix')).toBe(true);
    });

    it('ignores unknown stored extra-theme values', () => {
      localStorage.setItem(EXTRA_STORAGE_KEY, 'synthwave');
      const svc = TestBed.inject(ThemeService);
      expect(svc.extraTheme()).toBe(null);
    });

    it('remaps the legacy bare neon id to neon-blue', () => {
      localStorage.setItem(EXTRA_STORAGE_KEY, 'neon');
      const svc = TestBed.inject(ThemeService);
      expect(svc.extraTheme()).toBe('neon-blue');
      TestBed.tick();
      expect(doc.documentElement.classList.contains('app-neon')).toBe(true);
    });

    it('setExtraTheme(matrix) forces the dark classes even when mode is light', () => {
      const svc = TestBed.inject(ThemeService);
      svc.set('light');
      TestBed.tick();
      expect(doc.documentElement.classList.contains('app-dark')).toBe(false);
      svc.setExtraTheme('matrix');
      TestBed.tick();
      expect(doc.documentElement.classList.contains('app-matrix')).toBe(true);
      expect(doc.documentElement.classList.contains('app-dark')).toBe(true);
      expect(doc.documentElement.classList.contains('dark')).toBe(true);
    });

    it('persists matrix and removes the key when cleared', () => {
      const svc = TestBed.inject(ThemeService);
      svc.setExtraTheme('matrix');
      TestBed.tick();
      expect(localStorage.getItem(EXTRA_STORAGE_KEY)).toBe('matrix');
      svc.setExtraTheme(null);
      TestBed.tick();
      expect(localStorage.getItem(EXTRA_STORAGE_KEY)).toBe(null);
    });

    it('swaps the SVG favicon when matrix activates and back when cleared', () => {
      const svc = TestBed.inject(ThemeService);
      TestBed.tick();
      // Idle: default favicon, the effect's idempotency guard left the
      // pre-existing href untouched on first run.
      expect(faviconLink.getAttribute('href')).toBe('favicon.svg');

      svc.setExtraTheme('matrix');
      TestBed.tick();
      expect(faviconLink.getAttribute('href')).toBe('favicon-matrix.svg');

      svc.setExtraTheme(null);
      TestBed.tick();
      expect(faviconLink.getAttribute('href')).toBe('favicon.svg');
    });

    it('every extra theme declares and swaps to its own favicon', () => {
      const svc = TestBed.inject(ThemeService);
      for (const id of ['neon-blue', 'neon-green', 'neon-red', 'matrix'] as const) {
        svc.setExtraTheme(id);
        TestBed.tick();
        expect(faviconLink.getAttribute('href')).toBe(`favicon-${id}.svg`);
      }
      svc.setExtraTheme(null);
      TestBed.tick();
      expect(faviconLink.getAttribute('href')).toBe('favicon.svg');
    });

    it('toggle clears matrix AND advances the mode one step', () => {
      const svc = TestBed.inject(ThemeService);
      svc.set('light');
      svc.setExtraTheme('matrix');
      TestBed.tick();
      expect(svc.extraTheme()).toBe('matrix');
      expect(svc.mode()).toBe('light');

      svc.toggle();
      TestBed.tick();
      expect(svc.extraTheme()).toBe(null);
      expect(svc.mode()).toBe('dark'); // light → dark
      expect(doc.documentElement.classList.contains('app-matrix')).toBe(false);
    });
  });
});
