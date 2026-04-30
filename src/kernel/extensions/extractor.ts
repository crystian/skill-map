/**
 * Extractor runtime contract. Consumes a single node (frontmatter + body)
 * and emits its output through three context-supplied callbacks rather than
 * a return value. Extractors run in isolation: they MUST NOT read other
 * nodes, the graph, or the DB. Cross-node reasoning lives in rules.
 *
 * Output channels (all on the context):
 *
 *   - `ctx.emitLink(link)` — persist a link in the kernel's `links` table.
 *     Validated against `emitsLinkKinds` before insertion; an off-contract
 *     kind drops the link and surfaces an `extension.error` event.
 *   - `ctx.enrichNode(partial)` — merge canonical, kernel-curated properties
 *     onto the node. Strictly separate from the author-supplied frontmatter
 *     (the latter remains immutable and survives verbatim). Persistence of
 *     the enrichment layer to the DB lands in Phase 4 (A.8 stale tracking);
 *     B.1 only sets the API contract — the orchestrator collects the partials
 *     in memory and currently discards them at scan completion.
 *   - `ctx.store` — plugin-scoped persistence. Present only when the
 *     plugin declares `storage.mode` in `plugin.json`; shape depends on the
 *     mode (`KvStore` for mode A, scoped `Database` for mode B). See
 *     `plugin-kv-api.md` for the contract.
 *   - `ctx.runner` — `RunnerPort` injection for `probabilistic` extractors.
 *     `undefined` for the default `deterministic` mode.
 *
 * The manifest's `scope` field tells the orchestrator which parts to feed:
 * `frontmatter` extractors receive an empty string for body and vice versa.
 *
 * Renamed from `Detector` in spec 0.8.x. The previous `detect(ctx) → Link[]`
 * signature is gone; everything now flows through `extract(ctx) → void`
 * and the callbacks above.
 */

import type { IExtensionBase } from './base.js';
import type { Confidence, Link, LinkKind, Node, TExecutionMode } from '../types.js';

/**
 * Output callbacks supplied by the kernel on the extractor context.
 * Split out so plugin authors can name the callback shape if they
 * want to mock it in unit tests without depending on the wider
 * `IExtractorContext`.
 */
export interface IExtractorCallbacks {
  /**
   * Emit a single Link. The orchestrator validates the link against the
   * extractor's declared `emitsLinkKinds` before inserting it; off-contract
   * links are silently dropped with an `extension.error` event.
   */
  emitLink(link: Link): void;

  /**
   * Merge canonical, kernel-curated properties onto the current node's
   * enrichment layer. The author-supplied frontmatter stays untouched
   * (Decision #109 in `ROADMAP.md`). B.1 sets the API contract only;
   * persistence to the DB is deferred to Phase 4 (A.8 stale tracking).
   * In-memory merges are still observable inside the same scan via the
   * orchestrator's enrichment buffer; cross-scan persistence lands later.
   */
  enrichNode(partial: Partial<Node>): void;
}

export interface IExtractorContext extends IExtractorCallbacks {
  node: Node;
  body: string;
  frontmatter: Record<string, unknown>;
  /**
   * Plugin-scoped persistence. Optional because not every plugin declares
   * a `storage.mode` in `plugin.json`. Shape: KV accessor for mode A,
   * scoped `Database` for mode B. See `spec/plugin-kv-api.md`.
   *
   * Typed as `unknown` here because the concrete `PluginStore` shape is
   * defined alongside the plugin storage runtime (which has not landed
   * in this kernel yet); narrowing happens at the callsite.
   */
  store?: unknown;
  /**
   * `RunnerPort` injection for `probabilistic` extractors. `undefined`
   * for `deterministic` mode (the default). The kernel rejects
   * probabilistic extractors that try to register scan-time hooks at
   * load time.
   */
  runner?: unknown;
}

export interface IExtractor extends IExtensionBase {
  kind: 'extractor';
  /**
   * Execution mode. Optional in the manifest with a default of
   * `deterministic` per `spec/schemas/extensions/extractor.schema.json`.
   * `probabilistic` extractors invoke an LLM through the kernel's
   * `RunnerPort` and never participate in scan-time pipelines —
   * they dispatch only as queued jobs.
   */
  mode?: TExecutionMode;
  emitsLinkKinds: LinkKind[];
  defaultConfidence: Confidence;
  scope: 'frontmatter' | 'body' | 'both';
  /**
   * Optional opt-in filter on `node.kind`. When declared, the orchestrator
   * skips invocation of `extract()` for any node whose `kind` is NOT in
   * this list — fail-fast, before context construction, so a
   * probabilistic extractor wastes zero LLM cost on inapplicable nodes
   * and a deterministic extractor wastes zero CPU.
   *
   * Absent (`undefined`) is the default: the extractor applies to every
   * kind. There are no wildcards — the absence of the field already
   * encodes "every kind". An empty array (`[]`) is rejected at load
   * time by AJV (`minItems: 1` in the schema).
   *
   * Unknown kinds (no installed Provider declares them) do NOT block
   * the load: the extractor keeps `loaded` status and `sm plugins doctor`
   * surfaces a warning. The Provider that declares the kind may arrive
   * later (e.g. a user installs the corresponding plugin).
   *
   * Spec: `spec/schemas/extensions/extractor.schema.json#/properties/applicableKinds`.
   */
  applicableKinds?: string[];

  /**
   * Extractor entry point. Returns nothing; output flows through
   * `ctx.emitLink`, `ctx.enrichNode`, and `ctx.store`.
   */
  extract(ctx: IExtractorContext): void | Promise<void>;
}
