/**
 * Action runtime contract. The fourth plugin kind (spec § A.4 +
 * `spec/schemas/extensions/action.schema.json`).
 *
 * Actions operate on one or more nodes in one of two execution modes:
 *
 *   - `deterministic` — code runs in-process; the action computes the
 *     report synchronously and returns it. No job file, no runner.
 *   - `probabilistic` — the kernel renders a prompt + preamble into a
 *     job file; a runner executes it via `RunnerPort` against an LLM;
 *     `sm record` closes the job and validates the report against
 *     `reportSchemaRef`.
 *
 * **Deferred runtime invocation.** The dispatcher (`Action.run(ctx)` for
 * deterministic; the `RunnerPort` + `sm record` round-trip for
 * probabilistic) lands with the job subsystem (Decision #114 in
 * `ROADMAP.md`). Today the loader still validates `kind: 'action'`
 * manifests against `extension-action.schema.json` and the registry
 * holds them — `sm actions show` and the precondition gating UI consume
 * the manifest data. The runtime entry point is intentionally absent
 * from `IAction` so plugin authors don't ship a method the kernel will
 * not call until the job subsystem is in place; when it ships, the
 * method shape will land here without breaking the manifest contract.
 *
 * Mirrors `extensions/action.schema.json`:
 *
 *   - `mode` (required) — discriminator between the two modes.
 *   - `reportSchemaRef` (required) — JSON Schema reference the report
 *     MUST validate against. MUST extend `report-base.schema.json`.
 *   - `promptTemplateRef` — REQUIRED when `mode: 'probabilistic'`,
 *     FORBIDDEN when `mode: 'deterministic'`. The schema's conditional
 *     `allOf` enforces both directions; the runtime contract simply
 *     surfaces the field as optional and lets the loader catch shape
 *     violations at AJV time.
 *   - `expectedDurationSeconds` — REQUIRED for probabilistic (drives
 *     TTL); advisory for deterministic.
 *   - `precondition` — declarative filter consumed by `--all` fan-out,
 *     UI button gating, `sm actions show`.
 *   - `expectedTools` — hint to Skill / CLI runners about expected
 *     tools (no normative enforcement in v0).
 *   - `fanOutPolicy` — `'per-node'` (default) vs `'batch'`.
 */

import type { IExtensionBase } from './base.js';
import type { TExecutionMode } from '../types.js';

/**
 * Declarative filter applied by `--all` fan-out, UI button gating, and
 * `sm actions show`. All fields optional — an empty precondition matches
 * every node.
 */
export interface IActionPrecondition {
  /**
   * Node kinds this action accepts. Open-by-design (matches
   * `node.schema.json#/properties/kind`): an action declared with
   * `kind: ['cursorRule']` is valid as long as some Provider classifies
   * into `cursorRule`. Omitted → any kind.
   */
  kind?: string[];
  /** Provider ids whose nodes this action accepts. Omitted → any Provider. */
  provider?: string[];
  /** Node stability filter. */
  stability?: Array<'experimental' | 'stable' | 'deprecated'>;
  /**
   * Free-form precondition strings the kernel forwards to the action for
   * runtime evaluation (example: `frontmatter.metadata.source != null`).
   */
  custom?: string[];
}

export interface IAction extends IExtensionBase {
  kind: 'action';
  /**
   * Execution mode discriminator. Required per
   * `extensions/action.schema.json`.
   */
  mode: TExecutionMode;
  /**
   * Reference to the JSON Schema the report MUST validate against. MUST
   * extend `report-base.schema.json` (directly or transitively).
   * Validation failure → job transitions to `failed` with reason
   * `report-invalid`.
   */
  reportSchemaRef: string;
  /**
   * Best-effort estimate of wall-clock duration in seconds. Drives TTL
   * (`ttl = max(expectedDurationSeconds × graceMultiplier,
   * minimumTtlSeconds)`). Required for `probabilistic`; advisory for
   * `deterministic`.
   */
  expectedDurationSeconds?: number;
  /**
   * Path (relative to the extension file) to the prompt template the
   * kernel renders at `sm job submit`. REQUIRED when `mode:
   * 'probabilistic'`; FORBIDDEN when `mode: 'deterministic'`. The
   * conditional shape is enforced by AJV at load time; the runtime
   * contract carries the field as optional so both modes share one
   * interface.
   */
  promptTemplateRef?: string;
  /**
   * Optional declarative filter; absent → applies to every node.
   */
  precondition?: IActionPrecondition;
  /**
   * Hint to Skill / CLI runners about what tools the rendered prompt
   * expects access to (`Bash`, `Read`, `WebSearch`, …). No normative
   * enforcement in v0.
   */
  expectedTools?: string[];
  /**
   * `'per-node'` (default): `sm job submit --all` produces one job per
   * matching node. `'batch'`: one job whose prompt template receives the
   * full list. Batch actions tend to hit context limits; use sparingly.
   */
  fanOutPolicy?: 'per-node' | 'batch';
}
