---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Step 14.5.d — Provider-driven kind presentation + envelope kindRegistry

Pre-1.0 minor breaking per `versioning.md` § Pre-1.0.

The Provider extension surface gains the required `kinds[*].ui` field
so each kind a Provider declares carries the presentation metadata the
UI needs to render it (label, base color, optional dark-theme color,
optional emoji, optional icon). The icon is a discriminated union —
`{ kind: 'pi'; id: 'pi-…' }` for PrimeIcons or `{ kind: 'svg'; path:
'…' }` for raw SVG path data. The UI derives `bg` / `fg` tints from
`color` per theme via a deterministic helper, so the Provider declares
one base color per theme rather than four hex values.

The REST envelope shape (`spec/schemas/api/rest-envelope.schema.json`)
gains a new required `kindRegistry` field on every payload-bearing
variant (`nodes` / `links` / `issues` / `plugins` / `node` / `config`);
sentinel envelopes (`health` / `scan` / `graph`) stay exempt. The
registry is keyed by kind name and carries `{ providerId, label,
color, colorDark?, emoji?, icon? }` — the BFF assembles it once at
boot from every enabled Provider and attaches it to every applicable
response so the UI can render Provider-declared kinds (built-in and
user-plugin alike) without hardcoding a closed kind enum. The change
keeps `schemaVersion` at `'1'` (greenfield — no released consumers
depend on the prior shape).

**Files edited (spec)**

- `spec/schemas/extensions/provider.schema.json` — adds `ui` to the
  required field set on each `kinds[*]` entry, with discriminated
  `oneOf` for `icon`.
- `spec/schemas/api/rest-envelope.schema.json` — new `kindRegistry`
  definition; required on every payload-bearing variant; sentinel
  variants explicitly forbid the field via `not.anyOf`. Version stays
  at `'1'` (greenfield).
- `spec/CHANGELOG.md` — `[Unreleased]` `### Minor` entry.

**Files edited (kernel + built-in)**

- `src/kernel/extensions/provider.ts` — adds `IProviderKindUi` and
  `IProviderKindIcon`; `ui` becomes required on `IProviderKind`.
- `src/built-in-plugins/providers/claude/index.ts` — every kind
  (skill / agent / command / hook / note) declares its `ui` block
  reusing the colors / labels / icons previously hardcoded in
  `ui/src/styles.css`, `ui/src/i18n/kinds.texts.ts`, and
  `ui/src/app/components/kind-icon/kind-icon.html`.
- `src/built-in-plugins/providers/claude/claude.test.ts` — new test
  asserts every kind declares a well-formed `ui` block.
- `src/test/external-provider-kind.test.ts` — three mock providers
  updated to declare `ui` on their `cursorRule` kinds.
- `src/test/plugins-cli.test.ts` — `dropMockProvider` helper template
  declares `ui` on the inline mock `note` kind.

**Files added (conformance)**

- `spec/conformance/fixtures/plugin-missing-ui/` — drop-in Provider
  fixture whose `kinds[*]` omits `ui` (plus a trivial `notes/example.md`
  for the built-in Claude scan to grab).
- `spec/conformance/cases/plugin-missing-ui-rejected.json` — locks the
  loader contract: `sm scan --json` exits 0, stderr matches
  `plugin bad-provider:.*invalid.*must have required property 'ui'`,
  the envelope still contains the built-in Claude provider, and the
  one fixture node still gets scanned (one bad plugin does not take
  down the scan).

**Decisions taken inline (flag for orchestrator)**

- `ui` is required, not optional — making it optional reintroduces the
  pre-14.5.d trap of silently collapsing unknown kinds to `'note'`.
  The cost (one object per kind in the manifest) is small.
- Icon is a discriminated union (`oneOf` with `kind` discriminator)
  rather than two optional fields. Keeps the UI dispatch exhaustive
  and AJV validates each variant cleanly.
- `schemaVersion` stays at `'1'` despite the required-field add.
  Greenfield — no released consumers; a versioned migration buys
  nothing today. Bumps the day a third-party consumer ships against
  the wire.
- Severity (PrimeNG `<p-tag>` `severity` enum) is NOT declared by the
  Provider. The UI tints kind tags with the registry's `color`
  directly, avoiding a Provider-side dependency on a UI-framework
  enum.
- BFF + UI sub-steps land in follow-up commits (14.5.d.iii / .iv /
  .v) — the spec + kernel + built-in surface ship first so the
  contract is visible before consumers wire up.
