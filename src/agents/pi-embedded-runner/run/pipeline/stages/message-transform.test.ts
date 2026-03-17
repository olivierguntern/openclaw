import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { describe, expect, it, vi } from "vitest";
import { wrapStreamFnWithMessageTransform } from "./message-transform.js";

function makeStream() {
  return { [Symbol.asyncIterator]: () => (async function* () {})() } as never;
}

describe("wrapStreamFnWithMessageTransform", () => {
  it("calls transform with the messages array", async () => {
    const messages: AgentMessage[] = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
    const transform = vi.fn((msgs: AgentMessage[]) => msgs);
    const baseFn = vi.fn(() => makeStream());
    const wrapped = wrapStreamFnWithMessageTransform(baseFn as never, transform);

    await Promise.resolve(wrapped({} as never, { messages } as never, {} as never));
    expect(transform).toHaveBeenCalledWith(messages);
  });

  it("passes original context unchanged when transform returns same reference", async () => {
    const messages: AgentMessage[] = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
    const transform = (msgs: AgentMessage[]) => msgs; // same ref
    let capturedContext: unknown;
    const baseFn = vi.fn((_model: unknown, context: unknown) => {
      capturedContext = context;
      return makeStream();
    });

    const originalContext = { messages, extra: "value" };
    const wrapped = wrapStreamFnWithMessageTransform(baseFn as never, transform);
    await Promise.resolve(wrapped({} as never, originalContext as never, {} as never));

    expect(capturedContext).toBe(originalContext);
  });

  it("passes updated context when transform returns a new array", async () => {
    const messages: AgentMessage[] = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
    const newMessages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "transformed" }] },
    ];
    const transform = () => newMessages;
    let capturedContext: unknown;
    const baseFn = vi.fn((_model: unknown, context: unknown) => {
      capturedContext = context;
      return makeStream();
    });

    const originalContext = { messages, extra: "value" };
    const wrapped = wrapStreamFnWithMessageTransform(baseFn as never, transform);
    await Promise.resolve(wrapped({} as never, originalContext as never, {} as never));

    const ctx = capturedContext as Record<string, unknown>;
    expect(ctx.messages).toBe(newMessages);
    // Other context fields are preserved.
    expect(ctx.extra).toBe("value");
  });

  it("bypasses transform and calls base directly when messages is not an array", async () => {
    const transform = vi.fn();
    let called = false;
    const baseFn = vi.fn(() => {
      called = true;
      return makeStream();
    });

    const wrapped = wrapStreamFnWithMessageTransform(baseFn as never, transform);
    await Promise.resolve(wrapped({} as never, { messages: "nope" } as never, {} as never));

    expect(called).toBe(true);
    expect(transform).not.toHaveBeenCalled();
  });

  it("bypasses transform when context has no messages key", async () => {
    const transform = vi.fn();
    let called = false;
    const baseFn = vi.fn(() => {
      called = true;
      return makeStream();
    });

    const wrapped = wrapStreamFnWithMessageTransform(baseFn as never, transform);
    await Promise.resolve(wrapped({} as never, {} as never, {} as never));

    expect(called).toBe(true);
    expect(transform).not.toHaveBeenCalled();
  });

  it("forwards model and options to the base function", async () => {
    const messages: AgentMessage[] = [];
    let capturedModel: unknown;
    let capturedOptions: unknown;
    const baseFn = vi.fn((model: unknown, _ctx: unknown, options: unknown) => {
      capturedModel = model;
      capturedOptions = options;
      return makeStream();
    });

    const model = { id: "gpt-4" };
    const options = { temperature: 0.7 };
    const wrapped = wrapStreamFnWithMessageTransform(baseFn as never, (m) => m);
    await Promise.resolve(wrapped(model as never, { messages } as never, options as never));

    expect(capturedModel).toBe(model);
    expect(capturedOptions).toBe(options);
  });
});
