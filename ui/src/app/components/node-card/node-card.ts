import { ChangeDetectionStrategy, Component, computed, inject, input, model, output } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import { MarkdownRenderer } from '../../../services/markdown-renderer';
import { setupInlineMarkdown } from '../../../services/markdown-inline-signal';
import { NODE_CARD_TEXTS } from '../../../i18n/node-card.texts';
import {
  type IFrontmatterAgent,
  type INodeStats,
  type INodeView,
  type ISummaryAgent,
  type ISummaryCommand,
  type ISummaryMarkdown,
  type ISummarySkill,
  type TSummary,
} from '../../../models/node';
import {
  surfaceContribution,
  compactNumber,
  effectiveStability,
  effectiveUserTags,
  effectiveVersion,
} from '../../../models/node-derived';
import type { INodeActivityStatsApi } from '../../../models/api';
import { pathBasenameForLink } from '../../../services/path-basename';
import { cssColorOrNull, cssKindNameOrFallback } from '../../../services/css-guard';
import { KindRegistryService } from '../../../services/kind-registry';
import { UsageTrackerService } from '../../services/usage-tracker';
import type { ISelectionView } from '../../../models/selection';
import { KindIcon } from '../kind-icon/kind-icon';
import { ViewContributionsHost } from '../view-contributions-host/view-contributions-host';

/**
 * Default selection state for the card when its host did not bind one
 * (files view, prototype harnesses). Three booleans rolled into one
 * record per the `ISelectionView` contract.
 */
const DEFAULT_SELECTION: ISelectionView = {
  selected: false,
  highlighted: false,
  dimmed: false,
  far: false,
};

/**
 * Graph node body. Visual contract for what every kind looks like in
 * the graph view: avatar (kind icon) + title + a row of physical
 * subtitle pills (tokens, bytes, days, version), an actions cluster
 * (LLM confidence %, expand chevron) and, when expanded, an LLM
 * summary block, the author description (scrollable), kind-specific
 * meta rows, and the deterministic issues list. Footer carries the
 * conditional stats (errors, warns, tools, links, external refs).
 *
 * Structural rule: this component is meant to live inline as a direct
 * content child of `[fNode]` in `<f-canvas>`. The `fNodeInput` /
 * `fNodeOutput` connectors stay as siblings of `<sm-node-card>` so
 * Foblex's `@ContentChildren` queries still find them. Do NOT wrap
 * the connectors inside this component or route the body through
 * `*ngTemplateOutlet`, see `foblex-flow` skill rule #10 / debug #10.
 */
@Component({
  selector: 'sm-node-card',
  imports: [KindIcon, TooltipModule, ViewContributionsHost],
  templateUrl: './node-card.html',
  styleUrl: './node-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'sm-gnode',
    '[attr.data-kind]': 'node().kind',
    '[class.sm-gnode--with-color]': '!!nodeColor()',
    '[class.sm-gnode--deprecated]': "stability() === 'deprecated'",
    '[class.sm-gnode--expanded]': 'expanded()',
    '[class.sm-gnode--selected]': 'selection().selected',
    '[class.sm-gnode--highlighted]': 'selection().highlighted',
    '[class.sm-gnode--dimmed]': 'selection().dimmed',
    '[class.sm-gnode--far]': 'selection().far',
    '[class.sm-gnode--executing]': 'executing()',
    '[style.--node-color]': 'nodeColor()',
    '[style.--accent]': 'kindAccentVar()',
    '[style.--kind-bg]': 'kindBgVar()',
    '[style.--kind-fg]': 'kindFgVar()',
  },
})
export class NodeCard {
  readonly node = input.required<INodeView>();
  readonly stats = input<INodeStats>({ linksIn: 0, linksOut: 0 });
  readonly summary = input<TSummary | null>(null);

  /**
   * Selection / highlight / dim bundle owned by the graph view's
   * `selectionState` helper. A single input avoids N × 3 function
   * calls per CD pass on dense graphs; the parent passes one Map
   * lookup result and the host bindings read three boolean fields off
   * it. Defaults to all-`false` so files-view and prototype harnesses
   * can mount the card without wiring selection state.
   */
  readonly selection = input<ISelectionView>(DEFAULT_SELECTION);

  /**
   * Live-activity state (spec/provider-activity.md): `true` while the
   * node's skill / agent / command is executing in the operator's AI
   * runtime. Owned by `NodeActivityService` and projected by the graph
   * view (one O(1) Set lookup per node); the card only paints the
   * `.sm-gnode--executing` glow. Defaults off so non-live contexts
   * (files view, prototypes) mount unchanged.
   */
  readonly executing = input<boolean>(false);

