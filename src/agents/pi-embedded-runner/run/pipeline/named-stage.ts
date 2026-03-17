import type { StreamFn } from "@mariozechner/pi-agent-core";

/** A pipeline stage with a name for introspection and logging. */
export type NamedStage = {
  readonly name: string;
  readonly wrap: (fn: StreamFn) => StreamFn;
};

/** Creates a named pipeline stage. */
export function stage(name: string, wrap: (fn: StreamFn) => StreamFn): NamedStage {
  return { name, wrap };
}
