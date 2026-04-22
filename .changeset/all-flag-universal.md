---
"@skill-map/spec": minor
---

Promote `--all` to a normative universal flag in `spec/cli-contract.md §Global flags`.

Any verb that accepts a target identifier (`-n <node.path>`, `<job.id>`, `<plugin.id>`) MUST accept `--all` as "apply to every eligible target matching the verb's preconditions". Mutually exclusive with a positional target or `-n <path>` on the same invocation. Verbs that inherently target everything (`sm scan` without `-n`, `sm list`, `sm check`, `sm doctor`) accept the flag as a no-op for script-composition uniformity. Verbs where fan-out is nonsensical (`sm record`, `sm init`, `sm version`, `sm help`, `sm config get/set/reset/show`, `sm db *`, `sm serve`) MUST reject `--all` with exit `2`.

Concretely extended in this pass:

- `sm plugins enable <id> | --all` and `sm plugins disable <id> | --all`.
- `sm job cancel <job.id> | --all` (cancels every `queued` and `running` job).

Already normative before this change: `sm job submit <action> --all` and `sm job run --all`.

Classification: minor — new global flag semantics, backward compatible (existing invocations without `--all` behave identically). ROADMAP Decision #60 stays as the canonical narrative; this changeset brings the spec into line with it.
