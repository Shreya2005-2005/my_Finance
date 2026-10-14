import { describe, expect, it } from "vitest";
import { PROVIDER_ERROR_KINDS } from "../convex/engine/enums.ts";
import { fail, ok, ProviderError } from "../convex/engine/providers/types.ts";

describe("ProviderError", () => {
  it("retries temporary problems", () => {
    for (const kind of ["RATE_LIMITED", "TIMEOUT", "UNAVAILABLE"] as const) {
      expect(new ProviderError(kind, "gdelt", "x").retryable).toBe(true);
    }
  });

  it("does NOT retry permanent problems", () => {
    for (const kind of ["NOT_FOUND", "AUTH", "SCHEMA_DRIFT"] as const) {
      expect(new ProviderError(kind, "gdelt", "x").retryable).toBe(false);
    }
  });

  it("every error kind is decided one way or the other", () => {
    for (const kind of PROVIDER_ERROR_KINDS) {
      expect(typeof new ProviderError(kind, "p", "m").retryable).toBe("boolean");
    }
  });

  it("message names the provider and the problem", () => {
    const e = new ProviderError("RATE_LIMITED", "finnhub", "slow down", 2000);
    expect(e.message).toContain("finnhub");
    expect(e.message).toContain("RATE_LIMITED");
    expect(e.retryAfterMs).toBe(2000);
  });
});

describe("Result helpers", () => {
  it("ok() wraps a value", () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it("fail() wraps an error", () => {
    const r = fail(new ProviderError("TIMEOUT", "gdelt", "too slow"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("TIMEOUT");
  });
});
