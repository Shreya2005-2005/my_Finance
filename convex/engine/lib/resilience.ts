/**
 * RESILIENCE TOOLS: what keeps the system working when outside services misbehave.
 *
 *   withRetry        try again after a short, growing wait (only for temporary errors)
 *   circuit breaker  stop calling a service that keeps failing, check again later
 *   rate limiter     never ask a service for more than it allows
 *
 * All three take "now" and "sleep" as inputs, so tests run instantly with no real waiting.
 */
import { CIRCUIT_BREAKER, RETRY } from "../../config/engine.ts";
import type { BreakerState } from "../enums.ts";
import { fail, type ProviderError, type Result } from "../providers/types.ts";

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Returns 0 to 1. Replace in tests to remove randomness. */
  random?: () => number;
}

/** Wait before attempt N (0-based): base * 2^N, capped, plus up to 25% random "jitter". */
export function backoffDelay(attempt: number, o: Pick<RetryOptions, "baseDelayMs" | "maxDelayMs" | "random"> = {}): number {
  const base = o.baseDelayMs ?? RETRY.baseDelayMs;
  const max = o.maxDelayMs ?? RETRY.maxDelayMs;
  const rnd = o.random ?? Math.random;
  const raw = Math.min(base * 2 ** attempt, max);
  return Math.round(raw + raw * 0.25 * rnd());
}

/**
 * Runs `fn`. If it fails with a TEMPORARY error (rate limit, timeout, outage) it waits and tries again.
 * Permanent errors (wrong key, not found, changed format) return immediately: retrying cannot help.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<Result<T>>,
  options: RetryOptions = {},
): Promise<Result<T>> {
  const maxAttempts = options.maxAttempts ?? RETRY.maxAttempts;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: Result<T> | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    last = await fn(attempt);
    if (last.ok || !last.error.retryable) return last;
    if (attempt < maxAttempts - 1) {
      const wait = Math.max(last.error.retryAfterMs ?? 0, backoffDelay(attempt, options));
      await sleep(Math.min(wait, options.maxDelayMs ?? RETRY.maxDelayMs));
    }
  }
  return last!;
}

// ---------------------------------------------------------------------------
// Circuit breaker (pure state transitions; the state itself is saved in the providerHealth table)
// ---------------------------------------------------------------------------

export interface BreakerSnapshot {
  state: BreakerState;
  consecutiveFailures: number;
  openedAt?: number;
}

export const newBreaker = (): BreakerSnapshot => ({ state: "closed", consecutiveFailures: 0 });

/** May we call this provider right now? After the cool-down, one test call is allowed ("half open"). */
export interface BreakerConfig {
  failuresToOpen: number;
  coolDownMs: number;
}

export function canCall(b: BreakerSnapshot, now: number, cfg: BreakerConfig = CIRCUIT_BREAKER): { allowed: boolean; next: BreakerSnapshot } {
  if (b.state === "closed" || b.state === "half_open") return { allowed: true, next: b };
  if (b.openedAt !== undefined && now - b.openedAt >= cfg.coolDownMs) {
    return { allowed: true, next: { ...b, state: "half_open" } };
  }
  return { allowed: false, next: b };
}

export function recordSuccess(_b: BreakerSnapshot): BreakerSnapshot {
  return newBreaker();
}

export function recordFailure(b: BreakerSnapshot, now: number, cfg: BreakerConfig = CIRCUIT_BREAKER): BreakerSnapshot {
  const failures = b.consecutiveFailures + 1;
  // A failure during the single test call re-opens immediately.
  if (b.state === "half_open" || failures >= cfg.failuresToOpen) {
    return { state: "open", consecutiveFailures: failures, openedAt: now };
  }
  return { state: b.state, consecutiveFailures: failures, openedAt: b.openedAt };
}

/** Helper for adapters: the Result to return when the breaker is open. */
export function breakerOpenResult(providerId: string, makeError: (kind: "UNAVAILABLE", id: string, msg: string) => ProviderError): Result<never> {
  return fail(makeError("UNAVAILABLE", providerId, "circuit breaker is open; skipping this provider for now"));
}

// ---------------------------------------------------------------------------
// Rate limiter (token bucket)
// ---------------------------------------------------------------------------

export interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface BucketConfig {
  capacity: number; // most calls allowed in a burst
  refillPerSecond: number; // steady rate
}

export function newBucket(cfg: BucketConfig, now: number): Bucket {
  return { tokens: cfg.capacity, updatedAt: now };
}

/** Tries to spend one token. If none, says how long to wait until one is available. */
export function takeToken(b: Bucket, cfg: BucketConfig, now: number): { allowed: boolean; waitMs: number; next: Bucket } {
  const refilled = Math.min(cfg.capacity, b.tokens + ((now - b.updatedAt) / 1000) * cfg.refillPerSecond);
  if (refilled >= 1) return { allowed: true, waitMs: 0, next: { tokens: refilled - 1, updatedAt: now } };
  const waitMs = Math.ceil(((1 - refilled) / cfg.refillPerSecond) * 1000);
  return { allowed: false, waitMs, next: { tokens: refilled, updatedAt: now } };
}

/** Published limits of each free plan (kept conservative). Update if a plan changes. */
export const PROVIDER_RATE_LIMITS: Record<string, BucketConfig> = {
  gdelt: { capacity: 1, refillPerSecond: 1 / 6 },
  googlenews: { capacity: 3, refillPerSecond: 1 / 2 },
  finnhub: { capacity: 5, refillPerSecond: 1 }, // free plan: 60 calls/min
  mfapi: { capacity: 5, refillPerSecond: 2 },
  gemini: { capacity: 5, refillPerSecond: 0.25 },
};
