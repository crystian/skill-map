---
'@skill-map/cli': patch
---

Security audit fixes (cli-hacker sweep):

- Sanitize ANSI escape sequences and C0 control bytes in `sm check`, `sm history`, `sm list`, `sm orphans`, `sm plugins` output (defense in depth — values originate from plugin-authored strings persisted in the DB).
- Upgrade `stripAnsi()` regex in `kernel/util/safe-text.ts` to the strip-ansi v7 pattern so OSC 8 hyperlinks (with `:/?#&=` chars in the URL) strip cleanly instead of leaving the URL fragment behind.
- Reject `node.path` values that are absolute or escape the repo root in `sm refresh` (defense in depth against tampered DB files); shared helper at `cli/util/path-guard.ts`.
- Skip symlinks explicitly in the built-in claude `walkMarkdown` (audit M7); document that `scan.followSymlinks` is reserved for a future cycle-aware implementation.
- Pin `js-yaml` schema to `JSON_SCHEMA` in the claude provider's frontmatter parser.
- Preserve `0o600` permissions on `sm db restore`.
- Sanitize `--log-level` raw input before printing the invalid-level warning.
- Sanitize conformance case id before using it as the `mkdtemp` prefix.
- Move `truncate(...)` into a shared `cli/util/text.ts` and make it UTF-8 safe (split on code-point boundaries via `Array.from`).
- Document untrusted-repository plugin auto-loading risk in the CLI README.

No behavioral changes for trusted inputs; only hardens output rendering and edge-case validation.
