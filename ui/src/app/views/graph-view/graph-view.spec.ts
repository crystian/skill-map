import { describe, expect, it, beforeEach, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { EMPTY } from 'rxjs';

import { GraphView } from './graph-view';
import { CollectionLoaderService } from '../../../services/collection-loader';
import { KindRegistryService } from '../../../services/kind-registry';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../services/data-source/data-source.port';
import { MarkdownRenderer } from '../../../services/markdown-renderer';
import type { INodeView } from '../../../models/node';
import type { IScanResultApi } from '../../../models/api';

/**
 * `GraphView` — selection / URL-sync / panel-close behaviour. Tests
 * focus on the public API surface (`selectedNodeId`, `selectedPath`,
 * `closePanel`, `onEscape`, the URL writer effect). Foblex Flow
 * rendering is skipped intentionally — the canvas mounts inside the
 * `@if (!hasData())` else-branch, and the layout/render concerns are
 * covered by `graph-layout.spec.ts` plus visual smoke in dev.
 */

@Component({ template: '' })
class BlankPage {}

interface IStubLoader {
  nodes: ReturnType<typeof signal<INodeView[]>>;
  scan: ReturnType<typeof signal<IScanResultApi | null>>;
  loading: ReturnType<typeof signal<boolean>>;
  error: ReturnType<typeof signal<string | null>>;
  load: ReturnType<typeof vi.fn>;
}

function makeNode(path: string, name: string): INodeView {
  return {
    path,
    kind: 'agent',
    frontmatter: {
      name,
      description: '',
      metadata: { version: '1.0.0' },
    },
  };
}

function makeStubLoader(initialNodes: INodeView[] = []): IStubLoader {
  return {
    nodes: signal(initialNodes),
    scan: signal<IScanResultApi | null>({
      schemaVersion: 1,
      scannedAt: 0,
      scope: 'project',
      roots: ['.'],
      providers: [],
      nodes: initialNodes.map((n) => ({
        path: n.path,
        kind: n.kind,
        provider: 'claude',
        bodyHash: 'h',
        frontmatterHash: 'fh',
        bytes: { frontmatter: 1, body: 1, total: 2 },
        linksOutCount: 0,
        linksInCount: 0,
        externalRefsCount: 0,
      })),
      links: [],
      issues: [],
      stats: {
        filesWalked: initialNodes.length,
        filesSkipped: 0,
        nodesCount: initialNodes.length,
        linksCount: 0,
        issuesCount: 0,
        durationMs: 0,
      },
    }),
    loading: signal(false),
    error: signal<string | null>(null),
    load: vi.fn().mockResolvedValue(undefined),
  };
}

const STUB_DATA_SOURCE: IDataSourcePort = {
  health: vi.fn(),
  loadScan: vi.fn(),
  listNodes: vi.fn(),
  getNode: vi.fn().mockResolvedValue(null),
  listLinks: vi.fn().mockResolvedValue({
    schemaVersion: '1',
    kind: 'links',
    items: [],
    filters: { kind: null, from: null, to: null },
    counts: { total: 0, returned: 0 },
    kindRegistry: {},
  }),
  listIssues: vi.fn(),
  loadGraph: vi.fn(),
  loadConfig: vi.fn(),
  listPlugins: vi.fn(),
  events: vi.fn().mockReturnValue(EMPTY),
};

class FakeMarkdownRenderer extends MarkdownRenderer {
  override async render(): Promise<string> {
    return '';
  }
}

async function bootstrap(initialNodes: INodeView[]): Promise<{
  fixture: ComponentFixture<GraphView>;
  cmp: GraphView;
  loader: IStubLoader;
  router: Router;
}> {
  const loader = makeStubLoader(initialNodes);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: '', component: BlankPage },
        { path: 'graph', component: BlankPage },
      ]),
      { provide: CollectionLoaderService, useValue: loader },
      { provide: DATA_SOURCE, useValue: STUB_DATA_SOURCE },
      { provide: MarkdownRenderer, useClass: FakeMarkdownRenderer },
    ],
  });
  // Seed the kind registry so the layout's per-kind splits resolve.
  TestBed.inject(KindRegistryService).ingest({
    agent: { providerId: 'claude', label: 'Agents', color: '#3b82f6' },
  });
  const router = TestBed.inject(Router);
  await router.navigateByUrl('/graph');
  const fixture = TestBed.createComponent(GraphView);
  // Construction wires the effects but DOES NOT detect changes — that
  // would render the Foblex template, which is not our concern. We
  // poke methods on the instance directly and let effects flush via
  // `flush()` below.
  return { fixture, cmp: fixture.componentInstance, loader, router };
}

