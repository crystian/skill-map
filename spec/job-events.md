# Job events

Canonical event stream emitted during job execution. Every implementation MUST emit these events in the order described, with the shapes defined below. Consumers include the CLI pretty printer, the `--json` ndjson output, the Server's WebSocket broadcaster, and any third-party integration.

This document is **normative**. The set of event types, their payload shapes, and their ordering rules are stable contracts.

---

## Transport

Events are records produced by the kernel through `ProgressEmitterPort` (see `architecture.md`). An implementation MUST provide three output adapters:

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
| `runId` | always | Identifier of the `sm job run` invocation. One run emits many events. Format: `r-YYYYMMDD-HHMMSS-XXXX`. |
| `jobId` | when job-scoped | The job the event refers to. Null for run-level events (`run.*`). |
| `data` | per-event | Event-specific payload, shape defined below. |

Implementations MUST include every envelope field in every event, even if `jobId` is null. This simplifies consumers.

Unknown fields in `data` MUST be ignored by consumers (forward compatibility).

---

## Event catalog

Emitted in roughly this order during a `sm job run --all` invocation. The exact sequence may interleave for parallel runs (post-MVP).

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

Emitted when the runner is about to execute the job file.

```json
{
  "type": "job.spawning",
  "timestamp": 1745159455500,
  "runId": "...",
  "jobId": "...",
  "data": {
    "runner": "cli | skill | in-process",
    "command": "claude -p",
    "jobFilePath": ".skill-map/jobs/d-20260420-143055-b001.md"
  }
}
```

`command` is implementation-defined free-form; it is descriptive, not invokable.

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
    "reportPath": ".skill-map/reports/d-20260420-143055-b001.json"
  }
}
```

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
    "reportPath": ".skill-map/reports/d-20260420-143055-b001.json"
  }
}
```

### `job.failed`

Emitted when a job transitions to `failed` by any path.

```json
{
  "type": "job.failed",
  "timestamp": 1745159465200,
  "runId": "...",
  "jobId": "...",
  "data": {
    "reason": "runner-error | report-invalid | timeout | abandoned | job-file-missing | user-cancelled",
    "message": "Subprocess exited with code 127",
    "exitCode": 127,
    "durationMs": 180000
  }
}
```

`reason` enum matches `execution-record.failureReason`. `message` is human-readable free-form; MAY be truncated for display.

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

## Stability

The **event type list** above is stable as of spec v1.0.0. Adding a new event type is a minor bump. Removing or renaming one is a major bump.

**Adding** fields to `data` is a minor bump. Changing a field's type or removing a field is a major bump.

Consumers MUST ignore unknown fields (forward compatibility).

The envelope (`type`, `timestamp`, `runId`, `jobId`, `data`) is stable. Adding an envelope field is a major bump because every consumer would need to handle it.
