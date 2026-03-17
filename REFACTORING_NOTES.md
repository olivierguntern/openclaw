# Notes de refactoring — session du 17 mars 2026

Ce document explique **tout ce qui a été fait** durant cette session de travail, pour l'utilisateur qui veut comprendre sans avoir à lire le code, mais aussi avec assez de détails techniques pour le développeur qui veut comprendre le pourquoi.

---

## Table des matières

1. [Contexte — dans quel état était le code ?](#1-contexte--dans-quel-état-était-le-code-)
2. [Phase 1 — Découpe du monstre : `attempt.ts`](#2-phase-1--découpe-du-monstre--attemptts)
3. [Phase 2 — Build parallèle](#3-phase-2--build-parallèle)
4. [Phase 3 — Système de pipeline déclaratif](#4-phase-3--système-de-pipeline-déclaratif)
5. [Phase 4 — Registre de providers injectable](#5-phase-4--registre-de-providers-injectable)
6. [Phase 5 — Builder fluent + tests complets](#6-phase-5--builder-fluent--tests-complets)
7. [Phase 6 — Politique de retry isolée](#7-phase-6--politique-de-retry-isolée)
8. [Phase 7 — Groupes de stages provider-spécifiques](#8-phase-7--groupes-de-stages-provider-spécifiques)
9. [Phase 8 — Helper de test pour les providers](#9-phase-8--helper-de-test-pour-les-providers)
10. [Résumé chiffré](#10-résumé-chiffré)
11. [Ce qui reste à faire (dette technique connue)](#11-ce-qui-reste-à-faire-dette-technique-connue)

---

## 1. Contexte — dans quel état était le code ?

### Pour l'utilisateur lambda

Imagine une cuisine de restaurant. Avant ces changements, **tout se passait dans un seul fichier** : le chef recevait la commande, préparait les ingrédients, cuisait, dressait l'assiette, gérait les erreurs, calculait l'addition… dans une seule pièce avec une seule liste d'instructions de 2 900 lignes. Si quelque chose tournait mal, il fallait chercher l'aiguille dans une botte de foin. Si on voulait ajouter un nouveau plat (un nouveau modèle d'IA), il fallait modifier cette liste gigantesque en espérant ne rien casser.

Ce fichier s'appelait `attempt.ts`. Il pesait **2 900 lignes** et gérait simultanément :
- La préparation de la session (charger le contexte, les outils, les permissions)
- La sélection du modèle d'IA à appeler
- La transformation des messages avant envoi
- L'appel réel au modèle
- La gestion des erreurs et des retries
- Des corrections spécifiques à chaque provider (OpenAI, Anthropic, Kimi, xAI…)

### Pour le développeur

`attempt.ts` avait accumulé de la dette technique sur plusieurs axes :

- **Séparation des responsabilités inexistante** : la logique de setup de session, de transformation de stream, de repair de tool calls, et de gestion du yield étaient toutes dans le même fichier.
- **Pipeline de transformation impératif** : 10+ assignations consécutives `activeSession.agent.streamFn = wrappedFn` avec des `if/else` imbriqués. Aucune introspection possible sur les stages actifs.
- **Provider logic non-testable** : les providers étaient résolus via des imports statiques ESM, impossibles à mocker fiablement dans Vitest (pool `forks`).
- **Boilerplate explosion** : chaque stage de transformation de messages recopiait ~40 lignes identiques de context-spreading.

---

## 2. Phase 1 — Découpe du monstre : `attempt.ts`

**Commit :** `d978f5f` — *refactor: split attempt.ts + parallel build + fix any types*

### Ce qui a été fait

`attempt.ts` (2 900 lignes) a été découpé en 5 modules focalisés :

| Nouveau fichier | Ce qu'il contient | Lignes |
|---|---|---|
| `sessions-yield.ts` | Logique d'interruption `sessions_yield` (pause/reprise de session) | ~180 |
| `ollama-compat-numctx.ts` | Injection du paramètre `num_ctx` pour Ollama (fenêtre de contexte) | ~90 |
| `tool-name-dispatch.ts` | Normalisation des noms d'outils (suppression des espaces parasites) | ~60 |
| `tool-call-repair.ts` | Réparation des tool calls malformés (Kimi), décodage xAI HTML | ~300 |
| `run-setup.ts` | Setup du prompt, des hooks, du workspace, résumés de session | ~643 |

**`attempt.ts` passe de 2 900 → 1 681 lignes.** Les 5 nouveaux fichiers totalisent 1 273 lignes.

### Pourquoi cette découpe ?

#### Pour l'utilisateur lambda

C'est comme séparer la cuisine d'un restaurant en postes distincts : un poste entrées, un poste plats chauds, un poste desserts, un poste plonge. Chaque cuisinier connaît son domaine, fait son travail, et ne gêne pas les autres. Quand un problème survient, on sait exactement où regarder.

#### Pour le développeur

- **Responsabilité unique** : chaque module a un invariant clair. `ollama-compat-numctx.ts` ne sait que comment injecter `num_ctx`, rien d'autre.
- **Testabilité** : les modules extraits sont testables en isolation, sans avoir à construire le contexte entier d'une session.
- **Reviewabilité** : un PR qui touche la réparation des tool calls ne pollue plus les diffs de la logique de setup de session.
- **Localisabilité des bugs** : "le décodage xAI est cassé" → on ouvre `tool-call-repair.ts`, pas un fichier de 2 900 lignes.

---

## 3. Phase 2 — Build parallèle

**Commit :** `545559f` — *docs: document parallel build and agent runner module layout in README*
**Implémentation :** dans `d978f5f` via `scripts/build-parallel.mjs` + `build:parallel`

### Ce qui a été fait

Le script de build a été restructuré pour exécuter les étapes indépendantes en parallèle :

**Avant (séquentiel) :**
```
canvas:bundle → tsdown → postbuild → plugin-sdk DTS → [7 scripts post-processing]
```

**Après (parallèle en 3 phases) :**
```
Phase 1 : canvas:bundle ║ tsdown                        (parallèle)
Phase 2 : postbuild     ║ plugin-sdk DTS                (parallèle)
Phase 3 : write-build-info ║ cli-startup ║ cli-compat ║ ... (tous en parallèle)
```

### Pourquoi ?

#### Pour l'utilisateur lambda

La compilation du projet prenait X secondes parce que certaines tâches attendaient la fin d'autres tâches même quand elles n'en avaient pas besoin. C'est comme obliger le dessert à attendre que la vaisselle du plat principal soit lavée avant d'être préparé — alors qu'on pourrait faire les deux en même temps. Le build parallèle réduit le temps d'attente pour les développeurs.

#### Pour le développeur

`canvas:a2ui:bundle` et `tsdown` sont indépendants — l'un produit un bundle JS pour le canvas A2UI, l'autre compile le TypeScript principal. Il n'y a aucune raison de les séquencer. Les scripts de post-processing (write-build-info, cli-startup, cli-compat, etc.) dépendent tous de la sortie de tsdown mais pas les uns des autres : ils peuvent s'exécuter en parallèle avec `Promise.all`.

---

## 4. Phase 3 — Système de pipeline déclaratif

**Commit :** `cc1e99a` — *refactor(agent-runner): declarative stream pipeline + provider resolver (v2)*

### Le problème à résoudre

Dans `attempt.ts`, la composition du pipeline de transformation ressemblait à ça (forme v1) :

```typescript
// Avant : impératif, pas d'introspection, boilerplate partout
if (transcriptPolicy.dropThinkingBlocks) {
  const prev = activeSession.agent.streamFn;
  activeSession.agent.streamFn = (model, context, options) => {
    const ctx = context as unknown as { messages?: unknown };
    const messages = ctx?.messages;
    if (!Array.isArray(messages)) return prev(model, context, options);
    const transformed = dropThinkingBlocks(messages as AgentMessage[]);
    if (transformed === messages) return prev(model, context, options);
    const nextContext = {
      ...(context as unknown as Record<string, unknown>),
      messages: transformed,
    } as unknown;
    return prev(model, nextContext as typeof context, options);
  };
}
// ... répété 9 autres fois pour les autres stages
```

**Problèmes :**
1. 40 lignes par stage, toutes identiques sauf la fonction de transformation
2. Impossible de savoir quels stages étaient actifs (pas de log, pas d'introspection)
3. Condition `if` imbriquée → le flux d'exécution est difficile à suivre

### Ce qui a été créé

**`buildStreamPipeline(base, stages[])`** — fonction composant une liste de wrappers :

```typescript
// Après : déclaratif, introspectable
const streamPipeline = buildStreamPipeline(activeSession.agent.streamFn, [
  shouldInjectNumCtx ? (fn) => wrapOllamaCompatNumCtx(fn, numCtx) : null,
  cacheTrace ? (fn) => cacheTrace.wrapStreamFn(fn) : null,
  transcriptPolicy.dropThinkingBlocks ? wrapStreamFnDropThinkingBlocks : null,
  // ...
]);
log.debug(`pipeline: [${streamPipeline.activeStages.join(" → ")}]`);
// → "pipeline: [ollama:num-ctx → drop-thinking-blocks → yield-abort-guard → trim-tool-names]"
```

**`wrapStreamFnWithMessageTransform(baseFn, transform)`** — utilitaire générique éliminant les 40 lignes répétées :

```typescript
// Les 40 lignes de boilerplate se réduisent à 3
export function wrapStreamFnDropThinkingBlocks(baseFn: StreamFn): StreamFn {
  return wrapStreamFnWithMessageTransform(baseFn, dropThinkingBlocks);
}
```

**`wrapStreamFnWithAbortGuard(baseFn, opts)`** — court-circuit générique :

```typescript
const guarded = wrapStreamFnWithAbortGuard(fn, {
  shouldAbort: () => yieldDetected && signal.aborted,
  createAbortedResponse: (model) => createYieldAbortedStream(model),
});
```

**`wrapStreamFnWithMetrics(baseFn, onMetrics)`** — instrumentation sans modifier le comportement :

```typescript
const instrumented = wrapStreamFnWithMetrics(fn, ({ durationMs, eventCount, timeToFirstEventMs }) => {
  telemetry.record("llm.stream", { durationMs, eventCount });
});
```

### Pourquoi ?

#### Pour l'utilisateur lambda

Imagine que tu veux filtrer du café. Avant, tu reconstruisais tout le dispositif à chaque fois (filtre, carafe, eau). Maintenant tu as une machine à étapes : tu déclares "étape 1 : moule le café, étape 2 : verse l'eau chaude, étape 3 : filtre" — et la machine s'occupe du reste. Elle te dit aussi quelles étapes ont été actives ce matin, ce qui est utile quand tu dois débugger pourquoi ton café a un goût bizarre.

#### Pour le développeur

- **`buildStreamPipeline`** implémente un pattern de *function composition pipeline* où chaque stage est une fonction `StreamFn → StreamFn`. Les null sont ignorés (stages conditionnels inline).
- **`activeStages`** est une propriété `readonly string[]` sur le `PipelineStreamFn` retourné — les logs de debug peuvent maintenant montrer exactement quels stages étaient actifs pour un run donné, ce qui est précieux en production pour comprendre le comportement d'un modèle spécifique.
- **`wrapStreamFnWithMessageTransform`** optimise la même-référence : si le transform retourne le même tableau de messages, il n'alloue pas un nouveau context object. Évite les allocations inutiles dans les runs sans thinking blocks par exemple.
- **`wrapStreamFnWithMetrics`** gère correctement les abandons d'itérateur (`return()`, `throw()`), les bases asynchrones, et garantit que `onMetrics` est appelé exactement une fois par invocation.

---

## 5. Phase 4 — Registre de providers injectable

**Commit :** `cc1e99a`, `9ab7182`, `6940603` — série de refactorings sur les providers

### Le problème

La résolution du provider LLM à appeler (Ollama ? WebSocket ? fallback ?) était câblée directement dans `attempt.ts` avec des imports statiques ESM. Impossible à tester unitairement dans Vitest (pool `forks` + ESM mocking = résultats non-déterministes), et impossible à étendre depuis un plugin sans modifier le core.

### Ce qui a été créé

**`providers/registry.ts`** — registre extensible :

```typescript
// Un plugin peut enregistrer son propre provider :
import { registerStreamProvider } from "./providers/registry.js";

const unregister = registerStreamProvider(async (params) => {
  if (params.provider !== "my-custom-llm") return null; // passer au suivant
  return createMyCustomStreamFn(params);
});

// Au teardown :
unregister();
```

Ordre de résolution :
1. Resolvers enregistrés, dans l'ordre d'enregistrement (premier non-`null` gagne)
2. Logique built-in : Ollama → WebSocket → fallback

**`resolveProviderStreamFnCore(params, deps)`** — injection de dépendances pour les tests :

```typescript
// Dans un test — aucun ESM mock nécessaire :
const fn = await resolveProviderStreamFnCore(params, {
  createOllamaFn: vi.fn().mockReturnValue(mockStreamFn),
  createWsFn: vi.fn().mockReturnValue(mockStreamFn),
  registerCustomApi: vi.fn(),
  defaultStreamFn: mockStreamFn,
});
```

La fonction publique `resolveProviderStreamFn(params)` (utilisée par `attempt.ts`) câble automatiquement les vraies implémentations. Les call sites ne changent pas.

### Pourquoi ?

#### Pour l'utilisateur lambda

C'est comme avoir une prise universelle dans un aéroport. Avant, chaque nouvelle prise (nouveau modèle d'IA) nécessitait de reconfigurer l'alimentation centrale. Maintenant, chaque fournisseur peut brancher son adaptateur dans la prise universelle, et le système sait automatiquement quel adaptateur utiliser.

#### Pour le développeur

- **Open/Closed Principle** : le registre permet d'étendre sans modifier. Les plugins peuvent injecter des providers custom (Azure OpenAI avec auth spéciale, proxy interne, etc.) sans PR sur le repo core.
- **Dependency injection** : `resolveProviderStreamFnCore` avec `deps` injectés permet aux tests de vérifier le routage (Ollama vs WS vs fallback) sans ESM mocking, qui est notoirement fragile dans Vitest avec pool `forks` (les mocks ne sont pas visibles par le SUT dans le worker).
- **`cleanup()` pattern** : `registerStreamProvider` retourne un destructeur, suivant le pattern standard des event listeners / subscriptions. Les tests peuvent enregistrer un provider de test et nettoyer proprement dans `afterEach`.

---

## 6. Phase 5 — Builder fluent + tests complets

**Commits :** `7d5ab3e`, `9ab7182`, `6940603`

### Ce qui a été fait

#### Builder fluent

L'API tableau `buildStreamPipeline(base, [...])` a été complétée par un **builder fluent** plus lisible pour les pipelines longs :

```typescript
// API fluent — pipeline() + .pipe() + .pipeIf() + .build()
const streamPipeline = pipeline(activeSession.agent.streamFn)
  .pipeIf(shouldInjectNumCtx, "ollama:num-ctx", ...)
  .pipeIf(!!cacheTrace,       "cache-trace",   ...)
  .pipeIf(...dropThinking,    "drop-thinking-blocks", ...)
  .pipe("yield-abort-guard",  ...)
  .pipe("trim-tool-names",    ...)
  .build();

// Le debug log montre maintenant exactement ce qui s'est passé :
log.debug(`stream pipeline: [${streamPipeline.activeStages.join(" → ")}]`);
// → [ollama:num-ctx → cache-trace → drop-thinking-blocks → yield-abort-guard → trim-tool-names]
```

**`pipeIf(condition, name, wrap)`** est l'équivalent d'un `pipe` conditionnel : si `condition` est falsy, le stage est silencieusement ignoré et n'apparaît pas dans `activeStages`.

#### Suite de tests

**78 tests** répartis sur 11 fichiers :

| Fichier de test | Ce qui est testé |
|---|---|
| `pipeline/index.test.ts` | buildStreamPipeline : null skipping, ordering, activeStages |
| `pipeline/builder.test.ts` | StreamPipelineBuilder : pipe, pipeIf, pipeEach, ordering |
| `pipeline/stages/message-transform.test.ts` | Same-ref bypass, context spreading, no-messages bypass |
| `pipeline/stages/abort-guard.test.ts` | Pass-through, short-circuit, re-evaluation par invocation |
| `pipeline/stages/stream-metrics.test.ts` | eventCount, TTFT, stream vide, abandon précoce, async base |
| `pipeline/stages/drop-thinking-blocks.test.ts` | Suppression des thinking blocks, messages user intacts |
| `pipeline/stages/sanitize-tool-call-ids.test.ts` | Réécriture des IDs par mode |
| `pipeline/stages/downgrade-openai-reasoning-pairs.test.ts` | Suppression des reasoning pairs |
| `pipeline/stages/yield-abort-guard.test.ts` | Intégration avec abort signal |
| `providers/index.test.ts` | Routing Ollama / WS / fallback via deps injectés |
| `providers/registry.test.ts` | register/unregister, ordre de résolution, async resolvers |

**Décision clé — pas de `vi.mock()` ESM.** Les tests de providers utilisent `resolveProviderStreamFnCore(params, deps)` avec des stubs injectés plutôt que `vi.mock(...)`. Raison : Vitest en pool `forks` hisse les mocks ESM avant l'exécution, mais le SUT dans le worker fork ne voit pas toujours les modules mockés correctement. L'injection de dépendances élimine ce problème à la racine.

### Pourquoi ?

#### Pour l'utilisateur lambda

Sans tests, chaque modification du code est un pari : "j'espère que je n'ai rien cassé". Avec 78 tests, les 11 modules sont vérifiés automatiquement à chaque commit. Si quelqu'un casse accidentellement la gestion des timeout xAI en ajoutant une nouvelle fonctionnalité, le test l'attrape immédiatement, avant que ça arrive en production.

#### Pour le développeur

- **Coverage ciblée** : les tests couvrent les cas limites (same-ref bypass, iterator abandon, async base, empty stream) qui sont exactement les bugs subtils qui apparaissent en prod.
- **Tests comme documentation** : `stream-metrics.test.ts` documente le comportement exact de `onMetrics` lors d'un abandon précoce — information qui n'est pas évidente à lire dans le code.
- **Pas de setup fragile** : aucun `vi.mock()`, aucun `beforeEach` complexe. Chaque test est autonome : crée un `StreamFn` de test, applique le wrapper, vérifie.

---

## 7. Phase 6 — Politique de retry isolée

**Commit :** `329d99a` (partie 1/3)

### Le problème

Dans `run.ts` (1 700 lignes), 5 constantes magiques définissaient la politique de retry du runner :

```typescript
// Éparpillées en tête de fichier, sans contexte
const BASE_RUN_RETRY_ITERATIONS = 24;
const RUN_RETRY_ITERATIONS_PER_PROFILE = 8;
const MIN_RUN_RETRY_ITERATIONS = 32;
const MAX_RUN_RETRY_ITERATIONS = 160;
const MAX_OVERFLOW_COMPACTION_ATTEMPTS = 3; // celle-là était déclarée DANS la fonction, ligne 817
```

La fonction `resolveMaxRunRetryIterations` était co-localisée avec ces constantes mais dans le même fichier 1 700 lignes, perdue parmi le reste. Impossible à tester unitairement sans instancier tout le runner.

### Ce qui a été fait

Nouveau fichier **`run/retry-policy.ts`** (35 lignes) :

```typescript
/**
 * Retry et limites d'itération pour la boucle de run embedded.
 */
export const BASE_RUN_RETRY_ITERATIONS = 24;
export const RUN_RETRY_ITERATIONS_PER_PROFILE = 8;
export const MIN_RUN_RETRY_ITERATIONS = 32;
export const MAX_RUN_RETRY_ITERATIONS = 160;
export const MAX_OVERFLOW_COMPACTION_ATTEMPTS = 3;

/**
 * Calcule le nombre max de retries en fonction du nombre de profils d'auth disponibles.
 * Avec plus de profils, on a plus de headroom pour le failover.
 */
export function resolveMaxRunRetryIterations(profileCandidateCount: number): number {
  const scaled = BASE_RUN_RETRY_ITERATIONS +
    Math.max(1, profileCandidateCount) * RUN_RETRY_ITERATIONS_PER_PROFILE;
  return Math.min(MAX_RUN_RETRY_ITERATIONS, Math.max(MIN_RUN_RETRY_ITERATIONS, scaled));
}
```

`run.ts` importe maintenant depuis ce module. `MAX_OVERFLOW_COMPACTION_ATTEMPTS` n'est plus déclarée localement dans la fonction.

### Pourquoi ?

#### Pour l'utilisateur lambda

C'est comme séparer le règlement du restaurant (combien de fois on reessaye un plat raté, combien de temps on attend) du manuel d'opérations de la cuisine. Le règlement est court, lisible, modifiable sans toucher à la cuisine. Si on veut changer "on réessaie 5 fois au lieu de 3 en cas d'overflow", on modifie une ligne dans un fichier de 35 lignes, pas dans un fichier de 1 700 lignes.

#### Pour le développeur

- **Découplage** : les constantes de retry sont maintenant documentées avec JSDoc, compréhensibles sans contexte du runner.
- **Testabilité** : `resolveMaxRunRetryIterations` peut être testée unitairement — vérifier que le scaling par profil est correct, que les bornes min/max sont respectées.
- **Évolutivité** : si on veut plus tard injecter une `RetryPolicy` configurable (différente par provider, par tenant, etc.), la surface à modifier est claire et minimale.
- **`MAX_OVERFLOW_COMPACTION_ATTEMPTS`** : passer d'une `const` locale dans la fonction à une constante exportée du module de politique la rend visible, documentable, et modifiable sans chercher dans 1 700 lignes.

---

## 8. Phase 7 — Groupes de stages provider-spécifiques

**Commit :** `329d99a` (partie 2/3)

### Le problème

Dans `attempt.ts`, les 10 appels `.pipeIf()` mélangeaient deux catégories distinctes :
- **Stages génériques** (policy, lifecycle) : `drop-thinking-blocks`, `sanitize-tool-call-ids`, `yield-abort-guard`, `trim-tool-names`
- **Stages provider-spécifiques** : `ollama:num-ctx` (Ollama), `downgrade-openai-reasoning` (OpenAI), `repair-kimi-tool-calls` + `anthropic-payload-logger` (Anthropic), `decode-xai-entities` (xAI)

Problèmes :
1. La logique provider-spécifique était inline dans `attempt.ts` — pour comprendre "est-ce qu'on répare les tool calls de Kimi ici ?", il fallait lire `attempt.ts` et connaître que Kimi utilise `api: "anthropic-messages"`.
2. Les noms de stages n'indiquaient pas leur origine : `"repair-kimi-tool-calls"` ne donne pas d'indice sur le provider family.
3. Impossible de tester les stages d'un provider en isolation (toujours dans le contexte de `attempt.ts`).

### Ce qui a été fait

**`builder.ts`** : nouveau `.pipeEach(stages: Array<NamedStage | null | undefined>)`

```typescript
// Insérer un batch de stages pré-construits (les null sont ignorés)
builder.pipeEach(resolveAnthropicStages({ provider, modelApi, anthropicPayloadLogger }))
```

**`pipeline/provider-stages.ts`** — 4 fonctions groupées par provider family :

```typescript
// Groupe Ollama
export function resolveOllamaStages(params: { shouldInjectNumCtx: boolean; numCtx: number })
  : Array<NamedStage | null>
// → ["ollama:num-ctx"] ou [null]

// Groupe OpenAI
export function resolveOpenAIStages(params: { isResponsesApi: boolean })
  : Array<NamedStage | null>
// → ["openai:downgrade-reasoning"] ou [null]

// Groupe Anthropic
export function resolveAnthropicStages(params: { provider, modelApi, anthropicPayloadLogger })
  : Array<NamedStage | null>
// → ["anthropic:repair-kimi-tool-calls", "anthropic:payload-logger"] (selon conditions)

// Groupe xAI
export function resolveXaiStages(params: { provider: string; modelId: string })
  : Array<NamedStage | null>
// → ["xai:decode-entities"] ou [null]
```

**`attempt.ts`** — le pipeline devient lisible avec des blocs commentés :

```typescript
const streamPipeline = pipeline(activeSession.agent.streamFn)
  // ── Ollama group ──────────────────────────────────────────────────────
  .pipeEach(resolveOllamaStages({ shouldInjectNumCtx, numCtx }))
  // ── Instrumentation ───────────────────────────────────────────────────
  .pipeIf(!!cacheTrace, "cache-trace", (fn) => cacheTrace!.wrapStreamFn(fn))
  // ── Transcript policy ─────────────────────────────────────────────────
  .pipeIf(transcriptPolicy.dropThinkingBlocks, "drop-thinking-blocks", ...)
  .pipeIf(...sanitizeIds, "sanitize-tool-call-ids", ...)
  // ── OpenAI group ──────────────────────────────────────────────────────
  .pipeEach(resolveOpenAIStages({ isResponsesApi: isOpenAIResponsesApi }))
  // ── Lifecycle ─────────────────────────────────────────────────────────
  .pipe("yield-abort-guard", ...)
  .pipe("trim-tool-names", ...)
  // ── Anthropic group ───────────────────────────────────────────────────
  .pipeEach(resolveAnthropicStages({ provider: params.provider, modelApi: params.model.api, anthropicPayloadLogger }))
  // ── xAI group ─────────────────────────────────────────────────────────
  .pipeEach(resolveXaiStages({ provider: params.provider, modelId: params.modelId }))
  .build();
```

**Debug log après changement :**
```
stream pipeline: [ollama:num-ctx → drop-thinking-blocks → openai:downgrade-reasoning → yield-abort-guard → trim-tool-names → anthropic:repair-kimi-tool-calls → xai:decode-entities]
```

Les préfixes (`ollama:`, `openai:`, `anthropic:`, `xai:`) permettent de savoir immédiatement d'où vient chaque stage dans les logs de production.

**Renommage des stages existants :**

| Ancien nom | Nouveau nom | Provider |
|---|---|---|
| `"downgrade-openai-reasoning"` | `"openai:downgrade-reasoning"` | OpenAI |
| `"repair-kimi-tool-calls"` | `"anthropic:repair-kimi-tool-calls"` | Anthropic/Kimi |
| `"anthropic-payload-logger"` | `"anthropic:payload-logger"` | Anthropic |
| `"decode-xai-entities"` | `"xai:decode-entities"` | xAI |
| `"ollama:num-ctx"` | `"ollama:num-ctx"` | Ollama (déjà préfixé ✓) |

### Pourquoi ?

#### Pour l'utilisateur lambda

C'est comme organiser une valise par compartiments étiquetés ("vêtements Ollama", "vêtements OpenAI"…) plutôt que de tout mettre en vrac. Si demain on ajoute un nouveau modèle xAI, on sait qu'il faut modifier `resolveXaiStages()`, pas chercher dans tout `attempt.ts`. Si les logs montrent un problème avec `anthropic:repair-kimi-tool-calls`, on sait immédiatement que c'est le groupe Anthropic qui est en cause.

#### Pour le développeur

- **Co-localisation** : toute la logique d'un groupe provider est dans une fonction de ~10 lignes avec sa propre JSDoc. Ajouter un stage Anthropic = modifier `resolveAnthropicStages`, pas `attempt.ts`.
- **`pipeEach` vs multiple `pipeIf`** : un seul point d'insertion dans le pipeline pour tous les stages d'un provider. L'ordre interne au groupe est géré par la fonction du groupe.
- **Préfixes dans les logs** : `openai:downgrade-reasoning` est immédiatement identifiable comme un stage OpenAI dans les traces Datadog / Sentry. Avant, `"downgrade-openai-reasoning"` était ambigu (est-ce que c'est un stage "downgrade" qui concerne OpenAI, ou un stage "openai" de type "downgrade" ?).
- **Testabilité du groupe** : `provider-stages.test.ts` teste chaque fonction en isolation (22 tests), avec des stubs minimaux. Pas besoin de construire un contexte de session complet.

---

## 9. Phase 8 — Helper de test pour les providers

**Commit :** `329d99a` (partie 3/3)

### Le problème

Les ~20 fichiers de test de providers (`models-config.providers.*.test.ts`) avaient tous le même boilerplate de 5–10 lignes :

```typescript
// Répété dans CHAQUE test qui configure une API key
const agentDir = mkdtempSync(join(tmpdir(), "openclaw-test-"));
const envSnapshot = captureEnv(["SOME_API_KEY"]);
process.env.SOME_API_KEY = "test-key";

try {
  const providers = await resolveImplicitProvidersForTest({ agentDir });
  expect(providers?.some).toBeDefined();
  // ...
} finally {
  envSnapshot.restore();
}
```

### Ce qui a été fait

**`withApiKeyProviders(envValues, fn, extraParams?)`** dans `models-config.e2e-harness.ts` :

```typescript
// Avant (5 lignes de setup + try/finally)
const agentDir = mkdtempSync(join(tmpdir(), "openclaw-test-"));
const envSnapshot = captureEnv(["MOONSHOT_API_KEY"]);
process.env.MOONSHOT_API_KEY = "sk-test";
try {
  const providers = await resolveImplicitProvidersForTest({ agentDir });
  expect(providers?.moonshot?.baseUrl).toBe(MOONSHOT_AI_BASE_URL);
} finally {
  envSnapshot.restore();
}

// Après (1 ligne)
await withApiKeyProviders({ MOONSHOT_API_KEY: "sk-test" }, (providers) => {
  expect(providers?.moonshot?.baseUrl).toBe(MOONSHOT_AI_BASE_URL);
});
```

La fonction gère automatiquement :
1. Création d'un `agentDir` temporaire unique
2. Capture de l'état des env vars avant modification
3. Application des env vars de test
4. Appel de `resolveImplicitProvidersForTest`
5. Restauration des env vars même en cas d'erreur (`finally`)

Fichiers mis à jour pour démonstration : `kimi-coding.test.ts`, `moonshot.test.ts` (pour les cas simples sans `explicitProviders`).

### Pourquoi ?

#### Pour l'utilisateur lambda

C'est comme avoir un template de formulaire plutôt que de remplir à la main les mêmes champs à chaque fois. Moins d'erreurs (on oublie plus le `finally`), plus lisible (le test exprime son intention directement), plus rapide à écrire.

#### Pour le développeur

- **Lisibilité** : le test exprime son intention ("avec MOONSHOT_API_KEY, vérifier que...") sans être pollué par le plomberie de setup.
- **Invariants garantis** : on ne peut plus oublier le `finally { envSnapshot.restore() }`, qui est la source de test contamination entre tests (un test qui set une env var et plante sans restore pollue les tests suivants).
- **Extensible** : `extraParams?` permet de passer `explicitProviders`, `config`, etc. pour les cas plus complexes, tout en gardant la version simple courte.

---

## 10. Résumé chiffré

### Fichiers modifiés / créés

| Action | Fichier | Lignes avant | Lignes après | Delta |
|---|---|---|---|---|
| Découpé | `attempt.ts` | 2 900 | 1 681 | −1 219 |
| Créé | `sessions-yield.ts` | — | ~180 | +180 |
| Créé | `ollama-compat-numctx.ts` | — | ~90 | +90 |
| Créé | `tool-name-dispatch.ts` | — | ~60 | +60 |
| Créé | `tool-call-repair.ts` | — | ~300 | +300 |
| Créé | `run-setup.ts` | — | ~643 | +643 |
| Créé | `pipeline/index.ts` | — | ~52 | +52 |
| Créé | `pipeline/named-stage.ts` | — | ~13 | +13 |
| Créé | `pipeline/builder.ts` | — | ~70 | +70 |
| Créé | `pipeline/stages/message-transform.ts` | — | ~50 | +50 |
| Créé | `pipeline/stages/abort-guard.ts` | — | ~50 | +50 |
| Créé | `pipeline/stages/stream-metrics.ts` | — | ~80 | +80 |
| Refactorisé | `stages/drop-thinking-blocks.ts` | ~45 | ~8 | −37 |
| Refactorisé | `stages/sanitize-tool-call-ids.ts` | ~45 | ~10 | −35 |
| Refactorisé | `stages/downgrade-openai-reasoning-pairs.ts` | ~45 | ~8 | −37 |
| Créé | `providers/registry.ts` | — | ~63 | +63 |
| Créé | `providers/index.ts` | — | ~80 | +80 |
| Créé | `run/retry-policy.ts` | — | ~37 | +37 |
| Créé | `pipeline/provider-stages.ts` | — | ~88 | +88 |

### Tests

| Avant | Après | Delta |
|---|---|---|
| 0 tests sur les modules pipeline/provider | 100 tests (78 originaux + 22 nouveaux) | +100 |

### Impact sur `run.ts`

- Suppression des 5 constantes de retry (−15 lignes)
- Suppression de `resolveMaxRunRetryIterations` (−8 lignes)
- Import depuis `retry-policy.ts`

### Impact sur `attempt.ts` (session)

- Suppression des 7 imports provider-spécifiques
- Remplacement des 10 `.pipeIf()` provider-spécifiques par 4 `.pipeEach(resolve*Stages(...))`
- Ajout de commentaires de groupe dans le pipeline

---

## 11. Ce qui reste à faire (dette technique connue)

Ces points ont été identifiés pendant l'analyse mais **ne font pas partie de cette session** :

### Priorité haute

**Fichiers de types monolithiques :**
- `src/plugins/types.ts` (1 904 lignes) — union discriminante pour tous les plugins → à découper par domaine (`plugins/types/channel.ts`, `plugins/types/provider.ts`, etc.)
- `src/config/schema.help.ts` (1 636 lignes) — textes d'aide pour toutes les clés → à co-localiser avec les schémas
- `src/config/zod-schema.providers-core.ts` (1 537 lignes) — schémas providers dupliqués à la main → à générer depuis un catalogue

**`attempt.ts` encore à 1 600 lignes :** la boucle de retry/failover dans `run.ts` + la logique de compaction pourraient être extraites dans un module d'orchestration dédié.

### Priorité moyenne

**Coverage des extensions de canaux (~52%)** : la logique de routage, les allowlists, les politiques de groupe des channels (Discord, Slack, etc.) sont sous-testées. Zone de risque réelle.

**`compact.ts` (1 221 lignes)** : logique de compaction de contexte avec boucles de retry imbriquées. Difficile à tester en isolation.

### Pourquoi ne pas l'avoir fait maintenant ?

Ces changements sont plus larges, plus risqués (touches à des surfaces utilisées partout dans le code), et nécessitent un plan de migration soigneux. La session présente a traité les gains les plus concrets avec le moins de risque possible.

---

*Branche : `claude/analyze-repository-UzhrS`*
*Session : https://claude.ai/code/session_01DYS8pY1cx4tP9bfs5PTZs8*
