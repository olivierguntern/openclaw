import type { StreamFn } from "@mariozechner/pi-agent-core";
import { downgradeOpenAIFunctionCallReasoningPairs } from "../../../../pi-embedded-helpers.js";
import { wrapStreamFnWithMessageTransform } from "./message-transform.js";

/**
 * Removes reasoning-pair artifacts from OpenAI Responses/Codex API calls.
 * The API rejects messages that still carry function-call reasoning blocks.
 */
export function wrapStreamFnDowngradeOpenAIReasoningPairs(baseFn: StreamFn): StreamFn {
  return wrapStreamFnWithMessageTransform(baseFn, downgradeOpenAIFunctionCallReasoningPairs);
}
