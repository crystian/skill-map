import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { dataSourceFactory } from './data-source.factory';
import { RestDataSource } from './rest-data-source';
import { SKILL_MAP_MODE } from './runtime-mode';

describe('dataSourceFactory', () => {
  function configureWithMode(mode: string): unknown {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SKILL_MAP_MODE, useValue: mode },
      ],
    });
    return TestBed.runInInjectionContext(() => dataSourceFactory());
  }

  it('returns a RestDataSource when mode is "live"', () => {
    const ds = configureWithMode('live');
    expect(ds).toBeInstanceOf(RestDataSource);
  });

  it('throws a clear error when mode is "demo" (StaticDataSource lands at 14.3.b)', () => {
    expect(() => configureWithMode('demo')).toThrow(/14\.3\.b/);
  });

  it('throws an "unknown mode" error for any other value', () => {
    expect(() => configureWithMode('staging')).toThrow(/SKILL_MAP_MODE/);
  });
});
