import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ToggleButtonModule } from 'primeng/togglebutton';

import { PERF_HUD_TEXTS } from '../../../i18n/perf-hud.texts';

/** Max samples retained for the FPS sparkline (one sample per second). */
const SPARKLINE_SAMPLES = 30;
/** CSS size of the sparkline canvas. */
const SPARKLINE_W = 60;
const SPARKLINE_H = 14;

/**
 * Compact performance HUD for the graph view. Displays FPS + frame time
 * always; click expands to heap (Chromium only), long-task count, DOM
 * node count, visible/total nodes, edge count and layout-cache age.
 *
 * Sampling runs OUTSIDE NgZone so the rAF loop does not trigger change
 * detection every frame. Signals are written once per second; OnPush
 * picks them up without zone involvement.
 *
 * No external dependencies — every metric comes from native browser
 * APIs (`requestAnimationFrame`, `performance.memory`, `PerformanceObserver`).
 */
@Component({
  selector: 'app-perf-hud',
  imports: [FormsModule, ToggleButtonModule],
  templateUrl: './perf-hud.html',
  styleUrl: './perf-hud.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PerfHud {
  /** Visible nodes count after filters. */
  readonly visible = input<number>(0);
  /** Total loaded nodes (pre-filter). */
  readonly total = input<number>(0);
  /** Visible edge count. */
  readonly edges = input<number>(0);
  /** `performance.now()` timestamp of the last full layout compute. */
  readonly cacheAt = input<number | null>(null);

  protected readonly texts = PERF_HUD_TEXTS;

  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);

  protected readonly fps = signal(0);
  protected readonly frameTimeMs = signal(0);
  /** Ring buffer of the last N FPS samples — drives the sparkline. */
  protected readonly fpsSamples = signal<readonly number[]>([]);
  private readonly sparklineCanvas = viewChild<ElementRef<HTMLCanvasElement>>('sparkline');
  protected readonly heapMb = signal<number | null>(null);
  protected readonly longTasks = signal(0);
  protected readonly domNodes = signal(0);
  /** Re-emitted every sample so the cacheAge computed re-evaluates. */
  protected readonly nowTick = signal(performance.now());
  protected readonly expanded = signal(readStoredExpanded());

  protected readonly cacheAgeSec = computed(() => {
    const at = this.cacheAt();
    if (at === null) return null;
    return Math.max(0, Math.floor((this.nowTick() - at) / 1000));
  });

  protected readonly hasHeap = computed(() => this.heapMb() !== null);

  constructor() {
    let frameCount = 0;
    let frameTimeAccum = 0;
    let lastFrameAt = performance.now();
    let lastSampleAt = lastFrameAt;
    let rafId = 0;

    const tick = (now: number): void => {
      const delta = now - lastFrameAt;
      lastFrameAt = now;
      frameCount += 1;
      frameTimeAccum += delta;

      if (now - lastSampleAt >= 1000) {
        const elapsedSec = (now - lastSampleAt) / 1000;
        const currentFps = Math.round(frameCount / elapsedSec);
        this.fps.set(currentFps);
        this.frameTimeMs.set(Math.round(frameTimeAccum / Math.max(frameCount, 1)));
        this.heapMb.set(readHeapMb());
        this.domNodes.set(document.querySelectorAll('*').length);
        this.nowTick.set(now);
        // Sample buffer is filled regardless of expanded state, so when
        // the user opens the HUD they see the last N seconds of history
        // instead of an empty canvas slowly filling.
        this.fpsSamples.update((arr) => {
          const next = arr.length >= SPARKLINE_SAMPLES ? arr.slice(1) : arr.slice();
          next.push(currentFps);
          return next;
        });
        frameCount = 0;
        frameTimeAccum = 0;
        lastSampleAt = now;
      }

      rafId = requestAnimationFrame(tick);
    };

    // Run rAF outside Angular: signals notify the view without zone.js,
    // so no per-frame change-detection cost beyond the once-per-second
    // signal writes above.
    this.zone.runOutsideAngular(() => {
      rafId = requestAnimationFrame(tick);
    });

    let observer: PerformanceObserver | null = null;
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        observer = new PerformanceObserver((list) => {
          this.longTasks.update((n) => n + list.getEntries().length);
        });
        observer.observe({ type: 'longtask', buffered: true });
      } catch {
        // longtask entry type isn't supported on Safari; skip silently.
      }
    }

    this.destroyRef.onDestroy(() => {
      cancelAnimationFrame(rafId);
      observer?.disconnect();
    });

    // Redraw the sparkline whenever the canvas appears (user expands the
    // HUD) or a new sample lands. The viewChild signal is `undefined`
    // while the @if branch is collapsed, so the effect simply no-ops.
    effect(() => {
      const ref = this.sparklineCanvas();
      const samples = this.fpsSamples();
      if (!ref) return;
      drawSparkline(ref.nativeElement, samples);
    });
  }

  setExpanded(value: boolean): void {
    this.expanded.set(value);
    writeStoredExpanded(value);
  }
}

const EXPANDED_STORAGE_KEY = 'sm.perf-hud.expanded';

function readStoredExpanded(): boolean {
  try {
    return localStorage.getItem(EXPANDED_STORAGE_KEY) === '1';
  } catch {
    // Storage may be unavailable (private mode); default to collapsed.
    return false;
  }
}

function writeStoredExpanded(value: boolean): void {
  try {
    localStorage.setItem(EXPANDED_STORAGE_KEY, value ? '1' : '0');
  } catch {
    // Quota exceeded or storage blocked — ignore.
  }
}

/**
 * `performance.memory` is non-standard and only exposed in Chromium-based
 * browsers. Returns megabytes rounded, or null where unavailable.
 */
function readHeapMb(): number | null {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  if (!mem) return null;
  return Math.round(mem.usedJSHeapSize / 1024 / 1024);
}

/**
 * Render a 1px stroke connecting `samples` across the canvas. Y range is
 * [0, max(60, observed peak)] so a steady 60-fps signal sits at the top
 * and any dip reads as a downward valley. Stroke colour follows the
 * canvas's inherited `color`, so the sparkline adapts to dark/light
 * without theme-aware CSS overrides.
 */
function drawSparkline(canvas: HTMLCanvasElement, samples: readonly number[]): void {
  const dpr = window.devicePixelRatio || 1;
  const targetW = SPARKLINE_W * dpr;
  const targetH = SPARKLINE_H * dpr;
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, SPARKLINE_W, SPARKLINE_H);

  if (samples.length < 2) return;

  const peak = Math.max(60, ...samples);
  const stepX = SPARKLINE_W / (samples.length - 1);

  ctx.beginPath();
  for (let i = 0; i < samples.length; i += 1) {
    const x = i * stepX;
    const y = SPARKLINE_H - (samples[i] / peak) * SPARKLINE_H;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = getComputedStyle(canvas).color;
  ctx.lineWidth = 1;
  ctx.stroke();
}
