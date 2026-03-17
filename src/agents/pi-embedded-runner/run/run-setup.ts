import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { joinPresentTextSegments } from "../../../shared/text/join-segments.js";
import type { OpenClawConfig } from "../../../config/config.js";
import { isCronSessionKey, isSubagentSessionKey } from "../../../routing/session-key.js";
import { resolveEffectiveToolFsWorkspaceOnly } from "../../tool-fs-policy.js";
import { log } from "../logger.js";
import type {
  PluginHookAgentContext,
  PluginHookBeforeAgentStartResult,
  PluginHookBeforePromptBuildResult,
} from "../../../plugins/types.js";
import type { CompactEmbeddedPiSessionParams } from "../compact.js";
import type { EmbeddedRunAttemptParams } from "./types.js";

export type PromptBuildHookRunner = {
  hasHooks: (hookName: "before_prompt_build" | "before_agent_start") => boolean;
  runBeforePromptBuild: (
    event: { prompt: string; messages: unknown[] },
    ctx: PluginHookAgentContext,
  ) => Promise<PluginHookBeforePromptBuildResult | undefined>;
  runBeforeAgentStart: (
    event: { prompt: string; messages: unknown[] },
    ctx: PluginHookAgentContext,
  ) => Promise<PluginHookBeforeAgentStartResult | undefined>;
};

export async function resolvePromptBuildHookResult(params: {
  prompt: string;
  messages: unknown[];
  hookCtx: PluginHookAgentContext;
  hookRunner?: PromptBuildHookRunner | null;
  legacyBeforeAgentStartResult?: PluginHookBeforeAgentStartResult;
}): Promise<PluginHookBeforePromptBuildResult> {
  const promptBuildResult = params.hookRunner?.hasHooks("before_prompt_build")
    ? await params.hookRunner
        .runBeforePromptBuild(
          {
            prompt: params.prompt,
            messages: params.messages,
          },
          params.hookCtx,
        )
        .catch((hookErr: unknown) => {
          log.warn(`before_prompt_build hook failed: ${String(hookErr)}`);
          return undefined;
        })
    : undefined;
  const legacyResult =
    params.legacyBeforeAgentStartResult ??
    (params.hookRunner?.hasHooks("before_agent_start")
      ? await params.hookRunner
          .runBeforeAgentStart(
            {
              prompt: params.prompt,
              messages: params.messages,
            },
            params.hookCtx,
          )
          .catch((hookErr: unknown) => {
            log.warn(
              `before_agent_start hook (legacy prompt build path) failed: ${String(hookErr)}`,
            );
            return undefined;
          })
      : undefined);
  return {
    systemPrompt: promptBuildResult?.systemPrompt ?? legacyResult?.systemPrompt,
    prependContext: joinPresentTextSegments([
      promptBuildResult?.prependContext,
      legacyResult?.prependContext,
    ]),
    prependSystemContext: joinPresentTextSegments([
      promptBuildResult?.prependSystemContext,
      legacyResult?.prependSystemContext,
    ]),
    appendSystemContext: joinPresentTextSegments([
      promptBuildResult?.appendSystemContext,
      legacyResult?.appendSystemContext,
    ]),
  };
}

export function composeSystemPromptWithHookContext(params: {
  baseSystemPrompt?: string;
  prependSystemContext?: string;
  appendSystemContext?: string;
}): string | undefined {
  const prependSystem = params.prependSystemContext?.trim();
  const appendSystem = params.appendSystemContext?.trim();
  if (!prependSystem && !appendSystem) {
    return undefined;
  }
  return joinPresentTextSegments(
    [params.prependSystemContext, params.baseSystemPrompt, params.appendSystemContext],
    { trim: true },
  );
}

export function resolvePromptModeForSession(sessionKey?: string): "minimal" | "full" {
  if (!sessionKey) {
    return "full";
  }
  return isSubagentSessionKey(sessionKey) || isCronSessionKey(sessionKey) ? "minimal" : "full";
}

