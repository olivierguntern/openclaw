import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { NamedStage } from "./named-stage.js";

export type { StreamFn };
export type { NamedStage };
export { stage } from "./named-stage.js";
export { wrapStreamFnDropThinkingBlocks } from "./stages/drop-thinking-blocks.js";
export { wrapStreamFnDowngradeOpenAIReasoningPairs } from "./stages/downgrade-openai-reasoning-pairs.js";
export { wrapStreamFnSanitizeToolCallIds } from "./stages/sanitize-tool-call-ids.js";
export { wrapStreamFnYieldAbortGuard } from "./stages/yield-abort-guard.js";
export { wrapStreamFnWithAbortGuard } from "./stages/abort-guard.js";
export { wrapStreamFnWithMessageTransform } from "./stages/message-transform.js";
export { wrapStreamFnWithMetrics } from "./stages/stream-metrics.js";

/**
 * A StreamFn with an `activeStages` property listing the names of every
 * NamedStage that was applied (in application order).  Anonymous wrapper
 * functions do not appear in the list.
 */
export type PipelineStreamFn = StreamFn & { readonly activeStages: readonly string[] };

/**
 * Composes a base StreamFn with an ordered list of wrapper functions or
 * named stages.  Null/undefined entries are skipped.
 *
 * Named stages (objects with `{ name, wrap }`) are recorded in
 * `result.activeStages`; plain functions are applied silently.
 *
 *   buildStreamPipeline(base, [
 *     stage("drop-thinking", wrapDropThinking),
 *     condition ? (fn) => wrapFoo(fn, opts) : null,
 *   ]);
 */
export function buildStreamPipeline(
  base: StreamFn,
  wrappers: ReadonlyArray<NamedStage | ((fn: StreamFn) => StreamFn) | null | undefined>,
): PipelineStreamFn {
  const activeStages: string[] = [];
  const fn = wrappers.reduce((fn: StreamFn, w) => {
    if (!w) {
      return fn;
    }
    if (typeof w === "function") {
      return w(fn);
    }
    activeStages.push(w.name);
    return w.wrap(fn);
  }, base);
  (fn as PipelineStreamFn & { activeStages: string[] }).activeStages = activeStages;
  return fn as PipelineStreamFn;
}
