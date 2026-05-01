---
'@skill-map/cli': patch
---

Close audit items D3 (i18n discipline) and D4 (rename `extensions/`) in
a single sweep. **Patch bump**: pure refactor + docs; zero public API
changes, no spec change, no behaviour change. The directory rename and
the i18n migration are both internal to the workspace.

## D4 — rename `src/extensions/` → `src/built-in-plugins/`

The directory was confusingly close in name to `src/kernel/extensions/`,
which holds the **contracts** (`IProvider`, `IExtractor`, `IRule`,
`IFormatter`, `IHook`, …) — not implementations. Renaming the bundled
implementations to `built-in-plugins/` makes the distinction obvious at
import sites: "kernel/extensions = what shape; built-in-plugins = what
code."

- `mv src/extensions src/built-in-plugins`. Internal layout preserved
  (`built-ins.ts` + `providers/` + `extractors/` + `rules/` +
  `formatters/`).
- Bulk update of relative imports across 31 files (`from
  '../extensions/...'` → `from '../built-in-plugins/...'`, across four
  depth levels). One overshoot caught by hand:
  `kernel/adapters/schema-validators.ts` legitimately imports
  `../extensions/index.js` (the contracts, inside the kernel) — that
  site was restored.
- `src/tsconfig.json` — `include` updated.
- `src/package.json` — four test scripts repointed
  (`'extensions/**/*.test.ts'` → `'built-in-plugins/**/*.test.ts'`).
- `src/cli/util/conformance-scopes.ts` — runtime path resolver and the
  user-facing error message updated to `built-in-plugins/providers/`.
- `src/test/conformance.test.ts` and
  `src/test/conformance-disable-flags.test.ts` — hardcoded fixture
  paths updated.

## D3 — migrate hardcoded CLI strings to the `tx(*_TEXTS.*)` discipline

Every `cli/commands/*.ts` file that previously emitted user-facing text
through `this.context.std{out,err}.write('literal string')` now sources
its strings from a sibling `cli/i18n/<verb>.texts.ts` file. Pattern:
`tx(<VERB>_TEXTS.<key>, { vars })`.

- New texts files (8): `show.texts.ts`, `history.texts.ts`,
  `orphans.texts.ts`, `help.texts.ts`, `stubs.texts.ts`,
  `export.texts.ts`, `jobs.texts.ts`, `config.texts.ts`.
- Extended (2): `check.texts.ts` (+`noIssues`), `db.texts.ts` (+8 keys
  for backup, migrate, status).
- Migrated sites: `show.ts`, `check.ts`, `history.ts`, `orphans.ts`,
  `help.ts`, `stubs.ts`, `export.ts`, `jobs.ts`, `db.ts`,
  `config.ts`. ~25 hardcoded strings replaced.
- Pure-passthrough writes (e.g. `this.context.stderr.write(\`${warn}\n\`)`
  relaying an already-formatted plugin warning) were intentionally
  left alone — those carry no locally-authored copy.

## AGENTS.md — record both decisions as durable conventions

Two new sections so future agents do not re-derive these:

- **"Source layout: built-ins vs extension contracts"** — explains the
  `kernel/extensions/` (contracts) vs `built-in-plugins/`
  (implementations) split with the mnemonic and pointers to where to
  import what.
- **"i18n strategy: where strings live"** — codifies the rule that CLI
  strings live in `cli/i18n/<verb>.texts.ts` and pass through `tx`.
  Documents the rationale (one greppable catalog, future-locale-ready,
  enforces "no copy-changes hidden in command logic") and the
  passthrough exemption.

## Net effect

- Tests: **602/602 still green**.
- Build: clean.
- Lint: still silent (0 errors, 0 warnings).
- Audit closure: D3 + D4 are the last two `cli-architect` items that
  needed Architect input; only the two big-effort items remain
  (Storage Port refactor and Open Kinds — both scoped in
  `docs/refactors/`).
