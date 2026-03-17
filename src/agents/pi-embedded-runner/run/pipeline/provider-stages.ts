import type { StreamFn } from "@mariozechner/pi-agent-core";
import { isXaiProvider } from "../../../schema/clean-for-xai.js";
import { wrapOllamaCompatNumCtx } from "../ollama-compat-numctx.js";
import {
  shouldRepairMalformedAnthropicToolCallArguments,
  wrapStreamFnDecodeXaiToolCallArguments,
  wrapStreamFnRepairMalformedToolCallArguments,
} from "../tool-call-repair.js";
import { stage, type NamedStage } from "./named-stage.js";
import { wrapStreamFnDowngradeOpenAIReasoningPairs } from "./stages/downgrade-openai-reasoning-pairs.js";

export type { NamedStage };

/**
 * Ollama-specific pipeline stages.
 *
 * Injects `num_ctx` into every request so Ollama respects the model's context
 * window instead of defaulting to 4096 tokens.
 */
export function resolveOllamaStages(params: {
  shouldInjectNumCtx: boolean;
  numCtx: number;
}): Array<NamedStage | null> {
  return [
    params.shouldInjectNumCtx
      ? stage("ollama:num-ctx", (fn) => wrapOllamaCompatNumCtx(fn, params.numCtx))
      : null,
  ];
}

/**
 * OpenAI Responses / Codex Responses API stages.
 *
 * Removes reasoning-pair artifacts (`reasoning` + `output` content blocks)
 * that the API emits but that follow-up calls must not replay.
 */
export function resolveOpenAIStages(params: { isResponsesApi: boolean }): Array<NamedStage | null> {
  return [
    params.isResponsesApi
      ? stage("openai:downgrade-reasoning", wrapStreamFnDowngradeOpenAIReasoningPairs)
      : null,
  ];
}

/**
 * Anthropic-specific pipeline stages.
 *
 * - `anthropic:repair-kimi-tool-calls` – fixes trailing garbage after the
 *   closing `}` in tool-call JSON emitted by Kimi models served via the
 *   Anthropic Messages API.
 * - `anthropic:payload-logger` – opt-in debug logging of the raw Anthropic
 *   request/response payload (enabled via env var).
 */
export function resolveAnthropicStages(params: {
  provider: string;
  modelApi: string;
  anthropicPayloadLogger: { wrapStreamFn: (fn: StreamFn) => StreamFn } | null | undefined;
}): Array<NamedStage | null> {
  const isAnthropicMessages = params.modelApi === "anthropic-messages";
  return [
    isAnthropicMessages && shouldRepairMalformedAnthropicToolCallArguments(params.provider)
      ? stage("anthropic:repair-kimi-tool-calls", wrapStreamFnRepairMalformedToolCallArguments)
      : null,
    params.anthropicPayloadLogger
      ? stage("anthropic:payload-logger", (fn) => params.anthropicPayloadLogger!.wrapStreamFn(fn))
      : null,
  ];
}

/**
 * xAI / Grok-specific pipeline stages.
 *
 * Decodes HTML entities (`&gt;`, `&amp;`, etc.) that xAI/Grok emits inside
 * tool-call argument JSON, restoring valid JSON before tool dispatch.
 */
export function resolveXaiStages(params: {
  provider: string;
  modelId: string;
}): Array<NamedStage | null> {
  return [
    isXaiProvider(params.provider, params.modelId)
      ? stage("xai:decode-entities", wrapStreamFnDecodeXaiToolCallArguments)
      : null,
  ];
}
