import type { AgentMessage, StreamFn } from "@mariozechner/pi-agent-core";
import { dropThinkingBlocks } from "../../../thinking.js";

/**
 * Strips thinking blocks from outbound context before each LLM call.
 * Anthropic endpoints reject replayed `thinking` blocks on follow-up calls.
 */
export function wrapStreamFnDropThinkingBlocks(baseFn: StreamFn): StreamFn {
  return (model, context, options) => {
    const ctx = context as unknown as { messages?: unknown };
    const messages = ctx?.messages;
    if (!Array.isArray(messages)) {
      return baseFn(model, context, options);
    }
    const sanitized = dropThinkingBlocks(messages as unknown as AgentMessage[]) as unknown;
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
