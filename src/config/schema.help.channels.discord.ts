import {
  DISCORD_DEFAULT_INBOUND_WORKER_TIMEOUT_MS,
  DISCORD_DEFAULT_LISTENER_TIMEOUT_MS,
} from "../plugin-sdk/discord.js";

export const DISCORD_CHANNELS_FIELD_HELP: Record<string, string> = {
  "channels.discord":
    "Discord channel provider configuration for bot auth, retry policy, streaming, thread bindings, and optional voice capabilities. Keep privileged intents and advanced features disabled unless needed.",
  "channels.discord.configWrites":
    "Allow Discord to write config in response to channel events/commands (default: true).",
  "channels.discord.token":
    "Discord bot token used for gateway and REST API authentication for this provider account. Keep this secret out of committed config and rotate immediately after any leak.",
  "channels.discord.allowBots":
    'Allow bot-authored messages to trigger Discord replies (default: false). Set "mentions" to only accept bot messages that mention the bot.',
  "channels.discord.proxy":
    "Proxy URL for Discord gateway + API requests (app-id lookup and allowlist resolution). Set per account via channels.discord.accounts.<id>.proxy.",
  "channels.discord.commands.native": 'Override native commands for Discord (bool or "auto").',
  "channels.discord.commands.nativeSkills":
    'Override native skill commands for Discord (bool or "auto").',
  "channels.discord.streaming":
    'Unified Discord stream preview mode: "off" | "partial" | "block" | "progress". "progress" maps to "partial" on Discord. Legacy boolean/streamMode keys are auto-mapped.',
  "channels.discord.streamMode":
    "Legacy Discord preview mode alias (off | partial | block); auto-migrated to channels.discord.streaming.",
  "channels.discord.draftChunk.minChars":
    'Minimum chars before emitting a Discord stream preview update when channels.discord.streaming="block" (default: 200).',
  "channels.discord.draftChunk.maxChars":
    'Target max size for a Discord stream preview chunk when channels.discord.streaming="block" (default: 800; clamped to channels.discord.textChunkLimit).',
  "channels.discord.draftChunk.breakPreference":
    "Preferred breakpoints for Discord draft chunks (paragraph | newline | sentence). Default: paragraph.",
  "channels.discord.dmPolicy":
    'Direct message access control ("pairing" recommended). "open" requires channels.discord.allowFrom=["*"].',
  "channels.discord.dm.policy":
    'Direct message access control ("pairing" recommended). "open" requires channels.discord.allowFrom=["*"] (legacy: channels.discord.dm.allowFrom).',
  "channels.discord.retry.attempts":
    "Max retry attempts for outbound Discord API calls (default: 3).",
  "channels.discord.retry.minDelayMs": "Minimum retry delay in ms for Discord outbound calls.",
  "channels.discord.retry.maxDelayMs": "Maximum retry delay cap in ms for Discord outbound calls.",
  "channels.discord.retry.jitter": "Jitter factor (0-1) applied to Discord retry delays.",
  "channels.discord.maxLinesPerMessage": "Soft max line count per Discord message (default: 17).",
  "channels.discord.inboundWorker.runTimeoutMs": `Optional queued Discord inbound worker timeout in ms. This is separate from Carbon listener timeouts; defaults to ${DISCORD_DEFAULT_INBOUND_WORKER_TIMEOUT_MS} and can be disabled with 0. Set per account via channels.discord.accounts.<id>.inboundWorker.runTimeoutMs.`,
  "channels.discord.eventQueue.listenerTimeout": `Canonical Discord listener timeout control in ms for gateway normalization/enqueue handlers. Default is ${DISCORD_DEFAULT_LISTENER_TIMEOUT_MS} in OpenClaw; set per account via channels.discord.accounts.<id>.eventQueue.listenerTimeout.`,
  "channels.discord.eventQueue.maxQueueSize":
    "Optional Discord EventQueue capacity override (max queued events before backpressure). Set per account via channels.discord.accounts.<id>.eventQueue.maxQueueSize.",
  "channels.discord.eventQueue.maxConcurrency":
    "Optional Discord EventQueue concurrency override (max concurrent handler executions). Set per account via channels.discord.accounts.<id>.eventQueue.maxConcurrency.",
  "channels.discord.threadBindings.enabled":
    "Enable Discord thread binding features (/focus, bound-thread routing/delivery, and thread-bound subagent sessions). Overrides session.threadBindings.enabled when set.",
  "channels.discord.threadBindings.idleHours":
    "Inactivity window in hours for Discord thread-bound sessions (/focus and spawned thread sessions). Set 0 to disable idle auto-unfocus (default: 24). Overrides session.threadBindings.idleHours when set.",
  "channels.discord.threadBindings.maxAgeHours":
    "Optional hard max age in hours for Discord thread-bound sessions. Set 0 to disable hard cap (default: 0). Overrides session.threadBindings.maxAgeHours when set.",
  "channels.discord.threadBindings.spawnSubagentSessions":
    "Allow subagent spawns with thread=true to auto-create and bind Discord threads (default: false; opt-in). Set true to enable thread-bound subagent spawns for this account/channel.",
  "channels.discord.threadBindings.spawnAcpSessions":
    "Allow /acp spawn to auto-create and bind Discord threads for ACP sessions (default: false; opt-in). Set true to enable thread-bound ACP spawns for this account/channel.",
  "channels.discord.ui.components.accentColor":
    "Accent color for Discord component containers (hex). Set per account via channels.discord.accounts.<id>.ui.components.accentColor.",
  "channels.discord.voice.enabled":
    "Enable Discord voice channel conversations (default: true). Omit channels.discord.voice to keep voice support disabled for the account.",
  "channels.discord.voice.autoJoin":
    "Voice channels to auto-join on startup (list of guildId/channelId entries).",
  "channels.discord.voice.daveEncryption":
    "Toggle DAVE end-to-end encryption for Discord voice joins (default: true in @discordjs/voice; Discord may require this).",
  "channels.discord.voice.decryptionFailureTolerance":
    "Consecutive decrypt failures before DAVE attempts session recovery (passed to @discordjs/voice; default: 24).",
  "channels.discord.voice.tts":
    "Optional TTS overrides for Discord voice playback (merged with messages.tts).",
  "channels.discord.intents.presence":
    "Enable the Guild Presences privileged intent. Must also be enabled in the Discord Developer Portal. Allows tracking user activities (e.g. Spotify). Default: false.",
  "channels.discord.intents.guildMembers":
    "Enable the Guild Members privileged intent. Must also be enabled in the Discord Developer Portal. Default: false.",
  "channels.discord.pluralkit.enabled":
    "Resolve PluralKit proxied messages and treat system members as distinct senders.",
  "channels.discord.pluralkit.token":
    "Optional PluralKit token for resolving private systems or members.",
  "channels.discord.activity": "Discord presence activity text (defaults to custom status).",
  "channels.discord.status": "Discord presence status (online, dnd, idle, invisible).",
  "channels.discord.autoPresence.enabled":
    "Enable automatic Discord bot presence updates based on runtime/model availability signals. When enabled: healthy=>online, degraded/unknown=>idle, exhausted/unavailable=>dnd.",
  "channels.discord.autoPresence.intervalMs":
    "How often to evaluate Discord auto-presence state in milliseconds (default: 30000).",
  "channels.discord.autoPresence.minUpdateIntervalMs":
    "Minimum time between actual Discord presence update calls in milliseconds (default: 15000). Prevents status spam on noisy state changes.",
  "channels.discord.autoPresence.healthyText":
    "Optional custom status text while runtime is healthy (online). If omitted, falls back to static channels.discord.activity when set.",
  "channels.discord.autoPresence.degradedText":
    "Optional custom status text while runtime/model availability is degraded or unknown (idle).",
  "channels.discord.autoPresence.exhaustedText":
    "Optional custom status text while runtime detects exhausted/unavailable model quota (dnd). Supports {reason} template placeholder.",
  "channels.discord.activityType":
    "Discord presence activity type (0=Playing,1=Streaming,2=Listening,3=Watching,4=Custom,5=Competing).",
  "channels.discord.activityUrl": "Discord presence streaming URL (required for activityType=1).",
};
