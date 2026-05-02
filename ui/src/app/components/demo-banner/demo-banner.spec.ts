import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { DemoBanner } from './demo-banner';
import { SKILL_MAP_MODE } from '../../../services/data-source/runtime-mode';

const STORAGE_KEY = 'sm.demoBannerDismissed';

describe('DemoBanner', () => {
  beforeEach(() => {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  });

  afterEach(() => {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  });

  function makeFixture(mode: 'live' | 'demo') {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DemoBanner],
      providers: [{ provide: SKILL_MAP_MODE, useValue: mode }],
    });
    const fixture = TestBed.createComponent(DemoBanner);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the banner when mode is "demo"', () => {
    const fixture = makeFixture('demo');
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="demo-banner"]')).not.toBeNull();
  });

  it('hides the banner entirely when mode is "live"', () => {
    const fixture = makeFixture('live');
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="demo-banner"]')).toBeNull();
  });

  it('persists dismissal to localStorage and hides on next render', () => {
    const fixture = makeFixture('demo');
    fixture.componentInstance.dismiss();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="demo-banner"]')).toBeNull();
    expect(globalThis.localStorage?.getItem(STORAGE_KEY)).toBe('1');
  });

  it('stays hidden after a reload simulation when previously dismissed', () => {
    globalThis.localStorage?.setItem(STORAGE_KEY, '1');
    const fixture = makeFixture('demo');
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="demo-banner"]')).toBeNull();
  });
});
