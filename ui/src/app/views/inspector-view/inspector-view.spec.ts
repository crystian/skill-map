import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { EMPTY } from 'rxjs';

import { InspectorView } from './inspector-view';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../services/data-source/data-source.port';
import { MarkdownRenderer } from '../../../services/markdown-renderer';
import { CollectionLoaderService } from '../../../services/collection-loader';
import type { INodeView } from '../../../models/node';
import type { INodeDetailApi, INodeApi } from '../../../models/api';

/**
 * Inspector view spec — focuses on the Step 14.5.a body card lifecycle
 * (loading → ready / empty / unavailable / error) and the basic
 * shell-level empty states. Card-level rendering of frontmatter
 * cards (Agent / Command / Skill / Relations / Metadata) is
 * left to template integration; the body-card flow is the part with
 * non-trivial state to test.
 */

type IStubDataSource = IDataSourcePort & {
  getNode: ReturnType<typeof vi.fn>;
};

type IStubLoader = {
  nodes: ReturnType<typeof signal<INodeView[]>>;
  loading: ReturnType<typeof signal<boolean>>;
  load: ReturnType<typeof vi.fn>;
};

function makeNode(overrides: Partial<INodeView> = {}): INodeView {
  return {
    path: 'agents/architect.md',
    kind: 'agent',
    frontmatter: {
      name: 'architect',
      description: 'The architect.',
      metadata: { version: '1.0.0' },
    },
    ...overrides,
  };
}

function makeApiNode(overrides: Partial<INodeApi> = {}): INodeApi {
  return {
    path: 'agents/architect.md',
    kind: 'agent',
    provider: 'claude',
    bodyHash: 'h',
    frontmatterHash: 'fh',
    bytes: { frontmatter: 10, body: 20, total: 30 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    ...overrides,
  };
}

function makeDetail(item: INodeApi): INodeDetailApi {
  return {
    schemaVersion: '1',
    kind: 'node',
    item,
    links: { incoming: [], outgoing: [] },
    issues: [],
    kindRegistry: {},
  };
}

function makeStubLoader(initialNodes: INodeView[] = []): IStubLoader {
  return {
    nodes: signal(initialNodes),
    loading: signal(false),
    load: vi.fn().mockResolvedValue(undefined),
  };
}

function makeStubDataSource(): IStubDataSource {
  return {
    health: vi.fn(),
    loadScan: vi.fn(),
    listNodes: vi.fn(),
    getNode: vi.fn(),
    // The Inspector embeds <sm-linked-nodes-panel> which calls
    // listLinks({from}) + listLinks({to}) on every node-path change.
    // Default to an empty envelope so the panel resolves to "no
    // outgoing / incoming" without forcing every spec to stub it.
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
    // The LinkedNodesPanel subscribes in its constructor (`scan.completed`
    // reactive refresh) — return EMPTY so the subscription completes
    // immediately and never fires.
    events: vi.fn().mockReturnValue(EMPTY),
  } as unknown as IStubDataSource;
}

/**
 * Test-only MarkdownRenderer that bypasses the dynamic markdown-it /
 * DOMPurify imports. Returns a sanitized passthrough wrapped via the
 * real DomSanitizer so the `[innerHTML]` binding still receives a
 * SafeHtml.
 */
class FakeMarkdownRenderer extends MarkdownRenderer {
  constructor(
    private readonly sanitizerRef: DomSanitizer,
    private readonly mode: 'pass' | 'throw',
  ) {
    super();
  }

  override async render(src: string): Promise<SafeHtml> {
    if (this.mode === 'throw') throw new Error('boom');
    // Surround so the test can detect "the renderer ran" vs
    // "we got the raw string back".
    return this.sanitizerRef.bypassSecurityTrustHtml(`<div data-fake>${src}</div>`);
  }
}

interface IBootstrapOpts {
  loader?: IStubLoader;
  dataSource?: IStubDataSource;
  rendererMode?: 'pass' | 'throw';
}

function bootstrap(opts: IBootstrapOpts = {}): {
  fixture: ComponentFixture<InspectorView>;
  cmp: InspectorView;
  loader: IStubLoader;
  dataSource: IStubDataSource;
} {
  const loader = opts.loader ?? makeStubLoader();
  const dataSource = opts.dataSource ?? makeStubDataSource();

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: DATA_SOURCE, useValue: dataSource },
      { provide: CollectionLoaderService, useValue: loader },
      {
        provide: MarkdownRenderer,
        useFactory: (): MarkdownRenderer =>
          new FakeMarkdownRenderer(TestBed.inject(DomSanitizer), opts.rendererMode ?? 'pass'),
      },
    ],
  });
  const fixture = TestBed.createComponent(InspectorView);
  return { fixture, cmp: fixture.componentInstance, loader, dataSource };
}

