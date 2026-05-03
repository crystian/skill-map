---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Bare `sm` defaults to `sm serve` instead of printing help

`sm` invoked with no arguments now starts the Web UI server when a
`.skill-map/` project exists in the current working directory
(equivalent to `sm serve`). When no project is found, it prints a
one-line hint pointing to `sm init` and `sm --help` on stderr and
exits with code `2`. `sm --help` and `sm -h` continue to print
top-level help — help is now reserved for explicit flags.

**Spec change** (`spec/cli-contract.md` §Binary): the prior wording —
*"`sm`, `sm --help`, `sm -h` MUST all print top-level help"* — is
replaced by two separate clauses. Help invocation requires `--help` or
`-h`; bare invocation routes to the server with the hint-and-exit
fallback when no project exists.

**CLI change** (`src/cli/entry.ts`): empty argv is intercepted before
Clipanion sees it. If `defaultProjectDbPath(cwd)` exists, the args
are rewritten to `['serve']`. Otherwise the hint is printed via the
`tx()` i18n shim and the process exits `2`. `RootHelpCommand` no
longer carries `Command.Default`; it remains the handler for `--help`
and `-h` only.

**Why pre-1.0 minor instead of major**: `spec/` and `src/` are both
in `0.Y.Z`. Per `spec/versioning.md` §Pre-1.0, breaking changes ship
as minor bumps until the deliberate 1.0 stabilization. The conformance
suite required no updates (no case asserted bare-sm = help).
