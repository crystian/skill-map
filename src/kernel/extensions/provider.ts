/**
 * Provider runtime contract. Walks filesystem roots and emits raw node
 * records; classification maps path conventions to a node kind.
 *
 * Distinct from the **hexagonal-architecture** 'adapter' (`RunnerPort.adapter`,
 * `StoragePort.adapter`, etc.). A `Provider` is an extension kind authored
 * by plugins to declare a platform's universe (the catalog of kinds it
 * emits, the per-kind frontmatter schema, the filesystem directory it
 * owns); a hexagonal adapter is an internal implementation of a port.
 * Both can coexist without confusion because they live in different
 * namespaces.
 *
 * `walk()` is an async iterator so large scopes don't buffer in memory.
 * Each yielded `IRawNode` carries the full parsed frontmatter + body plus
 * the path relative to the scan root; the kernel computes hashes, bytes,
 * and tokens on top.
 *
 * **Spec 0.8.0**. Per-kind frontmatter schemas relocated from the spec
 * to the Provider that owns them. The flat
 * `defaultRefreshAction` map collapsed into the new `kinds` map: every
 * kind the Provider emits gets one entry that declares both its schema
 * and its refresh action. Spec keeps only `frontmatter/base.schema.json`
 * (universal); per-kind schemas live with the Provider.
 */

import type { IExtensionBase } from './base.js';
import type { IIgnoreFilter } from '../scan/ignore.js';

export interface IRawNode {
  /** Path relative to the scan root that produced this node. */
  path: string;
  /** Raw markdown body (everything after the frontmatter fence). */
  body: string;
  /** Raw frontmatter text (between `---` fences). Empty string when absent. */
  frontmatterRaw: string;
  /** Parsed frontmatter, or `{}` when absent / unparseable. */
  frontmatter: Record<string, unknown>;
}

/**
 * One entry in a Provider's `kinds` map. Declares both the per-kind
 * frontmatter schema (path relative to the Provider's package dir, plus
 * the loaded JSON object the kernel passes to AJV) and the qualified
 * default refresh action id the UI dispatches for nodes of this kind.
 *
 * The split between `schema` (manifest-level path) and `schemaJson`
 * (runtime-loaded JSON) keeps the manifest shape spec-conformant while
 * letting the runtime instance carry the parsed schema without a second
 * filesystem read at scan time. Built-in Providers populate `schemaJson`
 * via `import schema from './schemas/skill.schema.json' with { type: 'json' }`;
 * user-plugin Providers loaded by `PluginLoader` will have it filled in
 * by the loader after manifest validation.
 */
export interface IProviderKind {
  /**
   * Path to the kind's frontmatter JSON Schema, relative to the
   * Provider's package directory. Mirrors the spec field of the same
   * name in `extensions/provider.schema.json#/properties/kinds/.../schema`.
   */
  schema: string;
  /**
   * Loaded JSON Schema document for the kind. The kernel registers this
   * with AJV at scan boot and validates each node's frontmatter against
   * it. The schema MUST extend the spec's
   * `frontmatter/base.schema.json` via `allOf` + `$ref` to base's
   * `$id`; the loader registers base into the same AJV instance so
   * cross-package `$ref`-by-`$id` resolves transparently.
   *
   * `unknown` rather than a stronger type because AJV consumes any JSON
   * Schema object; tightening to a concrete shape would require mirroring
   * the JSON Schema vocabulary in TypeScript.
   */
  schemaJson: unknown;
  /**
   * Qualified action id (`<plugin-id>/<action-id>`) the probabilistic-
   * refresh UI dispatches for nodes of this kind. The kernel resolves
   * the id against its qualified action registry; a dangling reference
   * disables the Provider with status `invalid-manifest`.
   */
  defaultRefreshAction: string;
  /**
   * Presentation metadata the UI consumes to render nodes of this kind
   * (palette swatches, list tags, graph nodes, filter chips). Required
   * so the UI never has to invent visuals for a Provider-declared kind.
   * Mirrors `extensions/provider.schema.json#/properties/kinds/.../ui`.
   */
  ui: IProviderKindUi;
}

/**
 * Presentation contract for one Provider kind. The Provider declares
 * intent (label + base color, optional dark variant + emoji + icon);
 * the UI derives `bg`/`fg` tints per theme via a deterministic helper
 * and reads the registry from the `kindRegistry` field embedded in REST
 * envelopes. Single source of truth for what a kind looks like — the
 * UI never hardcodes presentation for a built-in kind.
 */
