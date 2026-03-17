import { describe, expect, it, vi } from "vitest";
import { wrapStreamFnYieldAbortGuard } from "./yield-abort-guard.js";

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

function makeSignal(aborted: boolean, reason?: unknown): AbortSignal & { reason?: unknown } {
  const controller = new AbortController();
  const signal = controller.signal as AbortSignal & { reason?: unknown };
  if (aborted) {
    controller.abort(reason);
  }
  return signal;
}

describe("wrapStreamFnYieldAbortGuard", () => {
  it("delegates to base function when yield has not been detected", async () => {
    const expected = createFakeStream({ text: "ok" });
    const baseFn = vi.fn(() => expected);
    const signal = makeSignal(false);

    const wrapped = wrapStreamFnYieldAbortGuard(baseFn as never, {
      signal,
      isYieldAborted: () => false,
    });
    const result = wrapped({ role: "model" } as never, {} as never, {} as never);

    expect(baseFn).toHaveBeenCalledOnce();
    expect(result).toBe(expected);
  });

  it("returns a synthetic aborted response when isYieldAborted() is true", async () => {
    const baseFn = vi.fn(() => createFakeStream({}));
    const signal = makeSignal(true, "sessions_yield");

    const wrapped = wrapStreamFnYieldAbortGuard(baseFn as never, {
      signal,
      isYieldAborted: () => true,
    });
    const result = wrapped({ role: "model" } as never, {} as never, {} as never);

    expect(baseFn).not.toHaveBeenCalled();
    // The returned value should be a thenable (async-iterable stream object)
    expect(result).toBeTruthy();
  });

  it("continues delegating after yield guard returns false", async () => {
    const expected = createFakeStream({ text: "go" });
    const baseFn = vi.fn(() => expected);
    const signal = makeSignal(false);

    let yieldActive = false;
    const wrapped = wrapStreamFnYieldAbortGuard(baseFn as never, {
      signal,
      isYieldAborted: () => yieldActive,
    });

    // First call: not aborted
    const r1 = wrapped({ role: "model" } as never, {} as never, {} as never);
    expect(r1).toBe(expected);
    expect(baseFn).toHaveBeenCalledTimes(1);

    // Second call: still not aborted
    const r2 = wrapped({ role: "model" } as never, {} as never, {} as never);
    expect(r2).toBe(expected);
    expect(baseFn).toHaveBeenCalledTimes(2);

    // After yield fires
    yieldActive = true;
    const r3 = wrapped({ role: "model" } as never, {} as never, {} as never);
    expect(r3).not.toBe(expected);
    expect(baseFn).toHaveBeenCalledTimes(2); // no new call
  });

  it("passes the model argument to createYieldAbortedResponse (returns a valid stream shape)", async () => {
    const baseFn = vi.fn();
    const signal = makeSignal(true, "sessions_yield");
    const model = { provider: "anthropic", id: "claude-3" };

    const wrapped = wrapStreamFnYieldAbortGuard(baseFn as never, {
      signal,
      isYieldAborted: () => true,
    });

    const result = wrapped(model as never, {} as never, {} as never);

    // createYieldAbortedResponse returns an object with a result() method
    expect(result).toBeDefined();
    expect(typeof (result as { result?: unknown }).result).toBe("function");
  });
});