  /**
   * Literal tool name that lit the card (spec/provider-activity.md
   * §detail: `Skill`, `Read`, `Agent`, an MCP tool, provider raw
   * names). Owned by `NodeActivityService.executionDetails` and
   * projected by the graph view; rendered as a transient badge only
   * while `executing` is true, so it decays with the glow. `null`
   * (frames without detail, non-live contexts) renders nothing.
   */
  readonly executingDetail = input<string | null>(null);

  /**
   * Per-node execution stats (spec/provider-activity.md §Execution
   * stats), owned by `NodeActivityStatsService` and projected by the
   * graph view (one O(1) Map lookup per node). The card only paints
   * the counter pill; `null` (or a zero count) renders nothing, so
   * non-live contexts (files view, prototypes) mount unchanged.
   */
  readonly activity = input<INodeActivityStatsApi | null>(null);

  /**
   * Per-user favorite state. Owned by the graph / list / inspector view
   * (which projects it from the loaded `INodeView.isFavorite`); the card
   * is a pure presenter and emits `(favoriteToggle)` when the user
   * clicks the heart so the parent can fire the BFF call + update the
   * collection-loader optimistically.
   */
  readonly isFavorite = input<boolean>(false);
  readonly favoriteToggle = output<{ path: string; value: boolean }>();

  /**
   * Emitted when the user clicks a tag chip on the card. Carries the tag
   * string; the graph view forwards it to the same `onTagSelect` the
   * inspector header tags use, so a card-tag click selects every node
   * carrying that tag on the map (and frames them). Read-only contexts
   * that mount the card without wiring this output just ignore it.
   */
  readonly tagClick = output<string>();

  protected readonly texts = NODE_CARD_TEXTS;

  private readonly kindRegistry = inject(KindRegistryService);
  private readonly usageTracker = inject(UsageTrackerService);

  /**
   * Human-readable kind name for the icon-box hover tooltip. Reuses the
   * runtime registry label (the same string the kind palette shows), so
   * the map icon and the filter toolbar name a kind identically. Falls
   * back to the raw kind id when the registry has not ingested yet.
   */
  protected readonly kindLabel = computed<string>(() =>
    this.kindRegistry.labelOf(this.node().kind),
  );

  /**
   * Expand state as a two-way model so the parent (graph-view) can own
   * persistence. Defaults to collapsed; the chevron toggles it via
   * `toggleExpanded()`, which writes back through the model and lets
   * the parent persist to localStorage.
   */
  readonly expanded = model<boolean>(false);

  /**
   * Fast accessor for the agent frontmatter block. Narrows the union to
   * the matching shape so the template can read fields without casts.
   */
  protected readonly fmAgent = computed<IFrontmatterAgent | null>(() => {
    const n = this.node();
    return n.kind === 'agent' ? (n.frontmatter as IFrontmatterAgent) : null;
  });

  /** Kind-specific summary narrowing. */
  protected readonly summaryAgent = computed<ISummaryAgent | null>(() => {
    const s = this.summary();
    return s?.kind === 'agent' ? s : null;
  });
  protected readonly summarySkill = computed<ISummarySkill | null>(() => {
    const s = this.summary();
    return s?.kind === 'skill' ? s : null;
  });
  protected readonly summaryCommand = computed<ISummaryCommand | null>(() => {
    const s = this.summary();
    return s?.kind === 'command' ? s : null;
  });
  protected readonly summaryMarkdown = computed<ISummaryMarkdown | null>(() => {
    const s = this.summary();
    return s?.kind === 'markdown' ? s : null;
  });

  /**
   * True when any kind-specific LLM row has content. Gates the cluster
   * wrapper so it does not paint its padding around an empty body.
   * (The per-kind WHAT lines were dropped, the LLM panel / chat owns
   * that surface now; the remaining rows are kind-specific facets.)
   */
  protected readonly hasLlmCluster = computed<boolean>(() => {
    const s = this.summary();
    return s !== null && this.hasLlmContent(s);
  });

  private hasLlmContent(s: TSummary): boolean {
    switch (s.kind) {
      case 'markdown':
        return (s.topics?.length ?? 0) > 0 || (s.keyFacts?.length ?? 0) > 0;
      case 'agent':
        return Boolean(s.whenToUse) || Boolean(s.interactionStyle) || (s.capabilities?.length ?? 0) > 0;
      case 'skill':
        return (
          (s.recipe?.length ?? 0) > 0 ||
          (s.preconditions?.length ?? 0) > 0 ||
          (s.outputs?.length ?? 0) > 0 ||
          (s.sideEffects?.length ?? 0) > 0
        );
      case 'command':
        return Boolean(s.invocationExample) || (s.sideEffects?.length ?? 0) > 0;
      default:
        return false;
    }
  }

