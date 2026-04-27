---
"@skill-map/cli": patch
---

Step 6.3 — `sm config list / get / set / reset / show` go from
stub-printing-"not implemented" to real implementations. The five verbs
share the layered loader from 6.2 and gain a `--strict-config` flag on
the read side that escalates merge warnings to fatal errors.

**Runtime change**:

- `src/cli/commands/config.ts` — five Clipanion commands plus shared
  helpers (`getAtPath`, `setAtPath`, `deleteAtPath` with empty-parent
  pruning, JSON-first value coercion, dot-path → human formatter).
- `src/cli/commands/stubs.ts` — five `Config*Command` classes removed;
  `STUB_COMMANDS` array shrunk; replaced-at-step comment kept.
- `src/cli/entry.ts` — registers the new `CONFIG_COMMANDS` array.
- `context/cli-reference.md` — regenerated from `sm help --format md`;
  CLI version line now reflects the live `0.3.x` value (the file had
  drifted at PR #12 against the prior stub descriptions).

**Verb semantics**:

- `sm config list [--json] [-g] [--strict-config]` — prints the merged
  effective config. Human mode emits sorted `key.path = value` lines;
  `--json` emits the JSON object. Exempt from `done in <…>` per
  `spec/cli-contract.md` §Elapsed time.
- `sm config get <key> [--json] [-g] [--strict-config]` — leaf value
  by dot-path. Unknown key → exit 5. `--json` wraps in JSON literals
  so callers can pipe into `jq`. Exempt from elapsed-time.
- `sm config show <key> [--source] [--json] [-g] [--strict-config]` —
  identical to `get` plus optional `--source` that surfaces the winning
  layer (`defaults / user / user-local / project / project-local /
  override`). For nested objects, the highest-precedence descendant
  wins. `--source --json` emits `{ value, source }`. Exempt from
  elapsed-time.
- `sm config set <key> <value> [-g]` — writes to project file by
  default; `-g` writes to user file. JSON-parses the raw value first so
  CLI ergonomics produce booleans / numbers / arrays / objects naturally
  (unparseable falls through as plain string). Result is re-validated
  against `project-config.schema.json`; schema violation → exit 2 with
  the file untouched. In-scope verb — emits `done in <…>` to stderr.
- `sm config reset <key> [-g]` — strips the key from the target file;
  prunes now-empty parent objects so the file stays tidy. Idempotent —
  absent key prints "No override at <path>" and exits 0. In-scope verb.

**Tests**: `src/test/config-cli.test.ts` exercises every verb through
the real `bin/sm.mjs` binary with isolated `HOME` and `cwd` per test:
list defaults / project / `--json`, get leaf / object / `--json` /
unknown-key, show `--source` on leaf and nested object, show `--source
--json`, show without `--source`, set project default + `-g` + nested
dot-path + invalid → exit 2 + preserves siblings + emits `done in`,
reset basic + idempotent absent + `-g` + parent-pruning.

Test count: 231 → 252 (+21).
