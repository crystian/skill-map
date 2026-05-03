---
"@skill-map/cli": minor
---

Replace Clipanion's full-catalog error dump with a concise diagnostic on argv parse errors.

Clipanion's default `UnknownSyntaxError` / `AmbiguousSyntaxError` handler prints the USAGE block of every registered command (~50 verbs for skill-map) to **stdout** and exits with code `1`. Three problems in one: it floods the screen for what is almost always a typo, it pollutes stdout (breaking `sm <verb> | jq` pipelines when an upstream typo trips the parser), and it uses the wrong exit code (per `spec/cli-contract.md` §Exit codes, "unknown flag" is operational error → `2`, not result-issue → `1`).

`src/cli/entry.ts` now pre-parses argv via `cli.process()` inside try/catch before delegating to `cli.run()`. On a parse error, `src/cli/util/parse-error.ts` formats a single-screen diagnostic (headline + at most one suggestion + `sm help` footer), writes it to **stderr**, and exits `ExitCode.Error` (2). Detection is duck-typed on `name` + `input` shape so a Clipanion version bump that re-exports the class can't silently flip the handler off.

Suggestion branches:

- Single-dash long flag (`sm -version`) → suggest the `--` form (`'--version'`).
- Unknown flag scoped to a known verb (`sm scan --foo`) → headline as `scan: unknown option '--foo'` + `Run 'sm help scan' for usage.`
- Incomplete namespace (`sm db`) → list up to three registered subcommands alphabetically.
- Unknown verb (`sm sacn`) → Levenshtein-ranked top-3 within 2-3 edits (cap tightened on short inputs to avoid `fooooo` matching `db backup`).

The exit-code change from `1` → `2` is technically observable for any caller that special-cased Clipanion's old behaviour, but it brings the binary into conformance with the documented contract. Pre-1.0 minor per `spec/versioning.md`.

Adds `src/test/cli-parse-errors.test.ts` (9 cases) covering each branch and the happy paths (`--version`, `-v`) to guard against regressions.
