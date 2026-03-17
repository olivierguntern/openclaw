import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { describe, expect, it, vi } from "vitest";
import { wrapStreamFnDowngradeOpenAIReasoningPairs } from "./downgrade-openai-reasoning-pairs.js";

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

async function invokeWrapped(messages: AgentMessage[]): Promise<AgentMessage[]> {
  let capturedMessages: AgentMessage[] = [];
  const baseFn = vi.fn((model: unknown, context: unknown) => {
    const ctx = context as { messages?: AgentMessage[] };
    capturedMessages = ctx.messages ?? [];
    return createFakeStream({});
  });

  const wrapped = wrapStreamFnDowngradeOpenAIReasoningPairs(baseFn as never);
  await Promise.resolve(wrapped({ role: "model" } as never, { messages } as never, {} as never));
  return capturedMessages;
}

describe("wrapStreamFnDowngradeOpenAIReasoningPairs", () => {
  it("passes through plain messages unchanged (reference equality)", async () => {
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
      {
        role: "assistant",
        content: [{ type: "text", text: "world" }],
      },
    ];

    const result = await invokeWrapped(messages);

    expect(result).toBe(messages);
  });

  it("forwards the call when context has no messages array", async () => {
    let called = false;
    const baseFn = vi.fn(() => {
      called = true;
      return createFakeStream({});
    });

    const wrapped = wrapStreamFnDowngradeOpenAIReasoningPairs(baseFn as never);
    await Promise.resolve(
      wrapped({ role: "model" } as never, { messages: "not-array" } as never, {} as never),
    );

    expect(called).toBe(true);
  });

  it("removes fc_ suffix from tool call IDs that lack a matching reasoning block", async () => {
    // A toolCall whose id ends with |fc_* but there is no preceding replayable reasoning block
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: [
          // Plain tool call with pairing suffix but no reasoning block
          { type: "toolCall", name: "read", id: "call_abc|fc_xyz", arguments: {} } as never,
        ],
      },
    ];

    const result = await invokeWrapped(messages);

    // The function should strip the |fc_* suffix
    const assistantMsg = result[0] as Extract<AgentMessage, { role: "assistant" }>;
    const block = assistantMsg.content[0] as { id?: string };
    expect(block.id).toBe("call_abc");
  });

  it("preserves the base stream result", async () => {
    const resultMsg = { role: "assistant", content: [{ type: "text", text: "ok" }] };
    const baseFn = vi.fn(() => createFakeStream(resultMsg));

    const wrapped = wrapStreamFnDowngradeOpenAIReasoningPairs(baseFn as never);
    const stream = (await Promise.resolve(
      wrapped({ role: "model" } as never, { messages: [] } as never, {} as never),
    )) as FakeStream;

    expect(await stream.result()).toBe(resultMsg);
  });
});
