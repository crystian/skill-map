#!/usr/bin/env node
/**
 * Deps-free static server for the skill-map demo bundle. Used by
 * Playwright's `webServer` so the smoke suite can exercise `web/demo/`
 * in its production shape (mounted under `/demo/`).
 *
 * Run from the `e2e/` workspace:
 *   node scripts/serve-demo.js [--port=4321]
 *
 * Behavior:
 *   - `web/demo/` (resolved relative to the repo root) is mounted at
 *     `/demo/`. Anything else 404s.
 *   - Any `/demo/*` request whose target file does not exist falls back
 *     to `/demo/index.html` (Angular hash-less router needs SPA fallback).
 *   - Mime type is inferred by file extension; unknown → octet-stream.
 *   - Logs a single ready line that Playwright matches via `url`.
 */

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');
const DEMO_ROOT = join(REPO_ROOT, 'web', 'demo');
const MOUNT = '/demo';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function parseArgs(argv) {
  const out = { port: 4321 };
  for (const arg of argv) {
    if (arg.startsWith('--port=')) out.port = Number(arg.slice('--port='.length));
  }
  return out;
}

function safeJoin(root, relPath) {
  // Normalize defends against `..` traversal — any path that escapes
  // `root` after normalization is rejected. A repeat-of-Express's
  // historical lesson: never trust the URL.
  const joined = normalize(join(root, relPath));
  if (!joined.startsWith(root)) return null;
  return joined;
}

function send(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(body);
}

function streamFile(res, absPath) {
  const ct = MIME[extname(absPath).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-store' });
  createReadStream(absPath).pipe(res);
}

function fileExists(p) {
  try {
    const s = statSync(p);
    return s.isFile();
  } catch {
    return false;
  }
}

function handle(req, res) {
  const url = new URL(req.url ?? '/', 'http://x');
  let pathname = url.pathname;

  if (!pathname.startsWith(MOUNT)) {
    send(res, 404, `Not under ${MOUNT}/`);
    return;
  }

  // Strip the mount prefix → relative to DEMO_ROOT.
  let rel = pathname.slice(MOUNT.length);
  if (rel === '' || rel === '/') rel = '/index.html';

  const abs = safeJoin(DEMO_ROOT, rel);
  if (!abs) {
    send(res, 400, 'Bad path');
    return;
  }

  if (fileExists(abs)) {
    streamFile(res, abs);
    return;
  }

  // SPA fallback — anything that does not resolve to a real file goes
  // through index.html so the Angular router can take over.
  const indexPath = join(DEMO_ROOT, 'index.html');
  if (fileExists(indexPath)) {
    streamFile(res, indexPath);
    return;
  }

  send(res, 404, `Not found (and no index.html in ${DEMO_ROOT})`);
}

const { port } = parseArgs(process.argv.slice(2));

if (!fileExists(join(DEMO_ROOT, 'index.html'))) {
  console.error(
    `[serve-demo] missing ${join(DEMO_ROOT, 'index.html')} — run \`npm run demo:build\` from the repo root first.`,
  );
  process.exit(2);
}

const server = createServer(handle);
server.listen(port, '127.0.0.1', () => {
  console.log(`[serve-demo] http://127.0.0.1:${port}${MOUNT}/ → ${DEMO_ROOT}`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
