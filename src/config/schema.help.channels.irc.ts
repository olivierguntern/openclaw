import { IRC_FIELD_HELP } from "./schema.irc.js";

export const IRC_CHANNELS_FIELD_HELP: Record<string, string> = {
  "channels.irc":
    "IRC channel provider configuration and compatibility settings for classic IRC transport workflows. Use this section when bridging legacy chat infrastructure into OpenClaw.",
  ...IRC_FIELD_HELP,
};
