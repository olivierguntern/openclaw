import type { StreamFn } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { AuthStorage } from "@mariozechner/pi-coding-agent";
import type { OpenClawConfig } from "../../../../config/config.js";
import { ensureCustomApiRegistered } from "../../../custom-api-registry.js";
import { createConfiguredOllamaStreamFn } from "../../../ollama-stream.js";
import { createOpenAIWebSocketStreamFn } from "../../../openai-ws-stream.js";
import { log } from "../../logger.js";
import { resolveFromStreamProviderRegistry } from "./registry.js";

export { registerStreamProvider, clearStreamProviderRegistry } from "./registry.js";

export type ProviderStreamFnParams = {
  model: Model<Api>;
  provider: string;
  config?: OpenClawConfig;
  authStorage: AuthStorage;
  sessionId: string;
  abortSignal: AbortSignal;
};

/** Injected dependencies — allows unit tests to stub without module mocking. */
export type ProviderStreamFnDeps = {
  createOllamaFn: (params: {
    model: { baseUrl?: string; headers?: unknown };
    providerBaseUrl?: string;
  }) => StreamFn;
  createWsFn: (apiKey: string, sessionId: string, opts: { signal: AbortSignal }) => StreamFn;
  registerCustomApi: (api: string, fn: StreamFn) => void;
  defaultStreamFn: StreamFn;
  warnFn: (msg: string) => void;
};

/**
 * Core provider resolution logic with explicit dependency injection.
 * Extension providers registered via `registerStreamProvider` are checked
 * first; built-in logic (Ollama, OpenAI WebSocket, streamSimple) runs only
 * when no registered resolver claims the request.
 *
 * Extracted for testability; prefer `resolveProviderStreamFn` at call sites.
 */
export async function resolveProviderStreamFnCore(
  params: ProviderStreamFnParams,
  deps: ProviderStreamFnDeps,
): Promise<StreamFn> {
  // Extension providers take priority over built-in logic.
  const fromRegistry = await resolveFromStreamProviderRegistry(params);
  if (fromRegistry !== null) {
    return fromRegistry;
  }

  if (params.model.api === "ollama") {
    // Prioritize configured provider baseUrl so Docker/remote Ollama hosts work reliably.
    const providerConfig = params.config?.models?.providers?.[params.model.provider];
    const providerBaseUrl =
      typeof providerConfig?.baseUrl === "string" ? providerConfig.baseUrl : undefined;
    const fn = deps.createOllamaFn({ model: params.model, providerBaseUrl });
    deps.registerCustomApi(params.model.api, fn);
    return fn;
  }

  if (params.model.api === "openai-responses" && params.provider === "openai") {
    const wsApiKey = await params.authStorage.getApiKey(params.provider);
    if (wsApiKey) {
      return deps.createWsFn(wsApiKey, params.sessionId, { signal: params.abortSignal });
    }
    deps.warnFn(`[ws-stream] no API key for provider=${params.provider}; using HTTP transport`);
  }

  // Force a stable streamFn reference so vitest can reliably mock @mariozechner/pi-ai.
  return deps.defaultStreamFn;
}

/**
 * Resolves the base StreamFn for the given model/provider combination.
 * Provider-specific side effects (e.g. custom API registration) are applied here.
 */
export async function resolveProviderStreamFn(params: ProviderStreamFnParams): Promise<StreamFn> {
  return resolveProviderStreamFnCore(params, {
    createOllamaFn: createConfiguredOllamaStreamFn,
    createWsFn: (apiKey, sessionId, opts) => createOpenAIWebSocketStreamFn(apiKey, sessionId, opts),
    registerCustomApi: ensureCustomApiRegistered,
    defaultStreamFn: streamSimple,
    warnFn: (msg) => log.warn(msg),
  });
}