export function resolveAttemptFsWorkspaceOnly(params: {
  config?: OpenClawConfig;
  sessionAgentId: string;
}): boolean {
  return resolveEffectiveToolFsWorkspaceOnly({
    cfg: params.config,
    agentId: params.sessionAgentId,
  });
}

export function prependSystemPromptAddition(params: {
  systemPrompt: string;
  systemPromptAddition?: string;
}): string {
  if (!params.systemPromptAddition) {
    return params.systemPrompt;
  }
  return `${params.systemPromptAddition}\n\n${params.systemPrompt}`;
}

/** Build runtime context passed into context-engine afterTurn hooks. */
export function buildAfterTurnRuntimeContext(params: {
  attempt: Pick<
    EmbeddedRunAttemptParams,
    | "sessionKey"
    | "messageChannel"
    | "messageProvider"
    | "agentAccountId"
    | "config"
    | "skillsSnapshot"
    | "senderIsOwner"
    | "provider"
    | "modelId"
    | "thinkLevel"
    | "reasoningLevel"
    | "bashElevated"
    | "extraSystemPrompt"
    | "ownerNumbers"
    | "authProfileId"
  >;
  workspaceDir: string;
  agentDir: string;
}): Partial<CompactEmbeddedPiSessionParams> {
  return {
    sessionKey: params.attempt.sessionKey,
    messageChannel: params.attempt.messageChannel,
    messageProvider: params.attempt.messageProvider,
    agentAccountId: params.attempt.agentAccountId,
    authProfileId: params.attempt.authProfileId,
    workspaceDir: params.workspaceDir,
    agentDir: params.agentDir,
    config: params.attempt.config,
    skillsSnapshot: params.attempt.skillsSnapshot,
    senderIsOwner: params.attempt.senderIsOwner,
    provider: params.attempt.provider,
    model: params.attempt.modelId,
    thinkLevel: params.attempt.thinkLevel,
    reasoningLevel: params.attempt.reasoningLevel,
    bashElevated: params.attempt.bashElevated,
    extraSystemPrompt: params.attempt.extraSystemPrompt,
    ownerNumbers: params.attempt.ownerNumbers,
  };
}

export function summarizeMessagePayload(msg: AgentMessage): {
  textChars: number;
  imageBlocks: number;
} {
  const content = (msg as { content?: unknown }).content;
  if (typeof content === "string") {
    return { textChars: content.length, imageBlocks: 0 };
  }
  if (!Array.isArray(content)) {
    return { textChars: 0, imageBlocks: 0 };
  }

  let textChars = 0;
  let imageBlocks = 0;
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const typedBlock = block as { type?: unknown; text?: unknown };
    if (typedBlock.type === "image") {
      imageBlocks++;
      continue;
    }
    if (typeof typedBlock.text === "string") {
      textChars += typedBlock.text.length;
    }
  }

  return { textChars, imageBlocks };
}

export function summarizeSessionContext(messages: AgentMessage[]): {
  roleCounts: string;
  totalTextChars: number;
  totalImageBlocks: number;
  maxMessageTextChars: number;
} {
  const roleCounts = new Map<string, number>();
  let totalTextChars = 0;
  let totalImageBlocks = 0;
  let maxMessageTextChars = 0;

  for (const msg of messages) {
    const role = typeof msg.role === "string" ? msg.role : "unknown";
    roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);

    const payload = summarizeMessagePayload(msg);
    totalTextChars += payload.textChars;
    totalImageBlocks += payload.imageBlocks;
    if (payload.textChars > maxMessageTextChars) {
      maxMessageTextChars = payload.textChars;
    }
  }

  return {
    roleCounts:
      [...roleCounts.entries()]
        .toSorted((a, b) => a[0].localeCompare(b[0]))
        .map(([role, count]) => `${role}:${count}`)
        .join(",") || "none",
    totalTextChars,
    totalImageBlocks,
    maxMessageTextChars,
  };
}
