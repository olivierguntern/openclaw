import type { StreamFn } from "@mariozechner/pi-agent-core";

export type AbortGuardOptions = {
  /**
   * Called before each stream invocation.  When this returns `true` the call
   * is short-circuited: `createAbortedResponse` is used to produce a
   * synthetic stream result instead of delegating to the base function.
   */
  shouldAbort: () => boolean;
  /**
   * Produces the synthetic stream object returned when `shouldAbort()` is
   * true.  Receives the model argument so the response can be typed
   * correctly by callers that inspect it.
   */
  createAbortedResponse: (model: unknown) => unknown;
};

/**
 * Generic guard stage that short-circuits the stream pipeline when a
 * condition is met.  Use it as the building block for any "bail out early"
 * scenario (yield detected, quota exceeded, user cancellation, …).
 */
export function wrapStreamFnWithAbortGuard(baseFn: StreamFn, opts: AbortGuardOptions): StreamFn {
  return (model, context, options) => {
    if (opts.shouldAbort()) {
      return opts.createAbortedResponse(model) as never;
    }
    return baseFn(model, context, options);
  };
}
