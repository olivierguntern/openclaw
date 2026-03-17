import type { AgentMessage, StreamFn } from "@mariozechner/pi-agent-core";
import type { ToolCallIdMode } from "../../../../tool-call-id.js";
import { sanitizeToolCallIdsForCloudCodeAssist } from "../../../../tool-call-id.js";
import { wrapStreamFnWithMessageTransform } from "./message-transform.js";

/**
 * Sanitizes tool call IDs on every outbound request.
 * Needed for strict providers (Mistral, Cloud Code Assist) that reject IDs
 * not matching their format requirements.
 */
export function wrapStreamFnSanitizeToolCallIds(baseFn: StreamFn, mode: ToolCallIdMode): StreamFn {
  return wrapStreamFnWithMessageTransform(baseFn, (messages: AgentMessage[]) =>
    sanitizeToolCallIdsForCloudCodeAssist(messages, mode),
  );
}
