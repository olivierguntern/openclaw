import type { StreamFn } from "@mariozechner/pi-agent-core";
import { createYieldAbortedResponse } from "../../sessions-yield.js";

/**
 * Short-circuits the stream with a synthetic aborted response when
 * `sessions_yield` has triggered and the run abort signal is set.
 * Must be installed after the abort controller is wired to `onYield`.
 */
export function wrapStreamFnYieldAbortGuard(
  baseFn: StreamFn,
  opts: {
    signal: AbortSignal & { reason?: unknown };
    isYieldAborted: () => boolean;
  },
): StreamFn {
  return (model, context, options) => {
    if (opts.isYieldAborted()) {
      return createYieldAbortedResponse(model) as unknown as Awaited<ReturnType<StreamFn>>;
    }
    return baseFn(model, context, options);
  };
}
