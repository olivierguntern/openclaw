import { z } from "zod";
import {
  resolveSlackNativeStreaming,
  resolveSlackStreamingMode,
} from "./discord-preview-streaming.js";
import { ToolPolicySchema } from "./zod-schema.agent-runtime.js";
import {
  ChannelHealthMonitorSchema,
  ChannelHeartbeatVisibilitySchema,
} from "./zod-schema.channels.js";
import {
  BlockStreamingCoalesceSchema,
  DmConfigSchema,
  DmPolicySchema,
  GroupPolicySchema,
  MarkdownConfigSchema,
  ProviderCommandsSchema,
  ReplyToModeSchema,
  SecretInputSchema,
  requireAllowlistAllowFrom,
  requireOpenAllowFrom,
} from "./zod-schema.core.js";
import { validateSlackSigningSecretRequirements } from "./zod-schema.secret-input-validation.js";
import { sensitive } from "./zod-schema.sensitive.js";
import { ToolPolicyBySenderSchema } from "./zod-schema.providers-shared.js";

const SlackCapabilitiesSchema = z.union([
  z.array(z.string()),
  z
    .object({
      interactiveReplies: z.boolean().optional(),
    })
    .strict(),
]);

function normalizeSlackStreamingConfig(value: {
  streaming?: unknown;
  nativeStreaming?: unknown;
  streamMode?: unknown;
}) {
  value.nativeStreaming = resolveSlackNativeStreaming(value);
  value.streaming = resolveSlackStreamingMode(value);
  delete value.streamMode;
}

export const SlackDmSchema = z
  .object({
    enabled: z.boolean().optional(),
    policy: DmPolicySchema.optional(),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    groupEnabled: z.boolean().optional(),
    groupChannels: z.array(z.union([z.string(), z.number()])).optional(),
    replyToMode: ReplyToModeSchema.optional(),
  })
  .strict();

export const SlackChannelSchema = z
  .object({
    enabled: z.boolean().optional(),
    allow: z.boolean().optional(),
    requireMention: z.boolean().optional(),
    tools: ToolPolicySchema,
    toolsBySender: ToolPolicyBySenderSchema,
    allowBots: z.boolean().optional(),
    users: z.array(z.union([z.string(), z.number()])).optional(),
    skills: z.array(z.string()).optional(),
    systemPrompt: z.string().optional(),
  })
  .strict();

export const SlackThreadSchema = z
  .object({
    historyScope: z.enum(["thread", "channel"]).optional(),
    inheritParent: z.boolean().optional(),
    initialHistoryLimit: z.number().int().min(0).optional(),
  })
  .strict();

const SlackReplyToModeByChatTypeSchema = z
  .object({
    direct: ReplyToModeSchema.optional(),
    group: ReplyToModeSchema.optional(),
    channel: ReplyToModeSchema.optional(),
  })
  .strict();

