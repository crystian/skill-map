# Built-in extensions (built-in plugin bundles)

The reference implementation's bundled extensions live here, organized by extension kind. Each is a directory with a manifest + implementation + a sibling `*.test.ts` (the kernel treats a missing test as a contract-check failure for built-ins).

The two built-in **plugin bundles** are declared in [`built-ins.ts`](./built-ins.ts):

- **`claude`** — granularity `bundle` (provider-level toggle). Ships the Claude Provider and its kind-aware Extractors.
- **`core`** — granularity `extension` (every kernel built-in is independently removable, satisfying §Boot invariant: "no extension is privileged"). Ships the kernel-internal primitives (Rules, the Formatter, the `external-url-counter` Extractor).

## Current built-in inventory

| Kind | Plugin | Id | Notes |
|---|---|---|---|
| Provider | `claude` | `claude` | Walks `.claude/{agents,commands,hooks,skills}/*.md` + `notes/**/*.md`; classifies into the five Claude node kinds. |
| Extractor | `claude` | `frontmatter` | Reads frontmatter `requires` / `related` / `supersedes` / `supersededBy`; emits the corresponding link kinds. |
| Extractor | `claude` | `slash` | Detects `/skill-map:explore`-style invocations in node bodies. |
| Extractor | `claude` | `at-directive` | Detects `@agent-name` mentions. |
| Extractor | `core` | `external-url-counter` | Counts external URLs per node; result lands on `node.externalRefsCount` (never persisted as a graph link). The drop-in litmus from Step 2 — adding it required one new file under `extractors/` and one entry in `built-ins.ts`. Zero kernel edits. |
| Rule | `core` | `trigger-collision` | Two nodes claim the same normalized trigger? Emits a `warn` Issue. |
| Rule | `core` | `broken-ref` | Invocation links pointing at a target that doesn't exist? Emits an `error` Issue. |
| Rule | `core` | `superseded` | A node marked `supersededBy` another that exists? Emits an `info` Issue. |
| Rule | `core` | `link-conflict` | Two Extractors emit a link for the same `(source, target)` pair with different `kind` values? Emits a `warn` Issue per pair. |
| Rule | `core` | `validate-all` | Post-scan AJV revalidation of every persisted node / link / issue against the spec schemas. (Pre-0.8.0 this was an `Audit` kind; absorbed into Rule when Audit was removed.) |
| Formatter | `core` | `ascii` | Plain-text dump grouped by node kind, then links, then issues. |

The Hook kind has no built-ins yet; the kind exists so plugins can subscribe (concrete built-in Hooks land separately when demand surfaces).

## Boot invariant

The kernel-empty-boot conformance case (`kernel-empty-boot`) asserts that with **zero registered extensions** the kernel still boots and returns an empty graph. The built-ins listed above are loaded on top of that empty boot — they are indistinguishable from drop-in plugins from the kernel's point of view. `--no-built-ins` strips them all and exercises the empty-boot path at runtime.

See [`ROADMAP.md`](../../ROADMAP.md) §Plugin system for the full kind catalog and the granularity rules. Extension kind contracts are normative in [`spec/architecture.md`](../../spec/architecture.md).
