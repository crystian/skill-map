/**
 * `sm refresh <node.path>` and `sm refresh --stale` — kernel-side CLI
 * verbs for the universal enrichment layer (spec § A.8).
 *
 * Both verbs re-run extractors against either a single node or the set of
 * nodes whose probabilistic enrichment rows are flagged `stale = 1`,
 * persisting the fresh outputs back into `node_enrichments`. Deterministic
 * extractors run for real and persist; probabilistic extractors require
 * the job subsystem (Step 10) and are stubbed for now — they emit a
 * stderr advisory and skip without touching their stale rows.
 *
 * The verbs read the node's body off disk (the persisted scan is the
 * source of truth for `node.path` and the extractor manifest set, but the
 * extractor itself wants the live body). They do NOT trigger a full scan —
 * the rest of the graph stays untouched.
 *
 * Exit code: 0 on a clean stub (with a clear stderr advisory when
 * probabilistic extractors were skipped). Operational failures (DB
 * missing, node not found, plugin load error bubbling up) → exit 2 / 5
 * per spec/cli-contract.md §Exit codes.
 *
 * Stub caveats — until the job subsystem ships:
 *
 *   - `--stale` only inspects probabilistic rows (those are the only ones
 *     that can be stale; det rows regenerate via the A.9 fine-grained
 *     scan cache and never carry the flag). The verb prints the count of
 *     skipped probabilistic invocations on stderr so the user knows the
 *     stale rows are still there.
 *   - `<node.path>` re-runs deterministic extractors against the live
 *     body and upserts their rows. Probabilistic extractors are skipped
 *     with the same stderr note. Useful today as a "force regenerate
 *     this node's deterministic enrichments" affordance, even though the
 *     stale workflow it ultimately serves is partial.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Command, Option } from 'clipanion';
import type { Kysely } from 'kysely';

import { listBuiltIns } from '../../extensions/built-ins.js';
import {
  runExtractorsForNode,
  type IEnrichmentRecord,
  type IExtractor,
  type IPersistedEnrichment,
  type Node,
  type ScanResult,
} from '../../kernel/index.js';
import { InMemoryProgressEmitter } from '../../kernel/adapters/in-memory-progress.js';
import {
  loadNodeEnrichments,
  loadScanResult,
} from '../../kernel/adapters/sqlite/scan-load.js';
import type { IDatabase } from '../../kernel/adapters/sqlite/schema.js';
import { tx } from '../../kernel/util/tx.js';
import { REFRESH_TEXTS } from '../i18n/refresh.texts.js';
import { ExitCode } from '../util/exit-codes.js';
import {
  composeScanExtensions,
  emptyPluginRuntime,
  loadPluginRuntime,
} from '../util/plugin-runtime.js';
import { tryWithSqlite, withSqlite } from '../util/with-sqlite.js';

const DEFAULT_PROJECT_DB = '.skill-map/skill-map.db';

/**
 * `sm refresh [<node.path>] [--stale]`
 *
 * Mutex: `--stale` and the positional `<node.path>` are mutually
 * exclusive. Exactly one MUST be supplied.
 */
export class RefreshCommand extends Command {
  static override paths = [['refresh']];

  static override usage = Command.Usage({
    category: 'Scan',
    description:
      'Refresh enrichment rows: granular (single node) or batch (every stale row).',
    details: `
      Re-runs Extractors against the node(s) and upserts their outputs into
      the universal enrichment layer (\`node_enrichments\`). Deterministic
      Extractors run for real and persist; probabilistic Extractors require
      the job subsystem (Step 10) and are stubbed for now — they emit a
      stderr advisory and skip without touching their stale rows.

      Layer separation: enrichments live separately from the author's
      frontmatter, which is immutable from any Extractor. Probabilistic
      enrichments track \`body_hash_at_enrichment\`; when the scan loop sees
      a body change, those rows are flagged \`stale = 1\` (NOT deleted, so
      the LLM cost is preserved) and surface here for refresh.

      Pass \`--stale\` to refresh every node carrying a stale row. Pass a
      positional \`<node.path>\` to refresh just that node. The two are
      mutually exclusive.
    `,
    examples: [
      ['Refresh a single node', '$0 refresh .claude/agents/architect.md'],
      ['Refresh every node with stale enrichments', '$0 refresh --stale'],
    ],
  });

  nodePath = Option.String({ name: 'node', required: false });
  stale = Option.Boolean('--stale', false, {
    description:
      'Refresh every node whose probabilistic enrichment row is flagged stale=1.',
  });
  noPlugins = Option.Boolean('--no-plugins', false, {
    description: 'Skip drop-in plugin discovery; use only the built-in extractor set.',
  });

