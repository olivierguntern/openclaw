import type { OpenClawConfig } from "../../config/config.js";
import type { RuntimeWebSearchMetadata } from "../../secrets/runtime-web-tools.types.js";

export type WebSearchProviderId = string;

export type WebSearchProviderToolDefinition = {
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

export type WebSearchProviderContext = {
  config?: OpenClawConfig;
  searchConfig?: Record<string, unknown>;
  runtimeMetadata?: RuntimeWebSearchMetadata;
};

export type WebSearchProviderPlugin = {
  id: WebSearchProviderId;
  label: string;
  hint: string;
  envVars: string[];
  placeholder: string;
  signupUrl: string;
  docsUrl?: string;
  autoDetectOrder?: number;
  getCredentialValue: (searchConfig?: Record<string, unknown>) => unknown;
  setCredentialValue: (searchConfigTarget: Record<string, unknown>, value: unknown) => void;
  createTool: (ctx: WebSearchProviderContext) => WebSearchProviderToolDefinition | null;
};

export type PluginWebSearchProviderEntry = WebSearchProviderPlugin & {
  pluginId: string;
};
