import { describe, expect, it, vi } from "vitest";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { AuthStorage } from "@mariozechner/pi-coding-agent";
import type { ProviderStreamFnDeps, ProviderStreamFnParams } from "./index.js";
import { resolveProviderStreamFnCore } from "./index.js";

function makeModel(api: string, provider = "test-provider"): Model<Api> {
  return { api, provider, id: "model-id" } as unknown as Model<Api>;
}

function makeAuthStorage(apiKey?: string): AuthStorage {
  return {
    getApiKey: vi.fn(async () => apiKey ?? null),
  } as unknown as AuthStorage;
}

function makeSignal(): AbortSignal {
  return new AbortController().signal;
}

const stubDefaultFn = vi.fn();

function makeDeps(overrides: Partial<ProviderStreamFnDeps> = {}): ProviderStreamFnDeps {
  return {
    createOllamaFn: vi.fn(() => vi.fn()),
    createWsFn: vi.fn(() => vi.fn()),
    registerCustomApi: vi.fn(),
    defaultStreamFn: stubDefaultFn,
    warnFn: vi.fn(),
    ...overrides,
  };
}

function makeParams(
  model: Model<Api>,
  provider: string,
  opts: Partial<ProviderStreamFnParams> = {},
): ProviderStreamFnParams {
  return {
    model,
    provider,
    authStorage: makeAuthStorage(),
    sessionId: "sess-test",
    abortSignal: makeSignal(),
    ...opts,
  };
}

describe("resolveProviderStreamFnCore", () => {
  it("returns defaultStreamFn for a default (anthropic-messages) model", async () => {
    const deps = makeDeps();
    const fn = await resolveProviderStreamFnCore(
      makeParams(makeModel("anthropic-messages"), "anthropic"),
      deps,
    );

    expect(fn).toBe(stubDefaultFn);
    expect(deps.createOllamaFn).not.toHaveBeenCalled();
    expect(deps.createWsFn).not.toHaveBeenCalled();
    expect(deps.registerCustomApi).not.toHaveBeenCalled();
  });

  it("returns defaultStreamFn for openai-completions", async () => {
    const deps = makeDeps();
    const fn = await resolveProviderStreamFnCore(
      makeParams(makeModel("openai-completions"), "openai"),
      deps,
    );

    expect(fn).toBe(stubDefaultFn);
    expect(deps.createWsFn).not.toHaveBeenCalled();
  });

  describe("ollama API", () => {
    it("calls createOllamaFn and returns its result", async () => {
      const ollamaFn = vi.fn();
      const deps = makeDeps({ createOllamaFn: vi.fn(() => ollamaFn) });
      const model = makeModel("ollama", "ollama");

      const fn = await resolveProviderStreamFnCore(
        makeParams(model, "ollama"),
        deps,
      );

      expect(deps.createOllamaFn).toHaveBeenCalledWith({
        model,
        providerBaseUrl: undefined,
      });
      expect(fn).toBe(ollamaFn);
    });

    it("passes providerBaseUrl from config", async () => {
      const deps = makeDeps({ createOllamaFn: vi.fn(() => vi.fn()) });
      const model = makeModel("ollama", "ollama");

      await resolveProviderStreamFnCore(
        makeParams(model, "ollama", {
          config: {
            models: {
              providers: {
                ollama: { baseUrl: "http://remote-host:11434", models: [] },
              },
            },
          },
        }),
        deps,
      );

      expect(deps.createOllamaFn).toHaveBeenCalledWith({
        model,
        providerBaseUrl: "http://remote-host:11434",
      });
    });

    it("calls registerCustomApi with the ollama fn", async () => {
      const ollamaFn = vi.fn();
      const deps = makeDeps({ createOllamaFn: vi.fn(() => ollamaFn) });

      await resolveProviderStreamFnCore(
        makeParams(makeModel("ollama", "ollama"), "ollama"),
        deps,
      );

      expect(deps.registerCustomApi).toHaveBeenCalledWith("ollama", ollamaFn);
    });

    it("does not call registerCustomApi for non-ollama models", async () => {
      const deps = makeDeps();
      await resolveProviderStreamFnCore(
        makeParams(makeModel("anthropic-messages"), "anthropic"),
        deps,
      );
      expect(deps.registerCustomApi).not.toHaveBeenCalled();
    });

    it("ignores a non-string providerBaseUrl in config", async () => {
      const deps = makeDeps({ createOllamaFn: vi.fn(() => vi.fn()) });
      const model = makeModel("ollama", "ollama");

      await resolveProviderStreamFnCore(
        makeParams(model, "ollama", {
          config: {
            models: {
              providers: {
                ollama: { baseUrl: 42 as unknown as string, models: [] },
              },
            },
          },
        }),
        deps,
      );

      expect(deps.createOllamaFn).toHaveBeenCalledWith({ model, providerBaseUrl: undefined });
    });
  });

  describe("openai-responses API with openai provider", () => {
    it("returns the WebSocket stream function when an API key is available", async () => {
      const wsFn = vi.fn();
      const deps = makeDeps({ createWsFn: vi.fn(() => wsFn) });
      const signal = makeSignal();

      const fn = await resolveProviderStreamFnCore(
        makeParams(makeModel("openai-responses", "openai"), "openai", {
          authStorage: makeAuthStorage("sk-test-key"),
          sessionId: "sess-ws",
          abortSignal: signal,
        }),
        deps,
      );

      expect(deps.createWsFn).toHaveBeenCalledWith("sk-test-key", "sess-ws", { signal });
      expect(fn).toBe(wsFn);
    });

    it("falls back to defaultStreamFn and warns when no API key is available", async () => {
      const deps = makeDeps();

      const fn = await resolveProviderStreamFnCore(
        makeParams(makeModel("openai-responses", "openai"), "openai", {
          authStorage: makeAuthStorage(undefined),
        }),
        deps,
      );

      expect(fn).toBe(stubDefaultFn);
      expect(deps.createWsFn).not.toHaveBeenCalled();
      expect(deps.warnFn).toHaveBeenCalledWith(
        expect.stringContaining("no API key for provider=openai"),
      );
    });

    it("uses defaultStreamFn when provider is not openai", async () => {
      const deps = makeDeps();

      const fn = await resolveProviderStreamFnCore(
        makeParams(makeModel("openai-responses", "azure"), "azure", {
          authStorage: makeAuthStorage("azure-key"),
        }),
        deps,
      );

      expect(deps.createWsFn).not.toHaveBeenCalled();
      expect(fn).toBe(stubDefaultFn);
    });

    it("does not warn when not on the openai-responses + openai path", async () => {
      const deps = makeDeps();
      await resolveProviderStreamFnCore(
        makeParams(makeModel("anthropic-messages"), "anthropic"),
        deps,
      );
      expect(deps.warnFn).not.toHaveBeenCalled();
    });
  });
});
