import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { ThemeService } from './theme';

const STORAGE_KEY = 'skill-map.ui.theme';
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

  beforeEach(() => {
    localStorage.clear();
    doc = document;
    doc.documentElement.classList.remove('app-dark', 'dark');
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
    doc.documentElement.classList.remove('app-dark', 'dark');
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
});
