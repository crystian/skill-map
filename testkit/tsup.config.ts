import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'index.ts' },
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: true,
  outDir: 'dist',
  esbuildOptions(options) {
    options.conditions = ['node'];
  },
  // Plugin authors install both @skill-map/cli and @skill-map/testkit;
  // we re-export `@skill-map/cli` types but never want to bundle the
  // CLI itself into testkit's dist. Mark it external so the published
  // build stays a thin layer over the user's installed cli version.
  external: ['@skill-map/cli'],
});
