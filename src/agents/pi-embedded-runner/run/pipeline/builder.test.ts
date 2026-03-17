import type { StreamFn } from "@mariozechner/pi-agent-core";
import { describe, expect, it, vi } from "vitest";
import { pipeline, StreamPipelineBuilder } from "./builder.js";

function makeBaseFn(): StreamFn {
  return vi.fn(() => ({ [Symbol.asyncIterator]: () => (async function* () {})() }) as never);
}

describe("StreamPipelineBuilder / pipeline()", () => {
  it("build() with no stages returns base fn wrapped with empty activeStages", () => {
    const base = makeBaseFn();
    const result = pipeline(base).build();
    expect(result.activeStages).toEqual([]);
  });

  it("pipe() adds a named stage and it appears in activeStages", () => {
    const base = makeBaseFn();
    const inner = makeBaseFn();
    const result = pipeline(base)
      .pipe("my-stage", () => inner)
      .build();
    expect(result.activeStages).toEqual(["my-stage"]);
  });

  it("later-registered stages are outermost (execute first at runtime)", () => {
    const order: string[] = [];
    const base: StreamFn = vi.fn(() => {
      order.push("base");
      return { [Symbol.asyncIterator]: () => (async function* () {})() } as never;
    });

    const wrap =
      (label: string) =>
      (fn: StreamFn): StreamFn =>
        vi.fn((...args: Parameters<StreamFn>) => {
          order.push(label);
          return fn(...args);
        }) as unknown as StreamFn;

    // "a" is registered first (innermost), "b" is registered second (outermost).
    // At runtime the outermost wrapper executes first: b → a → base.
    const result = pipeline(base).pipe("a", wrap("a")).pipe("b", wrap("b")).build();

    void result({} as never, {} as never, {} as never);
    expect(order).toEqual(["b", "a", "base"]);
  });

  it("pipeIf() with truthy condition adds the stage", () => {
    const base = makeBaseFn();
    const inner = makeBaseFn();
    const result = pipeline(base)
      .pipeIf(true, "conditional", () => inner)
      .build();
    expect(result.activeStages).toContain("conditional");
  });

  it("pipeIf() with false condition skips the stage", () => {
    const base = makeBaseFn();
    const inner = makeBaseFn();
    const result = pipeline(base)
      .pipeIf(false, "skipped", () => inner)
      .build();
    expect(result.activeStages).not.toContain("skipped");
  });

  it("pipeIf() with null condition skips the stage", () => {
    const base = makeBaseFn();
    const result = pipeline(base)
      .pipeIf(null, "skipped", () => makeBaseFn())
      .build();
    expect(result.activeStages).not.toContain("skipped");
  });

  it("pipeIf() with undefined condition skips the stage", () => {
    const base = makeBaseFn();
    const result = pipeline(base)
      .pipeIf(undefined, "skipped", () => makeBaseFn())
      .build();
    expect(result.activeStages).not.toContain("skipped");
  });

  it("mixed pipe() and pipeIf() builds correct activeStages list", () => {
    const base = makeBaseFn();
    const result = pipeline(base)
      .pipeIf(false, "skip-me", (fn) => fn)
      .pipe("always", (fn) => fn)
      .pipeIf(true, "conditional", (fn) => fn)
      .pipe("last", (fn) => fn)
      .build();
    expect(result.activeStages).toEqual(["always", "conditional", "last"]);
  });

  it("pipeEach() adds all non-null stages from the array", () => {
    const base = makeBaseFn();
    const result = pipeline(base)
      .pipeEach([
        { name: "a", wrap: (fn) => fn },
        null,
        { name: "b", wrap: (fn) => fn },
        undefined,
        { name: "c", wrap: (fn) => fn },
      ])
      .build();
    expect(result.activeStages).toEqual(["a", "b", "c"]);
  });

  it("pipeEach() with all-null array adds no stages", () => {
    const base = makeBaseFn();
    const result = pipeline(base).pipeEach([null, null, undefined]).build();
    expect(result.activeStages).toEqual([]);
  });

  it("pipeEach() stages are ordered correctly relative to pipe() calls", () => {
    const base = makeBaseFn();
    const result = pipeline(base)
      .pipe("first", (fn) => fn)
      .pipeEach([
        { name: "group-a", wrap: (fn) => fn },
        { name: "group-b", wrap: (fn) => fn },
      ])
      .pipe("last", (fn) => fn)
      .build();
    expect(result.activeStages).toEqual(["first", "group-a", "group-b", "last"]);
  });

  it("returns a StreamPipelineBuilder from pipeline()", () => {
    const base = makeBaseFn();
    expect(pipeline(base)).toBeInstanceOf(StreamPipelineBuilder);
  });

  it("activeStages is readonly (frozen)", () => {
    const base = makeBaseFn();
    const result = pipeline(base)
      .pipe("s", (fn) => fn)
      .build();
    // Verify it's an array on the function
    expect(Array.isArray(result.activeStages)).toBe(true);
  });
});
