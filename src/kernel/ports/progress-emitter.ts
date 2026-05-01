/**
 * `ProgressEmitterPort` — emits progress events during long operations.
 *
 * Shape-only today. The full event catalog (`run.started`,
 * `job.claimed`, `model.delta`, etc.) is normative in
 * `spec/job-events.md`; this port carries an open `data` payload so
 * adapters can emit any documented event without type churn.
 */

export interface ProgressEvent {
  type: string;
  timestamp: string;
  runId?: string;
  jobId?: string;
  data?: unknown;
}

export type ProgressListener = (event: ProgressEvent) => void;

export interface ProgressEmitterPort {
  emit(event: ProgressEvent): void;
  subscribe(listener: ProgressListener): () => void;
}
