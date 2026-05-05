import { describe, expect, it, beforeEach, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';

import { ListView } from './list-view';
import { CollectionLoaderService } from '../../../services/collection-loader';
import { FilterStoreService } from '../../../services/filter-store';
import { KindRegistryService } from '../../../services/kind-registry';
import type { INodeView } from '../../../models/node';

/**
 * `ListView` — the only behaviour worth testing at the component level
 * is the row-click navigation contract (rename of `openInspector` →
 * `openNode`, which now routes to `/graph?path=…` instead of to a
 * standalone inspector route). Table rendering is PrimeNG and trivial;
 * filter behaviour is owned by `FilterStoreService` and tested there.
 */

@Component({ template: '' })
class BlankPage {}

function makeNode(overrides: Partial<INodeView> = {}): INodeView {
  return {
    path: 'agents/architect.md',
    kind: 'agent',
    frontmatter: {
      name: 'architect',
      description: 'd',
      metadata: { version: '1.0.0' },
    },
    ...overrides,
  };
}

interface IStubLoader {
  nodes: ReturnType<typeof signal<INodeView[]>>;
  loading: ReturnType<typeof signal<boolean>>;
  error: ReturnType<typeof signal<string | null>>;
  count: ReturnType<typeof signal<number>>;
  scan: ReturnType<typeof signal<unknown>>;
  load: ReturnType<typeof vi.fn>;
}

function makeStubLoader(initialNodes: INodeView[] = []): IStubLoader {
  return {
    nodes: signal(initialNodes),
    loading: signal(false),
    error: signal<string | null>(null),
    count: signal(initialNodes.length),
    scan: signal<unknown>(null),
    load: vi.fn().mockResolvedValue(undefined),
  };
}

async function bootstrap(
  initialNodes: INodeView[] = [],
): Promise<{ fixture: ComponentFixture<ListView>; router: Router }> {
  const loader = makeStubLoader(initialNodes);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: '', component: BlankPage },
        { path: 'graph', component: BlankPage },
      ]),
      { provide: CollectionLoaderService, useValue: loader },
    ],
  });
  // Seed the kind registry so the table renders kind tags. Without an
  // ingest, the table still mounts (the kind label falls back to the
  // raw kind string) but we want a representative shape.
  TestBed.inject(KindRegistryService).ingest({
    agent: { providerId: 'claude', label: 'Agents', color: '#3b82f6' },
  });
  const router = TestBed.inject(Router);
  await router.navigateByUrl('/');
  const fixture = TestBed.createComponent(ListView);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, router };
}

describe('ListView', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('row click navigates to /graph with the row path as a query param', async () => {
    const node = makeNode();
    const { fixture, router } = await bootstrap([node]);

    const row = fixture.nativeElement.querySelector(
      `[data-testid="list-row-${node.path}"]`,
    ) as HTMLElement | null;
    expect(row).not.toBeNull();

    row!.click();
    await fixture.whenStable();

    expect(router.url).toBe(`/graph?path=${encodeURIComponent(node.path)}`);
  });

  it('renders the empty-all state when no nodes are loaded and no filters are active', async () => {
    const { fixture } = await bootstrap();
    const dom: HTMLElement = fixture.nativeElement;
    // Reset the filter store inside the test bed to be safe — if a
    // previous test left state on the root-provided service, this
    // assertion would fall through to the empty-filtered branch.
    TestBed.inject(FilterStoreService).reset();
    fixture.detectChanges();
    expect(dom.querySelector('[data-testid="list-empty-all"]')).not.toBeNull();
  });
});
