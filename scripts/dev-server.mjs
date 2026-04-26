#!/usr/bin/env node
/**
 * Local dev server for the public landing.
 *
 * - Initial build via scripts/build-site.mjs.
 * - Watches web/, spec/ and scripts/ recursively.
 * - On change: debounced rebuild, then push a reload event over SSE.
 * - Injects a tiny EventSource client into served HTML so the browser
 *   refreshes on its own. Works only when an HTML page is open.
 *
 * Zero dependencies. Node >= 22 ESM, recursive fs.watch.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { join, extname, normalize, sep } from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = '.tmp/site';
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || 'localhost';
const WATCH_DIRS = ['web', 'spec', 'scripts'];
const BUILD_CMD = ['node', 'scripts/build-site.mjs'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.schema.json': 'application/schema+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const RELOAD_CLIENTS = new Set();

const RELOAD_SNIPPET = `
<script>
  (() => {
    let es;
    function connect() {
      es = new EventSource('/__live');
      es.addEventListener('reload', () => location.reload());
      es.onerror = () => { try { es.close(); } catch {} setTimeout(connect, 500); };
    }
    connect();
  })();
</script>
`;

let building = false;
let pending = false;

function runBuild() {
  return new Promise((resolve, reject) => {
    const p = spawn(BUILD_CMD[0], BUILD_CMD.slice(1), { stdio: 'inherit' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`build exited ${code}`))));
    p.on('error', reject);
  });
}

async function build({ silent = false } = {}) {
  if (building) {
    pending = true;
    return;
  }
  building = true;
  try {
    const t = Date.now();
    if (!silent) console.log('· rebuilding...');
    await runBuild();
    console.log(`✓ rebuilt in ${Date.now() - t}ms`);
    for (const res of RELOAD_CLIENTS) {
      try {
        res.write('event: reload\ndata: 1\n\n');
      } catch {}
    }
  } catch (err) {
    console.error(`✗ build failed: ${err.message}`);
  } finally {
    building = false;
    if (pending) {
      pending = false;
      build({ silent: true });
    }
  }
}

function injectReload(buf) {
  const s = buf.toString('utf8');
  if (s.includes('</body>')) return Buffer.from(s.replace('</body>', `${RELOAD_SNIPPET}</body>`));
  return Buffer.from(s + RELOAD_SNIPPET);
}

function lookupMime(filePath) {
  if (filePath.endsWith('.schema.json')) return MIME['.schema.json'];
  return MIME[extname(filePath)] || 'application/octet-stream';
}

function safeJoin(root, urlPath) {
  const clean = normalize(urlPath).replace(/^([/\\])+/, '');
  const full = join(root, clean);
  if (!full.startsWith(root + sep) && full !== root) return null;
  return full;
}

const server = createServer(async (req, res) => {
  if (req.url === '/__live') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(': connected\n\n');
    RELOAD_CLIENTS.add(res);
    req.on('close', () => {
      RELOAD_CLIENTS.delete(res);
      try { res.end(); } catch {}
    });
    return;
  }

  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let filePath = safeJoin(ROOT, urlPath);
  if (filePath == null) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('bad path');
    return;
  }

  try {
    let s = await stat(filePath);
    if (s.isDirectory()) {
      filePath = join(filePath, 'index.html');
      s = await stat(filePath);
    }
    const data = await readFile(filePath);
    const mime = lookupMime(filePath);
    const headers = { 'Content-Type': mime, 'Cache-Control': 'no-store' };
    if (mime.startsWith('application/schema+json')) headers['Access-Control-Allow-Origin'] = '*';
    res.writeHead(200, headers);
    res.end(filePath.endsWith('.html') ? injectReload(data) : data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(injectReload(Buffer.from(`<!doctype html><meta charset="utf-8"><title>404</title>
<body style="background:#07070C;color:#F5F5FA;font:16px ui-sans-serif,system-ui,sans-serif;padding:48px">
<h1 style="margin:0 0 8px">404</h1>
<p style="color:#A8A8B8">no file at <code style="color:#C084FC">${urlPath}</code></p>
</body>`)));
  }
});

let debounceTimer = null;
function scheduleBuild(reason) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (reason) console.log(`· change detected: ${reason}`);
    build();
  }, 120);
}

const watchers = [];
for (const dir of WATCH_DIRS) {
  try {
    watchers.push(
      watch(dir, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        scheduleBuild(`${dir}/${filename}`);
      }),
    );
  } catch (err) {
    console.warn(`! cannot watch ${dir}/: ${err.message}`);
  }
}

await build({ silent: true });

server.listen(PORT, () => {
  const url = `http://${HOST}:${PORT}`;
  console.log(`\n▸ ${url}`);
  console.log(`  watching: ${WATCH_DIRS.map((d) => `${d}/`).join(', ')}`);
  console.log(`  ctrl+c to stop\n`);
});

function shutdown() {
  for (const w of watchers) {
    try { w.close(); } catch {}
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