  /**
   * Card accent color. Catalog curation 2026-05-07: the canonical source
   * is the Anthropic vendor `frontmatter.color` enum (`red` / `blue` /
   * `green` / …) on agent kind (per the Claude provider's agent schema,
   * NOT `metadata.color`). Non-agent kinds have no override and fall back
   * to the kind-default palette via the `--accent` CSS var. Drives the
   * `sm-gnode--with-color` class and the `--node-color` host var.
   *
   * Per-provider accent is intentionally NOT painted: kind dictates the
   * visual (an agent reads as "an agent" first, not as a vendor-tinted
   * card); provider identity surfaces via the kind-icon glyph and the
   * chrome above the list, not via a colour override that fights the
   * kind visual. See `kind-icon.ts` for the matching resolver.
   */
  protected readonly nodeColor = computed<string | null>(() => {
    const n = this.node();
    if (n.kind !== 'agent') return null;
    const fm = n.frontmatter as Record<string, unknown>;
    // Allowlist-guarded: `color` is author-controlled and binds into a
    // CSS context (`--node-color`), so reject anything but a hex / named
    // colour to block `url(...)` beacons (see `css-guard.ts`).
    return cssColorOrNull(fm['color']);
  });

  /**
   * Kind-driven accent + icon tint. Resolves the runtime kind registry's
   * `--sm-kind-<kind>` / `-bg` / `-fg` CSS vars (injected by
   * `KindRegistryService.applyCssVars` from each Provider's declared
   * `ui.color`) with a neutral `markdown` fallback, then binds them to
   * the host so the colour lives in the kind declaration, NOT a hardcoded
   * per-kind list in `node-card.css`. The accent bar reads `--accent`;
   * `.sm-gnode__icon-box` inherits `--kind-bg` / `--kind-fg`. A
   * Provider-declared kind (e.g. Antigravity `workflow`) therefore paints
   * its own colour, icon glyph included, with no CSS change per kind.
   *
   * Kind names are constrained to `[a-zA-Z][a-zA-Z0-9_-]{0,63}` by the
   * kernel (`spec/schemas/node.schema.json#/properties/kind`), but since
   * 14.5.d kinds are plugin-declared open strings, so the interpolation
   * runs the value through `cssKindNameOrFallback` (the shared UI-side
   * guard) before it lands inside the `var()` name: a valid kind is kept
   * verbatim, anything off-pattern degrades to the neutral `markdown`
   * palette. Same defence-in-depth posture as `inspector-view`'s accent.
   */
  protected readonly kindAccentVar = computed<string>(
    () => `var(--sm-kind-${cssKindNameOrFallback(this.node().kind)}, var(--sm-kind-markdown))`,
  );
  protected readonly kindBgVar = computed<string>(
    () => `var(--sm-kind-${cssKindNameOrFallback(this.node().kind)}-bg, var(--sm-kind-markdown-bg))`,
  );
  protected readonly kindFgVar = computed<string>(
    () => `var(--sm-kind-${cssKindNameOrFallback(this.node().kind)}-fg, var(--sm-kind-markdown-fg))`,
  );

  private readonly markdown = inject(MarkdownRenderer);

  /**
   * Execution-counter pill state: the stats bundle when it carries a
   * non-zero count, `null` otherwise (pill hidden). A zero count is
   * indistinguishable from "no data" for the operator, so it never
   * paints a `0` pill.
   */
  protected readonly activityStats = computed<INodeActivityStatsApi | null>(() => {
    const a = this.activity();
    return a !== null && a.count > 0 ? a : null;
  });

  protected readonly activityCountShort = computed<string | null>(() => {
    const a = this.activityStats();
    return a === null ? null : compactNumber(a.count);
  });

  protected readonly activityTooltip = computed<string>(() => {
    const a = this.activityStats();
    return a === null ? '' : this.texts.activity.tooltip(a);
  });

  protected readonly activityA11y = computed<string>(() => {
    const a = this.activityStats();
    return a === null ? '' : this.texts.activity.a11y(a.count);
  });

  /** Pretty number formatting for bytes / tokens (e.g. 12420 → "12k"). */
  protected readonly bytesShort = computed<string | null>(() => {
    // A byte size is a FILE metric. Virtual / derived nodes (e.g. `mcp://…`)
    // have no backing file (`modifiedAtMs` absent), so their byte size is a
    // hard 0 that reads as meaningless "B 0"; hide the pill there, the way the
    // tokens pill already hides on a null count.
    if (this.node().modifiedAtMs === undefined) return null;
    const v = this.stats().bytesTotal;
    return v === undefined ? null : compactNumber(v);
  });
  protected readonly tokensShort = computed<string | null>(() => {
    const v = this.stats().tokensTotal;
    return v === undefined ? null : compactNumber(v);
  });

