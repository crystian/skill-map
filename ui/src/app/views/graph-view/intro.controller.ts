/**
 * Boot-intro controller for `<sm-graph-view>`: the map draws itself
 * once per mount.
 *
 * Owns a three-phase signal the host binds to two short-lived classes
 * (`intro-pending` / `intro-running`) that `graph-view.css` keys its
 * PRM-gated entrance treatment on:
 *
 *   - `pending`: from mount until the first dagre pass is RECONCILED
 *     into positions. Every card sits at (0, 0) meanwhile (the layout
 *     is async), so the cards and the edge layer stay invisible instead
 *     of flashing a pile at the origin.
 *   - `running`: positions are in place and the boot fit applied. Cards
 *     fade + rise in, staggered along the layout's diagonal, then the
 *     edges draw themselves source-to-target. Stays on for
 *     `INTRO_ANIMATION_MS`, sized to outlast the longest CSS timeline.
 *   - `done`: the classes drop; nothing about the intro remains in the
 *     DOM. Nodes mounted afterwards (WS refreshes, lens toggles, view
 *     switches) never replay it, the view-switch fade owns those.
 *
 * The trigger is `layoutReconciledAt`, the tick the reconcile effect
 * stamps once a dagre pass landed (the same data dependency the
 * camera's deferred boot fit keys on), NOT the raw layout tick and NOT
 * the node arrival: both fire while cards still have no position.
 *
 * Mirrors `setupLayoutFit`: a `setupX` factory
 * returning a small handle the host captures in a field initializer.
 * Reduced motion needs no probe here: every intro rule sits behind the
 * CSS `prefers-reduced-motion` gate, so under "animation effects off"
 * the classes toggle over an unchanged canvas.
 */

import { effect, signal, untracked, type DestroyRef, type Signal } from '@angular/core';

export type TIntroPhase = 'pending' | 'running' | 'done';

/**
 * How long the `intro-running` host class stays on. Must outlast the
 * longest timeline in graph-view.css: the card stagger
 * (`INTRO_SWEEP_MS` + 80ms lead + 420ms fade) and the edge draw-on
 * (300ms lead + 800ms). The markers (dot + arrowhead) are hidden for
 * the whole window and pop in when it closes, right as the lines
 * finish.
 */
export const INTRO_ANIMATION_MS = 1200;

/**
 * Span of the per-card stagger, spread over the layout's diagonal
 * (`GraphView.introDelayFor`): the top-left card starts at 0, the
 * bottom-right one this many ms later, so a top-down layout unfolds
 * rank by rank and a left-right one sweeps across.
 */
export const INTRO_SWEEP_MS = 600;

export interface IIntroConfig {
  destroyRef: DestroyRef;
  /**
   * Stamped by the host's reconcile effect with the `computedAt` of the
   * dagre pass it just folded into positions; `0` until the first pass.
   */
  layoutReconciledAt: Signal<number>;
  /** Override for tests; defaults to `INTRO_ANIMATION_MS`. */
  durationMs?: number;
}

export interface IIntroHandle {
  readonly phase: Signal<TIntroPhase>;
}

export function setupIntro(config: IIntroConfig): IIntroHandle {
  const phase = signal<TIntroPhase>('pending');
  const durationMs = config.durationMs ?? INTRO_ANIMATION_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;

  effect(() => {
    if (config.layoutReconciledAt() === 0) return;
    // First reconciled pass only: later stamps (drags, re-layouts, WS
    // refreshes) must never restart the intro. Reading `phase` untracked
    // keeps this effect keyed on the stamp alone.
    if (untracked(phase) !== 'pending') return;
    phase.set('running');
    timer = setTimeout(() => {
      timer = null;
      phase.set('done');
    }, durationMs);
  });

  config.destroyRef.onDestroy(() => {
    if (timer !== null) clearTimeout(timer);
  });

  return { phase: phase.asReadonly() };
}
