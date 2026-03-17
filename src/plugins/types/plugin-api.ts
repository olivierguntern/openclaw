import type { IncomingMessage, ServerResponse } from "node:http";
import type { TopLevelComponents } from "@buape/carbon";
import type { Command } from "commander";
import type { AnyAgentTool } from "../../agents/tools/common.js";
import type { ReplyPayload } from "../../auto-reply/types.js";
import type { ChannelId, ChannelPlugin } from "../../channels/plugins/types.js";
import type { OpenClawConfig } from "../../config/config.js";
import type { GatewayRequestHandler } from "../../gateway/server-methods/types.js";
import type { InternalHookHandler } from "../../hooks/internal-hooks.js";
import type { HookEntry } from "../../hooks/types.js";
import type { PluginRuntime } from "../runtime/types.js";
import type { PluginHookHandlerMap, PluginHookName } from "./hooks.js";
import type { ImageGenerationProviderPlugin, MediaUnderstandingProviderPlugin } from "./speech.js";
import type { SpeechProviderPlugin } from "./speech.js";
import type { ProviderPlugin } from "./provider.js";
import type { WebSearchProviderPlugin } from "./web-search.js";

export type { PluginRuntime } from "../runtime/types.js";
export type { AnyAgentTool } from "../../agents/tools/common.js";

export type PluginLogger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

export type PluginConfigUiHint = {
  label?: string;
  help?: string;
  tags?: string[];
  advanced?: boolean;
  sensitive?: boolean;
  placeholder?: string;
};

export type PluginKind = "memory" | "context-engine";

export type PluginConfigValidation =
  | { ok: true; value?: unknown }
  | { ok: false; errors: string[] };

export type OpenClawPluginConfigSchema = {
  safeParse?: (value: unknown) => {
    success: boolean;
    data?: unknown;
    error?: {
      issues?: Array<{ path: Array<string | number>; message: string }>;
    };
  };
  parse?: (value: unknown) => unknown;
  validate?: (value: unknown) => PluginConfigValidation;
  uiHints?: Record<string, PluginConfigUiHint>;
  jsonSchema?: Record<string, unknown>;
};

export type OpenClawPluginToolContext = {
  config?: OpenClawConfig;
  workspaceDir?: string;
  agentDir?: string;
  agentId?: string;
  sessionKey?: string;
  /** Ephemeral session UUID — regenerated on /new and /reset. Use for per-conversation isolation. */
  sessionId?: string;
  messageChannel?: string;
  agentAccountId?: string;
  /** Trusted sender id from inbound context (runtime-provided, not tool args). */
  requesterSenderId?: string;
  /** Whether the trusted sender is an owner. */
  senderIsOwner?: boolean;
  sandboxed?: boolean;
};

export type OpenClawPluginToolFactory = (
  ctx: OpenClawPluginToolContext,
) => AnyAgentTool | AnyAgentTool[] | null | undefined;

export type OpenClawPluginToolOptions = {
  name?: string;
  names?: string[];
  optional?: boolean;
};

export type OpenClawPluginHookOptions = {
  entry?: HookEntry;
  name?: string;
  description?: string;
  register?: boolean;
};

export type OpenClawPluginGatewayMethod = {
  method: string;
  handler: GatewayRequestHandler;
};

// =============================================================================
// Plugin Commands
// =============================================================================

/**
 * Context passed to plugin command handlers.
 */
export type PluginCommandContext = {
  /** The sender's identifier (e.g., Telegram user ID) */
  senderId?: string;
  /** The channel/surface (e.g., "telegram", "discord") */
  channel: string;
  /** Provider channel id (e.g., "telegram") */
  channelId?: ChannelId;
  /** Whether the sender is on the allowlist */
  isAuthorizedSender: boolean;
  /** Raw command arguments after the command name */
  args?: string;
  /** The full normalized command body */
  commandBody: string;
  /** Current OpenClaw configuration */
  config: OpenClawConfig;
  /** Raw "From" value (channel-scoped id) */
  from?: string;
  /** Raw "To" value (channel-scoped id) */
  to?: string;
  /** Account id for multi-account channels */
  accountId?: string;
  /** Thread/topic id if available */
  messageThreadId?: number;
  requestConversationBinding: (
    params?: PluginConversationBindingRequestParams,
  ) => Promise<PluginConversationBindingRequestResult>;
  detachConversationBinding: () => Promise<{ removed: boolean }>;
  getCurrentConversationBinding: () => Promise<PluginConversationBinding | null>;
};

