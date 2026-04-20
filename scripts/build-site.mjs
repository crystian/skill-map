#!/usr/bin/env node
/**
 * Builds the public site served at skill-map.dev.
 *
 * - Copies every spec/schemas/**\/*.schema.json to site/spec/v0/... (dropping
 *   the `schemas/` path segment so the canonical URL is /spec/v0/<name>.schema.json).
 * - Validates that each schema's `$id` matches its target URL exactly.
 * - Generates site/index.html (landing) and site/spec/v0/index.html (schema index).
 *
 * Zero dependencies. Node >= 22 ESM.
 */

import { readdir, readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';

const SCHEMA_SRC = 'spec/schemas';
const SITE_DST = 'site';
const SCHEMA_DST = 'site/spec/v0';

const DOMAIN = 'https://skill-map.dev';
const MAJOR = 'v0';
const SPEC_URL = `${DOMAIN}/spec/${MAJOR}`;

const REPO_URL = 'https://github.com/crystian/skill-map';
const PROSE_BASE = `${REPO_URL}/blob/main/spec`;

const PROSE_DOCS = [
  { file: 'README.md', title: 'README', summary: 'Overview of the spec and what it defines.' },
  { file: 'versioning.md', title: 'Versioning', summary: 'Evolution policy, stability tags, deprecation window.' },
  { file: 'CHANGELOG.md', title: 'Changelog', summary: 'Normative history of spec changes.' },
  { file: 'architecture.md', title: 'Architecture', summary: 'Hexagonal ports & adapters, 6 extension kinds.' },
  { file: 'cli-contract.md', title: 'CLI contract', summary: 'Verbs, flags, exit codes, JSON introspection.' },
  { file: 'dispatch-lifecycle.md', title: 'Dispatch lifecycle', summary: 'Job state machine, atomic claim, TTL, reap.' },
  { file: 'job-events.md', title: 'Job events', summary: 'Canonical event stream emitted during execution.' },
  { file: 'prompt-preamble.md', title: 'Prompt preamble', summary: 'Verbatim injection-mitigation text prepended to every job.' },
  { file: 'db-schema.md', title: 'DB schema', summary: 'Zoned table catalog, naming conventions, migrations.' },
  { file: 'plugin-kv-api.md', title: 'Plugin KV API', summary: 'ctx.store contract for mode A + mode B dedicated rules.' },
  { file: 'interfaces/security-scanner.md', title: 'Security scanner interface', summary: 'Convention for third-party security scanners.' },
];

async function walkSchemas(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walkSchemas(full)));
    } else if (e.isFile() && e.name.endsWith('.schema.json')) {
      out.push(full);
    }
  }
  return out;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function groupSchemas(items) {
  const groups = { topLevel: [], frontmatter: [], summaries: [] };
  for (const item of items) {
    if (item.rel.startsWith('frontmatter/')) groups.frontmatter.push(item);
    else if (item.rel.startsWith('summaries/')) groups.summaries.push(item);
    else groups.topLevel.push(item);
  }
  for (const g of Object.values(groups)) g.sort((a, b) => a.rel.localeCompare(b.rel));
  return groups;
}

function renderSchemaList(items) {
  return items
    .map((it) => {
      const href = `/spec/${MAJOR}/${it.rel}`;
      return `<li>
    <a class="schema" href="${escapeHtml(href)}"><code>${escapeHtml(it.rel)}</code></a>
    <span class="title">${escapeHtml(it.title ?? '')}</span>
    <p class="desc">${escapeHtml(it.description ?? '')}</p>
  </li>`;
    })
    .join('\n');
}

function renderProseList() {
  return PROSE_DOCS.map(
    (d) => `<li>
    <a class="prose" href="${escapeHtml(PROSE_BASE)}/${escapeHtml(d.file)}"><code>${escapeHtml(d.file)}</code></a>
    <span class="title">${escapeHtml(d.title)}</span>
    <p class="desc">${escapeHtml(d.summary)}</p>
  </li>`
  ).join('\n');
}

const BASE_CSS = `
  :root {
    --bg: #0e1116;
    --fg: #e6edf3;
    --muted: #8b949e;
    --accent: #7ee787;
    --border: #30363d;
    --code-bg: #161b22;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); }
  body {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 14px;
    line-height: 1.6;
  }
  main { max-width: 960px; margin: 0 auto; padding: 48px 24px 96px; }
  h1 { font-size: 28px; font-weight: 600; margin: 0 0 8px; letter-spacing: -0.02em; }
  h1 .dim { color: var(--muted); font-weight: 400; }
  h2 { font-size: 18px; margin: 40px 0 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border); color: var(--accent); }
  p.lead { color: var(--muted); margin: 0 0 24px; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  code { background: var(--code-bg); padding: 2px 6px; border-radius: 4px; font-size: 13px; border: 1px solid var(--border); }
  ul.items { list-style: none; padding: 0; margin: 0; }
  ul.items li { padding: 12px 0; border-bottom: 1px solid var(--border); }
  ul.items li:last-child { border-bottom: none; }
  ul.items .title { color: var(--fg); margin-left: 8px; font-weight: 600; }
  ul.items .desc { color: var(--muted); margin: 4px 0 0; font-size: 13px; }
  .canonical { background: var(--code-bg); border: 1px solid var(--border); padding: 16px; border-radius: 8px; margin: 24px 0; }
  .canonical code { background: transparent; border: none; padding: 0; color: var(--accent); }
  footer { margin-top: 80px; padding-top: 24px; border-top: 1px solid var(--border); color: var(--muted); font-size: 12px; }
`;

