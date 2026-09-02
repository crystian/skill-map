/**
 * `GraphPreferencesService`, user-tunable visual preferences for the
 * graph view, persisted in `localStorage` (per-browser, not synced).
 *
 * Today the service owns four signals:
 *
 *   - `connectionType`, edge shape (Foblex `EFConnectionType` catalog).
 *   - `layoutAlgorithm`, dagre algorithm (network-simplex / tight-tree
 *     / longest-path).
 *   - `layoutDirection`, dagre direction (TB / BT / LR / RL).
 *   - `layoutSpacing`, preset that drives `nodeGap` + `layerGap`. The
 *     toolbar control was removed, so this is pinned to the default
 *     ("Normal") rather than read from / written to localStorage; the
 *     graph engine still consumes it.
 *
 * Each signal mirrors a single `localStorage` key under `sm.graph.*`.
 * Reads defend against malformed / older payloads via the
 * per-catalog `is*` type guards; writes swallow quota errors. Keeping
 * each preference under its own key (rather than one bundled JSON
 * blob) means an unrelated migration cannot corrupt the rest, and the
 * Settings UI can flip one knob without re-serialising the others.
 *
 * Why a service instead of inlining the localStorage reads in
 * `graph-view.ts`:
 *   - The Settings modal (`<sm-settings-general>`) and the graph view
 *     share the same source of truth, a writable signal lets the
 *     graph re-render the next CD cycle when the user picks a new
 *     layout from the selectbutton without forcing a reload.
 *   - Bad / unknown values written by an older version (or by hand)
 *     get normalised once at boot rather than every read.
 */

import { Injectable, inject, signal } from '@angular/core';
import { EFConnectionType } from '@foblex/flow';

import {
  DEFAULT_LAYOUT_ALGORITHM,
  DEFAULT_LAYOUT_DIRECTION,
  DEFAULT_LAYOUT_SPACING,
  isLayoutAlgorithm,
  isLayoutDirection,
  type TLayoutAlgorithm,
  type TLayoutDirection,
  type TLayoutSpacing,
} from '../app/views/graph-view/layout-controls';
import { SKILL_MAP_EMBED } from './embed-mode';

/**
 * Foblex `EFConnectionType` literal subset, scoped for narrowing without
 * dragging the enum into every consumer. `bezier` exists in Foblex but is
 * deliberately NOT offered (user call 2026-08-10): visually it reads as a
 * near-twin of `adaptive-curve` without following the connector
 * orientation, so it only bloated the picker. A legacy stored `bezier`
 * sanitises back to the default on read.
 */
export type TConnectionType =
  | 'segment'
  | 'straight'
  | 'adaptive-curve';

/**
 * Default edge shape. `adaptive-curve` follows the connector orientation
 * pinned by `fInputConnectableSide` / `fOutputConnectableSide`, so
 * edges leave each card along the layout-direction axis and curve into
 * the next card, which reads cleaner than the orthogonal `segment`
 * default. Users can flip it from Settings → General.
 */
export const DEFAULT_CONNECTION_TYPE: TConnectionType = 'adaptive-curve';

/** Closed catalog used both for runtime validation (sanitise) and to drive the Settings selectbutton options. */
export const CONNECTION_TYPES: ReadonlyArray<TConnectionType> = [
  'segment',
  'straight',
  'adaptive-curve',
];

const CONNECTION_TYPE_KEY = 'sm.graph.connection-type';
const LAYOUT_ALGORITHM_KEY = 'sm.graph.layout-algorithm';
const LAYOUT_DIRECTION_KEY = 'sm.graph.layout-direction';

@Injectable({ providedIn: 'root' })
export class GraphPreferencesService {
  /**
   * Embedded boot (spec §"Embedded replay"): the framed map always
   * opens in the balanced layout, left to right, whatever the
   * visitor's own preference on the shared origin says (the layout
   * toolbar is hidden there, so nothing can change it either).
   */
  private readonly embed = inject(SKILL_MAP_EMBED, { optional: true }) !== null;
  private readonly _connectionType = signal<TConnectionType>(
    readStored(CONNECTION_TYPE_KEY, isConnectionType, DEFAULT_CONNECTION_TYPE),
  );
  private readonly _layoutAlgorithm = signal<TLayoutAlgorithm>(
    this.embed
      ? 'network-simplex'
      : readStored(LAYOUT_ALGORITHM_KEY, isLayoutAlgorithm, DEFAULT_LAYOUT_ALGORITHM),
  );
  private readonly _layoutDirection = signal<TLayoutDirection>(
    this.embed
      ? 'LEFT_RIGHT'
      : readStored(LAYOUT_DIRECTION_KEY, isLayoutDirection, DEFAULT_LAYOUT_DIRECTION),
  );
  // Pinned to the default: the spacing toolbar control was removed, so
  // there is no UI to change it and no stored value is read (a legacy
  // compact / spacious selection must not leak). The graph engine still
  // reads this signal; it simply always yields "Normal".
  private readonly _layoutSpacing = signal<TLayoutSpacing>(DEFAULT_LAYOUT_SPACING);

  /** Readable signal for graph-view (template) + selectbutton ngModel. */
  readonly connectionType = this._connectionType.asReadonly();
  readonly layoutAlgorithm = this._layoutAlgorithm.asReadonly();
  readonly layoutDirection = this._layoutDirection.asReadonly();
  readonly layoutSpacing = this._layoutSpacing.asReadonly();

  /**
   * Mutate the connection type. No-op when the new value equals the
   * current one, the signal's equality check would short-circuit
   * anyway but bailing earlier avoids a useless localStorage write.
   */
  setConnectionType(value: TConnectionType): void {
    if (this._connectionType() === value) return;
    this._connectionType.set(value);
    writeStored(CONNECTION_TYPE_KEY, value);
  }

  setLayoutAlgorithm(value: TLayoutAlgorithm): void {
    if (this._layoutAlgorithm() === value) return;
    this._layoutAlgorithm.set(value);
    writeStored(LAYOUT_ALGORITHM_KEY, value);
  }

  setLayoutDirection(value: TLayoutDirection): void {
    if (this._layoutDirection() === value) return;
    this._layoutDirection.set(value);
    writeStored(LAYOUT_DIRECTION_KEY, value);
  }

  /**
   * Map our wire literal to the Foblex enum value. Foblex accepts
   * either the enum or the raw string (the enum IS a string union),
   * so call sites can also use the signal directly, this helper just
   * documents the bridge for readers.
   */
  static toFoblexEnum(value: TConnectionType): EFConnectionType {
    return value as EFConnectionType;
  }
}

function readStored<T extends string>(
  key: string,
  guard: (value: unknown) => value is T,
  fallback: T,
): T {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return fallback;
  }
  if (!raw) return fallback;
  return guard(raw) ? raw : fallback;
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Quota exceeded or storage blocked, swallow (matches the rest
    // of the graph-view storage helpers).
  }
}

function isConnectionType(value: unknown): value is TConnectionType {
  return (
    typeof value === 'string' &&
    (CONNECTION_TYPES as ReadonlyArray<string>).includes(value)
  );
}
