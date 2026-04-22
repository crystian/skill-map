import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'tsup';

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
    restoreNodeSqliteImports('dist');
  },
});
