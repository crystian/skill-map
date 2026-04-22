---
"@skill-map/spec": minor
---

Document `--all` as targeted fan-out, not a global flag, in `spec/cli-contract.md`.

`--all` is valid only on verbs whose contract explicitly lists it:

- `sm plugins enable <id> | --all` and `sm plugins disable <id> | --all`.
- `sm job cancel <job.id> | --all` (cancels every `queued` and `running` job).
- `sm job submit <action> --all` and `sm job run --all`.

Unsupported `--all` usage is an operational error (exit `2`), the same as any other unknown or invalid flag.

Classification: minor — targeted fan-out semantics are additive for the listed verbs, while avoiding a global flag contract.
