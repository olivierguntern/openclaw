import type { StreamFn } from "@mariozechner/pi-agent-core";
import { createYieldAbortedResponse } from "../../sessions-yield.js";
import { wrapStreamFnWithAbortGuard } from "./abort-guard.js";

/**
 * Short-circuits the stream with a synthetic aborted response when
 * `sessions_yield` has triggered and the run abort signal is set.
 * Implemented as a specialisation of `wrapStreamFnWithAbortGuard`.
 */
export function wrapStreamFnYieldAbortGuard(
  baseFn: StreamFn,
  opts: {
    signal: AbortSignal & { reason?: unknown };
    isYieldAborted: () => boolean;
  },
): StreamFn {
  return wrapStreamFnWithAbortGuard(baseFn, {
    shouldAbort: opts.isYieldAborted,
    createAbortedResponse: (model) => createYieldAbortedResponse(model),
  });
}