  // The remaining cyclomatic count comes from CLI ergonomics that don't
  // benefit from further extraction: argument-validation guards (2),
  // try/catch around extract (2) + persist (2), `instanceof Error` per
  // catch, plus the `if (probSkipCount > 0)` advisory. The inner work
  // already lives in `#resolveTargetNodes` and `#runDetExtractorsAcrossNodes`.
  // eslint-disable-next-line complexity
  async execute(): Promise<number> {
    // --- argument validation ------------------------------------------------
    if (this.stale && this.nodePath !== undefined) {
      this.context.stderr.write(REFRESH_TEXTS.nodeAndStaleMutex);
      return ExitCode.Error;
    }
    if (!this.stale && this.nodePath === undefined) {
      this.context.stderr.write(REFRESH_TEXTS.noTargetSpecified);
      return ExitCode.Error;
    }

    const dbPath = resolve(process.cwd(), DEFAULT_PROJECT_DB);

    // --- plugin runtime -----------------------------------------------------
    const pluginRuntime = this.noPlugins
      ? emptyPluginRuntime()
      : await loadPluginRuntime({ scope: 'project' });
    for (const warn of pluginRuntime.warnings) {
      this.context.stderr.write(`${warn}\n`);
    }

    // We always want the built-in set + plugin set; refresh has no
    // `--no-built-ins` knob (refresh against an empty pipeline would
    // be a no-op, and the listBuiltIns import below keeps the registry
    // shape parity with `sm scan`).
    listBuiltIns(); // touch the built-in registry to surface load errors early.
    const composed = composeScanExtensions({ noBuiltIns: false, pluginRuntime });
    const allExtractors: IExtractor[] = composed?.extractors ?? [];

    // --- load DB-resident state --------------------------------------------
    const persisted = await tryWithSqlite(
      { databasePath: dbPath, autoBackup: false },
      async (adapter) => {
        const result = await loadScanResult(adapter.db);
        const enrichments = await loadNodeEnrichments(adapter.db);
        return { result, enrichments };
      },
    );
    if (!persisted) {
      this.context.stderr.write(
        tx(REFRESH_TEXTS.nodeNotFound, { nodePath: this.nodePath ?? '<stale>' }),
      );
      return ExitCode.NotFound;
    }

    // --- decide target nodes -----------------------------------------------
    const targetResult = this.#resolveTargetNodes(persisted);
    if (!targetResult.ok) return targetResult.exitCode;
    const targetNodes = targetResult.nodes;

    // --- run det extractors per node, count prob skips ---------------------
    let extractResult;
    try {
      extractResult = await this.#runDetExtractorsAcrossNodes(targetNodes, allExtractors);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.context.stderr.write(tx(REFRESH_TEXTS.refreshFailed, { message }));
      return ExitCode.Error;
    }
    const { freshDetEnrichments, probSkipCount, probSkipNodePaths } = extractResult;

    // --- persist fresh det enrichments -------------------------------------
    if (freshDetEnrichments.length > 0) {
      try {
        await withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
          await upsertEnrichments(adapter.db, freshDetEnrichments);
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.context.stderr.write(tx(REFRESH_TEXTS.refreshFailed, { message }));
        return ExitCode.Error;
      }
    }
    this.context.stdout.write(
      tx(REFRESH_TEXTS.detPersisted, { detCount: freshDetEnrichments.length }),
    );

    // --- prob stub advisory ------------------------------------------------
    if (probSkipCount > 0) {
      this.context.stderr.write(
        tx(REFRESH_TEXTS.probStubSkipped, {
          count: probSkipCount,
          nodeCount: probSkipNodePaths.size,
        }),
      );
    }

    return ExitCode.Ok;
  }

