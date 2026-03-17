import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { describe, expect, it, vi } from "vitest";
import { wrapStreamFnDropThinkingBlocks } from "./drop-thinking-blocks.js";

type FakeStream = {
  result: () => Promise<unknown>;
  [Symbol.asyncIterator]: () => AsyncIterator<unknown>;
};

function createFakeStream(params: { resultMessage: unknown; events?: unknown[] }): FakeStream {
  const events = params.events ?? [];
  return {
    async result() {
      return params.resultMessage;
    },
    [Symbol.asyncIterator]() {
      return (async function* () {
        for (const event of events) {
          yield event;
        }
      })();
    },
  };
}

async function invokeWrapped(
  messages: AgentMessage[],
  resultMessage: unknown = {},
): Promise<{ capturedMessages: AgentMessage[]; stream: FakeStream }> {
  let capturedMessages: AgentMessage[] = [];
  const baseFn = vi.fn((model: unknown, context: unknown) => {
    const ctx = context as { messages?: AgentMessage[] };
    capturedMessages = ctx.messages ?? [];
    return createFakeStream({ resultMessage });
  });

  const wrapped = wrapStreamFnDropThinkingBlocks(baseFn as never);
  const stream = (await Promise.resolve(
    wrapped({ role: "model" } as never, { messages } as never, {} as never),
  )) as FakeStream;

  return { capturedMessages, stream };
}

describe("wrapStreamFnDropThinkingBlocks", () => {
  it("passes through messages with no thinking blocks unchanged (reference equality)", async () => {
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "text", text: "hello" }] },
    ];

    const { capturedMessages } = await invokeWrapped(messages);

    expect(capturedMessages).toBe(messages);
  });

  it("strips thinking blocks from assistant messages", async () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "let me reason" } as never,
          { type: "text", text: "answer" },
        ],
      },
    ];

    const { capturedMessages } = await invokeWrapped(messages);

    expect(capturedMessages).not.toBe(messages);
    const assistantMsg = capturedMessages[0] as Extract<AgentMessage, { role: "assistant" }>;
    expect(assistantMsg.content).toHaveLength(1);
    expect(assistantMsg.content[0]).toMatchObject({ type: "text", text: "answer" });
  });

  it("replaces a thinking-only assistant message with an empty text block", async () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: [{ type: "thinking", thinking: "internal reasoning" } as never],
      },
    ];

    const { capturedMessages } = await invokeWrapped(messages);

    const assistantMsg = capturedMessages[0] as Extract<AgentMessage, { role: "assistant" }>;
    expect(assistantMsg.content).toEqual([{ type: "text", text: "" }]);
  });

  it("leaves user messages and non-assistant messages untouched", async () => {
    const userMsg: AgentMessage = { role: "user", content: [{ type: "text", text: "query" }] };
    const messages: AgentMessage[] = [userMsg];

    const { capturedMessages } = await invokeWrapped(messages);

    expect(capturedMessages).toBe(messages);
    expect(capturedMessages[0]).toBe(userMsg);
  });

  it("forwards the call when context has no messages array", async () => {
    let called = false;
    const baseFn = vi.fn(() => {
      called = true;
      return createFakeStream({ resultMessage: {} });
    });

    const wrapped = wrapStreamFnDropThinkingBlocks(baseFn as never);
    await Promise.resolve(
      wrapped({ role: "model" } as never, { messages: "not-an-array" } as never, {} as never),
    );

    expect(called).toBe(true);
  });

  it("forwards the call when context has no messages key", async () => {
    let called = false;
    const baseFn = vi.fn(() => {
      called = true;
      return createFakeStream({ resultMessage: {} });
    });

    const wrapped = wrapStreamFnDropThinkingBlocks(baseFn as never);
    await Promise.resolve(wrapped({ role: "model" } as never, {} as never, {} as never));

    expect(called).toBe(true);
  });

  it("preserves the stream result from the base function", async () => {
    const resultMessage = { role: "assistant", content: [{ type: "text", text: "done" }] };
    const { stream } = await invokeWrapped(
      [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      resultMessage,
    );

    const result = await stream.result();
    expect(result).toBe(resultMessage);
  });
});
