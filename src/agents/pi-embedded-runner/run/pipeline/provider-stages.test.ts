import { describe, expect, it } from "vitest";
import {
  resolveAnthropicStages,
  resolveOllamaStages,
  resolveOpenAIStages,
  resolveXaiStages,
} from "./provider-stages.js";

describe("resolveOllamaStages()", () => {
  it("returns null entry when injection is not needed", () => {
    const stages = resolveOllamaStages({ shouldInjectNumCtx: false, numCtx: 4096 });
    expect(stages.every((s) => s === null)).toBe(true);
  });

  it("returns a named stage when injection is needed", () => {
    const stages = resolveOllamaStages({ shouldInjectNumCtx: true, numCtx: 8192 }).filter(Boolean);
    expect(stages).toHaveLength(1);
    expect(stages[0]?.name).toBe("ollama:num-ctx");
  });
});

describe("resolveOpenAIStages()", () => {
  it("returns null entry when not a Responses API", () => {
    const stages = resolveOpenAIStages({ isResponsesApi: false });
    expect(stages.every((s) => s === null)).toBe(true);
  });

  it("returns the downgrade-reasoning stage for Responses API", () => {
    const stages = resolveOpenAIStages({ isResponsesApi: true }).filter(Boolean);
    expect(stages).toHaveLength(1);
    expect(stages[0]?.name).toBe("openai:downgrade-reasoning");
  });
});

describe("resolveAnthropicStages()", () => {
  it("returns no active stages for non-anthropic-messages API", () => {
    const stages = resolveAnthropicStages({
      provider: "openai",
      modelApi: "openai-completions",
      anthropicPayloadLogger: null,
    }).filter(Boolean);
    expect(stages).toHaveLength(0);
  });

  it("includes repair stage for Kimi provider via anthropic-messages", () => {
    const stages = resolveAnthropicStages({
      provider: "kimi",
      modelApi: "anthropic-messages",
      anthropicPayloadLogger: null,
    }).filter(Boolean);
    expect(stages.map((s) => s?.name)).toContain("anthropic:repair-kimi-tool-calls");
  });

  it("includes payload-logger stage when logger is provided", () => {
    const fakeLogger = { wrapStreamFn: (fn: unknown) => fn as never };
    const stages = resolveAnthropicStages({
      provider: "anthropic",
      modelApi: "anthropic-messages",
      anthropicPayloadLogger: fakeLogger,
    }).filter(Boolean);
    expect(stages.map((s) => s?.name)).toContain("anthropic:payload-logger");
  });
});

describe("resolveXaiStages()", () => {
  it("returns null entry for non-xAI providers", () => {
    const stages = resolveXaiStages({ provider: "anthropic", modelId: "claude-3-opus" });
    expect(stages.every((s) => s === null)).toBe(true);
  });

  it("returns the decode-entities stage for xAI providers", () => {
    const stages = resolveXaiStages({ provider: "xai", modelId: "grok-3" }).filter(Boolean);
    expect(stages).toHaveLength(1);
    expect(stages[0]?.name).toBe("xai:decode-entities");
  });
});
