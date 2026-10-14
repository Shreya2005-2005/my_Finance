import { ProviderError } from "../providers/types.ts";

/** Same HTTP-status-to-error rules as the data providers, reused for the LLM. */
export function httpStatusToError(status: number, providerId: string, retryAfter: string | null, body: string): ProviderError {
  const retryAfterMs = retryAfter && Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1000 : undefined;
  if (status === 429) return new ProviderError("RATE_LIMITED", providerId, "quota or rate limit reached", retryAfterMs);
  if (status === 401 || status === 403) return new ProviderError("AUTH", providerId, `access denied (HTTP ${status}); check the API key`);
  if (status === 404) return new ProviderError("NOT_FOUND", providerId, "model or endpoint not found");
  if (status >= 500) return new ProviderError("UNAVAILABLE", providerId, `server error (HTTP ${status})`);
  return new ProviderError("SCHEMA_DRIFT", providerId, `unexpected HTTP ${status}: ${body.slice(0, 80)}`);
}
