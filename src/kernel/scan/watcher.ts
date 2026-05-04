/**
 * File watcher for `sm watch` / `sm scan --watch`.
 *
 * Wraps `chokidar` behind a small `IFsWatcher` interface so:
 *
 *   1. The CLI command is impl-agnostic — swapping chokidar for a
 *      different watcher later (Java? Rust port? a future `WatchPort`?)
 *      doesn't ripple into the command.
 *   2. Debouncing, batching, and ignore-filter integration live in one
 *      place. The CLI just gets `onBatch(paths)` callbacks and decides
 *      whether to re-scan.
 *
 * The watcher does NOT call into the orchestrator itself. That decision
 * is deliberate: the CLI owns the scan-and-persist pipeline (`runScan`,
 * `persistScanResult`, optional rebuild of the ignore filter when
 * `.skillmapignore` itself changes). Pulling that into the watcher
 * would couple the kernel module to `SqliteStorageAdapter`, which the
 * Server wouldn't want. Keep this module side-effect free
 * apart from filesystem subscription.
 *
 * Ignore filter integration: the supplied `IIgnoreFilter` is consulted
 * via chokidar's `ignored` predicate, which receives an absolute path.
 * We re-derive the path RELATIVE to the closest matching root before
 * passing it through `IIgnoreFilter.ignores`. This mirrors what the
 * scan walker does (`extensions/providers/claude/index.ts`) so both code
 * paths agree on what "ignored" means.
 */

import { resolve, relative, sep } from 'node:path';

import chokidar from 'chokidar';
import type { FSWatcher } from 'chokidar';

import type { IIgnoreFilter } from './ignore.js';

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export type TWatchEventKind = 'add' | 'change' | 'unlink';

export interface IWatchEvent {
  kind: TWatchEventKind;
  /** Absolute path. */
  absolutePath: string;
}

export interface IWatchBatch {
  /** Events that arrived inside the debounce window, in arrival order. */
  events: IWatchEvent[];
  /** Convenience: deduplicated absolute paths across the batch. */
  paths: string[];
}

export interface IFsWatcher {
  /** Resolves once chokidar has finished its initial directory scan and is ready to emit. */
  ready: Promise<void>;
  /** Tear down the watcher. Resolves after chokidar releases handles. */
  close: () => Promise<void>;
}

