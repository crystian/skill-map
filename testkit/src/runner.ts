/**
 * Fake `RunnerPort` placeholder. The kernel exposes `ctx.runner` to
 * probabilistic extensions so they can dispatch work to an LLM (the
 * deterministic half of the model never sees this port). The real
 * `RunnerPort` interface stabilizes when Step 10 lands the job
 * subsystem; until then this placeholder offers a queue-and-resolve
 * shape that lets plugin authors write probabilistic extensions
 * against a stable testkit surface even before the kernel finalizes
 * its contract.
 *
 * **Stability**: `experimental` until Step 10 ships. The shape and
 * field names will likely tighten then. The advice is: write tests
 * against `runRunnerOnce(...)` not against the underlying record
 * shape, because that record will change.
 */

export interface IFakeRunnerCall {
  /** Logical action invoked, e.g. `"summarize"` or a vendor-specific id. */
  action: string;
  /** Rendered prompt the runner would have sent to the LLM. */
  prompt: string;
  /** Free-form metadata the extension passed alongside the prompt. */
  metadata?: Record<string, unknown>;
}

export interface IFakeRunnerResponse {
  text: string;
  /** Optional structured output the runner extracted from the response. */
  data?: unknown;
}

export interface IFakeRunnerPort {
  /** Last call made to the runner; `undefined` if no call has happened. */
  readonly lastCall: IFakeRunnerCall | undefined;
  /** Every call in order, useful when the extension makes multiple. */
  readonly history: IFakeRunnerCall[];
  /**
   * Drive the runner with a canned response. Returns the same
   * response back, mirroring the real runner's resolve shape.
   */
  run(call: IFakeRunnerCall): Promise<IFakeRunnerResponse>;
  /**
   * Queue the next response. The runner serves them FIFO; an extra
   * `run` call after the queue empties resolves with the default.
   */
  queue(response: IFakeRunnerResponse): void;
  /** Reset the call history without dropping queued responses. */
  resetHistory(): void;
}

export interface IMakeFakeRunnerOptions {
  /** Default response served when the queue is empty. */
  default?: IFakeRunnerResponse;
}

const DEFAULT_RESPONSE: IFakeRunnerResponse = { text: '' };

/**
 * Build a fake `RunnerPort` for testing probabilistic extensions.
 *
 * Test pattern: queue the responses you expect, invoke the extension
 * with `ctx.runner = makeFakeRunner(...)`, then assert on `runner.history`
 * to verify the extension passed the right prompt.
 *
 * @example
 *   const runner = makeFakeRunner();
 *   runner.queue({ text: '5 nodes summarized' });
 *   const result = await myAction.run({ runner, ... });
 *   assert.equal(runner.history[0].action, 'skill-summarizer');
 */
export function makeFakeRunner(opts: IMakeFakeRunnerOptions = {}): IFakeRunnerPort {
  const fallback = opts.default ?? DEFAULT_RESPONSE;
  const queued: IFakeRunnerResponse[] = [];
  const history: IFakeRunnerCall[] = [];

  return {
    get lastCall(): IFakeRunnerCall | undefined {
      return history[history.length - 1];
    },
    get history(): IFakeRunnerCall[] {
      return history;
    },
    async run(call: IFakeRunnerCall): Promise<IFakeRunnerResponse> {
      history.push(call);
      return queued.length > 0 ? queued.shift()! : fallback;
    },
    queue(response: IFakeRunnerResponse): void {
      queued.push(response);
    },
    resetHistory(): void {
      history.length = 0;
    },
  };
}
