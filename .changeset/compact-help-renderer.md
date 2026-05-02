---
'@skill-map/cli': minor
---

feat(cli): compact `sm --help` and per-verb help

Replace Clipanion's default top-level and per-verb help output with a project-styled, compact renderer that fits the rest of the CLI's visual language. The normative `--format json` and `--format md` paths (locked by `spec/cli-contract.md` § Help) are untouched — only the human format changed.

**Top-level overview (`sm`, `sm --help`, `sm -h`, `sm help` no-verb)**

New `RootHelpCommand` replaces `Builtins.HelpCommand`. Layout: header tagline → USAGE block → EXAMPLES block → per-category sections (uppercased, alphabetical) → footer pointing at `sm <command> --help`. Per-category column width is computed independently so a single long verb doesn't widen every other section. Stub verbs (those whose description starts with `(planned)`) get a leading `[stub] ` tag in the description column (and in the single-verb header), and the `(planned)` parenthetical is stripped to keep the column flush. Long rows are truncated with a `…` ellipsis at 120 chars.

**Per-verb help (`sm <verb> --help`, `sm help <verb>`)**

New `routeHelpArgs(args, cli)` in `cli/entry.ts` (called before `cli.run`) intercepts `sm <verb...> --help|-h` and rewrites it to `sm help <verb...>`, picking the longest registered verb-path prefix. Pure function, lives next to the renderer in `cli/commands/help.ts`. `HelpCommand.verb` switched from `Option.String` to `Option.Rest` so multi-token verbs (`db migrate`, `scan compare-with`, `config get`) work via `sm help <verb>` too. `renderSingle` rewritten with HEAD / USAGE / DESCRIPTION / FLAGS sections matching the overview. The USAGE line now shows real positionals (`<orphanPath>`, `<dump> ...`, etc.) extracted from Clipanion's detailed-usage string — required adding `usage` to `ICliDefinition` because `def.path` is just the verb path; positionals only live in the detailed `def.usage`. FLAGS rows show the first sentence of each flag's description, padded into a column, truncated at 120 chars.

**Category consolidation** (eliminate one-verb categories)

`version` moves from `Setup & state` → `Introspection`. The two `actions` stubs move from `Actions` → `Jobs`. `serve` moves from `Server` → `Setup`. Cascades cleanly into `context/cli-reference.md` (regenerated; `npm run cli:check` clean).

**i18n**

Every new user-facing string lives in `cli/i18n/help.texts.ts` per the project's `tx(*_TEXTS.*)` discipline — no inline strings in command code.

**Lint**

Three new functions tripped the `complexity=8` cap. `extractPositionals` is a legit char-by-char tokenizer (AGENTS.md exception #2 — `eslint-disable-next-line complexity` with the documented justification). `renderSingle` and `routeHelpArgs` were split into helpers cleanly, no disables.

**Spec stance**

The human help format is not spec-normative — only `--format json` and `--format md` are locked by `spec/cli-contract.md` § Help, and those paths are untouched. The contract requirement that `sm`, `sm --help`, `sm -h` all print top-level help and exit 0 is still satisfied. No spec change, no `spec/CHANGELOG` entry.

Classified `minor` (not `major`) per AGENTS.md "Pre-1.0: never bump to a major" — pre-1.0 breaking changes ship as minor bumps.

**Validation**

`npm run validate` (lint) clean, `npm test -w src` 693/693 pass, `npm run cli:reference` regenerated, `npm run cli:check` confirms in sync. Manual smoke across `sm`, `sm --help`, `sm -h`, `sm help`, `sm scan --help`, `sm db migrate --help`, `sm orphans reconcile --help`, `sm scan compare-with --help`, `sm config get --help`, `sm help <verb>` for the same set, plus `sm help <verb> --format json|md` (normative formats — unchanged behaviour).
