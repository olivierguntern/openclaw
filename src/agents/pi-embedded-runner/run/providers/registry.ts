import type { StreamFn } from "@mariozechner/pi-agent-core";

/**
 * A provider resolver receives the raw attempt params and returns either a
 * StreamFn (to handle the request) or `null` (to pass to the next resolver).
 *
 * Resolvers are called in registration order.  The first non-null result wins.
 * Use this to add support for custom/extension providers without modifying the
 * built-in resolution logic in `providers/index.ts`.
 *
 * @example
 * ```ts
 * import { registerStreamProvider } from "./providers/registry.js";
 *
 * registerStreamProvider(async (params) => {
 *   if (params.provider !== "my-llm") return null;
 *   return createMyLLMStreamFn(params.model, params.authStorage);
 * });
 * ```
 */
export type ProviderResolver = (params: unknown) => Promise<StreamFn | null> | StreamFn | null;

const registry: ProviderResolver[] = [];

/**
 * Registers a provider resolver.
 * Returns an unregister function for cleanup (useful in tests and plugins
 * that support hot-reload).
 */
export function registerStreamProvider(resolver: ProviderResolver): () => void {
  registry.push(resolver);
  return () => {
    const idx = registry.indexOf(resolver);
    if (idx !== -1) {
      registry.splice(idx, 1);
    }
  };
}

/**
 * Iterates registered resolvers in registration order and returns the first
 * non-null StreamFn, or `null` when no resolver handles `params`.
 */
export async function resolveFromStreamProviderRegistry(params: unknown): Promise<StreamFn | null> {
  for (const resolver of registry) {
    const fn = await Promise.resolve(resolver(params));
    if (fn !== null) {
      return fn;
    }
  }
  return null;
}

/** Returns the current registry snapshot (read-only). */
export function getStreamProviderRegistry(): ReadonlyArray<ProviderResolver> {
  return registry;
}

/** Clears all registered resolvers. Intended for test isolation only. */
export function clearStreamProviderRegistry(): void {
  registry.splice(0);
}
