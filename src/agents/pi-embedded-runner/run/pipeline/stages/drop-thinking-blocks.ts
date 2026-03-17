import type { StreamFn } from "@mariozechner/pi-agent-core";
import { dropThinkingBlocks } from "../../../thinking.js";
import { wrapStreamFnWithMessageTransform } from "./message-transform.js";

/**
 * Strips thinking blocks from outbound context before each LLM call.
 * Anthropic endpoints reject replayed `thinking` blocks on follow-up calls.
 */
export function wrapStreamFnDropThinkingBlocks(baseFn: StreamFn): StreamFn {
  return wrapStreamFnWithMessageTransform(baseFn, dropThinkingBlocks);
}
