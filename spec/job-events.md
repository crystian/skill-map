# Job events

Canonical event stream emitted during job execution. Every implementation MUST emit these events in the order described, with the shapes defined below. Consumers include the CLI pretty printer, the `--json` ndjson output, the Server's WebSocket broadcaster, and any third-party integration.

This document is **normative**. The set of event types, their payload shapes, and their ordering rules are stable contracts.

---

## Transport

Events are records produced by the kernel through `ProgressEmitterPort` (see [`architecture.md`](./architecture.md)). An implementation MUST provide three output adapters:

| Adapter | Purpose | Format |
|---|---|---|
| `pretty` | Default TTY output. Human-readable, colored, line-based progress. | Free-form; not normative. |
| `stream-output` | Pretty + model tokens inline. Debugging mode. | Free-form; not normative. |
| `json` | Machine-readable ndjson. One event per line; each line is a complete JSON object. | **Normative.** Matches the shapes below. |

The Server exposes the same events over WebSocket (`/ws`) using the same JSON shapes; each event is a single WebSocket text frame.

---

## Common envelope

Every event is a JSON object with this envelope:

```json
{
  "type": "<event-type>",
  "timestamp": <unix-ms>,
  "runId": "<run-id>",
  "jobId": "<job-id> | null",
  "data": { ... }
}
```

| Field | Required | Meaning |
|---|---|---|
| `type` | always | One of the canonical event types below. |
| `timestamp` | always | Unix milliseconds when the event was emitted. |
| `runId` | always | Identifier of the invocation that emitted the event. CLI runner loops use `r-YYYYMMDD-HHMMSS-XXXX`; synthetic or non-job runs use one optional mode segment: `r-<mode>-YYYYMMDD-HHMMSS-XXXX`. Canonical modes are `ext` (external Skill claims), `scan` (scan runs), and `check` (standalone issue recomputations). |
| `jobId` | when job-scoped | The job the event refers to. Null for run-level events (`run.*`). |
| `data` | per-event | Event-specific payload, shape defined below. |

Implementations MUST include every envelope field in every event, even if `jobId` is null. This simplifies consumers.

Unknown fields in `data` MUST be ignored by consumers (forward compatibility).

---

## Event catalog

Emitted in roughly this order during a `sm job run --all` invocation. The exact sequence may interleave for parallel runs (deferred to post-`v1.0`).

### `run.started`

Emitted once at the start of every `sm job run` invocation.

```json
{
  "type": "run.started",
  "timestamp": 1745159455123,
  "runId": "r-20260420-143055-a3f2",
  "jobId": null,
  "data": {
    "mode": "single | all | max",
    "maxJobs": 10,
    "filter": { "action": "skill-summarizer" }
  }
}
```

- `mode`: what the runner was asked to do.
- `maxJobs`: cap on concurrent drain (`--max N` or null).
- `filter`: resolved filter predicate, free-form object.

### `run.reap.started`

Emitted before auto-reap scans for expired jobs.

```json
{
  "type": "run.reap.started",
  "timestamp": 1745159455200,
  "runId": "...",
  "jobId": null,
  "data": {}
}
```

### `run.reap.completed`

Emitted after auto-reap finishes.

```json
{
  "type": "run.reap.completed",
  "timestamp": 1745159455201,
  "runId": "...",
  "jobId": null,
  "data": {
    "reapedCount": 0,
    "reapedIds": []
  }
}
```

- `reapedIds` lists the jobs transitioned from `running` to `failed`. May be empty.

### `job.claimed`

Emitted when the runner successfully claims a job.

```json
{
  "type": "job.claimed",
  "timestamp": 1745159455300,
  "runId": "...",
  "jobId": "d-20260420-143055-b001",
  "data": {
    "actionId": "skill-summarizer",
    "actionVersion": "1.2.0",
    "nodeId": "skills/my-skill.md",
    "ttlSeconds": 180,
    "priority": 0
  }
}
```

### `job.skipped`

Emitted when a drain attempts to claim but finds no eligible job.

```json
{
  "type": "job.skipped",
  "timestamp": 1745159455400,
  "runId": "...",
  "jobId": null,
  "data": {
    "reason": "queue-empty | filter-excluded-all"
  }
}
```

### `job.spawning`

Emitted when the runner is about to execute the job content.

