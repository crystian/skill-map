/**
 * `GraphPreferencesService`, signal-backed connectionType + localStorage.
 *
 * Covers: default value, persistence read-path, normalisation of bad
 * payloads, write-back round-trip, and signal reactivity for the Settings
 * UI / graph-view consumers.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import {
  CONNECTION_TYPES,
  DEFAULT_CONNECTION_TYPE,
  GraphPreferencesService,
  type TConnectionType,
} from '../graph-preferences';
import { SKILL_MAP_EMBED } from '../embed-mode';

const STORAGE_KEY = 'sm.graph.connection-type';

describe('GraphPreferencesService, defaults', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('starts at the default when no storage row exists', () => {
    const service = TestBed.inject(GraphPreferencesService);
    expect(service.connectionType()).toBe(DEFAULT_CONNECTION_TYPE);
    expect(service.connectionType()).toBe('adaptive-curve');
  });

  it('exposes the closed offered catalog (3 entries, bezier deliberately absent)', () => {
    expect(CONNECTION_TYPES).toEqual([
      'segment',
      'straight',
      'adaptive-curve',
    ]);
  });
});

describe('GraphPreferencesService, localStorage read-path', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    localStorage.clear();
  });

  for (const good of [
    'segment',
    'straight',
    'adaptive-curve',
  ] as const) {
    it(`reads ${JSON.stringify(good)} verbatim from storage`, () => {
      localStorage.setItem(STORAGE_KEY, good);
      const service = TestBed.inject(GraphPreferencesService);
      expect(service.connectionType()).toBe(good);
    });
  }

  it('falls back to the default when storage holds an unknown value', () => {
    localStorage.setItem(STORAGE_KEY, 'spiral-bezier-future');
    const service = TestBed.inject(GraphPreferencesService);
    expect(service.connectionType()).toBe(DEFAULT_CONNECTION_TYPE);
  });

  // Migration pin: bezier WAS a catalog value until 2026-08-10; a
  // checkout that persisted it must land on the default, not crash or
  // keep rendering a shape the picker no longer offers.
  it('sanitises a legacy stored bezier back to the default', () => {
    localStorage.setItem(STORAGE_KEY, 'bezier');
    const service = TestBed.inject(GraphPreferencesService);
    expect(service.connectionType()).toBe(DEFAULT_CONNECTION_TYPE);
  });

  it('falls back to the default when storage holds an empty string', () => {
    localStorage.setItem(STORAGE_KEY, '');
    const service = TestBed.inject(GraphPreferencesService);
    expect(service.connectionType()).toBe(DEFAULT_CONNECTION_TYPE);
  });
});

describe('GraphPreferencesService, write-back', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('updates the signal and persists to storage', () => {
    const service = TestBed.inject(GraphPreferencesService);
    service.setConnectionType('segment');
    expect(service.connectionType()).toBe('segment');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('segment');
  });

  it('is a no-op when the new value matches the current one', () => {
    const service = TestBed.inject(GraphPreferencesService);
    service.setConnectionType('straight');
    // Capture the signal reference; signal identity stays stable when the
    // service short-circuits on equality, so consumers don't see a spurious
    // re-render.
    const valueAfterFirstWrite = service.connectionType();
    service.setConnectionType('straight');
    expect(service.connectionType()).toBe(valueAfterFirstWrite);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('straight');
  });

  it('survives every catalog value round-trip', () => {
    const service = TestBed.inject(GraphPreferencesService);
    // Step off the default first so every iteration below actually
    // writes (the service short-circuits when the new value matches the
    // current one, which would skip the storage write for the default).
    service.setConnectionType('segment');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('segment');
    for (const value of CONNECTION_TYPES) {
      service.setConnectionType(value);
      expect(service.connectionType()).toBe(value);
      expect(localStorage.getItem(STORAGE_KEY)).toBe(value);
    }
  });
});

describe('GraphPreferencesService, signal reactivity', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('subsequent reads observe the latest value (consumers can `connectionType()` repeatedly)', () => {
    const service = TestBed.inject(GraphPreferencesService);
    const readings: TConnectionType[] = [];
    readings.push(service.connectionType());
    service.setConnectionType('straight');
    readings.push(service.connectionType());
    service.setConnectionType('segment');
    readings.push(service.connectionType());
    expect(readings).toEqual([DEFAULT_CONNECTION_TYPE, 'straight', 'segment']);
  });
});

describe('GraphPreferencesService, embedded boot', () => {
  it('forces the balanced left-to-right layout over any stored preference', () => {
    localStorage.setItem('sm.graph.layout-algorithm', 'force');
    localStorage.setItem('sm.graph.layout-direction', 'TOP_BOTTOM');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: SKILL_MAP_EMBED, useValue: { theme: null } }] });
    const service = TestBed.inject(GraphPreferencesService);
    expect(service.layoutAlgorithm()).toBe('network-simplex');
    expect(service.layoutDirection()).toBe('LEFT_RIGHT');
    localStorage.clear();
  });
});
