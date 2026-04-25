/**
 * Browser-only stand-in for the kernel's reference detectors. Emits the
 * four canonical link kinds defined in `spec/schemas/link.schema.json`:
 *
 *   - `invokes`     — execution-level call. `/<command>` tokens in body.
 *   - `references`  — explicit reference. `@<handle>` or `[[wikilink]]`.
 *   - `mentions`    — informal text mention. Plain-text node-name match.
 *   - `supersedes`  — lifecycle. Declarative, from `metadata.supersedes[]`
 *                     or `metadata.supersededBy`.
 *
 * The first three (`invokes`/`references`/`mentions`) collapse to the
 * strongest kind per `(from, to)` pair so a body that mentions a target
 * via `@x` AND in plain text only renders one edge — `references`.
 * `supersedes` is independent (different dimension: lifecycle, not
 * reference) and always emits its own edge alongside any other.
 *
 * Replaced 1:1 by the kernel's detector output once Step 4 (Scan
 * end-to-end) lands. Same shape so the consumer swap is a single import.
 */

import type { INodeView } from '../models/node';

export type TLinkKind = 'invokes' | 'references' | 'mentions' | 'supersedes';

export interface IDetectedLink {
  from: string;
  to: string;
  kind: TLinkKind;
}

export function detectLinks(allNodes: readonly INodeView[]): IDetectedLink[] {
  const byHandle = buildHandleIndex(allNodes);
  const validPaths = new Set(allNodes.map((n) => n.path));

  const supersedes: IDetectedLink[] = [];
  const detected: IDetectedLink[] = [];

  for (const node of allNodes) {
    const meta = node.frontmatter.metadata ?? {};

    for (const target of meta.supersedes ?? []) {
      const to = resolveTarget(target, byHandle, validPaths);
      if (to && to !== node.path) supersedes.push({ from: node.path, to, kind: 'supersedes' });
    }
    if (typeof meta.supersededBy === 'string' && meta.supersededBy.length > 0) {
      const to = resolveTarget(meta.supersededBy, byHandle, validPaths);
      if (to && to !== node.path) supersedes.push({ from: node.path, to, kind: 'supersedes' });
    }

    for (const m of node.body.matchAll(/(?:^|[\s(`\[])\/([a-z][a-z0-9-]+)\b/gi)) {
      const to = byHandle.get(m[1].toLowerCase());
      if (to && to !== node.path) detected.push({ from: node.path, to, kind: 'invokes' });
    }

    for (const m of node.body.matchAll(/(?:^|[\s(`\[])@([a-z][a-z0-9-]+)\b/gi)) {
      const to = byHandle.get(m[1].toLowerCase());
      if (to && to !== node.path) detected.push({ from: node.path, to, kind: 'references' });
    }
    for (const m of node.body.matchAll(/\[\[([a-z][a-z0-9-]+)\]\]/gi)) {
      const to = byHandle.get(m[1].toLowerCase());
      if (to && to !== node.path) detected.push({ from: node.path, to, kind: 'references' });
    }

    for (const [handle, path] of byHandle) {
      if (path === node.path) continue;
      if (handle.length < 5) continue;
      const re = new RegExp(`(?:^|[^A-Za-z0-9-/@])${escapeRegex(handle)}(?![A-Za-z0-9-])`, 'i');
      if (re.test(node.body)) detected.push({ from: node.path, to: path, kind: 'mentions' });
    }
  }

  // Drop any detected (invokes/references/mentions) edge between a pair
  // that is already related via supersedes — the lifecycle relationship
  // wins, and the duplicate would render on top of the supersedes path
  // since both connect the same connector pair.
  const supersedesPairs = new Set<string>();
  for (const s of supersedes) {
    supersedesPairs.add(`${s.from} ${s.to}`);
    supersedesPairs.add(`${s.to} ${s.from}`);
  }
  const filteredDetected = detected.filter(
    (d) => !supersedesPairs.has(`${d.from} ${d.to}`),
  );
  return [...supersedes, ...collapseStrongest(filteredDetected)];
}

function buildHandleIndex(nodes: readonly INodeView[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const n of nodes) {
    const fmName = typeof n.frontmatter.name === 'string' ? n.frontmatter.name : '';
    if (fmName) map.set(fmName.toLowerCase(), n.path);
    const base = n.path.split('/').pop()?.replace(/\.md$/i, '');
    if (base) map.set(base.toLowerCase(), n.path);
  }
  return map;
}

function resolveTarget(
  raw: string,
  byHandle: Map<string, string>,
  validPaths: Set<string>,
): string | null {
  if (validPaths.has(raw)) return raw;
  return byHandle.get(raw.toLowerCase()) ?? null;
}

const KIND_RANK: Record<Exclude<TLinkKind, 'supersedes'>, number> = {
  invokes: 3,
  references: 2,
  mentions: 1,
};

function collapseStrongest(links: readonly IDetectedLink[]): IDetectedLink[] {
  const best = new Map<string, IDetectedLink>();
  for (const link of links) {
    if (link.kind === 'supersedes') continue;
    const key = `${link.from}\u0001${link.to}`;
    const existing = best.get(key);
    if (
      !existing ||
      KIND_RANK[link.kind as keyof typeof KIND_RANK] >
        KIND_RANK[existing.kind as keyof typeof KIND_RANK]
    ) {
      best.set(key, link);
    }
  }
  return [...best.values()];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
