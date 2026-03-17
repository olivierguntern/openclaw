import type { StreamFn } from "@mariozechner/pi-agent-core";

export type { StreamFn };
export { wrapStreamFnDropThinkingBlocks } from "./stages/drop-thinking-blocks.js";
export { wrapStreamFnDowngradeOpenAIReasoningPairs } from "./stages/downgrade-openai-reasoning-pairs.js";
export { wrapStreamFnSanitizeToolCallIds } from "./stages/sanitize-tool-call-ids.js";
export { wrapStreamFnYieldAbortGuard } from "./stages/yield-abort-guard.js";

/**
 * Composes a base StreamFn with an ordered list of wrapper functions.
 * Null/undefined entries are skipped, making conditional stages readable:
 *
 *   buildStreamPipeline(base, [
 *     condition ? (fn) => wrapFoo(fn, opts) : null,
 *     wrapBar,
 *   ]);
 */
export function buildStreamPipeline(
  base: StreamFn,
  wrappers: ReadonlyArray<((fn: StreamFn) => StreamFn) | null | undefined>,
): StreamFn {
  return wrappers.reduce((fn: StreamFn, wrap) => (wrap ? wrap(fn) : fn), base);
}
