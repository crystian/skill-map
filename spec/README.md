# skill-map spec

The **skill-map specification** defines a vendor-neutral standard for mapping, inspecting, and managing collections of interrelated Markdown files — skills, agents, commands, hooks, and notes that compose AI-agent ecosystems (Claude Code, Codex, Gemini, Obsidian vaults, docs sites, and any future platform).

This document is the **source of truth**. The reference implementation under `../src/` conforms to this spec. Third parties can build alternative implementations (any language, any UI, any CLI) using only `spec/`, without reading the reference source.

## What this spec defines

- The **domain model**: nodes, links, issues, scan results.
- The **extension contract**: six extension kinds (detector, adapter, rule, action, audit, renderer) with their input/output shapes.
- The **CLI contract**: verb set, flags, exit codes, JSON introspection.
- The **persistence contract**: table catalog owned by the kernel, plugin key-value API.
- The **job contract**: lifecycle states, event stream, prompt preamble, submit/claim/record semantics.
- The **frontmatter standard**: base fields and per-kind extensions.
- The **summary standard**: shape of action-produced summaries per kind.
- The **plugin manifest**: metadata, `specCompat` range, storage mode, security declarations.

## What this spec does not define

- Language or runtime of the implementation.
- Database engine (spec assumes a relational, SQL-like store; engine-agnostic).
- UI framework, theming, layout.
- Test framework (conformance suite is language-neutral data, not code).
- Logging format, telemetry, or distribution channels.
- Plugin marketplace mechanics.

These are implementation decisions. The reference impl picks them (see `../CLAUDE.md` and `../ROADMAP.md`); other implementations may pick differently and still conform.

## Properties

- **Machine-readable**: all domain shapes are JSON Schemas. Validate from any language that has a JSON Schema validator.
- **Human-readable**: prose documents for each subsystem, with examples.
- **Independently versioned**: spec `v1.0.0` can be implemented by CLI `v0.3.2`. See `versioning.md`.
- **Platform-neutral**: no platform (Claude Code, Obsidian, …) is privileged. Each is expressed as an adapter extension.
- **Conformance-tested**: every conforming implementation passes the suite under `conformance/`. Pass/fail is binary.

## Naming conventions

Two rules govern every identifier in the spec. They are **normative**.

- **Filesystem artefacts use kebab-case.** Every file and directory in `spec/` (and in any conforming implementation) — `scan-result.schema.json`, `job-lifecycle.md`, `report-base.schema.json`, `auto-rename-medium` (as an `issue.ruleId` value), `direct-override` (as a `safety.injectionType` enum value), and so on — is kebab-case lowercase. Enum values and issue rule ids follow the same convention so they can be echoed back into URLs, filenames, and log keys without escaping.
- **JSON content uses camelCase.** Every key inside a JSON Schema, frontmatter block, config file, plugin manifest, action manifest, job record, report, event payload, or API response is camelCase: `whatItDoes`, `injectionDetected`, `expectedTools`, `conflictsWith`, `docsUrl`, `examplesUrl`, `ttlSeconds`, `runId`, `jobId`. This matches the JS/TS ecosystem the reference impl ships in and the Kysely `CamelCasePlugin` that bridges to the `snake_case` SQL layer — but the rule is spec-level, not implementation-level: an alternative implementation in any language still exposes camelCase JSON keys.

The SQL persistence layer is the sole exception: tables, columns, and migration filenames use `snake_case` (see `db-schema.md`). That boundary is crossed only inside a storage adapter; nothing that leaves the kernel should ever be `snake_case`.

## Repo layout