```json
{
  "type": "job.spawning",
  "timestamp": 1745159455500,
  "runId": "...",
  "jobId": "...",
  "data": {
    "runner": "cli | skill | in-process",
    "command": "claude -p",
    "contentHash": "0a3f…"
  }
}
```

`command` is implementation-defined free-form; it is descriptive, not invokable. `contentHash` references the row in `state_job_contents` the runner is about to execute against — useful for downstream observers that want to correlate the spawn with the rendered content (which is in DB, not on disk).

> **Hookable** — see [`architecture.md` §Hook · curated trigger set](./architecture.md#hook--curated-trigger-set). Plugins MAY subscribe a `hook` extension to this event for pre-flight checks or audit logging. Reactions only — hooks cannot block the spawn.

### `model.delta`

Emitted in `stream-output` mode only. Carries incremental model output.

```json
{
  "type": "model.delta",
  "timestamp": 1745159456000,
  "runId": "...",
  "jobId": "...",
  "data": {
    "text": "Analyzing the skill...",
    "channel": "assistant | thinking | tool-use"
  }
}
```

Consumers of the canonical `json` output MAY receive these events if the runner chose to emit them. `pretty` and `json` adapters MAY drop `model.delta` events for brevity.

### `job.callback.received`

Emitted inside `sm record` when the callback arrives and passes nonce validation.

```json
{
  "type": "job.callback.received",
  "timestamp": 1745159465000,
  "runId": "...",
  "jobId": "...",
  "data": {
    "status": "completed | failed",
    "model": "claude-opus-4-7",
    "executionId": "e-20260420-143104-b001"
  }
}
```

`executionId` references the just-written `state_executions` row whose `report_json` carries the report payload. Consumers that need the content fetch it via `sm history --json` or directly from the DB; the event itself stays small.

`runId` on this event is the run that originally claimed the job. If the record is called from outside a CLI run — the canonical case being a Skill agent that called `sm job claim` + `sm record` without ever entering `sm job run` — the kernel MUST synthesize a `runId` of the form `r-ext-YYYYMMDD-HHMMSS-XXXX` (same timestamp + 4-hex shape as real run ids, with the `r-ext-` prefix reserved for externally-driven claims).

Synthetic-run envelope: when a Skill agent claims a job, the kernel MUST emit — on the server's WebSocket and in the `--json` ndjson stream if active — a full envelope covering that claim:

```
run.started (mode="external")
  → job.claimed
  → (no job.spawning — the claim itself is the spawn signal for external runs)
  → job.callback.received
  → (job.completed | job.failed)
  → run.summary
```

The `run.started.data.mode` carries the literal string `external` so UI consumers can render skill-driven work differently from CLI-driven work. `run.summary` closes the synthetic run as soon as the callback is processed; one synthetic run always wraps exactly one job. This keeps the WebSocket broadcaster's contract ("every job event lives inside a run envelope") intact across both runner paths.

### `job.completed`

Emitted when a job transitions to `completed`.

```json
{
  "type": "job.completed",
  "timestamp": 1745159465100,
  "runId": "...",
  "jobId": "...",
  "data": {
    "durationMs": 9700,
    "tokensIn": 2431,
    "tokensOut": 1072,
    "model": "claude-opus-4-7",
    "executionId": "e-20260420-143104-b001"
  }
}
```

`executionId` references the `state_executions` row that holds the report payload (in `report_json`). The full report is intentionally NOT inlined in the event — keep events small and let consumers query the row when they want the body.

> **Hookable** — see [`architecture.md` §Hook · curated trigger set](./architecture.md#hook--curated-trigger-set). The most common hookable event: notification, billing, downstream dispatch.

### `job.failed`

Emitted when a job transitions to `failed` by any path.

```json
{
  "type": "job.failed",
  "timestamp": 1745159465200,
  "runId": "...",
  "jobId": "...",
  "data": {
    "reason": "runner-error | report-invalid | timeout | abandoned | content-missing | user-cancelled",
    "message": "Subprocess exited with code 127",
    "exitCode": 127,
    "durationMs": 180000
  }
}
```

`reason` enum matches [`execution-record.schema.json`](./schemas/execution-record.schema.json) `failureReason`. `message` is human-readable free-form; MAY be truncated for display.

> **Hookable** — see [`architecture.md` §Hook · curated trigger set](./architecture.md#hook--curated-trigger-set). Hook subscribers commonly use this event for alerting and retry triggers. Filter by `data.reason` to narrow to a specific failure mode.

### `run.summary`

Emitted once at the end of `sm job run`, after the last job event.

```json
{
  "type": "run.summary",
  "timestamp": 1745159475000,
  "runId": "...",
  "jobId": null,
  "data": {
    "jobsAttempted": 5,
    "jobsCompleted": 4,
    "jobsFailed": 1,
    "totalDurationMs": 20000,
    "totalTokensIn": 12500,
    "totalTokensOut": 5300
  }
}
```

`jobsAttempted = jobsCompleted + jobsFailed` always.

---

## Ordering rules

For each job, the normative order is:

```
job.claimed → job.spawning → (model.delta)* → job.callback.received → (job.completed | job.failed)
```

For a run:

```
run.started
  → run.reap.started → run.reap.completed
  → (per-job sequence above)*
  → run.summary
```

A parallel implementation MAY interleave per-job sequences across different `jobId` values, but MUST preserve ordering within a single `jobId`.

`job.failed` with reason `abandoned` MAY appear without a matching `job.claimed` in the current run — it refers to a job claimed in a previous run that expired before the next reap.

---

## Non-job events (Stability: experimental)

These event families cover kernel activity other than job execution. They share the common envelope (`type`, `timestamp`, `runId`, `jobId`, `data`). For non-job events `jobId` is always `null`; `runId` identifies the invocation that produced the event — a scan gets an `r-scan-YYYYMMDD-HHMMSS-XXXX` id, an issue recomputation outside a scan gets an `r-check-...` id, following the same `r-<mode>-...` shape as the external-Skill synthetic envelope (`r-ext-...`).

The **shapes below are experimental through spec v0.x**. The reference impl starts emitting them at Step 13 alongside the WebSocket broadcaster; once real consumers exercise the stream, the fields lock. Bumping them to `stable` is a minor spec bump; changes to field shapes before `stable` are allowed without a major bump (per [`versioning.md`](./versioning.md) §Pre-1.0).

### Scan events

#### `scan.started`

Emitted once when a scan begins (full, `--changed`, or `-n <node.path>`).

```json
{
  "type": "scan.started",
  "timestamp": 1745159455123,
  "runId": "r-scan-20260420-143055-a3f2",
  "jobId": null,
  "data": {
    "mode": "full | changed | single",
    "target": "<node.path> | null",
    "rootsCount": 1
  }
}
```

> **Hookable** — see [`architecture.md` §Hook · curated trigger set](./architecture.md#hook--curated-trigger-set). Pre-scan setup, telemetry init.

#### `scan.progress`

Emitted periodically during a scan (implementation-defined cadence; SHOULD throttle to ≥250 ms apart to keep WS traffic cheap).

```json
{
  "type": "scan.progress",
  "timestamp": 1745159455500,
  "runId": "...",
  "jobId": null,
  "data": {
    "filesSeen": 128,
    "filesProcessed": 64,
    "filesSkipped": 3
  }
}
```

#### `scan.completed`

Emitted once at scan end.

```json
{
  "type": "scan.completed",
  "timestamp": 1745159456000,
  "runId": "...",
  "jobId": null,
  "data": {
    "nodes": 187,
    "links": 421,
    "issues": 12,
    "durationMs": 877
  }
}
```

> **Hookable** — see [`architecture.md` §Hook · curated trigger set](./architecture.md#hook--curated-trigger-set). Post-scan reaction (Slack notification, CI gate, summary email).

#### `extractor.completed`

Emitted once per registered Extractor, after the full walk completes. Aggregated, NOT per-node — per-node fan-out lives in `scan.progress`, which is intentionally not hookable.

```json
{
  "type": "extractor.completed",
  "timestamp": 1745159455900,
  "runId": "...",
  "jobId": null,
  "data": {
    "extractorId": "core/external-url-counter"
  }
}
```

`extractorId` is the qualified extension id (`<plugin-id>/<id>`).

> **Hookable** — see [`architecture.md` §Hook · curated trigger set](./architecture.md#hook--curated-trigger-set). Per-Extractor metrics, audit. Filter by `data.extractorId` to scope to a single Extractor.

#### `rule.completed`

Emitted once per registered Rule, after every issue has been validated.

```json
{
  "type": "rule.completed",
  "timestamp": 1745159455950,
  "runId": "...",
  "jobId": null,
  "data": {
    "ruleId": "core/superseded"
  }
}
```

`ruleId` is the qualified extension id.

> **Hookable** — see [`architecture.md` §Hook · curated trigger set](./architecture.md#hook--curated-trigger-set). Per-Rule alerting, downstream tooling. Filter by `data.ruleId`.

#### `action.completed`

Emitted once per Action invocation, after the report has been recorded.

```json
{
  "type": "action.completed",
  "timestamp": 1745159465500,
  "runId": "...",
  "jobId": "...",
  "data": {
    "actionId": "claude/skill-summarizer",
    "node": { "path": "skills/my-skill.md", "kind": "skill" },
    "jobResult": { "tokensIn": 2431, "tokensOut": 1072 }
  }
}
```

`actionId` is the qualified extension id; `node` carries the target node summary (full `Node` shape per [`schemas/node.schema.json`](./schemas/node.schema.json) is forward-compatible). Lands alongside the job subsystem at Step 10.

> **Hookable** — see [`architecture.md` §Hook · curated trigger set](./architecture.md#hook--curated-trigger-set). Per-Action notification, integration glue. Filter by `data.actionId`.

### Issue events

Emitted by the scan after `scan.completed` when the new scan's issue set differs from the previous one. Enables a UI "issue inbox" to update incrementally without re-fetching the full list.

#### `issue.added`

```json
{
  "type": "issue.added",
  "timestamp": 1745159456100,
  "runId": "...",
  "jobId": null,
  "data": {
    "ruleId": "trigger-collision",
    "severity": "warn",
    "nodeIds": ["skills/a.md", "skills/b.md"],
    "message": "..."
  }
}
```

#### `issue.resolved`

Emitted when an issue present in the previous scan is absent from the new one.

```json
{
  "type": "issue.resolved",
  "timestamp": 1745159456101,
  "runId": "...",
  "jobId": null,
  "data": {
    "ruleId": "broken-ref",
    "nodeIds": ["skills/c.md"]
  }
}
```

Issue diffing is keyed on `(ruleId, nodeIds sorted, message)` — same key → same issue. A payload change on the same key emits no event; consumers re-read full issue detail from `sm check` when needed.

---

## Error handling

If an event payload cannot be serialized (internal bug), the implementation MUST emit a synthetic event:

```json
{
  "type": "emitter.error",
  "timestamp": <now>,
  "runId": "<runId>",
  "jobId": null,
  "data": {
    "message": "failed to emit event of type '<type>': <reason>"
  }
}
```

Consumers MAY treat `emitter.error` as a soft failure (log and continue). Implementations MUST NOT crash the run because of a serialization failure.

---

## See also

- [`architecture.md`](./architecture.md) — `ProgressEmitterPort` definition.
- [`job-lifecycle.md`](./job-lifecycle.md) — state machine that drives these events.
- [`cli-contract.md`](./cli-contract.md) — `--json` and `--stream-output` flag semantics.

---

## Stability

The **job event type list** (`run.*`, `job.*`, `model.delta`, `emitter.error`) is stable as of spec v1.0.0. Adding a new event type is a minor bump. Removing or renaming one is a major bump.

**Adding** fields to `data` is a minor bump. Changing a field's type or removing a field is a major bump.

Consumers MUST ignore unknown fields (forward compatibility).

The envelope (`type`, `timestamp`, `runId`, `jobId`, `data`) is stable. Adding an envelope field is a major bump because every consumer would need to handle it.

The **non-job event families** (`scan.*`, `issue.*`, `extractor.completed`, `rule.completed`, `action.completed`) are marked **experimental** across spec v0.x. They ship alongside the WebSocket broadcaster at Step 13 of the reference impl; shapes may tighten before a stable tag lands. Once promoted to `stable` (a minor spec bump), the same add/remove/rename semantics as the job events apply.

The **Hook curated trigger set** (eight hookable lifecycle events; see [`architecture.md` §Hook · curated trigger set](./architecture.md#hook--curated-trigger-set)) is itself stable as of the same minor in which it lands: adding a hookable trigger is a minor bump, removing or renaming one is a major bump. The curation policy ("a hook subscribes only to a deliberately small set") is normative — surface noise reduction is the entire point.