/** Drain microtasks + flush effects so the body-fetch promise resolves. */
async function flush(fixture: ComponentFixture<InspectorView>): Promise<void> {
  fixture.detectChanges();
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
}

describe('InspectorView — empty states', () => {
  it('renders the no-selection empty state when path is undefined', async () => {
    const { fixture } = bootstrap();
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-empty-no-selection"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-card-body"]')).toBeNull();
  });

  it('renders the not-found empty state when the path is not in nodes()', async () => {
    const { fixture } = bootstrap();
    fixture.componentRef.setInput('path', 'agents/missing.md');
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-empty-not-found"]')).not.toBeNull();
  });
});

describe('InspectorView — body card lifecycle', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows the loading state while getNode() is in flight', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    // Never-resolving promise to lock the state at "loading".
    dataSource.getNode.mockReturnValue(new Promise(() => {}));

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-body-loading"]')).not.toBeNull();
    expect(dataSource.getNode).toHaveBeenCalledWith(node.path, { includeBody: true });
  });

  it('renders the markdown HTML when getNode() returns a body', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '# hello\n\nworld.' })));

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    const rendered = dom.querySelector('[data-testid="inspector-body-rendered"]');
    expect(rendered).not.toBeNull();
    expect(rendered!.innerHTML).toContain('# hello');
    expect(rendered!.innerHTML).toContain('data-fake');
  });

  it('shows the empty body state when item.body is undefined', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode()));

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-body-empty"]')).not.toBeNull();
  });

  it('shows the unavailable state when item.body is null (file missing)', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: null })));

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-body-unavailable"]')).not.toBeNull();
  });

  it('shows the unavailable state when getNode() returns null (404)', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(null);

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-body-unavailable"]')).not.toBeNull();
  });

  it('shows the error state when getNode() throws', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockRejectedValue(new Error('network down'));

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-body-error"]')).not.toBeNull();
  });

  it('shows the error state when the markdown renderer throws', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '# trips it' })));

    const { fixture } = bootstrap({ loader, dataSource, rendererMode: 'throw' });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-body-error"]')).not.toBeNull();
  });

  it('drops a stale resolution when the user navigates to a different path mid-fetch', async () => {
    const nodeA = makeNode({ path: 'a.md', frontmatter: { name: 'A', description: '', metadata: { version: '' } } });
    const nodeB = makeNode({ path: 'b.md', frontmatter: { name: 'B', description: '', metadata: { version: '' } } });
    const loader = makeStubLoader([nodeA, nodeB]);
    const dataSource = makeStubDataSource();

    let resolveA!: (v: INodeDetailApi) => void;
    const pendingA = new Promise<INodeDetailApi>((res) => {
      resolveA = res;
    });
    dataSource.getNode.mockImplementation((p: string) => {
      if (p === 'a.md') return pendingA;
      return Promise.resolve(makeDetail(makeApiNode({ path: 'b.md', body: '# B body' })));
    });

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', 'a.md');
    await flush(fixture);
    // Switch to B before A resolves.
    fixture.componentRef.setInput('path', 'b.md');
    await flush(fixture);

    // A's late resolution should be ignored — the body card already
    // shows B's content.
    resolveA(makeDetail(makeApiNode({ path: 'a.md', body: '# A body — late' })));
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    const rendered = dom.querySelector('[data-testid="inspector-body-rendered"]');
    expect(rendered).not.toBeNull();
    expect(rendered!.innerHTML).toContain('# B body');
    expect(rendered!.innerHTML).not.toContain('A body');
  });
});