  /**
   * Card version label, see `effectiveVersion` for source contract
   * (sidecar `annotations.version` wins, legacy `metadata.version` is
   * the un-migrated fallback).
   *
   * The label follows the contribution claiming the VERSION surface
   * (`spec/view-slots.md` §Re-homed surfaces), same rule as the header
   * version chip and the tag chips (user call 2026-07-22): claiming
   * extension off -> no version on the card either, the data stays in
   * the `.sm`. Selected by declaration, never by extension id.
   */
  protected readonly version = computed(() =>
    surfaceContribution(this.node(), 'inspector.surface.version') !== null
      ? effectiveVersion(this.node())
      : null,
  );

  /**
   * Effective stability, see `effectiveStability` for source contract.
   */
  protected readonly stability = computed(() => effectiveStability(this.node()));

  /**
   * Tags · single-source. Tags come from the `.sm` sidecar
   * (`annotations.tags`) only; legacy `frontmatter.metadata.tags` is
   * the fallback for un-migrated `.md` files (see `effectiveUserTags`).
   * The former author source (`frontmatter.tags`) was retired, so the
   * card renders one chip style with no source discriminator.
   *
   * The chip row follows the contribution claiming the TAGS surface
   * (`spec/view-slots.md` §Re-homed surfaces), same rule as the
   * inspector's tag row (user call 2026-07-21): claiming extension off
   * -> no tag chips on the card either, the data stays in the `.sm`.
   * Selected by declaration, never by extension id.
   */
  protected readonly tagChips = computed<readonly string[]>(() =>
    surfaceContribution(this.node(), 'inspector.surface.tags') !== null
      ? effectiveUserTags(this.node())
      : [],
  );

  /** Top-3 chips rendered on the card. */
  protected readonly visibleTagChips = computed(() => this.tagChips().slice(0, 3));

  /** "+N more" suffix when the chip list overflows the visible cap. */
  protected readonly moreTagsCount = computed<number>(() =>
    Math.max(0, this.tagChips().length - 3),
  );

  protected readonly displayName = computed<string>(() => {
    const fm = this.node().frontmatter;
    if (fm.name) return fm.name;
    // Fallback when the .md has no parseable `name` (frontmatter
    // parse error, invalid frontmatter, or just a missing field):
    // derive a friendly title from the path instead of showing the
    // whole path verbatim. Skills live at `<dir>/<name>/SKILL.md`,
    // their useful identifier is the parent directory; everything
    // else uses the filename without the `.md` extension.
    return pathBasenameForLink(this.node().path);
  });

  /** Description shown in the scrollable read-only block. */
  protected readonly description = computed<string>(() => {
    return this.node().frontmatter.description ?? '';
  });

  /** Description rendered as inline markdown (emphasis / code spans / links). */
  protected readonly descriptionHtml = setupInlineMarkdown(this.description, this.markdown);

  protected toggleExpanded(event: MouseEvent): void {
    // Stop propagation so the parent [fNode] doesn't treat this as a
    // node click (which would select the node and trigger highlight).
    event.stopPropagation();
    this.expanded.update((v) => !v);
  }

  /**
   * Foblex claims the gesture on `mousedown` / `touchstart` (its
   * `SelectByPointer` claimant runs from a bubbling listener on the
   * `<f-flow>` host), so selection happens BEFORE any `click` handler
   * can stop it: expanding a card would select the node and pop the
   * inspector open. Swallowing the pointer-down on the chevron keeps
   * the toggle a pure local control, with no selection side effect.
   */
  protected stopPointerDown(event: Event): void {
    event.stopPropagation();
  }

  protected toggleFavorite(event: MouseEvent): void {
    event.stopPropagation();
    // Usage analytics (opt-in, default OFF): the star GESTURE counts; no
    // node path or state rides the event.
    this.usageTracker.trackFeature('favorite-toggle');
    const next = !this.isFavorite();
    this.favoriteToggle.emit({ path: this.node().path, value: next });
  }

  protected onTagClick(tag: string, event: MouseEvent): void {
    // Stop propagation so the click does not bubble to the parent
    // `[fNode]` host, which would select / open the node instead of
    // filtering by the tag.
    event.stopPropagation();
    this.tagClick.emit(tag);
  }
}