```
spec/                              ← published as @skill-map/spec
├── README.md                      ← this file
├── CHANGELOG.md                   ← spec history (independent from CLI)
├── versioning.md                  ← evolution policy
├── package.json                   ← npm manifest for @skill-map/spec
├── index.json                     ← machine-readable manifest + per-file sha256 (generated)
│
├── architecture.md                ← hexagonal ports & adapters
├── cli-contract.md                ← verbs, flags, exit codes, JSON introspection
├── job-events.md                  ← canonical event stream schema
├── prompt-preamble.md             ← canonical injection-mitigation preamble (verbatim normative)
├── db-schema.md                   ← table catalog (kernel-owned)
├── plugin-kv-api.md               ← ctx.store contract for storage mode A
├── job-lifecycle.md               ← queued → running → completed | failed
│
├── schemas/                       ← 29 JSON Schemas, draft 2020-12, camelCase keys
│   ├── node.schema.json                     ┐
│   ├── link.schema.json                     │
│   ├── issue.schema.json                    │
│   ├── scan-result.schema.json              │
│   ├── execution-record.schema.json         │ 11 top-level
│   ├── project-config.schema.json           │
│   ├── plugins-registry.schema.json         │
│   ├── job.schema.json                      │
│   ├── report-base.schema.json              │
│   ├── conformance-case.schema.json         │
│   ├── history-stats.schema.json            ┘
│   │
│   ├── extensions/                          ← one per extension kind; validated at plugin load
│   │   ├── base.schema.json                 ┐
│   │   ├── adapter.schema.json              │
│   │   ├── detector.schema.json             │ 7 extension schemas
│   │   ├── rule.schema.json                 │ (base + 6 kinds)
│   │   ├── action.schema.json               │
│   │   ├── audit.schema.json                │
│   │   └── renderer.schema.json             ┘
│   │
│   ├── frontmatter/                         ← user-authored; additionalProperties: true
│   │   ├── base.schema.json                 ┐
│   │   ├── skill.schema.json                │
│   │   ├── agent.schema.json                │ 6 frontmatter schemas
│   │   ├── command.schema.json              │ (base + 5 kinds; each kind
│   │   ├── hook.schema.json                 │ extends base via allOf)
│   │   └── note.schema.json                 ┘
│   │
│   └── summaries/                           ← kernel-controlled; additionalProperties: false
│       ├── skill.schema.json                ┐
│       ├── agent.schema.json                │ 5 summaries (each extends
│       ├── command.schema.json              │ report-base via allOf)
│       ├── hook.schema.json                 │
│       └── note.schema.json                 ┘
│
├── interfaces/
│   └── security-scanner.md        ← convention over the Action kind (NOT a 7th extension kind)
└── conformance/
    ├── fixtures/                  ← controlled MD corpora + preamble-v1.txt
    └── cases/                     ← declarative test cases: basic-scan, kernel-empty-boot
                                     (preamble-bitwise-match deferred to ../ROADMAP.md Step 10)
```

## How to read this spec

- **Building a tool or plugin that consumes skill-map output?** Start with `schemas/scan-result.schema.json` and `schemas/node.schema.json`.
- **Building a custom detector, rule, or renderer?** Read `architecture.md`, then the relevant schema.
- **Building an alternative CLI implementation?** Read `cli-contract.md` and run `conformance/`.
- **Integrating a new platform (adapter)?** Read `architecture.md` §adapters, then the Claude adapter source in `../src/extensions/adapters/claude/` as a worked example.
- **Shipping a job-running runner?** Read `job-events.md`, `job-lifecycle.md`, `prompt-preamble.md`.

## Relationship to the reference implementation

The reference implementation (`../src/`) is one conforming consumer of this spec. It ships the CLI binary `sm`, a built-in SQLite storage adapter, and a bundle of default extensions.

The reference impl has no privileged access to the spec. Breaking changes to the spec must follow `versioning.md` regardless of reference-impl convenience.

When spec and reference impl disagree, the spec wins. File an issue; one of them is wrong.

## Distribution

Published to npm as [`@skill-map/spec`](https://www.npmjs.com/package/@skill-map/spec).

### Install

```bash
npm i @skill-map/spec
```

### Use — load a schema

```js
import specIndex from '@skill-map/spec';
import nodeSchema from '@skill-map/spec/schemas/node.schema.json' with { type: 'json' };

console.log(specIndex.specPackageVersion);  // → "0.2.0" (npm package version; source of truth for `spec` in `sm version`)
console.log(specIndex.indexPayloadVersion); // → "0.0.1" (payload shape of `index.json` itself; bumps only when this manifest's structure changes)
console.log(specIndex.integrity.algorithm); // → "sha256"
console.log(nodeSchema.$id);                // → "https://skill-map.dev/spec/v0/node.schema.json"
```

Every JSON Schema is exported individually via `@skill-map/spec/schemas/*.json`. Prose documents ship in the tarball for reference but are not `exports`-surfaced.

### Verify integrity

The package ships `index.json` with a sha256 per file. To verify a local installation matches what was published:

```js
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import index from '@skill-map/spec';

const file = 'schemas/node.schema.json';
const actual = createHash('sha256').update(readFileSync(`node_modules/@skill-map/spec/${file}`)).digest('hex');
console.log(actual === index.integrity.files[file] ? 'ok' : 'drift');
```

### JSON Schema Store

The schemas will be registered on JSON Schema Store once the canonical URLs under `skill-map.dev/spec/v0/` are stable (Step 14).

## License

MIT. See `../LICENSE`.