describe('InspectorView — body refresh (Step 14.5.c)', () => {
  it('renders a refresh button in the body card header', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '# initial' })));

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-body-refresh"]'),
    ).not.toBeNull();
  });

  it('re-fetches the body when the refresh button is clicked', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    let calls = 0;
    dataSource.getNode.mockImplementation(() => {
      calls++;
      return Promise.resolve(makeDetail(makeApiNode({ body: `# render ${calls}` })));
    });

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(calls).toBe(1);

    const btn = fixture.nativeElement.querySelector(
      '[data-testid="inspector-body-refresh"] button',
    ) as HTMLButtonElement;
    btn.click();
    await flush(fixture);

    expect(calls).toBe(2);
    const rendered = fixture.nativeElement.querySelector(
      '[data-testid="inspector-body-rendered"]',
    );
    expect(rendered!.innerHTML).toContain('# render 2');
  });

  it('disables the refresh button while a fetch is in flight', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    // Never-resolving promise locks bodyState at 'loading'.
    dataSource.getNode.mockReturnValue(new Promise(() => {}));

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    const btn = fixture.nativeElement.querySelector(
      '[data-testid="inspector-body-refresh"] button',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('refresh is a no-op while a fetch is already in flight (idempotent guard)', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    let calls = 0;
    dataSource.getNode.mockImplementation(() => {
      calls++;
      return new Promise(() => {});
    });

    const { fixture, cmp } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(calls).toBe(1);

    // Component-level call (bypasses the disabled DOM button) — the
    // guard inside refreshBody() must still short-circuit.
    (cmp as unknown as { refreshBody: () => void }).refreshBody();
    await flush(fixture);

    expect(calls).toBe(1);
  });

  it('recovers from an initial error when the user clicks refresh', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    // First call fails, second succeeds — the user-facing recovery
    // path: an error state ought to be reachable AND escapable via
    // the refresh button without forcing a navigate-away-and-back.
    let calls = 0;
    dataSource.getNode.mockImplementation(() => {
      calls++;
      if (calls === 1) return Promise.reject(new Error('transient'));
      return Promise.resolve(makeDetail(makeApiNode({ body: '# recovered' })));
    });

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-body-error"]')).not.toBeNull();

    const btn = fixture.nativeElement.querySelector(
      '[data-testid="inspector-body-refresh"] button',
    ) as HTMLButtonElement;
    btn.click();
    await flush(fixture);

    const rendered = fixture.nativeElement.querySelector(
      '[data-testid="inspector-body-rendered"]',
    );
    expect(rendered).not.toBeNull();
    expect(rendered!.innerHTML).toContain('# recovered');
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-body-error"]')).toBeNull();
  });

  it('clears the rendered body during the refresh loading window so stale HTML is never shown', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    let resolveSecond!: (v: INodeDetailApi) => void;
    let calls = 0;
    dataSource.getNode.mockImplementation(() => {
      calls++;
      if (calls === 1) {
        return Promise.resolve(makeDetail(makeApiNode({ body: '# first' })));
      }
      // Second call hangs so we can inspect the loading window.
      return new Promise<INodeDetailApi>((res) => {
        resolveSecond = res;
      });
    });

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    // First render landed.
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-body-rendered"]'),
    ).not.toBeNull();

    const btn = fixture.nativeElement.querySelector(
      '[data-testid="inspector-body-refresh"] button',
    ) as HTMLButtonElement;
    btn.click();
    await flush(fixture);

    // While the refresh fetch is in flight, the rendered HTML must be
    // gone (no stale "# first" leaking through). Loading state shows.
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-body-loading"]'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-body-rendered"]'),
    ).toBeNull();

    // Now resolve so the test cleans up its dangling promise.
    resolveSecond(makeDetail(makeApiNode({ body: '# second' })));
    await flush(fixture);
  });

  it('refreshBody() is a no-op when no path is selected', async () => {
    const loader = makeStubLoader();
    const dataSource = makeStubDataSource();
    const { fixture, cmp } = bootstrap({ loader, dataSource });
    await flush(fixture);
    // No setInput('path', …) — path() stays undefined.

    (cmp as unknown as { refreshBody: () => void }).refreshBody();
    await flush(fixture);

    expect(dataSource.getNode).not.toHaveBeenCalled();
  });
});

