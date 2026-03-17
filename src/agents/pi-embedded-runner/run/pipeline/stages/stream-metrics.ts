import type { StreamFn } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";

export type StreamCallMetrics = {
  /** Total elapsed time from the first stream call until the iterator is exhausted. */
  durationMs: number;
  /** Number of streaming events yielded before the iterator finished. */
  eventCount: number;
  /**
   * Elapsed time from the first stream call until the first event was received.
   * Equals `durationMs` when no events were yielded (i.e. empty or error stream).
   */
  timeToFirstEventMs: number;
};

type WrappedStream = ReturnType<typeof streamSimple>;

function wrapStreamWithMetrics(
  stream: WrappedStream,
  start: number,
  onMetrics: (m: StreamCallMetrics) => void,
): WrappedStream {
  let firstEventMs = -1;
  let eventCount = 0;
  let reported = false;

  function report() {
    if (!reported) {
      reported = true;
      onMetrics({
        durationMs: performance.now() - start,
        eventCount,
        timeToFirstEventMs: firstEventMs >= 0 ? firstEventMs : performance.now() - start,
      });
    }
  }

  const originalIterator = stream[Symbol.asyncIterator].bind(stream);
  (stream as { [Symbol.asyncIterator]: typeof originalIterator })[Symbol.asyncIterator] =
    function () {
      const iterator = originalIterator();
      return {
        async next() {
          const result = await iterator.next();
          if (result.done) {
            report();
          } else {
            if (firstEventMs < 0) {
              firstEventMs = performance.now() - start;
            }
            eventCount++;
          }
          return result;
        },
        async return(value?: unknown) {
          report();
          return iterator.return?.(value) ?? { done: true as const, value: undefined };
        },
        async throw(error?: unknown) {
          report();
          return iterator.throw?.(error) ?? { done: true as const, value: undefined };
        },
      };
    };

  return stream;
}

/**
 * Wraps a StreamFn to collect timing and event-count metrics for every call.
 * The `onMetrics` callback is invoked once the iterator is exhausted (or
 * abandoned via `return()`/`throw()`).
 *
 * Handles both synchronous and promise-returning base functions.
 */
export function wrapStreamFnWithMetrics(
  baseFn: StreamFn,
  onMetrics: (metrics: StreamCallMetrics) => void,
): StreamFn {
  return (model, context, options) => {
    const start = performance.now();
    const maybeStream = baseFn(model, context, options);
    if (maybeStream && typeof maybeStream === "object" && "then" in maybeStream) {
      return Promise.resolve(maybeStream).then((stream) =>
        wrapStreamWithMetrics(stream, start, onMetrics),
      );
    }
    return wrapStreamWithMetrics(maybeStream as unknown as WrappedStream, start, onMetrics);
  };
}
