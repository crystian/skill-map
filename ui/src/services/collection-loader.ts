/**
 * Loads the mock collection at runtime by fetching /mock-collection/index.json,
 * then fetching each .md listed there and parsing its frontmatter + body.
 *
 * Simulates what `sm scan` will later do on disk — but in the browser, against
 * the build-time assets served under /mock-collection/. The kernel's real scan
 * pipeline is NOT consumed here; this is the Step 0c prototype's sole data
 * source.
 */

import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { load as parseYaml } from 'js-yaml';
import { firstValueFrom } from 'rxjs';

import { COLLECTION_LOADER_TEXTS } from '../i18n/collection-loader.texts';
import type {
  IMockIndex,
  TFrontmatter,
  TNodeKind,
  INodeView,
} from '../models/node';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const MOCK_BASE = '/mock-collection';

@Injectable({ providedIn: 'root' })
export class CollectionLoaderService {
  private readonly http = inject(HttpClient);

  private readonly _nodes = signal<INodeView[]>([]);
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);

  readonly nodes = this._nodes.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly count = computed(() => this._nodes().length);
  readonly byKind = computed(() => {
    const buckets: Record<TNodeKind, INodeView[]> = {
      skill: [],
      agent: [],
      command: [],
      hook: [],
      note: [],
    };
    for (const node of this._nodes()) {
      buckets[node.kind].push(node);
    }
    return buckets;
  });

  async load(): Promise<void> {
    if (this._loading()) return;
    this._loading.set(true);
    this._error.set(null);
    try {
      const index = await firstValueFrom(
        this.http.get<IMockIndex>(`${MOCK_BASE}/index.json`),
      );
      const files = await Promise.all(
        index.paths.map((p) => this.fetchOne(p)),
      );
      this._nodes.set(files.filter((n): n is INodeView => n !== null));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._error.set(msg);
    } finally {
      this._loading.set(false);
    }
  }

  private async fetchOne(relPath: string): Promise<INodeView | null> {
    const url = `${MOCK_BASE}/${relPath}`;
    const raw = await firstValueFrom(
      this.http.get(url, { responseType: 'text' }),
    );
    const parsed = this.parseFrontmatter(raw);
    if (!parsed) {
      console.warn(COLLECTION_LOADER_TEXTS.warnNoFrontmatter(relPath));
      return null;
    }
    return {
      path: relPath,
      kind: classifyKind(relPath, parsed.frontmatter),
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      raw,
      mockSummary: deriveMockSummary(parsed.body, parsed.frontmatter),
    };
  }

  private parseFrontmatter(
    raw: string,
  ): { frontmatter: TFrontmatter; body: string } | null {
    const match = FRONTMATTER_RE.exec(raw);
    if (!match) return null;
    try {
      const fm = parseYaml(match[1]) as TFrontmatter;
      return { frontmatter: fm, body: match[2] };
    } catch (err) {
      console.warn(COLLECTION_LOADER_TEXTS.warnYamlParseFailed, err);
      return null;
    }
  }
}

/**
 * Deterministic kind classifier for the prototype. Matches the directory
 * convention used in ui/mock-collection (`.claude/<plural>/` + `notes/` +
 * top-level README). Not a substitute for the real claude adapter in `src/` —
 * that one will classify based on the adapter's own rules at Step 2.
 */
function deriveMockSummary(body: string, fm: TFrontmatter): string | null {
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  if (lines.length > 0) return lines[0];
  return fm.description ?? null;
}

function classifyKind(path: string, fm: TFrontmatter): TNodeKind {
  if (path.startsWith('.claude/agents/')) return 'agent';
  if (path.startsWith('.claude/commands/')) return 'command';
  if (path.startsWith('.claude/hooks/')) return 'hook';
  if (path.startsWith('.claude/skills/')) return 'skill';
  if (path.startsWith('notes/')) return 'note';
  if (typeof fm.type === 'string') {
    const hint = fm.type.toLowerCase();
    if (
      hint === 'agent' ||
      hint === 'command' ||
      hint === 'hook' ||
      hint === 'skill' ||
      hint === 'note'
    ) {
      return hint;
    }
  }
  return 'note';
}
