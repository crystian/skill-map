/**
 * Runtime settings for skill-map.
 *
 * This is the canonical shape of the JSON the UI reads at runtime to
 * configure itself. Defaults below are compiled into the bundle; the
 * runtime configuration file (when implemented per ROADMAP §Configuration
 * and §"Step 14 — Distribution polish") overrides on a per-key basis.
 *
 * ## Hierarchy (low → high precedence, last wins)
 *
 *   1. `DEFAULT_SETTINGS` (this file, compile-time, always present).
 *   2. `~/.skill-map/settings.json`            — user, committed nowhere.
 *   3. `~/.skill-map/settings.local.json`      — user, machine-local.
 *   4. `<cwd>/.skill-map/settings.json`        — project, committed.
 *   5. `<cwd>/.skill-map/settings.local.json`  — project, gitignored.
 *
 * Plus a runtime escape hatch — `sm ui --config <path>` — that REPLACES
 * the four file layers entirely (single source override). Env vars / CLI
 * flags from the CLI command sit on top of all of the above.
 *
 * The CLI (`sm ui` sub-command, ROADMAP §Step 14) is the loader / merger:
 * it walks the hierarchy, merges, validates, and serves the resulting
 * object as `GET /config.json`. The UI fetches that URL once on boot
 * (`APP_INITIALIZER`) and caches the result.
 *
 * ## Why partial-everything
 *
 * Each branch is `Partial`-friendly so an override file may set a single
 * key without redeclaring siblings. Missing keys fall through to defaults.
 * This is intentionally lenient — config files are hand-edited, malformed
 * or partial input must never crash the app. The loader emits warnings
 * and falls back; only `--strict` turns those into errors.
 *
 * ## Validation
 *
 * Type guards in TS today (each side validates locally). When the contract
 * matures, `spec/runtime-settings.schema.json` becomes the source of truth
 * and AJV replaces the manual guards (ROADMAP §Step 14).
 */

/** Performance flags for the graph view. Each is independent; off-states
 * are zero-cost (no Foblex APIs touched, no extra template branches taken).
 * Source of the patterns: `libs/f-examples/nodes/stress-test` in the
 * Foblex/f-flow repository.
 */
export interface IGraphPerfFlags {
  /**
   * Enable Foblex's internal geometry cache (`[fCache]` on `<f-flow>`).
   * Connector positions and connection geometry are reused across redraws
   * (pan / zoom / drag). Safe ON by default — Foblex invalidates the
   * cache on relevant input changes.
   */
  readonly cache: boolean;

  /**
   * Render only nodes whose bounding box intersects the visible viewport
   * (plus a buffer). Uses `*fVirtualFor` from `@foblex/flow`. Beneficial
   * around 300+ visible nodes; below that the bookkeeping cost is
   * larger than the saved render cost. Off by default — flip to ON when
   * the perf HUD shows fps drops with large collections.
   */
  readonly virtualization: boolean;
}

export interface IGraphSettings {
  readonly perf: IGraphPerfFlags;
  /**
   * Show the floating performance HUD (FPS, frame time, optional expanded
   * tiers) in the bottom-left of the canvas. Default ON during prototype
   * phase — flip OFF in `settings.json` for cleaner screenshots / shipped
   * deployments where surfacing perf metrics to end users is undesirable.
   * Sibling of `perf` rather than nested inside it because this is UI
   * visibility, not an optimisation toggle. Future overlay toggles
   * (minimap, legend, kind-palette) land as additional siblings.
   */
  readonly perfHud: boolean;
}

export interface ISkillMapSettings {
  readonly graph: IGraphSettings;
}

export const DEFAULT_SETTINGS: ISkillMapSettings = {
  graph: {
    perf: {
      cache: true,
      virtualization: false,
    },
    perfHud: true,
  },
};
