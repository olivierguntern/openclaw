import type { AgentMessage, StreamFn } from "@mariozechner/pi-agent-core";
import type { ToolCallIdMode } from "../../../../tool-call-id.js";
import { sanitizeToolCallIdsForCloudCodeAssist } from "../../../../tool-call-id.js";

/**
 * Sanitizes tool call IDs on every outbound request.
 * Needed for strict providers (Mistral, Cloud Code Assist) that reject IDs
 * not matching their format requirements.
 */
export function wrapStreamFnSanitizeToolCallIds(
  baseFn: StreamFn,
  mode: ToolCallIdMode,
): StreamFn {
  return (model, context, options) => {
    const ctx = context as unknown as { messages?: unknown };
    const messages = ctx?.messages;
    if (!Array.isArray(messages)) {
      return baseFn(model, context, options);
    }
    const sanitized = sanitizeToolCallIdsForCloudCodeAssist(messages as AgentMessage[], mode);
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
