import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import type { ThinkLevel } from "../../auto-reply/thinking.js";
import {
  ensureContextEnginesInitialized,
  resolveContextEngine,
} from "../../context-engine/index.js";
import { getGlobalHookRunner } from "../../plugins/hook-runner-global.js";
import { prepareProviderRuntimeAuth } from "../../plugins/provider-runtime.js";
import type { PluginHookBeforeAgentStartResult } from "../../plugins/types.js";
import { enqueueCommandInLane } from "../../process/command-queue.js";
import { isMarkdownCapableMessageChannel } from "../../utils/message-channel.js";
import { resolveOpenClawAgentDir } from "../agent-paths.js";
import { hasConfiguredModelFallbacks } from "../agent-scope.js";
import {
  isProfileInCooldown,
  type AuthProfileFailureReason,
  markAuthProfileFailure,
  resolveProfilesUnavailableReason,
} from "../auth-profiles.js";
import {
  CONTEXT_WINDOW_HARD_MIN_TOKENS,
  CONTEXT_WINDOW_WARN_BELOW_TOKENS,
  evaluateContextWindowGuard,
  resolveContextWindowInfo,
} from "../context-window-guard.js";
import { DEFAULT_CONTEXT_TOKENS, DEFAULT_MODEL, DEFAULT_PROVIDER } from "../defaults.js";
import {
  coerceToFailoverError,
  describeFailoverError,
  FailoverError,
  resolveFailoverStatus,
} from "../failover-error.js";
import {
  applyLocalNoAuthHeaderOverride,
  ensureAuthProfileStore,
  getApiKeyForModel,
  resolveAuthProfileOrder,
  type ResolvedProviderAuth,
} from "../model-auth.js";
import { normalizeProviderId } from "../model-selection.js";
import { ensureOpenClawModelsJson } from "../models-config.js";
import {
  classifyFailoverReason,
  isFailoverErrorMessage,
  type FailoverReason,
} from "../pi-embedded-helpers.js";
import { ensureRuntimePluginsLoaded } from "../runtime-plugins.js";
import { redactRunIdentifier, resolveRunWorkspaceDir } from "../workspace-run.js";
import { resolveGlobalLane, resolveSessionLane } from "./lanes.js";
import { log } from "./logger.js";
import { resolveModelAsync } from "./model.js";
import { createFailoverDecisionLogger } from "./run/failover-observation.js";
import type { RunEmbeddedPiAgentParams } from "./run/params.js";
import { buildEmbeddedRunPayloads } from "./run/payloads.js";
import {
  runRetryLoop,
  type RetryLoopConfig,
  type RetryLoopHelpers,
  type RetryLoopState,
} from "./run/retry-loop.js";
import type { EmbeddedPiRunResult } from "./types.js";
import { describeUnknownError } from "./utils.js";

type ApiKeyInfo = ResolvedProviderAuth;

type RuntimeAuthState = {
  sourceApiKey: string;
  authMode: string;
  profileId?: string;
  expiresAt?: number;
  refreshTimer?: ReturnType<typeof setTimeout>;
  refreshInFlight?: Promise<void>;
};

