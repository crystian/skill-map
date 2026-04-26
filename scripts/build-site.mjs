#!/usr/bin/env node
/**
 * Builds the public site served at skill-map.dev.
 *
 * - Copies web/ → .tmp/site/ (the editable landing).
 * - Substitutes {{SPEC_VERSION}} placeholders in .tmp/site/index.html.
 * - Validates that each schema's `$id` matches its target URL exactly,
 *   then copies spec/schemas/**\/*.schema.json → .tmp/site/spec/v0/...
 * - Generates .tmp/site/spec/v0/index.html (the schema browse index).
 *
 * Zero dependencies. Node >= 22 ESM.
 */

import { readdir, readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';

const SCHEMA_SRC = 'spec/schemas';
const SPEC_PKG_PATH = 'spec/package.json';
const WEB_SRC = 'web';
const SITE_DST = '.tmp/site';
const SCHEMA_DST = '.tmp/site/spec/v0';
const I18N_SRC = 'web/i18n.json';
const LANDING_PATH = join(SITE_DST, 'index.html');

const DOMAIN = 'https://skill-map.dev';
const MAJOR = 'v0';
const SPEC_URL = `${DOMAIN}/spec/${MAJOR}`;

const REPO_URL = 'https://github.com/crystian/skill-map';
const PROSE_BASE = `${REPO_URL}/blob/main/spec`;
const NPM_PKG_URL = 'https://www.npmjs.com/package/@skill-map/spec';

const PROSE_DOCS = [
  { file: 'README.md', title: 'README', summary: 'Overview of the spec and what it defines.' },
  { file: 'versioning.md', title: 'Versioning', summary: 'Evolution policy, stability tags, deprecation window.' },
  { file: 'CHANGELOG.md', title: 'Changelog', summary: 'Normative history of spec changes.' },
  { file: 'architecture.md', title: 'Architecture', summary: 'Hexagonal ports & adapters, 6 extension kinds.' },
  { file: 'cli-contract.md', title: 'CLI contract', summary: 'Verbs, flags, exit codes, JSON introspection.' },
  { file: 'job-lifecycle.md', title: 'Job lifecycle', summary: 'Job state machine, atomic claim, TTL, reap.' },
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

function escapeAttr(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;');
}

/**
 * Render the landing for a single language.
 *
 * Replaces:
 *   - data-i18n="key"           → inner text of the tag (single-text-only)
 *   - data-i18n-<attr>="key"    → adds/overwrites <attr>="value"
 *   - <html lang="…">           → current lang
 *   - <a … data-lang="…">       → adds aria-current="page" if matches
 *   - {{SPEC_VERSION}}          → spec package.json version
 * Injects in <head>:
 *   - <link rel="alternate" hreflang> for every language + x-default
 */
function renderLanding(html, { lang, defaultLang, langs, version, dict }) {
  const lookup = (key) => {
    const e = dict[key];
    if (!e) return key;
    return e[lang] ?? e[defaultLang] ?? key;
  };

  // 1. data-i18n="key" — replace inner text. Single-line, single-text-content tags only.
  let out = html.replace(
    /(<[a-z][a-z0-9-]*\b[^>]*\sdata-i18n="([^"]+)"[^>]*>)([\s\S]*?)(<\/[a-z][a-z0-9-]*>)/gi,
    (_m, openTag, key, _inner, closeTag) => `${openTag}${escapeHtml(lookup(key))}${closeTag}`,
  );

  // 2. data-i18n-<attr>="key" — set/replace <attr> on the same tag.
  //    Strategy: rewrite the whole tag opening, removing any existing <attr>="…" first.
  out = out.replace(
    /<([a-z][a-z0-9-]*)\b([^>]*?)>/gi,
    (m, tag, attrs) => {
      if (!attrs.includes('data-i18n-')) return m;
      let next = attrs;
      next = next.replace(
        /\sdata-i18n-([a-z-]+)="([^"]+)"/g,
        (_mm, attr, key) => {
          // Remove any existing same-named attribute on this tag.
          next = next.replace(new RegExp(`\\s${attr}="[^"]*"`), '');
          return ` data-i18n-${attr}="${key}" ${attr}="${escapeAttr(lookup(key))}"`;
        },
      );
      return `<${tag}${next}>`;
    },
  );

  // 3. <html lang="…">
  out = out.replace(/<html\s+lang="[a-z]+"/i, `<html lang="${lang}"`);

  // 4. data-lang="…" on <a> — add aria-current="page" when active.
  out = out.replace(
    /<a\b([^>]*?)\sdata-lang="([a-z]+)"([^>]*)>/gi,
    (_m, before, langAttr, after) => {
      const cleanBefore = before.replace(/\saria-current="[^"]*"/g, '');
      const cleanAfter = after.replace(/\saria-current="[^"]*"/g, '');
      const aria = langAttr === lang ? ' aria-current="page"' : '';
      return `<a${cleanBefore} data-lang="${langAttr}"${cleanAfter}${aria}>`;
    },
  );

  // 5. {{SPEC_VERSION}}
  out = out.replaceAll('{{SPEC_VERSION}}', version);

  // 6. <link rel="alternate" hreflang> — inject before </head>.
  const alternates = [
    ...langs.map((l) => `  <link rel="alternate" hreflang="${l}" href="${DOMAIN}${l === defaultLang ? '/' : `/${l}/`}">`),
    `  <link rel="alternate" hreflang="x-default" href="${DOMAIN}/">`,
  ].join('\n');
  out = out.replace('</head>', `${alternates}\n</head>`);

  return out;
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

