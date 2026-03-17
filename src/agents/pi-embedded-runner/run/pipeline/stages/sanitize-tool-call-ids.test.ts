import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { describe, expect, it, vi } from "vitest";
import { wrapStreamFnSanitizeToolCallIds } from "./sanitize-tool-call-ids.js";

type FakeStream = {
  result: () => Promise<unknown>;
  [Symbol.asyncIterator]: () => AsyncIterator<unknown>;
};

function createFakeStream(resultMessage: unknown): FakeStream {
  return {
    async result() {
      return resultMessage;
    },
    [Symbol.asyncIterator]() {
      return (async function* () {})();
    },
  };
}

async function invokeWrapped(
  messages: AgentMessage[],
  mode: "strict" | "strict9" = "strict",
): Promise<AgentMessage[]> {
  let capturedMessages: AgentMessage[] = [];
  const baseFn = vi.fn((model: unknown, context: unknown) => {
    const ctx = context as { messages?: AgentMessage[] };
    capturedMessages = ctx.messages ?? [];
    return createFakeStream({});
  });

  const wrapped = wrapStreamFnSanitizeToolCallIds(baseFn as never, mode);
  await Promise.resolve(wrapped({ role: "model" } as never, { messages } as never, {} as never));
  return capturedMessages;
}

describe("wrapStreamFnSanitizeToolCallIds", () => {
  it("passes through valid strict tool call IDs unchanged (reference equality)", async () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: [{ type: "toolCall", name: "read", id: "abcdefghi", arguments: {} } as never],
      },
    ];

    const result = await invokeWrapped(messages);

    // sanitizeToolCallIdsForCloudCodeAssist returns the same reference when nothing changed
    expect(result).toBe(messages);
  });

  it("sanitizes tool call IDs that contain invalid characters for strict mode", async () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: [
          // ID with a hyphen is invalid for strict9 (only [a-zA-Z0-9]{9})
          { type: "toolCall", name: "read", id: "call_xyz-1", arguments: {} } as never,
        ],
      },
    ];

    const result = await invokeWrapped(messages, "strict9");

    // Should return a new array (modified IDs)
    const assistantMsg = result[0] as Extract<AgentMessage, { role: "assistant" }>;
    const block = assistantMsg.content[0] as { id?: string; name: string; type: string };
    // The sanitized ID should be 9 alphanumeric chars
    expect(block.id).toMatch(/^[a-zA-Z0-9]{9}$/);
  });

  it("passes through messages when context has no messages array", async () => {
    let called = false;
    const baseFn = vi.fn(() => {
      called = true;
      return createFakeStream({});
    });

    const wrapped = wrapStreamFnSanitizeToolCallIds(baseFn as never, "strict");
    await Promise.resolve(
      wrapped({ role: "model" } as never, { messages: null } as never, {} as never),
    );

    expect(called).toBe(true);
  });

  it("does not alter user messages that have no tool call IDs", async () => {
    const messages: AgentMessage[] = [{ role: "user", content: [{ type: "text", text: "hello" }] }];

    const result = await invokeWrapped(messages, "strict");

    expect(result).toBe(messages);
  });

  it("preserves result from the base stream", async () => {
    const resultMsg = { role: "assistant", content: [{ type: "text", text: "done" }] };
    const baseFn = vi.fn(() => createFakeStream(resultMsg));

    const wrapped = wrapStreamFnSanitizeToolCallIds(baseFn as never, "strict");
    const stream = (await Promise.resolve(
      wrapped({ role: "model" } as never, { messages: [] } as never, {} as never),
    )) as FakeStream;

    expect(await stream.result()).toBe(resultMsg);
  });
});
