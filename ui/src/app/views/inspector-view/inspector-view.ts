import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  computed,
} from '@angular/core';
import type { OnInit } from '@angular/core';
import type { SafeHtml } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { TagModule } from 'primeng/tag';
import { ChipModule } from 'primeng/chip';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

import { INSPECTOR_VIEW_TEXTS } from '../../../i18n/inspector-view.texts';
import { CollectionLoaderService } from '../../../services/collection-loader';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../services/data-source/data-source.port';
import { KindRegistryService } from '../../../services/kind-registry';
import { MarkdownRenderer } from '../../../services/markdown-renderer';
import { EmptyState } from '../../components/empty-state/empty-state';
import { LinkedNodesPanel } from '../../components/linked-nodes-panel/linked-nodes-panel';
import type {
  IFrontmatterAgent,
  IFrontmatterCommand,
  IFrontmatterSkill,
  TNodeKind,
  INodeView,
  TStability,
} from '../../../models/node';

const STABILITY_SEVERITY: Record<TStability, 'success' | 'info' | 'warn'> = {
  stable: 'success',
  experimental: 'info',
  deprecated: 'warn',
};

/**
 * Body fetch lifecycle. The body card switches its rendered branch off
 * this signal:
 *   - `idle` — no path selected yet (the parent template handles the
 *     no-selection empty state outside the body card).
 *   - `loading` — `getNode(path, {includeBody: true})` is in flight.
 *   - `empty` — fetch returned but the file is body-less (only frontmatter).
 *   - `unavailable` — fetch returned `body: null` (file missing on disk
 *     since the last scan, or the source went away mid-session).
 *   - `error` — markdown render or fetch threw.
 *   - `ready` — `bodyHtml()` is populated and ready to bind via [innerHTML].
 */
type TBodyState = 'idle' | 'loading' | 'empty' | 'unavailable' | 'error' | 'ready';