const RUNTIME_AUTH_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const RUNTIME_AUTH_REFRESH_RETRY_MS = 60 * 1000;
const RUNTIME_AUTH_REFRESH_MIN_DELAY_MS = 5 * 1000;
export async function runEmbeddedPiAgent(
  params: RunEmbeddedPiAgentParams,
): Promise<EmbeddedPiRunResult> {
  const sessionLane = resolveSessionLane(params.sessionKey?.trim() || params.sessionId);
  const globalLane = resolveGlobalLane(params.lane);
  const enqueueGlobal =
    params.enqueue ?? ((task, opts) => enqueueCommandInLane(globalLane, task, opts));
  const enqueueSession =
    params.enqueue ?? ((task, opts) => enqueueCommandInLane(sessionLane, task, opts));
  const channelHint = params.messageChannel ?? params.messageProvider;
  const resolvedToolResultFormat =
    params.toolResultFormat ??
    (channelHint
      ? isMarkdownCapableMessageChannel(channelHint)
        ? "markdown"
        : "plain"
      : "markdown");
  const isProbeSession = params.sessionId?.startsWith("probe-") ?? false;

  return enqueueSession(() =>
    enqueueGlobal(async () => {
      const started = Date.now();
      const workspaceResolution = resolveRunWorkspaceDir({
        workspaceDir: params.workspaceDir,
        sessionKey: params.sessionKey,
        agentId: params.agentId,
        config: params.config,
      });
      const resolvedWorkspace = workspaceResolution.workspaceDir;
      const redactedSessionId = redactRunIdentifier(params.sessionId);
      const redactedSessionKey = redactRunIdentifier(params.sessionKey);
      const redactedWorkspace = redactRunIdentifier(resolvedWorkspace);
      if (workspaceResolution.usedFallback) {
        log.warn(
          `[workspace-fallback] caller=runEmbeddedPiAgent reason=${workspaceResolution.fallbackReason} run=${params.runId} session=${redactedSessionId} sessionKey=${redactedSessionKey} agent=${workspaceResolution.agentId} workspace=${redactedWorkspace}`,
        );
      }
      ensureRuntimePluginsLoaded({
        config: params.config,
        workspaceDir: resolvedWorkspace,
        allowGatewaySubagentBinding: params.allowGatewaySubagentBinding,
      });
      const prevCwd = process.cwd();

      let provider = (params.provider ?? DEFAULT_PROVIDER).trim() || DEFAULT_PROVIDER;
      let modelId = (params.model ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;
      const agentDir = params.agentDir ?? resolveOpenClawAgentDir();
      const fallbackConfigured = hasConfiguredModelFallbacks({
        cfg: params.config,
        agentId: params.agentId,
        sessionKey: params.sessionKey,
      });
      await ensureOpenClawModelsJson(params.config, agentDir);

      // Run before_model_resolve hooks early so plugins can override the
      // provider/model before resolveModel().
      //
      // Legacy compatibility: before_agent_start is also checked for override
      // fields if present. New hook takes precedence when both are set.
      let modelResolveOverride: { providerOverride?: string; modelOverride?: string } | undefined;
      let legacyBeforeAgentStartResult: PluginHookBeforeAgentStartResult | undefined;
      const hookRunner = getGlobalHookRunner();
      const hookCtx = {
        agentId: workspaceResolution.agentId,
        sessionKey: params.sessionKey,
        sessionId: params.sessionId,
        workspaceDir: resolvedWorkspace,
        messageProvider: params.messageProvider ?? undefined,
        trigger: params.trigger,
        channelId: params.messageChannel ?? params.messageProvider ?? undefined,
      };
      if (hookRunner?.hasHooks("before_model_resolve")) {
        try {
          modelResolveOverride = await hookRunner.runBeforeModelResolve(
            { prompt: params.prompt },
            hookCtx,
          );
        } catch (hookErr) {
          log.warn(`before_model_resolve hook failed: ${String(hookErr)}`);
        }
      }
      if (hookRunner?.hasHooks("before_agent_start")) {
        try {
          legacyBeforeAgentStartResult = await hookRunner.runBeforeAgentStart(
            { prompt: params.prompt },
            hookCtx,
          );
          modelResolveOverride = {
            providerOverride:
              modelResolveOverride?.providerOverride ??
              legacyBeforeAgentStartResult?.providerOverride,
            modelOverride:
              modelResolveOverride?.modelOverride ?? legacyBeforeAgentStartResult?.modelOverride,
          };
        } catch (hookErr) {
          log.warn(
            `before_agent_start hook (legacy model resolve path) failed: ${String(hookErr)}`,
          );
        }
      }
      if (modelResolveOverride?.providerOverride) {
        provider = modelResolveOverride.providerOverride;
        log.info(`[hooks] provider overridden to ${provider}`);
      }
      if (modelResolveOverride?.modelOverride) {
        modelId = modelResolveOverride.modelOverride;
        log.info(`[hooks] model overridden to ${modelId}`);
      }

      const { model, error, authStorage, modelRegistry } = await resolveModelAsync(
        provider,
        modelId,
        agentDir,
        params.config,
      );
      if (!model) {
        throw new FailoverError(error ?? `Unknown model: ${provider}/${modelId}`, {
          reason: "model_not_found",
          provider,
          model: modelId,
        });
      }
      const runtimeModel = model;

      const ctxInfo = resolveContextWindowInfo({
        cfg: params.config,
        provider,
        modelId,
        modelContextWindow: runtimeModel.contextWindow,
        defaultTokens: DEFAULT_CONTEXT_TOKENS,
      });
      // Apply contextTokens cap to model so pi-coding-agent's auto-compaction
      // threshold uses the effective limit, not the native context window.
      const effectiveModel =
        ctxInfo.tokens < (runtimeModel.contextWindow ?? Infinity)
          ? { ...runtimeModel, contextWindow: ctxInfo.tokens }
          : runtimeModel;
      const ctxGuard = evaluateContextWindowGuard({
        info: ctxInfo,
        warnBelowTokens: CONTEXT_WINDOW_WARN_BELOW_TOKENS,
        hardMinTokens: CONTEXT_WINDOW_HARD_MIN_TOKENS,
      });
      if (ctxGuard.shouldWarn) {
        log.warn(
          `low context window: ${provider}/${modelId} ctx=${ctxGuard.tokens} (warn<${CONTEXT_WINDOW_WARN_BELOW_TOKENS}) source=${ctxGuard.source}`,
        );
      }
      if (ctxGuard.shouldBlock) {
        log.error(
          `blocked model (context window too small): ${provider}/${modelId} ctx=${ctxGuard.tokens} (min=${CONTEXT_WINDOW_HARD_MIN_TOKENS}) source=${ctxGuard.source}`,
        );
        throw new FailoverError(
          `Model context window too small (${ctxGuard.tokens} tokens). Minimum is ${CONTEXT_WINDOW_HARD_MIN_TOKENS}.`,
          { reason: "unknown", provider, model: modelId },
        );
      }

      const authStore = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
      const preferredProfileId = params.authProfileId?.trim();
      let lockedProfileId = params.authProfileIdSource === "user" ? preferredProfileId : undefined;
      if (lockedProfileId) {
        const lockedProfile = authStore.profiles[lockedProfileId];
        if (
          !lockedProfile ||
          normalizeProviderId(lockedProfile.provider) !== normalizeProviderId(provider)
        ) {
          lockedProfileId = undefined;
        }
      }
      const profileOrder = resolveAuthProfileOrder({
        cfg: params.config,
        store: authStore,
        provider,
        preferredProfile: preferredProfileId,
      });
      if (lockedProfileId && !profileOrder.includes(lockedProfileId)) {
        throw new Error(`Auth profile "${lockedProfileId}" is not configured for ${provider}.`);
      }
      const profileCandidates = lockedProfileId
        ? [lockedProfileId]
        : profileOrder.length > 0
          ? profileOrder
          : [undefined];
      const initialThinkLevel = params.thinkLevel ?? "off";
      let runtimeAuthState: RuntimeAuthState | null = null;
      let runtimeAuthRefreshCancelled = false;
      // All mutable per-attempt values are held in a single shared object so
      // that the setup-phase closures (advanceAuthProfile, applyApiKeyInfo, …)
      // and the extracted retry loop always read/write the same state.
      const state: RetryLoopState = {
        runtimeModel,
        effectiveModel,
        thinkLevel: initialThinkLevel,
        profileIndex: 0,
        apiKeyInfo: null,
        lastProfileId: undefined,
        attemptedThinking: new Set<ThinkLevel>(),
      };
      const hasRefreshableRuntimeAuth = () => Boolean(runtimeAuthState?.sourceApiKey.trim());

      const clearRuntimeAuthRefreshTimer = () => {
        if (!runtimeAuthState?.refreshTimer) {
          return;
        }
        clearTimeout(runtimeAuthState.refreshTimer);
        runtimeAuthState.refreshTimer = undefined;
      };

      const stopRuntimeAuthRefreshTimer = () => {
        if (!runtimeAuthState) {
          return;
        }
        runtimeAuthRefreshCancelled = true;
        clearRuntimeAuthRefreshTimer();
      };

      const refreshRuntimeAuth = async (reason: string): Promise<void> => {
        if (!runtimeAuthState) {
          return;
        }
        if (runtimeAuthState.refreshInFlight) {
          await runtimeAuthState.refreshInFlight;
          return;
        }
        runtimeAuthState.refreshInFlight = (async () => {
          const sourceApiKey = runtimeAuthState?.sourceApiKey.trim() ?? "";
          if (!sourceApiKey) {
            throw new Error(`Runtime auth refresh requires a source credential.`);
          }
          log.debug(`Refreshing runtime auth for ${state.runtimeModel.provider} (${reason})...`);
          const preparedAuth = await prepareProviderRuntimeAuth({
            provider: state.runtimeModel.provider,
            config: params.config,
            workspaceDir: resolvedWorkspace,
            env: process.env,
            context: {
              config: params.config,
              agentDir,
              workspaceDir: resolvedWorkspace,
              env: process.env,
              provider: state.runtimeModel.provider,
              modelId,
              model: state.runtimeModel,
              apiKey: sourceApiKey,
              authMode: runtimeAuthState?.authMode ?? "unknown",
              profileId: runtimeAuthState?.profileId,
            },
          });
          if (!preparedAuth?.apiKey) {
            throw new Error(
              `Provider "${state.runtimeModel.provider}" does not support runtime auth refresh.`,
            );
          }
          authStorage.setRuntimeApiKey(state.runtimeModel.provider, preparedAuth.apiKey);
          if (preparedAuth.baseUrl) {
            state.runtimeModel = { ...state.runtimeModel, baseUrl: preparedAuth.baseUrl };
            state.effectiveModel = { ...state.effectiveModel, baseUrl: preparedAuth.baseUrl };
          }
          runtimeAuthState = {
            ...runtimeAuthState,
            expiresAt: preparedAuth.expiresAt,
          };
          if (preparedAuth.expiresAt) {
            const remaining = preparedAuth.expiresAt - Date.now();
            log.debug(
              `Runtime auth refreshed for ${state.runtimeModel.provider}; expires in ${Math.max(0, Math.floor(remaining / 1000))}s.`,
            );
          }
        })()
          .catch((err) => {
            log.warn(
              `Runtime auth refresh failed for ${state.runtimeModel.provider}: ${describeUnknownError(err)}`,
            );
            throw err;
          })
          .finally(() => {
            if (runtimeAuthState) {
              runtimeAuthState.refreshInFlight = undefined;
            }
          });
        await runtimeAuthState.refreshInFlight;
      };

      const scheduleRuntimeAuthRefresh = (): void => {
        if (!runtimeAuthState || runtimeAuthRefreshCancelled) {
          return;
        }
        if (!hasRefreshableRuntimeAuth()) {
          log.warn(
            `Skipping runtime auth refresh scheduling for ${state.runtimeModel.provider}; source credential missing.`,
          );
          return;
        }
        if (!runtimeAuthState.expiresAt) {
          return;
        }
        clearRuntimeAuthRefreshTimer();
        const now = Date.now();
        const refreshAt = runtimeAuthState.expiresAt - RUNTIME_AUTH_REFRESH_MARGIN_MS;
        const delayMs = Math.max(RUNTIME_AUTH_REFRESH_MIN_DELAY_MS, refreshAt - now);
        const timer = setTimeout(() => {
          if (runtimeAuthRefreshCancelled) {
            return;
          }
          refreshRuntimeAuth("scheduled")
            .then(() => scheduleRuntimeAuthRefresh())
            .catch(() => {
              if (runtimeAuthRefreshCancelled) {
                return;
              }
              const retryTimer = setTimeout(() => {
                if (runtimeAuthRefreshCancelled) {
                  return;
                }
                refreshRuntimeAuth("scheduled-retry")
                  .then(() => scheduleRuntimeAuthRefresh())
                  .catch(() => undefined);
              }, RUNTIME_AUTH_REFRESH_RETRY_MS);
              const activeRuntimeAuthState = runtimeAuthState;
              if (activeRuntimeAuthState) {
                activeRuntimeAuthState.refreshTimer = retryTimer;
              }
              if (runtimeAuthRefreshCancelled && activeRuntimeAuthState) {
                clearTimeout(retryTimer);
                activeRuntimeAuthState.refreshTimer = undefined;
              }
            });
        }, delayMs);
        runtimeAuthState.refreshTimer = timer;
        if (runtimeAuthRefreshCancelled) {
          clearTimeout(timer);
          runtimeAuthState.refreshTimer = undefined;
        }
      };

      const resolveAuthProfileFailoverReason = (params: {
        allInCooldown: boolean;
        message: string;
        profileIds?: Array<string | undefined>;
      }): FailoverReason => {
        if (params.allInCooldown) {
          const profileIds = (params.profileIds ?? profileCandidates).filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          );
          return (
            resolveProfilesUnavailableReason({
              store: authStore,
              profileIds,
            }) ?? "unknown"
          );
        }
        const classified = classifyFailoverReason(params.message);
        return classified ?? "auth";
      };

      const throwAuthProfileFailover = (params: {
        allInCooldown: boolean;
        message?: string;
        error?: unknown;
      }): never => {
        const fallbackMessage = `No available auth profile for ${provider} (all in cooldown or unavailable).`;
        const message =
          params.message?.trim() ||
          (params.error ? describeUnknownError(params.error).trim() : "") ||
          fallbackMessage;
        const reason = resolveAuthProfileFailoverReason({
          allInCooldown: params.allInCooldown,
          message,
          profileIds: profileCandidates,
        });
        if (fallbackConfigured) {
          throw new FailoverError(message, {
            reason,
            provider,
            model: modelId,
            status: resolveFailoverStatus(reason),
            cause: params.error,
          });
        }
        if (params.error instanceof Error) {
          throw params.error;
        }
        throw new Error(message);
      };

      const resolveApiKeyForCandidate = async (candidate?: string) => {
        return getApiKeyForModel({
          model: state.runtimeModel,
          cfg: params.config,
          profileId: candidate,
          store: authStore,
          agentDir,
        });
      };

      const applyApiKeyInfo = async (candidate?: string): Promise<void> => {
        state.apiKeyInfo = await resolveApiKeyForCandidate(candidate);
        const resolvedProfileId = state.apiKeyInfo.profileId ?? candidate;
        if (!state.apiKeyInfo.apiKey) {
          if (state.apiKeyInfo.mode !== "aws-sdk") {
            throw new Error(
              `No API key resolved for provider "${state.runtimeModel.provider}" (auth mode: ${state.apiKeyInfo.mode}).`,
            );
          }
          state.lastProfileId = resolvedProfileId;
          return;
        }
        let runtimeAuthHandled = false;
        const preparedAuth = await prepareProviderRuntimeAuth({
          provider: state.runtimeModel.provider,
          config: params.config,
          workspaceDir: resolvedWorkspace,
          env: process.env,
          context: {
            config: params.config,
            agentDir,
            workspaceDir: resolvedWorkspace,
            env: process.env,
            provider: state.runtimeModel.provider,
            modelId,
            model: state.runtimeModel,
            apiKey: state.apiKeyInfo.apiKey,
            authMode: state.apiKeyInfo.mode,
            profileId: state.apiKeyInfo.profileId,
          },
        });
        if (preparedAuth?.baseUrl) {
          state.runtimeModel = { ...state.runtimeModel, baseUrl: preparedAuth.baseUrl };
          state.effectiveModel = { ...state.effectiveModel, baseUrl: preparedAuth.baseUrl };
        }
        if (preparedAuth?.apiKey) {
          authStorage.setRuntimeApiKey(state.runtimeModel.provider, preparedAuth.apiKey);
          runtimeAuthState = {
            sourceApiKey: state.apiKeyInfo.apiKey,
            authMode: state.apiKeyInfo.mode,
            profileId: state.apiKeyInfo.profileId,
            expiresAt: preparedAuth.expiresAt,
          };
          if (preparedAuth.expiresAt) {
            scheduleRuntimeAuthRefresh();
          }
          runtimeAuthHandled = true;
        }
        if (runtimeAuthHandled) {
          // Plugin-owned runtime auth already stored the exchanged credential.
        } else {
          authStorage.setRuntimeApiKey(state.runtimeModel.provider, state.apiKeyInfo.apiKey);
          runtimeAuthState = null;
        }
        state.lastProfileId = state.apiKeyInfo.profileId;
      };

      const advanceAuthProfile = async (): Promise<boolean> => {
        if (lockedProfileId) {
          return false;
        }
        let nextIndex = state.profileIndex + 1;
        while (nextIndex < profileCandidates.length) {
          const candidate = profileCandidates[nextIndex];
          if (candidate && isProfileInCooldown(authStore, candidate)) {
            nextIndex += 1;
            continue;
          }
          try {
            await applyApiKeyInfo(candidate);
            state.profileIndex = nextIndex;
            state.thinkLevel = initialThinkLevel;
            state.attemptedThinking.clear();
            return true;
          } catch (err) {
            if (candidate && candidate === lockedProfileId) {
              throw err;
            }
            nextIndex += 1;
          }
        }
        return false;
      };

      try {
        const autoProfileCandidates = profileCandidates.filter(
          (candidate): candidate is string =>
            typeof candidate === "string" && candidate.length > 0 && candidate !== lockedProfileId,
        );
        const allAutoProfilesInCooldown =
          autoProfileCandidates.length > 0 &&
          autoProfileCandidates.every((candidate) => isProfileInCooldown(authStore, candidate));
        const unavailableReason = allAutoProfilesInCooldown
          ? (resolveProfilesUnavailableReason({
              store: authStore,
              profileIds: autoProfileCandidates,
            }) ?? "unknown")
          : null;
        const allowTransientCooldownProbe =
          params.allowTransientCooldownProbe === true &&
          allAutoProfilesInCooldown &&
          (unavailableReason === "rate_limit" ||
            unavailableReason === "overloaded" ||
            unavailableReason === "billing" ||
            unavailableReason === "unknown");
        let didTransientCooldownProbe = false;

        while (state.profileIndex < profileCandidates.length) {
          const candidate = profileCandidates[state.profileIndex];
          const inCooldown =
            candidate && candidate !== lockedProfileId && isProfileInCooldown(authStore, candidate);
          if (inCooldown) {
            if (allowTransientCooldownProbe && !didTransientCooldownProbe) {
              didTransientCooldownProbe = true;
              log.warn(
                `probing cooldowned auth profile for ${provider}/${modelId} due to ${unavailableReason ?? "transient"} unavailability`,
              );
            } else {
              state.profileIndex += 1;
              continue;
            }
          }
          await applyApiKeyInfo(profileCandidates[state.profileIndex]);
          break;
        }
        if (state.profileIndex >= profileCandidates.length) {
          throwAuthProfileFailover({ allInCooldown: true });
        }
      } catch (err) {
        if (err instanceof FailoverError) {
          throw err;
        }
        if (profileCandidates[state.profileIndex] === lockedProfileId) {
          throwAuthProfileFailover({ allInCooldown: false, error: err });
        }
        const advanced = await advanceAuthProfile();
        if (!advanced) {
          throwAuthProfileFailover({ allInCooldown: false, error: err });
        }
      }

      const maybeRefreshRuntimeAuthForAuthError = async (
        errorText: string,
        retried: boolean,
      ): Promise<boolean> => {
        if (!runtimeAuthState || retried) {
          return false;
        }
        if (!isFailoverErrorMessage(errorText)) {
          return false;
        }
        if (classifyFailoverReason(errorText) !== "auth") {
          return false;
        }
        try {
          await refreshRuntimeAuth("auth-error");
          scheduleRuntimeAuthRefresh();
          return true;
        } catch {
          return false;
        }
      };

      const maybeMarkAuthProfileFailure = async (failure: {
        profileId?: string;
        reason?: AuthProfileFailureReason | null;
        config?: RunEmbeddedPiAgentParams["config"];
        agentDir?: RunEmbeddedPiAgentParams["agentDir"];
      }) => {
        const { profileId, reason } = failure;
        if (!profileId || !reason || reason === "timeout") {
          return;
        }
        await markAuthProfileFailure({
          store: authStore,
          profileId,
          reason,
          cfg: params.config,
          agentDir,
          runId: params.runId,
        });
      };

      // Resolve the context engine once and reuse across retries to avoid
      // repeated initialization/connection overhead per attempt.
      ensureContextEnginesInitialized();
      const contextEngine = await resolveContextEngine(params.config);

      const loopConfig: RetryLoopConfig = {
        params,
        started,
        provider,
        modelId,
        model,
        agentDir,
        resolvedWorkspace,
        hookRunner,
        hookCtx,
        legacyBeforeAgentStartResult,
        contextEngine,
        ctxInfo,
        authStore,
        authStorage,
        modelRegistry,
        fallbackConfigured,
        lockedProfileId,
        profileCandidates,
        isProbeSession,
        resolvedToolResultFormat,
        initialThinkLevel,
        bootstrapPromptWarningSignaturesSeen:
          params.bootstrapPromptWarningSignaturesSeen ??
          (params.bootstrapPromptWarningSignature
            ? [params.bootstrapPromptWarningSignature]
            : []),
      };
      const loopHelpers: RetryLoopHelpers = {
        advanceAuthProfile,
        maybeRefreshRuntimeAuthForAuthError,
        maybeMarkAuthProfileFailure,
      };
      try {
        return await runRetryLoop(loopConfig, state, loopHelpers);
      } finally {
        await contextEngine.dispose?.();
        stopRuntimeAuthRefreshTimer();
        process.chdir(prevCwd);
      }
    }),
  );
}