const INDEX_CSS = `
  :root {
    --bg: #0e1116;
    --fg: #e6edf3;
    --muted: #8b949e;
    --accent: #c084fc;
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
  .version-badge {
    display: inline-block;
    padding: 2px 10px;
    margin-left: 10px;
    background: var(--code-bg);
    border: 1px solid var(--accent);
    border-radius: 12px;
    font-size: 13px;
    font-weight: 400;
    vertical-align: middle;
  }
  .version-badge a { color: var(--accent); }
  .version-badge a:hover { text-decoration: none; color: var(--fg); }
  footer { margin-top: 80px; padding-top: 24px; border-top: 1px solid var(--border); color: var(--muted); font-size: 12px; }
`;

function renderSchemaIndex(items, version) {
  const g = groupSchemas(items);
  const npmVersionUrl = `${NPM_PKG_URL}/v/${version}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>skill-map spec / ${MAJOR} (v${escapeHtml(version)})</title>
<style>${INDEX_CSS}</style>
</head>
<body>
<main>
  <h1>spec <span class="dim">/ ${MAJOR}</span> <span class="version-badge"><a href="${escapeHtml(npmVersionUrl)}">v${escapeHtml(version)}</a></span></h1>
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

  <h2>Prose contracts</h2>
  <ul class="items">
${renderProseList()}
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
  if (!existsSync(WEB_SRC)) {
    throw new Error(`missing ${WEB_SRC}/ — the editable landing source must exist before build`);
  }

  if (existsSync(SITE_DST)) await rm(SITE_DST, { recursive: true });

  // 1. Copy the editable landing into the build output.
  //    Skip:
  //      - web/tmp/      (reference JSX/CSS dropped by the author for porting)
  //      - web/i18n.json (build-time only — translations are baked into HTML)
  await cp(WEB_SRC, SITE_DST, {
    recursive: true,
    filter: (src) => !src.includes(`${WEB_SRC}/tmp`)
                   && !src.endsWith('/i18n.json')
                   && !src.endsWith('\\i18n.json'),
  });

  // 2. Read the spec version + i18n dictionary, then render one HTML per language.
  const pkg = JSON.parse(await readFile(SPEC_PKG_PATH, 'utf8'));
  const version = pkg.version;
  if (!version) throw new Error(`${SPEC_PKG_PATH} has no "version" field`);

  const i18n = JSON.parse(await readFile(I18N_SRC, 'utf8'));
  const meta = i18n._meta ?? { default: 'en', langs: ['en'] };
  const langs = meta.langs ?? ['en'];
  const defaultLang = meta.default ?? langs[0];

  if (existsSync(LANDING_PATH)) {
    const sourceHtml = await readFile(LANDING_PATH, 'utf8');

    for (const lang of langs) {
      const rendered = renderLanding(sourceHtml, { lang, defaultLang, langs, version, dict: i18n });
      const outPath = lang === defaultLang
        ? LANDING_PATH
        : join(SITE_DST, lang, 'index.html');
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, rendered);
    }
    console.log(`✓ Landing rendered for: ${langs.join(', ')}`);
  } else {
    console.warn(`! ${LANDING_PATH} does not exist — landing rendering skipped`);
  }

  // 3. Validate every schema's $id matches its canonical URL, then mirror it.
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

  // 4. Generate the schema browse index.
  await writeFile(join(SCHEMA_DST, 'index.html'), renderSchemaIndex(validated, version));

  console.log(`✓ Validated ${validated.length} schemas.`);
  console.log(`✓ Site built at ${SITE_DST}/ (spec v${version}).`);
  console.log(`  Landing: ${LANDING_PATH}  (from ${WEB_SRC}/)`);
  console.log(`  Schemas: ${SCHEMA_DST}/`);
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