function renderLanding(items) {
  const g = groupSchemas(items);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>skill-map spec</title>
<meta name="description" content="Vendor-neutral specification for mapping and managing AI-agent markdown ecosystems.">
<style>${BASE_CSS}</style>
</head>
<body>
<main>
  <h1>skill-map <span class="dim">spec</span></h1>
  <p class="lead">Vendor-neutral specification for mapping, inspecting, and managing collections of interrelated markdown files — skills, agents, commands, hooks, and notes.</p>

  <div class="canonical">
    <strong>Canonical URL</strong><br>
    <code>${escapeHtml(SPEC_URL)}/&lt;path&gt;.schema.json</code>
    <p style="margin: 8px 0 0; color: var(--muted); font-size: 12px;">Pre-1.0. <code>v0</code> throughout the unstable lifecycle; becomes <code>v1</code> at first stable cut.</p>
  </div>

  <h2>Top-level schemas</h2>
  <ul class="items">
${renderSchemaList(g.topLevel)}
  </ul>

  <h2>Frontmatter schemas</h2>
  <ul class="items">
${renderSchemaList(g.frontmatter)}
  </ul>

  <h2>Summary schemas</h2>
  <ul class="items">
${renderSchemaList(g.summaries)}
  </ul>

  <h2>Prose contracts</h2>
  <p class="lead">Rendered on GitHub. The spec on this site is the schemas; the prose below is what they enforce.</p>
  <ul class="items">
${renderProseList()}
  </ul>

  <footer>
    <p>Source: <a href="${escapeHtml(REPO_URL)}">${escapeHtml(REPO_URL.replace('https://', ''))}</a>
    &middot; MIT license
    &middot; <a href="${escapeHtml(REPO_URL)}/blob/main/spec/CHANGELOG.md">changelog</a></p>
  </footer>
</main>
</body>
</html>
`;
}

function renderSchemaIndex(items) {
  const g = groupSchemas(items);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>skill-map spec / ${MAJOR}</title>
<style>${BASE_CSS}</style>
</head>
<body>
<main>
  <h1>spec <span class="dim">/ ${MAJOR}</span></h1>
  <p class="lead">${items.length} JSON Schemas served from this path. Each <code>$id</code> equals its URL.</p>

  <h2>Top-level</h2>
  <ul class="items">
${renderSchemaList(g.topLevel)}
  </ul>

  <h2>Frontmatter</h2>
  <ul class="items">
${renderSchemaList(g.frontmatter)}
  </ul>

  <h2>Summaries</h2>
  <ul class="items">
${renderSchemaList(g.summaries)}
  </ul>

  <footer>
    <p><a href="/">← back to landing</a></p>
  </footer>
</main>
</body>
</html>
`;
}

async function main() {
  if (existsSync(SITE_DST)) await rm(SITE_DST, { recursive: true });
  await mkdir(SCHEMA_DST, { recursive: true });

  const files = await walkSchemas(SCHEMA_SRC);
  if (files.length === 0) throw new Error(`no schemas found under ${SCHEMA_SRC}/`);

  const validated = [];
  const errors = [];

  for (const src of files) {
    const rel = relative(SCHEMA_SRC, src).split('\\').join('/');
    const expectedId = `${SPEC_URL}/${rel}`;

    const content = await readFile(src, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      errors.push(`${src}: invalid JSON — ${e.message}`);
      continue;
    }

    if (parsed.$id !== expectedId) {
      errors.push(`${src}: $id mismatch\n    expected: ${expectedId}\n    actual:   ${parsed.$id ?? '(missing)'}`);
      continue;
    }

    const dst = join(SCHEMA_DST, rel);
    await mkdir(dirname(dst), { recursive: true });
    await cp(src, dst);
    validated.push({ src, rel, title: parsed.title, description: parsed.description });
  }

  if (errors.length > 0) {
    console.error(`✗ ${errors.length} schema error(s):\n`);
    for (const err of errors) console.error(`  ${err}\n`);
    process.exit(1);
  }

  await writeFile(join(SITE_DST, 'index.html'), renderLanding(validated));
  await writeFile(join(SCHEMA_DST, 'index.html'), renderSchemaIndex(validated));

  console.log(`✓ Validated ${validated.length} schemas.`);
  console.log(`✓ Site built at ${SITE_DST}/`);
  console.log(`  Landing: ${SITE_DST}/index.html`);
  console.log(`  Schemas: ${SCHEMA_DST}/`);
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
