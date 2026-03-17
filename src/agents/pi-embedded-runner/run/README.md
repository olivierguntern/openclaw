# pi-embedded-runner — `run/` module

This document describes the stream pipeline and provider resolution systems
introduced during the v2/v3 refactoring of `attempt.ts`.

---

## Table of contents

1. [Background — the problem with the original code](#1-background)
2. [Pipeline system](#2-pipeline-system)
   - [Core types](#21-core-types)
   - [Low-level API: `buildStreamPipeline`](#22-low-level-api-buildstreampipeline)
   - [Fluent API: `pipeline().pipeIf().pipe().build()`](#23-fluent-api)
   - [Generic stage utilities](#24-generic-stage-utilities)
   - [Built-in stages](#25-built-in-stages)
3. [Provider resolution system](#3-provider-resolution-system)
   - [Extension registry](#31-extension-registry)
   - [Dependency injection](#32-dependency-injection)
4. [Module layout](#4-module-layout)
5. [Testing approach](#5-testing-approach)
6. [Before / after at a glance](#6-before--after-at-a-glance)

---

## 1. Background

Before the refactoring, `attempt.ts` contained ~183 lines of imperative
provider setup and pipeline wiring in a single `if/else/if/else` block:

```typescript
// Before (abridged) — hard to scan, hard to test, hard to extend
if (params.model.api === "ollama") {
  const fn = createConfiguredOllamaStreamFn(...);
  ensureCustomApiRegistered(params.model.api, fn);
  activeSession.agent.streamFn = fn;
} else if (...) { ... }

if (transcriptPolicy.dropThinkingBlocks) {
  const prev = activeSession.agent.streamFn;
  activeSession.agent.streamFn = (model, ctx, opts) => {
    // 40-line inline wrapper...
  };
}
// ...repeated ~10 more times
```

Problems:

- **No introspection** — impossible to know at runtime which stages were active.
- **Boilerplate explosion** — every stage needed 15–40 lines of copy-paste context
  spreading (`{ ...context, messages: transformed }`).
- **Untestable** — provider logic used static module imports that ESM mocking
  could not reliably intercept.
- **Closed to extension** — adding a new provider required modifying `attempt.ts`
  directly.

---

## 2. Pipeline system

### 2.1 Core types

```
StreamFn          — the primitive: (model, context, options) → Stream | Promise<Stream>
NamedStage        — { name: string; wrap: (fn: StreamFn) => StreamFn }
PipelineStreamFn  — StreamFn & { readonly activeStages: readonly string[] }
```

`PipelineStreamFn` is the enriched result of `buildStreamPipeline` / `.build()`.
The `activeStages` array records every stage name in application order and is
useful for debug logging:

```typescript
log.debug(`stream pipeline: [${streamPipeline.activeStages.join(" → ")}]`);
// e.g.: stream pipeline: [ollama:num-ctx → drop-thinking-blocks → yield-abort-guard → trim-tool-names]
```

### 2.2 Low-level API: `buildStreamPipeline`

```typescript
import { buildStreamPipeline, stage } from "./pipeline/index.js";

const fn = buildStreamPipeline(base, [
  stage("drop-thinking", wrapStreamFnDropThinkingBlocks),
  condition ? (fn) => wrapFoo(fn, opts) : null, // null entries are skipped
]);
```

Stages are composed left-to-right. **The last stage in the list becomes the
outermost wrapper** and therefore executes first at runtime. Null/undefined
entries are silently skipped, so conditional stages are expressed inline with a
ternary.

### 2.3 Fluent API

`pipeline(base).pipeIf(cond, name, wrap).pipe(name, wrap).build()`

The fluent builder makes conditional stages more readable — `.pipeIf()` replaces
the `condition ? ... : null` ternary pattern:

```typescript
// After — attempt.ts
const streamPipeline = pipeline(activeSession.agent.streamFn)
  .pipeIf(shouldInjectNumCtx, "ollama:num-ctx",
          (fn) => wrapOllamaCompatNumCtx(fn, numCtx))
  .pipeIf(!!cacheTrace, "cache-trace",
          (fn) => cacheTrace!.wrapStreamFn(fn))
  .pipeIf(transcriptPolicy.dropThinkingBlocks,
          "drop-thinking-blocks", wrapStreamFnDropThinkingBlocks)
  .pipeIf(
    !!(transcriptPolicy.sanitizeToolCallIds && transcriptPolicy.toolCallIdMode),
    "sanitize-tool-call-ids",
    (fn) => wrapStreamFnSanitizeToolCallIds(fn, transcriptPolicy.toolCallIdMode!),
  )
  .pipeIf(isOpenAIResponsesApi, "downgrade-openai-reasoning",
          wrapStreamFnDowngradeOpenAIReasoningPairs)
  .pipe("yield-abort-guard", (fn) =>
    wrapStreamFnYieldAbortGuard(fn, { signal, isYieldAborted: () => ... }),
  )
  .pipe("trim-tool-names", (fn) => wrapStreamFnTrimToolCallNames(fn, allowedToolNames))
  .pipeIf(shouldRepairKimi, "repair-kimi-tool-calls",
          wrapStreamFnRepairMalformedToolCallArguments)
  .pipeIf(isXaiProvider(...), "decode-xai-entities",
          wrapStreamFnDecodeXaiToolCallArguments)
  .pipeIf(!!anthropicPayloadLogger, "anthropic-payload-logger",
          (fn) => anthropicPayloadLogger!.wrapStreamFn(fn))
  .build();

log.debug(`stream pipeline: [${streamPipeline.activeStages.join(" → ")}]`);
activeSession.agent.streamFn = streamPipeline;
```

**Benefits vs. the array form:**

|                    | Array (`buildStreamPipeline`)   | Fluent (`.pipeIf`)          |
| ------------------ | ------------------------------- | --------------------------- |
| Conditional stages | `cond ? fn : null` ternaries    | `.pipeIf(cond, name, wrap)` |
| Stage names        | Optional (use `stage()` helper) | Always named                |
| Readability        | OK for small lists              | Better for 10+ stages       |
| Debug output       | `activeStages` ✓                | `activeStages` ✓            |

Both APIs produce a `PipelineStreamFn` with `activeStages`.

### 2.4 Generic stage utilities

Three reusable building blocks eliminate boilerplate for the most common stage
patterns:

#### `wrapStreamFnWithMessageTransform(baseFn, transform)`

Shared skeleton for any stage that transforms the `messages` array before
forwarding to the inner function. Before this helper, each of the three
message-transform stages (drop-thinking-blocks, sanitize-tool-call-ids,
downgrade-openai-reasoning-pairs) contained ~40 identical lines of context
spreading. Now each is a 3-line delegate:

```typescript
// drop-thinking-blocks.ts — after
export function wrapStreamFnDropThinkingBlocks(baseFn: StreamFn): StreamFn {
  return wrapStreamFnWithMessageTransform(baseFn, dropThinkingBlocks);
}
```

Key behaviors:

- If context has no `messages` array: delegates to base unchanged.
- If `transform` returns the **same reference**: delegates without creating a
  new context object (avoids unnecessary allocations).
- Otherwise: spreads the context, replaces `messages`, delegates.

#### `wrapStreamFnWithAbortGuard(baseFn, { shouldAbort, createAbortedResponse })`

Generic pre-call short-circuit. Used by `wrapStreamFnYieldAbortGuard` (and can
be used for quota guards, user-cancellation, etc.):

```typescript
const guarded = wrapStreamFnWithAbortGuard(fn, {
  shouldAbort: () => isQuotaExceeded(),
  createAbortedResponse: (model) => createQuotaExceededStream(model),
});
```

`shouldAbort()` is re-evaluated on every invocation, so guards that become true
after the pipeline is built work correctly.

#### `wrapStreamFnWithMetrics(baseFn, onMetrics)`

Instruments any `StreamFn` with latency and throughput metrics without
changing its behavior:

```typescript
const instrumented = wrapStreamFnWithMetrics(
  fn,
  ({ durationMs, eventCount, timeToFirstEventMs }) => {
    telemetry.record("llm.stream", { durationMs, eventCount, timeToFirstEventMs });
  },
);
```

- `durationMs` — total elapsed time from call to iterator exhaustion.
- `eventCount` — number of streaming events yielded.
- `timeToFirstEventMs` — time-to-first-token (TTFT); equals `durationMs` when
  no events were yielded.
- `onMetrics` is called exactly once per invocation, even when the caller
  abandons the iterator early via `return()` or `throw()`.
- Handles both synchronous and `Promise`-returning base functions.

### 2.5 Built-in stages

| Export                                      | File                                         | Purpose                                                                                 |
| ------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| `wrapStreamFnDropThinkingBlocks`            | `stages/drop-thinking-blocks.ts`             | Remove Anthropic `thinking` content blocks that would be rejected by follow-up requests |
| `wrapStreamFnSanitizeToolCallIds`           | `stages/sanitize-tool-call-ids.ts`           | Rewrite tool-call IDs for strict providers (Mistral, Cloud Code Assist)                 |
| `wrapStreamFnDowngradeOpenAIReasoningPairs` | `stages/downgrade-openai-reasoning-pairs.ts` | Remove reasoning-pair artifacts for OpenAI Responses/Codex APIs                         |
| `wrapStreamFnYieldAbortGuard`               | `stages/yield-abort-guard.ts`                | Short-circuit after `sessions_yield` sets the abort signal                              |

---

## 3. Provider resolution system

### 3.1 Extension registry

`providers/registry.ts` implements a simple priority chain for custom LLM
providers, following the open/closed principle: new providers can be added by
plugins **without touching built-in code**.

```typescript
import { registerStreamProvider } from "./providers/registry.js";

// In your plugin's init:
const unregister = registerStreamProvider(async (params) => {
  if (params.provider !== "my-llm") return null; // pass to next resolver
  return createMyLLMStreamFn(params);
});

// On plugin teardown (or in tests):
unregister();
```

Resolution order:

1. Registered extension resolvers, in registration order (first non-`null` wins).
2. Built-in logic: Ollama → OpenAI WebSocket → `streamSimple` fallback.

### 3.2 Dependency injection

`resolveProviderStreamFnCore(params, deps)` accepts a `ProviderStreamFnDeps`
object instead of calling module-level functions directly. This makes the
provider logic fully unit-testable without ESM module mocking:

```typescript
// In a test:
const fn = await resolveProviderStreamFnCore(params, {
  createOllamaFn: vi.fn().mockReturnValue(mockStreamFn),
  createWsFn: vi.fn().mockReturnValue(mockStreamFn),
  registerCustomApi: vi.fn(),
  defaultStreamFn: mockStreamFn,
  warnFn: vi.fn(),
});
```

The public `resolveProviderStreamFn(params)` function used by `attempt.ts`
wires in the real implementations automatically; call sites remain unchanged.

---

## 4. Module layout

```
run/
├── attempt.ts                    — main run loop; uses pipeline() builder
├── pipeline/
│   ├── index.ts                  — buildStreamPipeline, PipelineStreamFn, re-exports
│   ├── named-stage.ts            — NamedStage type + stage() helper
│   ├── builder.ts                — StreamPipelineBuilder + pipeline() fluent factory
│   └── stages/
│       ├── message-transform.ts  — wrapStreamFnWithMessageTransform (generic)
│       ├── abort-guard.ts        — wrapStreamFnWithAbortGuard (generic)
│       ├── stream-metrics.ts     — wrapStreamFnWithMetrics (generic)
│       ├── drop-thinking-blocks.ts
│       ├── sanitize-tool-call-ids.ts
│       ├── downgrade-openai-reasoning-pairs.ts
│       └── yield-abort-guard.ts
└── providers/
    ├── index.ts                  — resolveProviderStreamFn + resolveProviderStreamFnCore
    └── registry.ts               — registerStreamProvider / clearStreamProviderRegistry
```

---

## 5. Testing approach

All modules are unit-tested with Vitest (78 tests across 11 files).

| Test file                                                  | What is tested                                                                           |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pipeline/index.test.ts`                                   | `buildStreamPipeline`: null skipping, stage ordering, `activeStages`                     |
| `pipeline/builder.test.ts`                                 | `StreamPipelineBuilder`: `.pipe()`, `.pipeIf()`, stage ordering, `activeStages`          |
| `pipeline/stages/message-transform.test.ts`                | same-ref bypass, context spreading, no-messages bypass, arg forwarding                   |
| `pipeline/stages/abort-guard.test.ts`                      | pass-through, short-circuit, model forwarding, per-invocation re-evaluation              |
| `pipeline/stages/stream-metrics.test.ts`                   | eventCount, TTFT, empty stream, early `return()`, async base fn, not-called-before-drain |
| `pipeline/stages/drop-thinking-blocks.test.ts`             | thinking block removal, empty result, user msg untouched                                 |
| `pipeline/stages/sanitize-tool-call-ids.test.ts`           | ID rewriting by mode                                                                     |
| `pipeline/stages/downgrade-openai-reasoning-pairs.test.ts` | reasoning pair removal                                                                   |
| `pipeline/stages/yield-abort-guard.test.ts`                | abort signal integration                                                                 |
| `providers/index.test.ts`                                  | Ollama / WS / fallback routing via injected deps                                         |
| `providers/registry.test.ts`                               | register/unregister, resolution order, async resolvers, clear                            |

**Key decision — no ESM module mocking.** Provider tests use the
`resolveProviderStreamFnCore(params, deps)` overload with stub `deps` objects
instead of `vi.mock(...)`. This avoids the ESM hoisting/fork-pool issue where
mocked modules are not seen by the SUT in the Vitest forks pool.

---

## 6. Before / after at a glance

### `attempt.ts` — pipeline wiring

**Before** (~43 lines, mix of ternaries and raw wrapper assignments):

```typescript
activeSession.agent.streamFn = buildStreamPipeline(activeSession.agent.streamFn, [
  shouldInjectNumCtx ? (fn) => wrapOllamaCompatNumCtx(fn, numCtx) : null,
  cacheTrace ? (fn) => cacheTrace.wrapStreamFn(fn) : null,
  transcriptPolicy.dropThinkingBlocks ? wrapStreamFnDropThinkingBlocks : null,
  transcriptPolicy.sanitizeToolCallIds && transcriptPolicy.toolCallIdMode
    ? (fn) => wrapStreamFnSanitizeToolCallIds(fn, transcriptPolicy.toolCallIdMode!) : null,
  isOpenAIResponsesApi ? wrapStreamFnDowngradeOpenAIReasoningPairs : null,
  (fn) => wrapStreamFnYieldAbortGuard(fn, { ... }),
  (fn) => wrapStreamFnTrimToolCallNames(fn, allowedToolNames),
  params.model.api === "anthropic-messages" && shouldRepair...
    ? wrapStreamFnRepairMalformedToolCallArguments : null,
  isXaiProvider(...) ? wrapStreamFnDecodeXaiToolCallArguments : null,
  anthropicPayloadLogger ? (fn) => anthropicPayloadLogger.wrapStreamFn(fn) : null,
]);
// No visibility into which stages were active
```

**After** (fluent, self-documenting, introspectable):

```typescript
const streamPipeline = pipeline(activeSession.agent.streamFn)
  .pipeIf(shouldInjectNumCtx,    "ollama:num-ctx",            ...)
  .pipeIf(!!cacheTrace,          "cache-trace",               ...)
  .pipeIf(...dropThinking,       "drop-thinking-blocks",      ...)
  .pipeIf(...sanitize,           "sanitize-tool-call-ids",    ...)
  .pipeIf(isOpenAIResponsesApi,  "downgrade-openai-reasoning",...)
  .pipe(                         "yield-abort-guard",         ...)
  .pipe(                         "trim-tool-names",           ...)
  .pipeIf(shouldRepairKimi,      "repair-kimi-tool-calls",    ...)
  .pipeIf(isXaiProvider(...),    "decode-xai-entities",       ...)
  .pipeIf(!!anthropicPayloadLogger, "anthropic-payload-logger",...)
  .build();
log.debug(`stream pipeline: [${streamPipeline.activeStages.join(" → ")}]`);
// e.g.: [ollama:num-ctx → drop-thinking-blocks → yield-abort-guard → trim-tool-names]
```

### Stage implementations — boilerplate reduction

**Before** — every message-transform stage was ~40 lines:

```typescript
export function wrapStreamFnDropThinkingBlocks(baseFn: StreamFn): StreamFn {
  return (model, context, options) => {
    const ctx = context as unknown as { messages?: unknown };
    const messages = ctx?.messages;
    if (!Array.isArray(messages)) return baseFn(model, context, options);
    const transformed = dropThinkingBlocks(messages as AgentMessage[]);
    if (transformed === messages) return baseFn(model, context, options);
    const nextContext = {
      ...(context as unknown as Record<string, unknown>),
      messages: transformed,
    } as unknown;
    return baseFn(model, nextContext as typeof context, options);
  };
}
```

**After** — 3 lines, behavior identical:

```typescript
export function wrapStreamFnDropThinkingBlocks(baseFn: StreamFn): StreamFn {
  return wrapStreamFnWithMessageTransform(baseFn, dropThinkingBlocks);
}
```

### Summary of line counts

| File                                                                         | Before | After  | Delta                        |
| ---------------------------------------------------------------------------- | ------ | ------ | ---------------------------- |
| `attempt.ts`                                                                 | ~1 682 | ~1 596 | −86                          |
| `drop-thinking-blocks.ts`                                                    | ~45    | ~8     | −37                          |
| `sanitize-tool-call-ids.ts`                                                  | ~45    | ~10    | −35                          |
| `downgrade-openai-reasoning-pairs.ts`                                        | ~45    | ~8     | −37                          |
| New generic utilities (`message-transform`, `abort-guard`, `stream-metrics`) | 0      | ~150   | +150                         |
| New builder + named-stage                                                    | 0      | ~70    | +70                          |
| New provider registry                                                        | 0      | ~63    | +63                          |
| **Net**                                                                      |        |        | **−12 LOC, +~500 LOC tests** |

The slight LOC increase is entirely in new generic utilities and tests. Every
existing code path became shorter while gaining test coverage and introspection.
