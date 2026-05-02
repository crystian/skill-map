import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Component } from '@angular/core';

import { FilterStoreService } from './filter-store';
import { FilterUrlSyncService } from './filter-url-sync';

@Component({ template: '' })
class BlankPage {}

describe('FilterUrlSyncService', () => {
  let router: Router;
  let store: FilterStoreService;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', component: BlankPage },
          { path: 'list', component: BlankPage },
        ]),
      ],
    });
    router = TestBed.inject(Router);
    store = TestBed.inject(FilterStoreService);
    await router.navigateByUrl('/');
  });

  afterEach(() => {
    store.reset();
  });

  it('seeds store from URL on construction', async () => {
    await router.navigateByUrl('/list?search=foo&kinds=agent,skill&hasIssues=true');
    TestBed.inject(FilterUrlSyncService);
    expect(store.searchText()).toBe('foo');
    expect(store.selectedKinds()).toEqual(['agent', 'skill']);
    expect(store.hasIssuesOnly()).toBe(true);
  });

  it('ignores unknown kinds when seeding from URL', async () => {
    await router.navigateByUrl('/list?kinds=agent,bogus,skill');
    TestBed.inject(FilterUrlSyncService);
    expect(store.selectedKinds()).toEqual(['agent', 'skill']);
  });

  it('pushes store changes to the URL', async () => {
    TestBed.inject(FilterUrlSyncService);
    await new Promise((r) => setTimeout(r, 0));

    store.setSearchText('hello');
    store.setKinds(['agent']);
    // Allow the effect + router navigation to flush.
    await new Promise((r) => setTimeout(r, 10));

    const url = router.url;
    expect(url).toContain('search=hello');
    expect(url).toContain('kinds=agent');
  });

  it('does not loop: a URL-driven seed does not trigger a redundant URL write', async () => {
    await router.navigateByUrl('/list?search=initial');
    TestBed.inject(FilterUrlSyncService);
    await new Promise((r) => setTimeout(r, 10));

    const before = router.url;
    // Re-set the same value: should be a no-op for the URL.
    store.setSearchText('initial');
    await new Promise((r) => setTimeout(r, 10));
    expect(router.url).toBe(before);
  });

  it('clears params when filters reset', async () => {
    TestBed.inject(FilterUrlSyncService);
    store.setSearchText('xyz');
    await new Promise((r) => setTimeout(r, 10));
    expect(router.url).toContain('search=xyz');

    store.reset();
    await new Promise((r) => setTimeout(r, 10));
    expect(router.url).not.toContain('search=');
  });
});
