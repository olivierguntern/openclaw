import { describe, expect, it, vi } from "vitest";
import { wrapStreamFnWithAbortGuard } from "./abort-guard.js";

function makeStream() {
  return { [Symbol.asyncIterator]: () => (async function* () {})() } as never;
}

describe("wrapStreamFnWithAbortGuard", () => {
  it("calls the base function when shouldAbort returns false", () => {
    const baseFn = vi.fn(() => makeStream());
    const wrapped = wrapStreamFnWithAbortGuard(baseFn as never, {
      shouldAbort: () => false,
      createAbortedResponse: () => ({ aborted: true }),
    });

    void wrapped({} as never, {} as never, {} as never);
    expect(baseFn).toHaveBeenCalledOnce();
  });

  it("returns aborted response and skips base fn when shouldAbort returns true", () => {
    const baseFn = vi.fn(() => makeStream());
    const abortedResponse = { aborted: true, reason: "quota" };
    const wrapped = wrapStreamFnWithAbortGuard(baseFn as never, {
      shouldAbort: () => true,
      createAbortedResponse: () => abortedResponse,
    });

    const result = wrapped({} as never, {} as never, {} as never);
    expect(baseFn).not.toHaveBeenCalled();
    expect(result).toBe(abortedResponse as never);
  });

  it("passes model to createAbortedResponse", () => {
    const model = { api: "openai", id: "gpt-4o" };
    let capturedModel: unknown;
    const wrapped = wrapStreamFnWithAbortGuard(vi.fn() as never, {
      shouldAbort: () => true,
      createAbortedResponse: (m) => {
        capturedModel = m;
        return makeStream();
      },
    });

    void wrapped(model as never, {} as never, {} as never);
    expect(capturedModel).toBe(model);
  });

  it("re-evaluates shouldAbort on each invocation", () => {
    let abortToggle = false;
    const baseFn = vi.fn(() => makeStream());
    const wrapped = wrapStreamFnWithAbortGuard(baseFn as never, {
      shouldAbort: () => abortToggle,
      createAbortedResponse: () => makeStream(),
    });

    // First call: not aborted — base fn called.
    void wrapped({} as never, {} as never, {} as never);
    expect(baseFn).toHaveBeenCalledTimes(1);

    // Second call: aborted — base fn NOT called.
    abortToggle = true;
    void wrapped({} as never, {} as never, {} as never);
    expect(baseFn).toHaveBeenCalledTimes(1);

    // Third call: no longer aborted — base fn called again.
    abortToggle = false;
    void wrapped({} as never, {} as never, {} as never);
    expect(baseFn).toHaveBeenCalledTimes(2);
  });

  it("forwards model, context, and options to base fn when not aborted", () => {
    let capturedArgs: unknown[] = [];
    const baseFn = vi.fn((...args: unknown[]) => {
      capturedArgs = args;
      return makeStream();
    });
    const wrapped = wrapStreamFnWithAbortGuard(baseFn as never, {
      shouldAbort: () => false,
      createAbortedResponse: () => makeStream(),
    });

    const model = { id: "m" };
    const context = { messages: [] };
    const options = { maxTokens: 100 };
    void wrapped(model as never, context as never, options as never);

    expect(capturedArgs[0]).toBe(model);
    expect(capturedArgs[1]).toBe(context);
    expect(capturedArgs[2]).toBe(options);
  });
});