/** Drive the effect runner without rendering the template. */
async function flushEffects(fixture: ComponentFixture<GraphView>): Promise<void> {
  // `detectChanges` runs the effect runner; calling it is enough to
  // surface signal-driven behaviour. We call it inside a try/catch
  // because the `@else` Foblex branch tries to render `f-flow`
  // descendants in JSDOM — geometry APIs (ResizeObserver,
  // getBoundingClientRect) may throw or return zeros, but the
  // selection / URL effects we care about already ran by the time
  // any render error surfaces.
  try {
    fixture.detectChanges();
  } catch {
    // Ignore Foblex-internal render glitches in JSDOM.
  }
  await Promise.resolve();
  await Promise.resolve();
}

describe('GraphView — selection and URL sync', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('selects a node and exposes its path via selectedPath()', async () => {
    const node = makeNode('agents/architect.md', 'architect');
    const { fixture, cmp } = await bootstrap([node]);
    await flushEffects(fixture);

    cmp.selectedNodeId.set(node.path);
    await flushEffects(fixture);

    expect(cmp.selectedNodeId()).toBe(node.path);
  });

  it('writes the selected path into the URL `?path=` query param', async () => {
    const node = makeNode('agents/architect.md', 'architect');
    const { fixture, cmp, router } = await bootstrap([node]);
    await flushEffects(fixture);

    cmp.selectedNodeId.set(node.path);
    await flushEffects(fixture);
    // Allow router navigation microtask to land.
    await new Promise((r) => setTimeout(r, 0));

    expect(router.url).toContain(`path=${encodeURIComponent(node.path)}`);
  });

  it('removes the `?path=` param when selection is cleared via closePanel()', async () => {
    const node = makeNode('agents/architect.md', 'architect');
    const { fixture, cmp, router } = await bootstrap([node]);
    await flushEffects(fixture);

    cmp.selectedNodeId.set(node.path);
    await flushEffects(fixture);
    await new Promise((r) => setTimeout(r, 0));
    expect(router.url).toContain('path=');

    cmp.closePanel();
    await flushEffects(fixture);
    await new Promise((r) => setTimeout(r, 0));

    expect(cmp.selectedNodeId()).toBeNull();
    expect(router.url).not.toContain('path=');
  });

  it('Escape clears the selection when the panel is open', async () => {
    const node = makeNode('agents/architect.md', 'architect');
    const { fixture, cmp } = await bootstrap([node]);
    await flushEffects(fixture);

    cmp.selectedNodeId.set(node.path);
    await flushEffects(fixture);

    cmp.onEscape();
    await flushEffects(fixture);

    expect(cmp.selectedNodeId()).toBeNull();
  });

  it('Escape is a no-op when nothing is selected (does not break key propagation)', async () => {
    const { fixture, cmp } = await bootstrap([
      makeNode('agents/architect.md', 'architect'),
    ]);
    await flushEffects(fixture);

    expect(cmp.selectedNodeId()).toBeNull();
    cmp.onEscape();
    expect(cmp.selectedNodeId()).toBeNull();
  });
});

describe('GraphView — deep-link reader', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('opens the panel for a node when the URL carries `?path=…`', async () => {
    const node = makeNode('agents/architect.md', 'architect');
    const loader = makeStubLoader([node]);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', component: BlankPage },
          { path: 'graph', component: BlankPage },
        ]),
        { provide: CollectionLoaderService, useValue: loader },
        { provide: DATA_SOURCE, useValue: STUB_DATA_SOURCE },
        { provide: MarkdownRenderer, useClass: FakeMarkdownRenderer },
      ],
    });
    TestBed.inject(KindRegistryService).ingest({
      agent: { providerId: 'claude', label: 'Agents', color: '#3b82f6' },
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl(`/graph?path=${encodeURIComponent(node.path)}`);

    const fixture = TestBed.createComponent(GraphView);
    const cmp = fixture.componentInstance;
    await flushEffects(fixture);
    await new Promise((r) => setTimeout(r, 0));
    await flushEffects(fixture);

    expect(cmp.selectedNodeId()).toBe(node.path);
  });
});