export type PluginConversationBindingRequestParams = {
  summary?: string;
  detachHint?: string;
};

export type PluginConversationBinding = {
  bindingId: string;
  pluginId: string;
  pluginName?: string;
  pluginRoot: string;
  channel: string;
  accountId: string;
  conversationId: string;
  parentConversationId?: string;
  threadId?: string | number;
  boundAt: number;
  summary?: string;
  detachHint?: string;
};

export type PluginConversationBindingRequestResult =
  | {
      status: "bound";
      binding: PluginConversationBinding;
    }
  | {
      status: "pending";
      approvalId: string;
      reply: ReplyPayload;
    }
  | {
      status: "error";
      message: string;
    };

/**
 * Result returned by a plugin command handler.
 */
export type PluginCommandResult = ReplyPayload;

/**
 * Handler function for plugin commands.
 */
export type PluginCommandHandler = (
  ctx: PluginCommandContext,
) => PluginCommandResult | Promise<PluginCommandResult>;

/**
 * Definition for a plugin-registered command.
 */
export type OpenClawPluginCommandDefinition = {
  /** Command name without leading slash (e.g., "tts") */
  name: string;
  /**
   * Optional native-command aliases for slash/menu surfaces.
   * `default` applies to all native providers unless a provider-specific
   * override exists (for example `{ default: "talkvoice", discord: "voice2" }`).
   */
  nativeNames?: Partial<Record<string, string>> & { default?: string };
  /** Description shown in /help and command menus */
  description: string;
  /** Whether this command accepts arguments */
  acceptsArgs?: boolean;
  /** Whether only authorized senders can use this command (default: true) */
  requireAuth?: boolean;
  /** The handler function */
  handler: PluginCommandHandler;
};

export type PluginInteractiveChannel = "telegram" | "discord" | "slack";

export type PluginInteractiveButtons = Array<
  Array<{ text: string; callback_data: string; style?: "danger" | "success" | "primary" }>
>;

export type PluginInteractiveTelegramHandlerResult = {
  handled?: boolean;
} | void;

export type PluginInteractiveTelegramHandlerContext = {
  channel: "telegram";
  accountId: string;
  callbackId: string;
  conversationId: string;
  parentConversationId?: string;
  senderId?: string;
  senderUsername?: string;
  threadId?: number;
  isGroup: boolean;
  isForum: boolean;
  auth: {
    isAuthorizedSender: boolean;
  };
  callback: {
    data: string;
    namespace: string;
    payload: string;
    messageId: number;
    chatId: string;
    messageText?: string;
  };
  respond: {
    reply: (params: { text: string; buttons?: PluginInteractiveButtons }) => Promise<void>;
    editMessage: (params: { text: string; buttons?: PluginInteractiveButtons }) => Promise<void>;
    editButtons: (params: { buttons: PluginInteractiveButtons }) => Promise<void>;
    clearButtons: () => Promise<void>;
    deleteMessage: () => Promise<void>;
  };
  requestConversationBinding: (
    params?: PluginConversationBindingRequestParams,
  ) => Promise<PluginConversationBindingRequestResult>;
  detachConversationBinding: () => Promise<{ removed: boolean }>;
  getCurrentConversationBinding: () => Promise<PluginConversationBinding | null>;
};

export type PluginInteractiveDiscordHandlerResult = {
  handled?: boolean;
} | void;

