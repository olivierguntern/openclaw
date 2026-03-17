import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { wrapStreamFnWithMetrics, type StreamCallMetrics } from "./stream-metrics.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAsyncStream(events: unknown[] = []) {
  return {
    result: async () => ({}),
    [Symbol.asyncIterator]() {
      return (async function* () {
        for (const e of events) {
          yield e;
        }
      })();
    },
  };
}

/** Drains an async iterable and returns all yielded values. */
async function drain(stream: ReturnType<typeof makeAsyncStream>): Promise<unknown[]> {
  const items: unknown[] = [];
  for await (const item of stream) {
    items.push(item);
  }
  return items;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("wrapStreamFnWithMetrics", () => {
  let performanceSpy: ReturnType<typeof vi.spyOn>;
  let tick = 0;

  beforeEach(() => {
    tick = 0;
    performanceSpy = vi.spyOn(performance, "now").mockImplementation(() => {
      // Each call to performance.now() advances by 10ms so tests are deterministic.
      return (tick += 10);
    });
  });

  afterEach(() => {
    performanceSpy.mockRestore();
  });

  it("reports eventCount and durationMs after stream exhaustion", async () => {
    const events = ["a", "b", "c"];
    const baseFn = vi.fn(() => makeAsyncStream(events) as never);
    let metrics: StreamCallMetrics | null = null;

    const wrapped = wrapStreamFnWithMetrics(baseFn as never, (m) => {
      metrics = m;
    });

    const stream = wrapped({} as never, {} as never, {} as never) as ReturnType<
      typeof makeAsyncStream
    >;
    await drain(stream);

    expect(metrics).not.toBeNull();
    expect(metrics!.eventCount).toBe(3);
    expect(metrics!.durationMs).toBeGreaterThan(0);
  });

  it("timeToFirstEventMs is less than or equal to durationMs for a non-empty stream", async () => {
    const baseFn = vi.fn(() => makeAsyncStream(["x", "y"]) as never);
    let metrics: StreamCallMetrics | null = null;

    const wrapped = wrapStreamFnWithMetrics(baseFn as never, (m) => {
      metrics = m;
    });

    const stream = wrapped({} as never, {} as never, {} as never) as ReturnType<
      typeof makeAsyncStream
    >;
    await drain(stream);

    expect(metrics!.timeToFirstEventMs).toBeLessThanOrEqual(metrics!.durationMs);
  });

  it("reports eventCount=0 and timeToFirstEventMs >= durationMs for an empty stream", async () => {
    const baseFn = vi.fn(() => makeAsyncStream([]) as never);
    let metrics: StreamCallMetrics | null = null;

    const wrapped = wrapStreamFnWithMetrics(baseFn as never, (m) => {
      metrics = m;
    });

    const stream = wrapped({} as never, {} as never, {} as never) as ReturnType<
      typeof makeAsyncStream
    >;
    await drain(stream);

    expect(metrics!.eventCount).toBe(0);
    // Both durationMs and timeToFirstEventMs are measured at stream end via
    // separate performance.now() calls, so timeToFirstEventMs >= durationMs.
    expect(metrics!.timeToFirstEventMs).toBeGreaterThanOrEqual(metrics!.durationMs);
  });

  it("onMetrics is called only once even if iterator is fully drained", async () => {
    const baseFn = vi.fn(() => makeAsyncStream(["e1"]) as never);
    let callCount = 0;
    const onMetrics = () => callCount++;

    const wrapped = wrapStreamFnWithMetrics(baseFn as never, onMetrics);
    const stream = wrapped({} as never, {} as never, {} as never) as ReturnType<
      typeof makeAsyncStream
    >;
    await drain(stream);

    expect(callCount).toBe(1);
  });

  it("reports via onMetrics when iterator is abandoned via return()", async () => {
    const baseFn = vi.fn(() => makeAsyncStream(["e1", "e2", "e3"]) as never);
    let metrics: StreamCallMetrics | null = null;

    const wrapped = wrapStreamFnWithMetrics(baseFn as never, (m) => {
      metrics = m;
    });

    const stream = wrapped({} as never, {} as never, {} as never) as ReturnType<
      typeof makeAsyncStream
    >;
    const iter = stream[Symbol.asyncIterator]();
    await iter.next(); // consume one event
    await iter.return?.(); // abandon early

    expect(metrics).not.toBeNull();
    // Only 1 event was consumed before return().
    expect(metrics!.eventCount).toBe(1);
  });

  it("handles async (Promise-returning) base functions", async () => {
    const asyncBaseFn = vi.fn(async () => makeAsyncStream(["p1", "p2"]) as never);
    let metrics: StreamCallMetrics | null = null;

    const wrapped = wrapStreamFnWithMetrics(asyncBaseFn as never, (m) => {
      metrics = m;
    });

    const streamOrPromise = wrapped({} as never, {} as never, {} as never);
    // Resolve the promise since baseFn is async.
    const stream = (await Promise.resolve(streamOrPromise)) as ReturnType<typeof makeAsyncStream>;
    await drain(stream);

    expect(metrics).not.toBeNull();
    expect(metrics!.eventCount).toBe(2);
  });

  it("onMetrics is not called before the stream is consumed", () => {
    const baseFn = vi.fn(() => makeAsyncStream(["e"]) as never);
    let called = false;

    const wrapped = wrapStreamFnWithMetrics(baseFn as never, () => {
      called = true;
    });

    // Just invoke the wrapped fn — don't iterate.
    void wrapped({} as never, {} as never, {} as never);
    expect(called).toBe(false);
  });
});