export const SlackAccountSchema = z
  .object({
    name: z.string().optional(),
    mode: z.enum(["socket", "http"]).optional(),
    signingSecret: SecretInputSchema.optional().register(sensitive),
    webhookPath: z.string().optional(),
    capabilities: SlackCapabilitiesSchema.optional(),
    markdown: MarkdownConfigSchema,
    enabled: z.boolean().optional(),
    commands: ProviderCommandsSchema,
    configWrites: z.boolean().optional(),
    botToken: SecretInputSchema.optional().register(sensitive),
    appToken: SecretInputSchema.optional().register(sensitive),
    userToken: SecretInputSchema.optional().register(sensitive),
    userTokenReadOnly: z.boolean().optional().default(true),
    allowBots: z.boolean().optional(),
    dangerouslyAllowNameMatching: z.boolean().optional(),
    requireMention: z.boolean().optional(),
    groupPolicy: GroupPolicySchema.optional(),
    historyLimit: z.number().int().min(0).optional(),
    dmHistoryLimit: z.number().int().min(0).optional(),
    dms: z.record(z.string(), DmConfigSchema.optional()).optional(),
    textChunkLimit: z.number().int().positive().optional(),
    chunkMode: z.enum(["length", "newline"]).optional(),
    blockStreaming: z.boolean().optional(),
    blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
    streaming: z.union([z.boolean(), z.enum(["off", "partial", "block", "progress"])]).optional(),
    nativeStreaming: z.boolean().optional(),
    streamMode: z.enum(["replace", "status_final", "append"]).optional(),
    mediaMaxMb: z.number().positive().optional(),
    reactionNotifications: z.enum(["off", "own", "all", "allowlist"]).optional(),
    reactionAllowlist: z.array(z.union([z.string(), z.number()])).optional(),
    replyToMode: ReplyToModeSchema.optional(),
    replyToModeByChatType: SlackReplyToModeByChatTypeSchema.optional(),
    thread: SlackThreadSchema.optional(),
    actions: z
      .object({
        reactions: z.boolean().optional(),
        messages: z.boolean().optional(),
        pins: z.boolean().optional(),
        search: z.boolean().optional(),
        permissions: z.boolean().optional(),
        memberInfo: z.boolean().optional(),
        channelInfo: z.boolean().optional(),
        emojiList: z.boolean().optional(),
      })
      .strict()
      .optional(),
    slashCommand: z
      .object({
        enabled: z.boolean().optional(),
        name: z.string().optional(),
        sessionPrefix: z.string().optional(),
        ephemeral: z.boolean().optional(),
      })
      .strict()
      .optional(),
    // Aliases for channels.slack.dm.policy / channels.slack.dm.allowFrom. Prefer these for
    // inheritance in multi-account setups (shallow merge works; nested dm object doesn't).
    dmPolicy: DmPolicySchema.optional(),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    defaultTo: z.string().optional(),
    dm: SlackDmSchema.optional(),
    channels: z.record(z.string(), SlackChannelSchema.optional()).optional(),
    heartbeat: ChannelHeartbeatVisibilitySchema,
    healthMonitor: ChannelHealthMonitorSchema,
    responsePrefix: z.string().optional(),
    ackReaction: z.string().optional(),
    typingReaction: z.string().optional(),
  })
  .strict()
  .superRefine((value) => {
    normalizeSlackStreamingConfig(value);

    // DM allowlist validation is enforced at SlackConfigSchema so account entries
    // can inherit top-level allowFrom via runtime shallow merge.
  });

export const SlackConfigSchema = SlackAccountSchema.safeExtend({
  mode: z.enum(["socket", "http"]).optional().default("socket"),
  signingSecret: SecretInputSchema.optional().register(sensitive),
  webhookPath: z.string().optional().default("/slack/events"),
  groupPolicy: GroupPolicySchema.optional().default("allowlist"),
  accounts: z.record(z.string(), SlackAccountSchema.optional()).optional(),
  defaultAccount: z.string().optional(),
}).superRefine((value, ctx) => {
  const dmPolicy = value.dmPolicy ?? value.dm?.policy ?? "pairing";
  const allowFrom = value.allowFrom ?? value.dm?.allowFrom;
  const allowFromPath =
    value.allowFrom !== undefined ? (["allowFrom"] as const) : (["dm", "allowFrom"] as const);
  requireOpenAllowFrom({
    policy: dmPolicy,
    allowFrom,
    ctx,
    path: [...allowFromPath],
    message:
      'channels.slack.dmPolicy="open" requires channels.slack.allowFrom (or channels.slack.dm.allowFrom) to include "*"',
  });
  requireAllowlistAllowFrom({
    policy: dmPolicy,
    allowFrom,
    ctx,
    path: [...allowFromPath],
    message:
      'channels.slack.dmPolicy="allowlist" requires channels.slack.allowFrom (or channels.slack.dm.allowFrom) to contain at least one sender ID',
  });

  const baseMode = value.mode ?? "socket";
  if (!value.accounts) {
    validateSlackSigningSecretRequirements(value, ctx);
    return;
  }
  for (const [accountId, account] of Object.entries(value.accounts)) {
    if (!account) {
      continue;
    }
    if (account.enabled === false) {
      continue;
    }
    const accountMode = account.mode ?? baseMode;
    const effectivePolicy =
      account.dmPolicy ?? account.dm?.policy ?? value.dmPolicy ?? value.dm?.policy ?? "pairing";
    const effectiveAllowFrom =
      account.allowFrom ?? account.dm?.allowFrom ?? value.allowFrom ?? value.dm?.allowFrom;
    requireOpenAllowFrom({
      policy: effectivePolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message:
        'channels.slack.accounts.*.dmPolicy="open" requires channels.slack.accounts.*.allowFrom (or channels.slack.allowFrom) to include "*"',
    });
    requireAllowlistAllowFrom({
      policy: effectivePolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message:
        'channels.slack.accounts.*.dmPolicy="allowlist" requires channels.slack.accounts.*.allowFrom (or channels.slack.allowFrom) to contain at least one sender ID',
    });
    if (accountMode !== "http") {
      continue;
    }
  }
  validateSlackSigningSecretRequirements(value, ctx);
});
