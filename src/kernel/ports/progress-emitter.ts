/**
 * `ProgressEmitterPort` — emits progress events during long operations.
 *
 * Step 0b: shape-only. Full event catalog (`run.started`, `job.claimed`,
 * `model.delta`, etc.) lands with Step 10. See `spec/job-events.md`.
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
