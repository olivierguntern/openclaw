// Catalogue-assembled provider schema barrel.
// Each provider's schemas live in their own module; this file re-exports them all
// so that existing consumers continue to import from this path unchanged.
export * from "./zod-schema.providers-core.telegram.js";
export * from "./zod-schema.providers-core.discord.js";
export * from "./zod-schema.providers-core.googlechat.js";
export * from "./zod-schema.providers-core.slack.js";
export * from "./zod-schema.providers-core.signal.js";
export * from "./zod-schema.providers-core.irc.js";
export * from "./zod-schema.providers-core.imessage.js";
export * from "./zod-schema.providers-core.bluebubbles.js";
export * from "./zod-schema.providers-core.msteams.js";
