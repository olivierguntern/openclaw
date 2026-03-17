import type { StreamFn } from "@mariozechner/pi-agent-core";
import { buildStreamPipeline, type PipelineStreamFn } from "./index.js";
import type { NamedStage } from "./named-stage.js";

/**
 * Fluent builder for stream pipelines.
 *
 * Usage:
 *   const fn = pipeline(base)
 *     .pipeIf(shouldDropThinking, "drop-thinking", wrapDropThinking)
 *     .pipe("trim-names", (fn) => wrapTrimNames(fn, allowed))
 *     .build();
 *   log.debug(`pipeline: ${fn.activeStages.join(" → ")}`);
 */
export class StreamPipelineBuilder {
  private readonly stages: NamedStage[] = [];

  constructor(private readonly base: StreamFn) {}

  /** Appends a stage unconditionally. */
  pipe(name: string, wrap: (fn: StreamFn) => StreamFn): this {
    this.stages.push({ name, wrap });
    return this;
  }

  /**
   * Appends a stage only when `condition` is truthy.
   * Falsy conditions (`false`, `null`, `undefined`, `0`, `""`) are silently
   * skipped — no stage is added and `activeStages` will not include `name`.
   */
  pipeIf(
    condition: boolean | null | undefined,
    name: string,
    wrap: (fn: StreamFn) => StreamFn,
  ): this {
    if (condition) {
      this.stages.push({ name, wrap });
    }
    return this;
  }

  /**
   * Appends a batch of pre-built named stages, skipping null/undefined entries.
   * Use this to insert a group of provider-specific stages in one call:
   *
   *   .pipeEach(resolveOpenAIStages({ isResponsesApi }))
   *
   * Null/undefined entries in the array are silently ignored, matching the
   * behaviour of `pipeIf()` with a falsy condition.
   */
  pipeEach(stages: ReadonlyArray<NamedStage | null | undefined>): this {
    for (const s of stages) {
      if (s) {
        this.stages.push(s);
      }
    }
    return this;
  }

  /**
   * Builds the composed StreamFn.
   * The returned function exposes `activeStages` listing every stage name
   * that was added (in application order).
   */
  build(): PipelineStreamFn {
    return buildStreamPipeline(this.base, this.stages);
  }
}

/** Creates a new fluent pipeline builder starting from `base`. */
export function pipeline(base: StreamFn): StreamPipelineBuilder {
  return new StreamPipelineBuilder(base);
}
