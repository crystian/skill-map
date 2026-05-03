# `@skill-map/testkit`

Kernel mocks and builders for plugin authors. Unit-test Extractors, Rules, and Formatters without spinning up a real kernel or DB.

The full plugin contract lives in [`spec/plugin-author-guide.md`](../spec/plugin-author-guide.md). This README is a fast on-ramp: how to ship the smallest viable plugin and validate it with the testkit.

## Install

```bash
npm install --save-dev @skill-map/testkit @skill-map/cli
```

Pin both at exact versions — no `^` or `~`.

## Minimum plugin shape

A plugin is a directory with one manifest and one extension file:

```text
my-plugin/
├── plugin.json
└── extensions/
    └── my-extractor.js
```

`plugin.json`:

```jsonc
{
  "id": "my-plugin",
  "version": "1.0.0",
  "specCompat": "^1.0.0",
  "extensions": ["./extensions/my-extractor.js"]
}
```

The directory name MUST equal `id`. Cross-root id collisions block both plugins.

`extensions/my-extractor.js` — an Extractor that emits one `references` link per `[[ref:<name>]]` token in the body:

```javascript
export default {
  id: 'my-extractor',
  kind: 'extractor',
  version: '1.0.0',
  emitsLinkKinds: ['references'],
  defaultConfidence: 'medium',
  scope: 'body',
  extract(ctx) {
    for (const m of ctx.body.matchAll(/\[\[ref:([a-z0-9-]+)\]\]/gi)) {
      ctx.emitLink({
        source: ctx.node.path,
        target: m[1].toLowerCase(),
        kind: 'references',
        confidence: 'medium',
        sources: ['my-extractor'],
        trigger: { originalTrigger: m[0], normalizedTrigger: m[0].toLowerCase() },
      });
    }
  },
};
```

The extension's `id` is short (`my-extractor`); the kernel composes the qualified id `my-plugin/my-extractor` from the manifest. Pick a token syntax that does not collide with the built-in `@<token>` and `/<token>` Extractors.

The `extract(ctx) → void` shape is normative: Extractors emit through three callbacks (`ctx.emitLink`, `ctx.enrichNode`, `ctx.store`) instead of returning links. See [`spec/architecture.md` §Extractor · output callbacks](../spec/architecture.md#extractor--output-callbacks).

The five other extension kinds (`provider`, `rule`, `formatter`, `action`, `hook`) follow the same shape — see [`spec/plugin-author-guide.md`](../spec/plugin-author-guide.md#the-six-extension-kinds).

## Test it

```javascript
// test/my-extractor.test.js
import { test } from 'node:test';
import { strictEqual } from 'node:assert';
import { node, runExtractorOnFixture } from '@skill-map/testkit';
import extractor from '../extensions/my-extractor.js';

test('emits one link per [[ref:<name>]]', async () => {
  const { links } = await runExtractorOnFixture(extractor, {
    body: 'See [[ref:architect]] and [[ref:sre]].',
    context: { node: node({ path: 'sample.md' }) },
  });
  strictEqual(links.length, 2);
  strictEqual(links[0].target, 'architect');
});
```

```bash
node --test test/my-extractor.test.js
```

The testkit also ships `runRuleOnGraph` (Rules), `runFormatterOnGraph` (Formatters), `makeFakeStorage` (KV storage), and `makeFakeRunner` (probabilistic mode). Full surface in [`index.ts`](./index.ts).

## Run it under the real CLI

```bash
mkdir -p .skill-map/plugins
cp -r my-plugin .skill-map/plugins/
sm plugins list   # status should be: enabled
sm scan
```

Discovery roots (in order): `<project>/.skill-map/plugins/`, then `~/.skill-map/plugins/`. Override with `--plugin-dir <path>`.

If `sm plugins list` shows anything other than `enabled` / `disabled`, run `sm plugins doctor` for the diagnostic and check the [Diagnostics table](../spec/plugin-author-guide.md#diagnostics).

## A complete worked example

[`examples/hello-world/`](../examples/hello-world/) is the smallest plugin that compiles, loads, scans, and tests. Copy it as a template.

## See also

- [`spec/plugin-author-guide.md`](../spec/plugin-author-guide.md) — full contract, all six extension kinds, storage modes, dual-mode posture.
- [`spec/architecture.md`](../spec/architecture.md) — extension contract, ports, execution modes.
- [`spec/plugin-kv-api.md`](../spec/plugin-kv-api.md) — KV storage API for stateful plugins.
- [`spec/schemas/plugins-registry.schema.json`](../spec/schemas/plugins-registry.schema.json) — normative manifest shape.

## Stability

`experimental` while Step 9 is in flight. The Extractor / Rule / Formatter helpers and builders are intended to stay stable through v1.0; `makeFakeRunner` may change to track the Step 10 job subsystem contract.
