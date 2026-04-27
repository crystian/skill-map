---
"@skill-map/cli": patch
---

Step 6 follow-up — unify the `--strict-config` flag (introduced in 6.2
for the layered loader) with the existing `--strict` flag (introduced
in 6.7 for frontmatter validation). One name, same intent across every
verb that touches user input: "fail loudly on any validation
warning".

**CLI surface change** (renamed flag, same Option.Boolean):

  - `sm config list / get / show` — `--strict-config` → `--strict`.
  - `sm scan --strict` — already did frontmatter strict; now ALSO
    propagates strict to `loadConfig` so a bogus key in
    `settings.json` aborts the scan instead of being silently
    skipped.
  - `sm init --strict` — new. Propagates strict to BOTH the loader
    (so user-layer warnings during the first-scan path become
    fatal) and the first-scan's frontmatter validator. Affects only
    the path that actually loads config — `sm init --no-scan`
    skips the loader entirely so `--strict` has nothing to enforce
    there.

The user-visible motivation: one flag to remember. Internally each
verb still routes the boolean to whichever validations are reachable
from its execution path; the conflated name reflects the conflated
intent ("strict mode = no silent input fixups").

**Runtime change**:

- `src/cli/commands/config.ts` — `Option.Boolean('--strict-config',
  false)` becomes `Option.Boolean('--strict', false)` in three
  commands (list / get / show). Local field renamed `strictConfig`
  → `strict`. Module JSDoc rewritten to point at the unified
  contract.
- `src/cli/commands/scan.ts` — `loadConfig` call in `ScanCommand`
  now passes `strict: this.strict` and is wrapped in a try/catch
  emitting `sm scan: <message>` + exit 2 on throw, matching the
  config-verbs UX from the prior follow-up.
- `src/cli/commands/init.ts` — new `Option.Boolean('--strict',
  false)` on `InitCommand`; threaded through `runFirstScan` to
  both the `loadConfig` call (try/catch) and the `runScan` options.
- `context/cli-reference.md` — regenerated; `sm init --strict` flag
  description now appears in the reference.

**Spec / docs**:

- `ROADMAP.md` — every `--strict-config` reference renamed to
  `--strict` (header status, §Configuration body, completeness
  marker, Step 14 `sm ui` flag list).
- `ui/src/models/settings.ts` JSDoc — same rename.
- `.changeset/step-6-2-config-loader.md`,
  `.changeset/step-6-3-config-verbs.md`,
  `.changeset/step-6-followup-version-strict-config.md` — all
  flag mentions in pending changeset bodies updated so the
  generated CHANGELOG entries match the shipping flag name.

**Tests**:

- `src/test/config-cli.test.ts` — `--strict-config` references in
  the existing `sm config — --strict UX` describe block renamed to
  `--strict`. Test count unchanged.
- `src/test/scan-frontmatter-strict.test.ts` — new
  `--strict unification` describe block with two end-to-end CLI
  tests: `sm scan --strict` aborts on a bogus loader key (and
  the lenient `sm scan` still tolerates it), and `sm init --strict`
  surfaces the same bogus key during the first-scan path.

Test count: 310 → 312 (+2).

No `@skill-map/spec` change — the rename is CLI-only; the spec never
defined the flag (only the feature semantics).