@Component({
  selector: 'app-inspector-view',
  imports: [RouterLink, NgTemplateOutlet, TagModule, ChipModule, CardModule, ButtonModule, TooltipModule, EmptyState, LinkedNodesPanel],
  templateUrl: './inspector-view.html',
  styleUrl: './inspector-view.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InspectorView implements OnInit {
  private readonly loader = inject(CollectionLoaderService);
  private readonly router = inject(Router);
  private readonly kindRegistry = inject(KindRegistryService);
  private readonly dataSource: IDataSourcePort = inject(DATA_SOURCE);
  private readonly markdown = inject(MarkdownRenderer);

  protected readonly texts = INSPECTOR_VIEW_TEXTS;

  readonly path = input<string | undefined>(undefined);

  readonly node = computed<INodeView | null>(() => {
    const path = this.path();
    if (!path) return null;
    return this.loader.nodes().find((n) => n.path === path) ?? null;
  });

  /** O(1) path lookup, rebuilt only when the loaded nodes change. */
  private readonly pathSet = computed<ReadonlySet<string>>(() => {
    const set = new Set<string>();
    for (const n of this.loader.nodes()) set.add(n.path);
    return set;
  });

  readonly asAgent = computed<IFrontmatterAgent | null>(() =>
    this.node()?.kind === 'agent' ? (this.node()!.frontmatter as IFrontmatterAgent) : null,
  );
  readonly asCommand = computed<IFrontmatterCommand | null>(() =>
    this.node()?.kind === 'command' ? (this.node()!.frontmatter as IFrontmatterCommand) : null,
  );
  readonly asSkill = computed<IFrontmatterSkill | null>(() =>
    this.node()?.kind === 'skill' ? (this.node()!.frontmatter as IFrontmatterSkill) : null,
  );

  /**
   * Body card state — drives the `@switch` in the template. The fetch
   * runs in an `effect` keyed on `path()`, so navigating between nodes
   * (or refreshing the live data after a `scan.completed`) re-fetches
   * automatically. A token guards against stale resolutions: if the
   * user clicks node B before A's fetch completes, A's resolution is
   * dropped and only B's lands in the signals.
   */
  protected readonly bodyState = signal<TBodyState>('idle');
  protected readonly bodyHtml = signal<SafeHtml | null>(null);
  private fetchToken = 0;

  /**
   * Dead-link verification (Step 14.5.b — hybrid mode).
   *
   * Heuristic: chips for `meta.supersededBy / supersedes / requires /
   * related` are styled `--dead` when the path isn't in `pathSet()`
   * (the in-memory `loader.nodes()` view). Cheap, instant, but lies
   * for paths that are *real-but-out-of-scope* (e.g. a project-scope
   * SPA scanning `.claude/` won't see global `~/.claude/agents/foo.md`
   * even though that file exists on disk).
   *
   * Verify icon: a question-mark on each heuristically-dead chip
   * fires `verifyDeadLink(path)` → `getNode(path)` against the BFF.
   * Result lands in `verifiedAlive` (200, false-positive — chip flips
   * to live + becomes navigable) or `verifiedDead` (404, confirmed
   * dead). Both sets are reset whenever `path()` changes so a fresh
   * inspector view doesn't carry verification state from the previous
   * node.
   */
  protected readonly verifiedAlive = signal<ReadonlySet<string>>(new Set());
  protected readonly verifiedDead = signal<ReadonlySet<string>>(new Set());
  protected readonly verifyInFlight = signal<ReadonlySet<string>>(new Set());

  constructor() {
    effect(() => {
      const path = this.path();
      const myToken = ++this.fetchToken;
      this.bodyHtml.set(null);
      // Reset per-node verification state so the previous inspector's
      // verifications don't bleed into the current view.
      this.verifiedAlive.set(new Set());
      this.verifiedDead.set(new Set());
      this.verifyInFlight.set(new Set());
      if (!path) {
        this.bodyState.set('idle');
        return;
      }
      this.bodyState.set('loading');
      void this.fetchAndRenderBody(path, myToken);
    });
  }

  ngOnInit(): void {
    if (this.loader.nodes().length === 0 && !this.loader.loading()) {
      void this.loader.load();
    }
  }

  kindLabel(kind: TNodeKind): string {
    return this.kindRegistry.labelOf(kind);
  }

  /**
   * Inline tag style derived from the runtime kind registry — replaces
   * the pre-14.5.d hardcoded `<p-tag severity>` mapping. Same `--sm-kind-<id>`
   * vars list-view uses, so kind tinting stays consistent app-wide.
   */
  kindStyle(kind: TNodeKind): Record<string, string> {
    return {
      background: `var(--sm-kind-${kind}-bg)`,
      color: `var(--sm-kind-${kind}-fg)`,
    };
  }

  stabilitySeverity(s: TStability): 'success' | 'info' | 'warn' {
    return STABILITY_SEVERITY[s];
  }

  openPath(path: string): void {
    void this.router.navigate(['/inspector'], { queryParams: { path } });
  }

  pathExists(path: string): boolean {
    return this.pathSet().has(path);
  }

  /**
   * Three-state classifier for a relation chip's path. The template
   * picks the css class + verify-icon variant off this. Order matters:
   * an explicit verify result wins over the in-memory heuristic, and
   * a path present in `pathSet()` is always considered live.
   *
   *   - `'live'` — known good (in scope OR confirmed by verify).
   *   - `'dead-confirmed'` — verify hit returned 404.
   *   - `'dead-heuristic'` — not in scope and not yet verified.
   */
  protected linkStatus(path: string): 'live' | 'dead-confirmed' | 'dead-heuristic' {
    if (this.pathSet().has(path)) return 'live';
    if (this.verifiedAlive().has(path)) return 'live';
    if (this.verifiedDead().has(path)) return 'dead-confirmed';
    return 'dead-heuristic';
  }

  protected isVerifying(path: string): boolean {
    return this.verifyInFlight().has(path);
  }

  /**
   * Fire a single-path verify against the BFF. Updates the verifiedAlive
   * / verifiedDead sets based on the result. Idempotent: a re-click on
   * a path that already verified does nothing (the sets persist for
   * the current node's lifetime). A verify in flight is also a no-op
   * to avoid double-fetching when the user double-clicks.
   */
  protected async verifyDeadLink(path: string): Promise<void> {
    if (this.verifiedAlive().has(path) || this.verifiedDead().has(path)) return;
    if (this.verifyInFlight().has(path)) return;
    this.verifyInFlight.update((s) => new Set(s).add(path));
    try {
      const detail = await this.dataSource.getNode(path);
      if (detail === null) {
        this.verifiedDead.update((s) => new Set(s).add(path));
      } else {
        this.verifiedAlive.update((s) => new Set(s).add(path));
      }
    } catch {
      // Network-level failure (server down, DNS, etc.). Treat as
      // unverified — leave the chip in its heuristic state. The user
      // can retry by clicking the icon again.
    } finally {
      this.verifyInFlight.update((s) => {
        const next = new Set(s);
        next.delete(path);
        return next;
      });
    }
  }

  /**
   * Manual refresh hook (Step 14.5.c). Wired to the body card's
   * header refresh button. Idempotent while a fetch is already in
   * flight (the button is disabled in the template while
   * `bodyState() === 'loading'`, and a fresh token would only orphan
   * the in-flight resolution anyway). No-op when no path is selected.
   */
  protected refreshBody(): void {
    const path = this.path();
    if (!path) return;
    if (this.bodyState() === 'loading') return;
    const myToken = ++this.fetchToken;
    this.bodyHtml.set(null);
    this.bodyState.set('loading');
    void this.fetchAndRenderBody(path, myToken);
  }

  private async fetchAndRenderBody(path: string, token: number): Promise<void> {
    try {
      const detail = await this.dataSource.getNode(path, { includeBody: true });
      if (token !== this.fetchToken) return;
      if (detail === null) {
        this.bodyState.set('unavailable');
        return;
      }
      const body = detail.item.body;
      if (body === null) {
        this.bodyState.set('unavailable');
        return;
      }
      if (body === undefined || body.trim().length === 0) {
        this.bodyState.set('empty');
        return;
      }
      const html = await this.markdown.render(body);
      if (token !== this.fetchToken) return;
      this.bodyHtml.set(html);
      this.bodyState.set('ready');
    } catch {
      if (token !== this.fetchToken) return;
      this.bodyState.set('error');
    }
  }
}
