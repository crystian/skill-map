/**
 * `RunnerPort` — executes an action against a rendered job file.
 *
 * Step 0b: shape-only. `ClaudeCliRunner` + `MockRunner` land with Step 9
 * (job subsystem + first summarizer).
 */

export interface RunOptions {
  timeoutMs?: number;
  model?: string;
}

export interface RunResult {
  reportPath: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  exitCode: number;
}

export interface RunnerPort {
  run(jobFilePath: string, options?: RunOptions): Promise<RunResult>;
}