describe('InspectorView — dead-link verify (Step 14.5.b)', () => {
  /**
   * Build a node whose frontmatter declares an out-of-scope `requires`
   * path. The path is NOT in `loader.nodes()`, so `pathExists()` returns
   * false → heuristic flags it dead → verify icon appears.
   */
  function makeNodeWithDeadRequire(): INodeView {
    return {
      path: 'agents/architect.md',
      kind: 'agent',
      frontmatter: {
        name: 'architect',
        description: 'd',
        metadata: {
          version: '1.0.0',
          requires: ['out-of-scope/missing.md'],
        },
      } as INodeView['frontmatter'],
    };
  }

  it('renders the verify icon for a heuristically-dead chip', async () => {
    const node = makeNodeWithDeadRequire();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    const icon = fixture.nativeElement.querySelector(
      '[data-testid="rel-requires-verify-out-of-scope/missing.md"]',
    );
    expect(icon).not.toBeNull();
  });

  it('confirms a dead link when the verify hit returns null (404)', async () => {
    const node = makeNodeWithDeadRequire();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    // Body fetch resolves; the verify call (a separate getNode without
    // includeBody) returns null → 404 → confirms dead.
    dataSource.getNode.mockImplementation((p: string, opts?: { includeBody?: boolean }) => {
      if (opts?.includeBody) return Promise.resolve(makeDetail(makeApiNode({ body: '' })));
      if (p === 'out-of-scope/missing.md') return Promise.resolve(null);
      return Promise.resolve(makeDetail(makeApiNode({ path: p })));
    });

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    const verifyBtn = fixture.nativeElement.querySelector(
      '[data-testid="rel-requires-verify-out-of-scope/missing.md"]',
    ) as HTMLButtonElement;
    verifyBtn.click();
    await flush(fixture);

    // Confirmed-dead variant shows the times-circle icon.
    const confirmedIcon = fixture.nativeElement.querySelector(
      '[data-testid="rel-requires-verify-out-of-scope/missing.md"] .pi-times-circle',
    );
    expect(confirmedIcon).not.toBeNull();
  });

  it('flips a heuristic-dead chip to live when the verify hit returns a node (false-positive)', async () => {
    const node = makeNodeWithDeadRequire();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    // Verify call returns a real node — the path was real-but-out-of-scope.
    dataSource.getNode.mockImplementation((p: string, opts?: { includeBody?: boolean }) => {
      if (opts?.includeBody) return Promise.resolve(makeDetail(makeApiNode({ body: '' })));
      if (p === 'out-of-scope/missing.md') {
        return Promise.resolve(makeDetail(makeApiNode({ path: 'out-of-scope/missing.md' })));
      }
      return Promise.resolve(makeDetail(makeApiNode({ path: p })));
    });

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    const verifyBtn = fixture.nativeElement.querySelector(
      '[data-testid="rel-requires-verify-out-of-scope/missing.md"]',
    ) as HTMLButtonElement;
    verifyBtn.click();
    await flush(fixture);

    // After verify→alive, the icon (and the verify button itself)
    // should disappear: the chip is now classified `live`, and the
    // template only renders the icon block for non-live statuses.
    const verifyAfter = fixture.nativeElement.querySelector(
      '[data-testid="rel-requires-verify-out-of-scope/missing.md"]',
    );
    expect(verifyAfter).toBeNull();
  });
});

describe('InspectorView — kind-specific cards smoke', () => {
  it('renders the agent card for an agent node', async () => {
    const node = makeNode({
      kind: 'agent',
      frontmatter: {
        name: 'architect',
        description: 'd',
        model: 'opus',
        metadata: { version: '1.0.0' },
      } as INodeView['frontmatter'],
    });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-card-agent"]')).not.toBeNull();
  });
});

// Smoke: confirm the router is reachable so the back-link doesn't crash
// the component on construction. (The router is provided in `bootstrap`;
// this test exists to surface a missing provider as an early failure.)
describe('InspectorView — router smoke', () => {
  it('has a router available for in-app navigation links', () => {
    bootstrap();
    expect(TestBed.inject(Router)).toBeDefined();
  });
});