export interface IProviderKindUi {
  /**
   * Plural human-readable label for groups of this kind (e.g. `'Skills'`,
   * `'Agents'`, `'Cursor Rules'`). Used in filter dropdowns, palette
   * tooltips, and any list grouping.
   */
  label: string;
  /**
   * Base hex color (`#RRGGBB`) for the light theme. The UI derives `bg`
   * and `fg` tints from this value at runtime via a deterministic
   * helper. Declaring one base value (instead of three) keeps the
   * manifest small and centralises accessibility-driven contrast in the
   * UI.
   */
  color: string;
  /**
   * Optional dark-theme variant of `color`. When absent, the UI falls
   * back to `color`. Declared explicitly because a luminosity flip
   * rarely matches the brand intent for kinds that should stand out in
   * dark mode.
   */
  colorDark?: string;
  /**
   * Optional decorative emoji used as a fallback when `icon` is absent
   * or fails to render. Length-bound so the UI can lay it out
   * predictably alongside text.
   */
  emoji?: string;
  /**
   * Optional discriminated icon descriptor. The UI prefers `icon` over
   * `emoji`; when both are absent, the UI falls back to the first
   * letter of `label` colored with `color`.
   */
  icon?: IProviderKindIcon;
}

/**
 * Discriminated icon contract. `pi` references a PrimeIcons identifier
 * (e.g. `'pi-cog'`); `svg` carries raw SVG path data the UI wraps in a
 * `<svg viewBox="0 0 24 24"><path d="…"/></svg>` element tinted with
 * `currentColor`. The discriminator (`kind`) keeps the UI dispatch
 * exhaustive without string-sniffing the payload.
 */
export type IProviderKindIcon =
  | { kind: 'pi'; id: string }
  | { kind: 'svg'; path: string };

export interface IProvider extends IExtensionBase {
  kind: 'provider';

  /**
   * Filesystem directory (relative to user home or project root) where this
   * Provider's content lives. Required. Examples: `'~/.claude'` for the
   * Claude Provider, `'~/.cursor'` for a hypothetical Cursor Provider.
   * The kernel walks this directory during boot/scan to discover nodes;
   * `sm doctor` validates the directory exists and emits a non-blocking
   * warning when it does not.
   */
  explorationDir: string;

  /**
   * Catalog of node kinds this Provider emits. Keyed by kind name. Every
   * kind the Provider can `classify()` MUST have an entry; an entry is
   * the union of the kind's frontmatter schema and its default refresh
   * action.
   *
   * The string keys are typed loosely (`string`) rather than `NodeKind`
   * because the value space is open by design: a future Cursor Provider
   * could declare `rule`, an Obsidian Provider could declare `daily`.
   * The kernel's hard-coded `NodeKind` union represents the kinds the
   * built-in Claude Provider emits; it is NOT the kernel-wide kind type
   * (see `kernel/types.ts:NodeKind` docstring). `Node.kind`, the AJV
   * `node.schema.json` validator, and the SQLite `scan_nodes.kind`
   * column all accept any non-empty string an enabled Provider returns.
   */
  kinds: Record<string, IProviderKind>;

  /**
   * Optional auxiliary JSON Schemas this Provider's per-kind schemas
   * `$ref` by `$id`. Registered with AJV via `addSchema` BEFORE the
   * per-kind schemas compile, so cross-file `$ref` resolution succeeds.
   *
   * Use case: when several kinds share a common base (e.g. Anthropic's
   * merged skill / command frontmatter — both extend a shared
   * `skill-base.schema.json`), the Provider declares the base here so
   * `skill.schema.json` and `command.schema.json` can `$ref` it without
   * duplicating fields.
   *
   * Runtime-only — does NOT appear in the spec's `provider.schema.json`
   * manifest. Manifest-validated schemas remain the per-kind ones in
   * `kinds[<kind>].schema`; auxiliary schemas are an implementation
   * concern of how the runtime composes those.
   */
  schemas?: unknown[];

  /**
   * Walk the given roots and yield every node the Provider recognises.
   * Non-matching files are silently skipped. Unreadable files produce
   * a diagnostic via the emitter but do not abort the walk.
   *
   * `options.ignoreFilter` — when supplied, the Provider MUST
   * skip every directory and file whose path-relative-to-root the
   * filter reports as ignored. Providers MAY also keep their own
   * hard-coded skip list (e.g. `.git`) as a defensive measure, but the
   * filter is the canonical source of user intent.
   */
  walk(
    roots: string[],
    options?: { ignoreFilter?: IIgnoreFilter },
  ): AsyncIterable<IRawNode>;

  /**
   * Given a path and its parsed frontmatter, decide the node kind. The
   * classifier is called after walk() yields — Providers MAY embed the
   * logic inside walk itself, but exposing it lets the kernel rebuild
   * classification during partial scans without re-walking.
   *
   * Returns an open `string`. The returned value MUST be a key of the
   * Provider's own `kinds` catalog; the orchestrator does not validate
   * the kind against `NodeKind`. External Providers (Cursor, Obsidian,
   * …) freely return their own kinds (e.g. `'cursorRule'`, `'daily'`).
   */
  classify(path: string, frontmatter: Record<string, unknown>): string;
}