  /**
   * Decide which nodes the verb should refresh based on `--stale` /
   * `<nodePath>`. Writes the per-target advisory to stdout (or the
   * not-found / nothing-to-do message). Returns either the target list
   * or the exit code the caller should use.
   */
  #resolveTargetNodes(
    persisted: { result: ScanResult; enrichments: IPersistedEnrichment[] },
  ): { ok: true; nodes: Node[] } | { ok: false; exitCode: number } {
    const nodesByPath = new Map<string, Node>();
    for (const node of persisted.result.nodes) nodesByPath.set(node.path, node);

    if (this.stale) {
      const staleEnrichments = persisted.enrichments.filter((e) => e.stale);
      if (staleEnrichments.length === 0) {
        this.context.stdout.write(REFRESH_TEXTS.refreshingStaleNone);
        return { ok: false, exitCode: ExitCode.Ok };
      }
      const stalePaths = new Set(staleEnrichments.map((e) => e.nodePath));
      const nodes: Node[] = [];
      for (const path of stalePaths) {
        const node = nodesByPath.get(path);
        if (node) nodes.push(node);
      }
      this.context.stdout.write(
        tx(REFRESH_TEXTS.refreshingStale, {
          count: staleEnrichments.length,
          nodeCount: nodes.length,
        }),
      );
      return { ok: true, nodes };
    }

    const node = nodesByPath.get(this.nodePath!);
    if (!node) {
      this.context.stderr.write(
        tx(REFRESH_TEXTS.nodeNotFound, { nodePath: this.nodePath! }),
      );
      return { ok: false, exitCode: ExitCode.NotFound };
    }
    this.context.stdout.write(
      tx(REFRESH_TEXTS.refreshingNode, { nodePath: node.path }),
    );
    return { ok: true, nodes: [node] };
  }

  /**
   * For each target node: read its body off disk, run every applicable
   * deterministic extractor, count probabilistic skips. Probabilistic
   * extractors are deferred to the job subsystem (Step 10); refresh
   * just reports the count so the user knows which extractors were
   * skipped and on which nodes.
   */
  async #runDetExtractorsAcrossNodes(
    targetNodes: Node[],
    allExtractors: IExtractor[],
  ): Promise<{
    freshDetEnrichments: IEnrichmentRecord[];
    probSkipCount: number;
    probSkipNodePaths: Set<string>;
  }> {
    const freshDetEnrichments: IEnrichmentRecord[] = [];
    let probSkipCount = 0;
    const probSkipNodePaths = new Set<string>();

    for (const node of targetNodes) {
      let body: string;
      try {
        const raw = readFileSync(resolve(process.cwd(), node.path), 'utf8');
        body = stripFrontmatterFence(raw);
      } catch (err) {
        this.context.stderr.write(
          tx(REFRESH_TEXTS.refreshFailed, {
            message: `read failed for ${node.path}: ${err instanceof Error ? err.message : String(err)}`,
          }),
        );
        continue;
      }
      const fm = (node.frontmatter ?? {}) as Record<string, unknown>;
      const applicable = allExtractors.filter(
        (ex) => ex.applicableKinds === undefined || ex.applicableKinds.includes(node.kind),
      );
      for (const extractor of applicable) {
        if (extractor.mode === 'probabilistic') {
          probSkipCount += 1;
          probSkipNodePaths.add(node.path);
          continue;
        }
        const records = await runExtractorForEnrichment(extractor, node, body, fm);
        for (const record of records) freshDetEnrichments.push(record);
      }
    }

    return { freshDetEnrichments, probSkipCount, probSkipNodePaths };
  }
}

/**
 * Run a single Extractor against a node and return the enrichment records
 * it produced. Mirrors the orchestrator's per-(node, extractor) collection
 * step but is deliberately lighter — there is no link emission here, no
 * external pseudo-link partitioning, no scan-cache bookkeeping.
 *
 * Multiple `enrichNode` calls within the same `extract(ctx)` invocation
 * fold into a single record's `value` (last-write-wins per field), which
 * matches the orchestrator's contract.
 *
 * Exported for the test suite so it can drive a probe extractor directly
 * without bringing the whole CLI surface online.
 */
export async function runExtractorForEnrichment(
  extractor: IExtractor,
  node: Node,
  body: string,
  frontmatter: Record<string, unknown>,
): Promise<IEnrichmentRecord[]> {
  // Delegate to the kernel's shared loop (audit item V4 — refresh used
  // to hand-duplicate the extract-and-fold dance). Refresh stays scoped
  // to the enrichment layer, so emitted links are discarded; the
  // emitter is a throwaway in-memory instance because refresh doesn't
  // expose progress events.
  const result = await runExtractorsForNode({
    extractors: [extractor],
    node,
    body,
    frontmatter,
    bodyHash: node.bodyHash,
    emitter: new InMemoryProgressEmitter(),
  });
  return result.enrichments;
}

/**
 * Upsert a batch of enrichment records into `node_enrichments`. Mirrors
 * the orchestrator's persist path but stays scoped to `sm refresh`'s
 * single-table footprint — no replace-all, no stale flagging across
 * unrelated rows. Each record always lands with `stale = 0`: the verb
 * just refreshed it.
 */
async function upsertEnrichments(
  db: Kysely<IDatabase>,
  enrichments: IEnrichmentRecord[],
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    for (const enrichment of enrichments) {
      const row = {
        nodePath: enrichment.nodePath,
        extractorId: enrichment.extractorId,
        bodyHashAtEnrichment: enrichment.bodyHashAtEnrichment,
        valueJson: JSON.stringify(enrichment.value ?? {}),
        stale: 0,
        enrichedAt: enrichment.enrichedAt,
        isProbabilistic: enrichment.isProbabilistic ? 1 : 0,
      };
      await trx
        .insertInto('node_enrichments')
        .values(row)
        .onConflict((oc) =>
          oc.columns(['nodePath', 'extractorId']).doUpdateSet({
            bodyHashAtEnrichment: row.bodyHashAtEnrichment,
            valueJson: row.valueJson,
            stale: 0,
            enrichedAt: row.enrichedAt,
            isProbabilistic: row.isProbabilistic,
          }),
        )
        .execute();
    }
  });
}

/**
 * Strip a leading YAML frontmatter fence from `text`. Mirrors the
 * Provider's regex (`^---\r?\n[\s\S]*?\r?\n---\r?\n?`); if the close
 * fence is missing or the prefix is malformed, the helper returns the
 * original text unchanged — same fall-through as the Provider, where the
 * malformed-frontmatter extractor is responsible for surfacing the issue.
 */
function stripFrontmatterFence(text: string): string {
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!match) return text;
  return text.slice(match[0].length);
}

/** Aggregate export so `entry.ts` can register the refresh verb in one line. */
export const REFRESH_COMMANDS = [RefreshCommand];
