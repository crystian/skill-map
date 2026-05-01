---
'@skill-map/cli': minor
---

Correct misclassified exit codes in `sm export` and `sm graph`.

Per `spec/cli-contract.md` § Exit codes, exit `5` is reserved for
"DB missing"; user/argument errors return `2`. The two verbs were
returning `5` for cases that have nothing to do with a missing DB —
unsupported `--format`, invalid `--query`, deferred formatters, no
formatter registered.

**Sites corrected:**

- `sm export --format mermaid` (deferred to Step 12) → `2` (was `5`).
- `sm export --format <unsupported>` → `2` (was `5`).
- `sm export --query '<invalid>'` → `2` (was `5`).
- `sm graph --format <no-formatter-registered>` → `2` (was `5`).

Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0: this changes a
user-observable contract (exit code) so it ships as a minor while the
package is `0.Y.Z`. Header comments on both verbs and three
test-suite assertions updated.
