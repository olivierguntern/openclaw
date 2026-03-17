/**
 * Retry and iteration limits for the embedded agent run loop.
 *
 * Centralising these constants makes them testable and easy to tune without
 * hunting through the 1 700-line run orchestrator.
 */

/** Baseline iterations before scaling by auth-profile count. */
export const BASE_RUN_RETRY_ITERATIONS = 24;

/** Extra iterations budgeted per additional auth-profile candidate. */
export const RUN_RETRY_ITERATIONS_PER_PROFILE = 8;

/** Floor: never go below this even with a single profile. */
export const MIN_RUN_RETRY_ITERATIONS = 32;

/** Ceiling: hard upper bound regardless of profile count. */
export const MAX_RUN_RETRY_ITERATIONS = 160;

/**
 * How many times the orchestrator will attempt auto-compaction after a context
 * overflow before giving up and surfacing the overflow error to the user.
 */
export const MAX_OVERFLOW_COMPACTION_ATTEMPTS = 3;

/**
 * Returns the maximum number of retry iterations for a run, scaled by the
 * number of available auth-profile candidates so that multi-profile setups get
 * proportionally more headroom for failover.
 */
export function resolveMaxRunRetryIterations(profileCandidateCount: number): number {
  const scaled =
    BASE_RUN_RETRY_ITERATIONS +
    Math.max(1, profileCandidateCount) * RUN_RETRY_ITERATIONS_PER_PROFILE;
  return Math.min(MAX_RUN_RETRY_ITERATIONS, Math.max(MIN_RUN_RETRY_ITERATIONS, scaled));
}
