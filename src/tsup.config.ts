import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'tsup';

/**
 * Post-build pass: restore `from "node:sqlite"` specifiers that esbuild
 * strips down to bare `"sqlite"`. Esbuild rewrites the canonical form
 * of every Node built-in import (`node:fs` → `fs`, `node:path` → `path`,
 * etc.) which is harmless for the resolvable-without-prefix built-ins
 * but BREAKS `node:sqlite` — Node only exposes the SQLite module under
 * the prefixed specifier, so the bundle would try to resolve a bare
 * `"sqlite"` against node_modules and fail at startup.
 *
 * Verified workarounds that did NOT solve this:
 *
 *   - `external: ['node:sqlite']` in tsup config: esbuild marks the
 *     specifier as external but still strips the prefix.
 *   - `external: [/^node:/]` regex: same outcome.
 *   - `esbuildOptions(o) { o.packages = 'external' }`: would also mark
 *     real npm deps as external, defeating the bundle.
 *
 * The `replaceAll('from "sqlite"', 'from "node:sqlite"')` below is
 * narrow — it only runs on `.js` outputs in `dist/`, and the only
 * place in the source tree that imports `sqlite` is the storage
 * adapter (always with the `node:` prefix). False positives would
 * require a string literal or comment containing exactly
 * `from "sqlite"` which the source intentionally never has.
 */
function restoreNodeSqliteImports(dir: string): void {
  for (const name of readdirSync(dir, { recursive: true })) {
    const file = join(dir, String(name));
    if (!file.endsWith('.js')) continue;
    const src = readFileSync(file, 'utf8');
    const fixed = src.replaceAll('from "sqlite"', 'from "node:sqlite"');
    if (fixed !== src) writeFileSync(file, fixed);
  }
}

export default defineConfig({
  entry: {
    index: 'index.ts',
    'kernel/index': 'kernel/index.ts',
    'conformance/index': 'conformance/index.ts',
    cli: 'cli/entry.ts',
  },
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: true,
  outDir: 'dist',
  banner: ({ format }) => {
    if (format === 'esm') return { js: '' };
    return {};
  },
  esbuildOptions(options) {
    options.conditions = ['node'];
  },
  async onSuccess() {
    if (existsSync('migrations')) {
      cpSync('migrations', 'dist/migrations', { recursive: true });
    }
    if (existsSync('config/defaults')) {
      cpSync('config/defaults', 'dist/config/defaults', { recursive: true });
    }
    restoreNodeSqliteImports('dist');
  },
});
