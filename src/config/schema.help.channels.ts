// Channel-specific field help entries, split per provider for maintainability.
// All consumers import CHANNELS_FIELD_HELP from here or from schema.help.ts.
import { CHANNELS_DEFAULTS_FIELD_HELP } from "./schema.help.channels.defaults.js";
import { CHANNELS_MODEL_BY_CHANNEL_FIELD_HELP } from "./schema.help.channels.model-by-channel.js";
import { BLUEBUBBLES_CHANNELS_FIELD_HELP } from "./schema.help.channels.bluebubbles.js";
import { DISCORD_CHANNELS_FIELD_HELP } from "./schema.help.channels.discord.js";
import { IMESSAGE_CHANNELS_FIELD_HELP } from "./schema.help.channels.imessage.js";
import { IRC_CHANNELS_FIELD_HELP } from "./schema.help.channels.irc.js";
import { MATTERMOST_CHANNELS_FIELD_HELP } from "./schema.help.channels.mattermost.js";
import { MSTEAMS_CHANNELS_FIELD_HELP } from "./schema.help.channels.msteams.js";
import { SIGNAL_CHANNELS_FIELD_HELP } from "./schema.help.channels.signal.js";
import { SLACK_CHANNELS_FIELD_HELP } from "./schema.help.channels.slack.js";
import { TELEGRAM_CHANNELS_FIELD_HELP } from "./schema.help.channels.telegram.js";
import { WHATSAPP_CHANNELS_FIELD_HELP } from "./schema.help.channels.whatsapp.js";

export const CHANNELS_FIELD_HELP: Record<string, string> = {
  channels:
    "Channel provider configurations plus shared defaults that control access policies, heartbeat visibility, and per-surface behavior. Keep defaults centralized and override per provider only where required.",
  ...CHANNELS_DEFAULTS_FIELD_HELP,
  ...CHANNELS_MODEL_BY_CHANNEL_FIELD_HELP,
  ...BLUEBUBBLES_CHANNELS_FIELD_HELP,
  ...DISCORD_CHANNELS_FIELD_HELP,
  ...IMESSAGE_CHANNELS_FIELD_HELP,
  ...IRC_CHANNELS_FIELD_HELP,
  ...MATTERMOST_CHANNELS_FIELD_HELP,
  ...MSTEAMS_CHANNELS_FIELD_HELP,
  ...SIGNAL_CHANNELS_FIELD_HELP,
  ...SLACK_CHANNELS_FIELD_HELP,
  ...TELEGRAM_CHANNELS_FIELD_HELP,
  ...WHATSAPP_CHANNELS_FIELD_HELP,
};
