export const TELEGRAM_CHANNELS_FIELD_HELP: Record<string, string> = {
  "channels.telegram":
    "Telegram channel provider configuration including auth tokens, retry behavior, and message rendering controls. Use this section to tune bot behavior for Telegram-specific API semantics.",
  "channels.telegram.configWrites":
    "Allow Telegram to write config in response to channel events/commands (default: true).",
  "channels.telegram.botToken":
    "Telegram bot token used to authenticate Bot API requests for this account/provider config. Use secret/env substitution and rotate tokens if exposure is suspected.",
  "channels.telegram.capabilities.inlineButtons":
    "Enable Telegram inline button components for supported command and interaction surfaces. Disable if your deployment needs plain-text-only compatibility behavior.",
  "channels.telegram.execApprovals":
    "Telegram-native exec approval routing and approver authorization. Enable this only when Telegram should act as an explicit exec-approval client for the selected bot account.",
  "channels.telegram.execApprovals.enabled":
    "Enable Telegram exec approvals for this account. When false or unset, Telegram messages/buttons cannot approve exec requests.",
  "channels.telegram.execApprovals.approvers":
    "Telegram user IDs allowed to approve exec requests for this bot account. Use numeric Telegram user IDs; prompts are only delivered to these approvers when target includes dm.",
  "channels.telegram.execApprovals.agentFilter":
    'Optional allowlist of agent IDs eligible for Telegram exec approvals, for example `["main", "ops-agent"]`. Use this to keep approval prompts scoped to the agents you actually operate from Telegram.',
  "channels.telegram.execApprovals.sessionFilter":
    "Optional session-key filters matched as substring or regex-style patterns before Telegram approval routing is used. Use narrow patterns so Telegram approvals only appear for intended sessions.",
  "channels.telegram.execApprovals.target":
    'Controls where Telegram approval prompts are sent: "dm" sends to approver DMs (default), "channel" sends to the originating Telegram chat/topic, and "both" sends to both. Channel delivery exposes the command text to the chat, so only use it in trusted groups/topics.',
  "channels.telegram.commands.native": 'Override native commands for Telegram (bool or "auto").',
  "channels.telegram.commands.nativeSkills":
    'Override native skill commands for Telegram (bool or "auto").',
  "channels.telegram.customCommands":
    "Additional Telegram bot menu commands (merged with native; conflicts ignored).",
  "channels.telegram.dmPolicy":
    'Direct message access control ("pairing" recommended). "open" requires channels.telegram.allowFrom=["*"].',
  "channels.telegram.streaming":
    'Unified Telegram stream preview mode: "off" | "partial" | "block" | "progress" (default: "partial"). "progress" maps to "partial" on Telegram. Legacy boolean/streamMode keys are auto-mapped.',
  "channels.telegram.retry.attempts":
    "Max retry attempts for outbound Telegram API calls (default: 3).",
  "channels.telegram.retry.minDelayMs": "Minimum retry delay in ms for Telegram outbound calls.",
  "channels.telegram.retry.maxDelayMs":
    "Maximum retry delay cap in ms for Telegram outbound calls.",
  "channels.telegram.retry.jitter": "Jitter factor (0-1) applied to Telegram retry delays.",
  "channels.telegram.network.autoSelectFamily":
    "Override Node autoSelectFamily for Telegram (true=enable, false=disable).",
  "channels.telegram.timeoutSeconds":
    "Max seconds before Telegram API requests are aborted (default: 500 per grammY).",
  "channels.telegram.silentErrorReplies":
    "When true, Telegram bot replies marked as errors are sent silently (no notification sound). Default: false.",
  "channels.telegram.threadBindings.enabled":
    "Enable Telegram conversation binding features (/focus, /unfocus, /agents, and /session idle|max-age). Overrides session.threadBindings.enabled when set.",
  "channels.telegram.threadBindings.idleHours":
    "Inactivity window in hours for Telegram bound sessions. Set 0 to disable idle auto-unfocus (default: 24). Overrides session.threadBindings.idleHours when set.",
  "channels.telegram.threadBindings.maxAgeHours":
    "Optional hard max age in hours for Telegram bound sessions. Set 0 to disable hard cap (default: 0). Overrides session.threadBindings.maxAgeHours when set.",
  "channels.telegram.threadBindings.spawnSubagentSessions":
    "Allow subagent spawns with thread=true to auto-bind Telegram current conversations when supported.",
  "channels.telegram.threadBindings.spawnAcpSessions":
    "Allow ACP spawns with thread=true to auto-bind Telegram current conversations when supported.",
};
