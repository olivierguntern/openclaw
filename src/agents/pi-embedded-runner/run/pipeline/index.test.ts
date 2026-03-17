import { describe, expect, it, vi } from "vitest";
import { buildStreamPipeline } from "./index.js";

type FakeStreamFn = (model: unknown, context: unknown, options: unknown) => unknown;

function makeStreamFn(id: string): FakeStreamFn & { id: string } {
  const fn: FakeStreamFn & { id: string } = vi.fn(() => `result-from-${id}`) as never;
  fn.id = id;
  return fn;
}

describe("buildStreamPipeline", () => {
  it("returns the base function unchanged when wrappers array is empty", () => {
    const base = makeStreamFn("base");
    const result = buildStreamPipeline(base, []);
    expect(result).toBe(base);
  });

  it("applies a single wrapper to the base function", () => {
    const base = makeStreamFn("base");
    const wrapped = makeStreamFn("wrapped");
    const wrapper = vi.fn(() => wrapped);

    const result = buildStreamPipeline(base, [wrapper]);

    expect(wrapper).toHaveBeenCalledWith(base);
    expect(result).toBe(wrapped);
  });

  it("applies multiple wrappers in order (first wrapper wraps base, next wraps that)", () => {
    const callOrder: string[] = [];
    const base = makeStreamFn("base");

    const wrapper1 = vi.fn((fn: FakeStreamFn) => {
      callOrder.push("wrapper1");
      const next = makeStreamFn("w1");
      next.id = `w1-over-${(fn as FakeStreamFn & { id: string }).id}`;
      return next;
    });
    const wrapper2 = vi.fn((fn: FakeStreamFn) => {
      callOrder.push("wrapper2");
      const next = makeStreamFn("w2");
      next.id = `w2-over-${(fn as FakeStreamFn & { id: string }).id}`;
      return next;
    });

    const result = buildStreamPipeline(base, [wrapper1, wrapper2]);

    expect(callOrder).toEqual(["wrapper1", "wrapper2"]);
    expect(wrapper1).toHaveBeenCalledWith(base);
    expect((result as FakeStreamFn & { id: string }).id).toBe("w2-over-w1-over-base");
  });

  it("skips null entries without breaking the pipeline", () => {
    const base = makeStreamFn("base");
    const wrapped = makeStreamFn("wrapped");
    const wrapper = vi.fn(() => wrapped);

    const result = buildStreamPipeline(base, [null, wrapper, null, undefined]);

    expect(wrapper).toHaveBeenCalledWith(base);
    expect(result).toBe(wrapped);
  });

  it("returns the base function when all wrappers are null or undefined", () => {
    const base = makeStreamFn("base");
    const result = buildStreamPipeline(base, [null, undefined, null]);
    expect(result).toBe(base);
  });

  it("passes calls through the composed pipeline at runtime", () => {
    const calls: string[] = [];
    const base = vi.fn((model: unknown) => {
      calls.push(`base(${model})`);
      return "base-result";
    });
    const wrapper = (fn: typeof base) =>
      vi.fn((model: unknown, ctx: unknown, opts: unknown) => {
        calls.push(`wrapper-before`);
        const r = fn(model, ctx, opts);
        calls.push(`wrapper-after`);
        return r;
      });

    const pipeline = buildStreamPipeline(base as never, [wrapper as never]);
    pipeline("m", "c", "o");

    expect(calls).toEqual(["wrapper-before", "base(m)", "wrapper-after"]);
  });
});
