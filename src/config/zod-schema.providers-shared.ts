import { z } from "zod";
import { ToolPolicySchema } from "./zod-schema.agent-runtime.js";

// Shared cross-provider schema used by all channel modules.
export const ToolPolicyBySenderSchema = z.record(z.string(), ToolPolicySchema).optional();
