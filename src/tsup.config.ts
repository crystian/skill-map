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
    copyTutorialSkill();
    copyUiBundle();
    restoreNodeSqliteImports('dist');
  },
});

/**
 * Copy the `sm-tutorial` SKILL.md from `.claude/skills/sm-tutorial/` (repo
 * root) into `dist/cli/tutorial/sm-tutorial.md` so the published tarball
 * ships the file the `sm tutorial` verb materializes. The runtime
 * resolver in `src/cli/commands/tutorial.ts` walks both layouts (dev →
 * repo source; bundled → this copy).
 *
 * Soft-fail: when running outside the monorepo (rare — we only build
 * inside `src/`), warn and move on instead of failing the CLI build.
 * The runtime resolver still falls back to the repo-source candidate
 * in dev mode, and the verb surfaces `sourceMissing` to users in the
 * pathological case where neither path resolves.
 */
function copyTutorialSkill(): void {
  const source = '../.claude/skills/sm-tutorial/SKILL.md';
  if (!existsSync(source)) {
    process.stderr.write(
      `tsup: skipping sm-tutorial copy — ${source} not found ` +
      '(expected at repo root; required for `sm tutorial` to ship its payload).\n',
    );
    return;
  }
  // Ensure the destination dir exists, then copy with the published
  // filename (`sm-tutorial.md`) — matches what the verb writes to cwd.
  cpSync(source, 'dist/cli/tutorial/sm-tutorial.md');
}

/**
 * Copy the Angular SPA build output into `dist/ui/` so the published
 * `@skill-map/cli` tarball ships the UI inside the package. The
 * runtime resolver in `src/server/paths.ts` looks here first when no
 * `--ui-dist` is given, which is what end users hit after `npm i -g
 * @skill-map/cli`.
 *
 * Soft-fail: when the UI workspace hasn't been built yet (a fresh
 * clone running `npm run build` only inside `src/`), warn and move on
 * instead of failing the CLI build. The release workflow has its own
 * step that builds UI before CLI; dev iteration on TS shouldn't be
 * blocked on Angular being built. The runtime resolver falls back to
 * the upward `cwd` walk in the monorepo case.
 */
function copyUiBundle(): void {
  const source = '../ui/dist/ui/browser';
  if (!existsSync(source)) {
    process.stderr.write(
      `tsup: skipping UI bundle copy — ${source} not found ` +
      '(run `npm run build --workspace=ui` to populate; required for npm publish).\n',
    );
    return;
  }
  cpSync(source, 'dist/ui', { recursive: true });
}