export type PluginInteractiveDiscordHandlerContext = {
  channel: "discord";
  accountId: string;
  interactionId: string;
  conversationId: string;
  parentConversationId?: string;
  guildId?: string;
  senderId?: string;
  senderUsername?: string;
  auth: {
    isAuthorizedSender: boolean;
  };
  interaction: {
    kind: "button" | "select" | "modal";
    data: string;
    namespace: string;
    payload: string;
    messageId?: string;
    values?: string[];
    fields?: Array<{ id: string; name: string; values: string[] }>;
  };
  respond: {
    acknowledge: () => Promise<void>;
    reply: (params: { text: string; ephemeral?: boolean }) => Promise<void>;
    followUp: (params: { text: string; ephemeral?: boolean }) => Promise<void>;
    editMessage: (params: { text?: string; components?: TopLevelComponents[] }) => Promise<void>;
    clearComponents: (params?: { text?: string }) => Promise<void>;
  };
  requestConversationBinding: (
    params?: PluginConversationBindingRequestParams,
  ) => Promise<PluginConversationBindingRequestResult>;
  detachConversationBinding: () => Promise<{ removed: boolean }>;
  getCurrentConversationBinding: () => Promise<PluginConversationBinding | null>;
};

export type PluginInteractiveSlackHandlerResult = {
  handled?: boolean;
} | void;

export type PluginInteractiveSlackHandlerContext = {
  channel: "slack";
  accountId: string;
  interactionId: string;
  conversationId: string;
  parentConversationId?: string;
  senderId?: string;
  senderUsername?: string;
  threadId?: string;
  auth: {
    isAuthorizedSender: boolean;
  };
  interaction: {
    kind: "button" | "select";
    data: string;
    namespace: string;
    payload: string;
    actionId: string;
    blockId?: string;
    messageTs?: string;
    threadTs?: string;
    value?: string;
    selectedValues?: string[];
    selectedLabels?: string[];
    triggerId?: string;
    responseUrl?: string;
  };
  respond: {
    acknowledge: () => Promise<void>;
    reply: (params: { text: string; responseType?: "ephemeral" | "in_channel" }) => Promise<void>;
    followUp: (params: {
      text: string;
      responseType?: "ephemeral" | "in_channel";
    }) => Promise<void>;
    editMessage: (params: { text?: string; blocks?: unknown[] }) => Promise<void>;
  };
  requestConversationBinding: (
    params?: PluginConversationBindingRequestParams,
  ) => Promise<PluginConversationBindingRequestResult>;
  detachConversationBinding: () => Promise<{ removed: boolean }>;
  getCurrentConversationBinding: () => Promise<PluginConversationBinding | null>;
};

export type PluginInteractiveTelegramHandlerRegistration = {
  channel: "telegram";
  namespace: string;
  handler: (
    ctx: PluginInteractiveTelegramHandlerContext,
  ) => Promise<PluginInteractiveTelegramHandlerResult> | PluginInteractiveTelegramHandlerResult;
};

export type PluginInteractiveDiscordHandlerRegistration = {
  channel: "discord";
  namespace: string;
  handler: (
    ctx: PluginInteractiveDiscordHandlerContext,
  ) => Promise<PluginInteractiveDiscordHandlerResult> | PluginInteractiveDiscordHandlerResult;
};

export type PluginInteractiveSlackHandlerRegistration = {
  channel: "slack";
  namespace: string;
  handler: (
    ctx: PluginInteractiveSlackHandlerContext,
  ) => Promise<PluginInteractiveSlackHandlerResult> | PluginInteractiveSlackHandlerResult;
};

export type PluginInteractiveHandlerRegistration =
  | PluginInteractiveTelegramHandlerRegistration
  | PluginInteractiveDiscordHandlerRegistration
  | PluginInteractiveSlackHandlerRegistration;

export type OpenClawPluginHttpRouteAuth = "gateway" | "plugin";
export type OpenClawPluginHttpRouteMatch = "exact" | "prefix";

export type OpenClawPluginHttpRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<boolean | void> | boolean | void;

