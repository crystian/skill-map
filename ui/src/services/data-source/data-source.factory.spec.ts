import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { dataSourceFactory } from './data-source.factory';
import { RestDataSource } from './rest-data-source';
import { StaticDataSource } from './static-data-source';
import { SKILL_MAP_MODE } from './runtime-mode';

describe('dataSourceFactory', () => {
  function configureWithMode(mode: string): unknown {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        // SKILL_MAP_MODE drives both the factory branch and the
        // WsEventStreamService's connect-vs-no-op decision. Demo mode
        // here keeps the WS service from trying to open a socket when
        // the factory probes the live branch under TestBed.
        { provide: SKILL_MAP_MODE, useValue: mode },
      ],
    });
    return TestBed.runInInjectionContext(() => dataSourceFactory());
  }

  it('returns a RestDataSource when mode is "live"', () => {
    const ds = configureWithMode('live');
    expect(ds).toBeInstanceOf(RestDataSource);
  });

  it('returns a StaticDataSource when mode is "demo"', () => {
    const ds = configureWithMode('demo');
    expect(ds).toBeInstanceOf(StaticDataSource);
  });

  it('throws an "unknown mode" error for any other value', () => {
    expect(() => configureWithMode('staging')).toThrow(/SKILL_MAP_MODE/);
  });
});