export interface ICreateFsWatcherOptions {
  /** Roots to watch. Resolved relative to `cwd` if relative paths are passed. */
  roots: string[];
  /** Working directory used to resolve relative roots and the ignore-filter root. */
  cwd: string;
  /** Debounce window in milliseconds. `0` triggers `onBatch` synchronously per event. */
  debounceMs: number;
  /**
   * Optional ignore filter — same instance the scan walker uses.
   *
   * Two shapes are accepted:
   *
   *   - **`IIgnoreFilter`** (the static one) — captured by reference at
   *     construction. Use this when the filter never changes for the
   *     lifetime of the watcher (the typical CLI `sm watch` flow).
   *
   *   - **`() => IIgnoreFilter | undefined`** (a getter) — re-evaluated
   *     on EVERY chokidar `ignored` predicate call. Use this when the
   *     filter can change at runtime — e.g. the BFF rebuilds it after
   *     a `.skillmapignore` or `.skill-map/settings.json` edit and
   *     wants chokidar to immediately respect the new patterns without
   *     tearing down and rebuilding the watcher. A getter that returns
   *     `undefined` disables ignore filtering for that call.
   */
  ignoreFilter?: IIgnoreFilter | (() => IIgnoreFilter | undefined) | undefined;
  /** Called once per debounced batch. Awaited; concurrent batches are serialised. */
  onBatch: (batch: IWatchBatch) => void | Promise<void>;
  /**
   * Called when the underlying watcher surfaces an error. The watcher
   * stays open — callers decide whether to log, keep going, or close.
   */
  onError?: (err: Error) => void;
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Construct a chokidar-backed watcher. Subscribes immediately; the
 * returned `ready` promise resolves once chokidar's initial directory
 * walk completes, at which point only NEW events fire `onBatch`.
 *
 * The initial directory walk is deliberately silent — we set
 * `ignoreInitial: true`. The CLI runs a one-shot scan before flipping
 * the watcher on, so re-emitting an `add` for every existing file
 * would be redundant churn.
 */
export function createChokidarWatcher(opts: ICreateFsWatcherOptions): IFsWatcher {
  const absRoots = opts.roots.map((r) => resolve(opts.cwd, r));
  const ignoreFilterOpt = opts.ignoreFilter;

  // Normalise the union: the static filter shape becomes a constant getter.
  // Resolving the getter on every call is what enables the BFF to swap
  // filters at runtime without tearing the watcher down.
  const getFilter: (() => IIgnoreFilter | undefined) | undefined =
    ignoreFilterOpt === undefined
      ? undefined
      : typeof ignoreFilterOpt === 'function'
        ? ignoreFilterOpt
        : (): IIgnoreFilter => ignoreFilterOpt;

  const ignored = getFilter
    ? (path: string): boolean => {
        const filter = getFilter();
        if (!filter) return false;
        const rel = relativePathFromRoots(path, absRoots);
        if (rel === null) return false;
        return filter.ignores(rel);
      }
    : undefined;

  const watcher: FSWatcher = chokidar.watch(absRoots, {
    ignoreInitial: true,
    persistent: true,
    ...(ignored ? { ignored } : {}),
  });

  // Pending state for debouncing.
  let pending: IWatchEvent[] = [];
  let timer: NodeJS.Timeout | null = null;
  let inFlight: Promise<void> | null = null;
  let closed = false;

  const fire = async (): Promise<void> => {
    timer = null;
    if (pending.length === 0) return;
    if (inFlight) {
      // A previous batch is still running; let it finish first.
      // The current pending events stay queued and will fire in the
      // next tick once `inFlight` resolves.
      return;
    }
    const events = pending;
    pending = [];
    const seen = new Set<string>();
    const paths: string[] = [];
    for (const ev of events) {
      if (!seen.has(ev.absolutePath)) {
        seen.add(ev.absolutePath);
        paths.push(ev.absolutePath);
      }
    }
    inFlight = Promise.resolve(opts.onBatch({ events, paths }))
      .catch((err: unknown) => {
        if (opts.onError) {
          opts.onError(err instanceof Error ? err : new Error(String(err)));
        }
      })
      .finally(() => {
        inFlight = null;
        // If new events accumulated while we were busy, schedule
        // another fire. We respect the debounce window so a slow
        // `onBatch` doesn't immediately re-trigger.
        if (!closed && pending.length > 0 && timer === null) {
          schedule();
        }
      });
  };

  const schedule = (): void => {
    if (closed) return;
    if (opts.debounceMs <= 0) {
      void fire();
      return;
    }
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      void fire();
    }, opts.debounceMs);
  };

  const enqueue = (kind: TWatchEventKind, absolutePath: string): void => {
    if (closed) return;
    pending.push({ kind, absolutePath });
    schedule();
  };

  watcher.on('add', (p) => enqueue('add', p));
  watcher.on('change', (p) => enqueue('change', p));
  watcher.on('unlink', (p) => enqueue('unlink', p));
  if (opts.onError) {
    watcher.on('error', (err) => {
      opts.onError?.(err instanceof Error ? err : new Error(String(err)));
    });
  }

  const ready: Promise<void> = new Promise((resolveReady) => {
    watcher.once('ready', () => resolveReady());
  });

  const close = async (): Promise<void> => {
    closed = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = [];
    if (inFlight) {
      try {
        await inFlight;
      } catch {
        // already routed through onError above
      }
    }
    await watcher.close();
  };

  return { ready, close };
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Pick the matching root for `absolute` and return the path RELATIVE to
 * it, in POSIX form. Returns `null` when the path is outside every
 * supplied root (chokidar shouldn't emit those, but the contract on
 * `IIgnoreFilter.ignores` requires a relative path so we guard
 * defensively).
 */
function relativePathFromRoots(absolute: string, absRoots: string[]): string | null {
  for (const root of absRoots) {
    const rel = relative(root, absolute);
    if (rel === '' || rel === '.') return '';
    if (!rel.startsWith('..') && !rel.startsWith(`..${sep}`)) {
      return rel.split(sep).join('/');
    }
  }
  return null;
}
