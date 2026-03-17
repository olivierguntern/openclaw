import type { AgentMessage, StreamFn } from "@mariozechner/pi-agent-core";
import { downgradeOpenAIFunctionCallReasoningPairs } from "../../../../pi-embedded-helpers.js";

/**
 * Removes reasoning-pair artifacts from OpenAI Responses/Codex API calls.
 * The API rejects messages that still carry function-call reasoning blocks.
 */
export function wrapStreamFnDowngradeOpenAIReasoningPairs(baseFn: StreamFn): StreamFn {
  return (model, context, options) => {
    const ctx = context as unknown as { messages?: unknown };
    const messages = ctx?.messages;
    if (!Array.isArray(messages)) {
      return baseFn(model, context, options);
    }
    const sanitized = downgradeOpenAIFunctionCallReasoningPairs(messages as AgentMessage[]);
    if (sanitized === messages) {
      return baseFn(model, context, options);
    }
    const nextContext = {
      ...(context as unknown as Record<string, unknown>),
      messages: sanitized,
    } as unknown;
    return baseFn(model, nextContext as typeof context, options);
  };
}
