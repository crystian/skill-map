---
'@skill-map/cli': minor
---

Step 9.1 — plugin runtime wiring. Drop-in plugins discovered under
`<scope>/.skill-map/plugins/<id>/` now participate in the read-side
pipeline: their detectors / rules emit links + issues during `sm scan`,
and their renderers are selectable via `sm graph --format <name>`.

New surface:

- `loadPluginRuntime(opts)` helper at `src/cli/util/plugin-runtime.ts`
  centralises discovery, layered enabled-resolver (settings.json + DB
  override `config_plugins`), failure-mode-to-warning conversion, and
  manifest-row collection. Single source of truth for any verb that
  needs plugin extensions on the wire.
- `composeScanExtensions` + `composeRenderers` merge built-in and plugin
  contributions into the shapes the orchestrator + graph command consume.
- `--no-plugins` flag added to `sm scan`, `sm scan --watch`, `sm watch`,
  and `sm graph`. Pairs with `--no-built-ins` for kernel-empty-boot
  parity.
- Failed plugins (`incompatible-spec` / `invalid-manifest` / `load-error`)
  emit one stderr line each and are skipped; the kernel keeps booting.
  Disabled plugins silently drop out of the pipeline (their `sm plugins
  list` row already conveys intent).

Bug fix collateral: the plugin loader now strips function-typed
properties from a plugin's runtime export before AJV-validating it
against the extension-kind schema. The kind schemas use
`unevaluatedProperties: false` to keep the manifest shape strict;
without the strip, real plugins shipping `detect` / `render` /
`evaluate` methods always failed validation. Built-ins were unaffected
because they never went through the loader.

Out of scope for 9.1, picked up later in Step 9:

- `sm export --format` does not consult the renderer registry today;
  its formats (`json`, `md`, `mermaid`) are hand-rolled. Flipping it
  to use renderers is a future enhancement, not on the Step 9 critical
  path.
- Plugin migrations + `sm db migrate --kernel-only` / `--plugin <id>`
  flags + triple protection ship as Step 9.2.
- `@skill-map/testkit` package ships as Step 9.3.
- Plugin author guide ships as Step 9.4.

5 new tests at `src/test/plugin-runtime.test.ts` cover plugin detector
contribution, `--no-plugins` opt-out on both scan and graph, broken-
manifest tolerance, and plugin-renderer selection. Test count
389 → 394.
