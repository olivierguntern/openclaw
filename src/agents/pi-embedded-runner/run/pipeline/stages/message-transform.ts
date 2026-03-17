import type { AgentMessage, StreamFn } from "@mariozechner/pi-agent-core";

/**
 * Generic stage that applies a pure message-array transform before each LLM
 * call.  The transform receives the current messages, returns a (possibly new)
 * array, and the updated context is forwarded to the inner stream function.
 *
 * When the transform returns the **same reference** nothing is forwarded —
 * the inner function is called with the original context unchanged.
 *
 * Used as the shared skeleton for drop-thinking-blocks, sanitize-tool-call-ids,
 * and downgrade-openai-reasoning-pairs so the boilerplate lives in one place.
 */
export function wrapStreamFnWithMessageTransform(
  baseFn: StreamFn,
  transform: (messages: AgentMessage[]) => AgentMessage[],
): StreamFn {
  return (model, context, options) => {
    const ctx = context as unknown as { messages?: unknown };
    const messages = ctx?.messages;
    if (!Array.isArray(messages)) {
      return baseFn(model, context, options);
    }
    const transformed = transform(messages as AgentMessage[]);
    if (transformed === messages) {
      return baseFn(model, context, options);
    }
    const nextContext = {
      ...(context as unknown as Record<string, unknown>),
      messages: transformed,
    } as unknown;
    return baseFn(model, nextContext as typeof context, options);
  };
}
