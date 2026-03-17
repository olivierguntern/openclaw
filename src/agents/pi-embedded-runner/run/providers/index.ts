import type { StreamFn } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { AuthStorage } from "@mariozechner/pi-coding-agent";
import type { OpenClawConfig } from "../../../../config/config.js";
import { createConfiguredOllamaStreamFn } from "../../../ollama-stream.js";
import { createOpenAIWebSocketStreamFn } from "../../../openai-ws-stream.js";
import { ensureCustomApiRegistered } from "../../../custom-api-registry.js";
import { log } from "../../logger.js";

export type ProviderStreamFnParams = {
  model: Model<Api>;
  provider: string;
  config?: OpenClawConfig;
  authStorage: AuthStorage;
  sessionId: string;
  abortSignal: AbortSignal;
};

/**
 * Resolves the base StreamFn for the given model/provider combination.
 * Provider-specific side effects (e.g. custom API registration) are applied here.
 */
export async function resolveProviderStreamFn(
  params: ProviderStreamFnParams,
): Promise<StreamFn> {
  if (params.model.api === "ollama") {
    // Prioritize configured provider baseUrl so Docker/remote Ollama hosts work reliably.
    const providerConfig = params.config?.models?.providers?.[params.model.provider];
    const providerBaseUrl =
      typeof providerConfig?.baseUrl === "string" ? providerConfig.baseUrl : undefined;
    const fn = createConfiguredOllamaStreamFn({ model: params.model, providerBaseUrl });
    ensureCustomApiRegistered(params.model.api, fn);
    return fn;
  }

  if (params.model.api === "openai-responses" && params.provider === "openai") {
    const wsApiKey = await params.authStorage.getApiKey(params.provider);
    if (wsApiKey) {
      return createOpenAIWebSocketStreamFn(wsApiKey, params.sessionId, {
        signal: params.abortSignal,
      });
    }
    log.warn(`[ws-stream] no API key for provider=${params.provider}; using HTTP transport`);
  }

  // Force a stable streamFn reference so vitest can reliably mock @mariozechner/pi-ai.
  return streamSimple;
}
