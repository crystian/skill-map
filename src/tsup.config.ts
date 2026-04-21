import { defineConfig } from 'tsup';

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
});
