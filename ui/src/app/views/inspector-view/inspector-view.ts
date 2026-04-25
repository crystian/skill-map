import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TagModule } from 'primeng/tag';
import { ChipModule } from 'primeng/chip';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

import { INSPECTOR_VIEW_TEXTS } from '../../../i18n/inspector-view.texts';
import { CollectionLoaderService } from '../../../services/collection-loader';
import { EventBusService } from '../../../services/event-bus';
import type {
  IFrontmatterAgent,
  IFrontmatterCommand,
  IFrontmatterHook,
  IFrontmatterSkill,
  TNodeKind,
  INodeView,
  TStability,
} from '../../../models/node';

const KIND_SEVERITY: Record<TNodeKind, 'info' | 'success' | 'warn' | 'danger' | 'secondary'> = {
  skill: 'info',
  agent: 'success',
  command: 'warn',
  hook: 'danger',
  note: 'secondary',
};

const STABILITY_SEVERITY: Record<TStability, 'success' | 'info' | 'warn'> = {
  stable: 'success',
  experimental: 'info',
  deprecated: 'warn',
};

@Component({
  selector: 'app-inspector-view',
  imports: [RouterLink, TagModule, ChipModule, CardModule, ButtonModule, TooltipModule],
  templateUrl: './inspector-view.html',
  styleUrl: './inspector-view.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InspectorView implements OnInit {
  private readonly loader = inject(CollectionLoaderService);
  private readonly router = inject(Router);
  private readonly bus = inject(EventBusService);

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
  readonly asHook = computed<IFrontmatterHook | null>(() =>
    this.node()?.kind === 'hook' ? (this.node()!.frontmatter as IFrontmatterHook) : null,
  );
  readonly asSkill = computed<IFrontmatterSkill | null>(() =>
    this.node()?.kind === 'skill' ? (this.node()!.frontmatter as IFrontmatterSkill) : null,
  );

  ngOnInit(): void {
    if (this.loader.nodes().length === 0 && !this.loader.loading()) {
      void this.loader.load();
    }
  }

  kindSeverity(kind: TNodeKind): 'info' | 'success' | 'warn' | 'danger' | 'secondary' {
    return KIND_SEVERITY[kind];
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

  triggerDet(): void {
    const n = this.node();
    if (!n) return;
    this.bus.emit({
      family: 'scan',
      name: 'scan.progress',
      severity: 'info',
      message: INSPECTOR_VIEW_TEXTS.events.detProgress(n.path),
      data: { path: n.path, kind: n.kind },
    });
    setTimeout(() => {
      this.bus.emit({
        family: 'scan',
        name: 'scan.completed',
        severity: 'success',
        message: INSPECTOR_VIEW_TEXTS.events.detCompleted(n.path),
        data: { path: n.path },
      });
    }, 300);
  }

  triggerProb(): void {
    const n = this.node();
    if (!n) return;
    this.bus.emit({
      family: 'job',
      name: 'job.submitted',
      severity: 'info',
      message: INSPECTOR_VIEW_TEXTS.events.probSubmitted(n.kind, n.path),
      data: { path: n.path, kind: n.kind, action: `${n.kind}-summarizer` },
    });
    setTimeout(() => {
      this.bus.emit({
        family: 'job',
        name: 'job.completed',
        severity: 'success',
        message: INSPECTOR_VIEW_TEXTS.events.probCompleted(n.kind, n.path),
        data: { path: n.path },
      });
    }, 1500);
  }
}