export type OpenClawPluginHttpRouteParams = {
  path: string;
  handler: OpenClawPluginHttpRouteHandler;
  auth: OpenClawPluginHttpRouteAuth;
  match?: OpenClawPluginHttpRouteMatch;
  replaceExisting?: boolean;
};

export type OpenClawPluginCliContext = {
  program: Command;
  config: OpenClawConfig;
  workspaceDir?: string;
  logger: PluginLogger;
};

export type OpenClawPluginCliRegistrar = (ctx: OpenClawPluginCliContext) => void | Promise<void>;

export type OpenClawPluginServiceContext = {
  config: OpenClawConfig;
  workspaceDir?: string;
  stateDir: string;
  logger: PluginLogger;
};

export type OpenClawPluginService = {
  id: string;
  start: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
  stop?: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
};

export type OpenClawPluginChannelRegistration = {
  plugin: ChannelPlugin;
};

export type OpenClawPluginDefinition = {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  kind?: PluginKind;
  configSchema?: OpenClawPluginConfigSchema;
  register?: (api: OpenClawPluginApi) => void | Promise<void>;
  activate?: (api: OpenClawPluginApi) => void | Promise<void>;
};

export type OpenClawPluginModule =
  | OpenClawPluginDefinition
  | ((api: OpenClawPluginApi) => void | Promise<void>);

export type PluginRegistrationMode = "full" | "setup-only" | "setup-runtime";

export type OpenClawPluginApi = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  rootDir?: string;
  registrationMode: PluginRegistrationMode;
  config: OpenClawConfig;
  pluginConfig?: Record<string, unknown>;
  runtime: PluginRuntime;
  logger: PluginLogger;
  registerTool: (
    tool: AnyAgentTool | OpenClawPluginToolFactory,
    opts?: OpenClawPluginToolOptions,
  ) => void;
  registerHook: (
    events: string | string[],
    handler: InternalHookHandler,
    opts?: OpenClawPluginHookOptions,
  ) => void;
  registerHttpRoute: (params: OpenClawPluginHttpRouteParams) => void;
  registerChannel: (registration: OpenClawPluginChannelRegistration | ChannelPlugin) => void;
  registerGatewayMethod: (method: string, handler: GatewayRequestHandler) => void;
  registerCli: (registrar: OpenClawPluginCliRegistrar, opts?: { commands?: string[] }) => void;
  registerService: (service: OpenClawPluginService) => void;
  registerProvider: (provider: ProviderPlugin) => void;
  registerSpeechProvider: (provider: SpeechProviderPlugin) => void;
  registerMediaUnderstandingProvider: (provider: MediaUnderstandingProviderPlugin) => void;
  registerImageGenerationProvider: (provider: ImageGenerationProviderPlugin) => void;
  registerWebSearchProvider: (provider: WebSearchProviderPlugin) => void;
  registerInteractiveHandler: (registration: PluginInteractiveHandlerRegistration) => void;
  /**
   * Register a custom command that bypasses the LLM agent.
   * Plugin commands are processed before built-in commands and before agent invocation.
   * Use this for simple state-toggling or status commands that don't need AI reasoning.
   */
  registerCommand: (command: OpenClawPluginCommandDefinition) => void;
  /** Register a context engine implementation (exclusive slot — only one active at a time). */
  registerContextEngine: (
    id: string,
    factory: import("../../context-engine/registry.js").ContextEngineFactory,
  ) => void;
  resolvePath: (input: string) => string;
  /** Register a lifecycle hook handler */
  on: <K extends PluginHookName>(
    hookName: K,
    handler: PluginHookHandlerMap[K],
    opts?: { priority?: number },
  ) => void;
};

export type PluginOrigin = "bundled" | "global" | "workspace" | "config";

export type PluginFormat = "openclaw" | "bundle";

export type PluginBundleFormat = "codex" | "claude" | "cursor";

export type PluginDiagnostic = {
  level: "warn" | "error";
  message: string;
  pluginId?: string;
  source?: string;
};
