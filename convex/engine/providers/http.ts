/**
 * One shared way to call outside services, so every adapter reports problems the same way.
 * Turns HTTP statuses and network failures into the six ProviderError kinds.
 */
import { fail, ok, ProviderError, type ProviderContext, type Result } from "./types.ts";

export interface HttpOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  method?: "GET" | "POST";
  body?: string;
}

export function statusToError(status: number, providerId: string, retryAfter: string | null, body: string): ProviderError {
  const retryAfterMs = retryAfter && Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1000 : undefined;
  if (status === 429) return new ProviderError("RATE_LIMITED", providerId, "too many requests", retryAfterMs);
  if (status === 401 || status === 403) return new ProviderError("AUTH", providerId, `access denied (HTTP ${status}); check the API key or plan`);
  if (status === 404) return new ProviderError("NOT_FOUND", providerId, "not found");
  if (status === 408) return new ProviderError("TIMEOUT", providerId, "request timed out (HTTP 408)");
  if (status >= 500) return new ProviderError("UNAVAILABLE", providerId, `server error (HTTP ${status})`);
  return new ProviderError("SCHEMA_DRIFT", providerId, `unexpected HTTP ${status}: ${body.slice(0, 80)}`);
}

/** GET a URL and return its body as text. Never throws: returns ok(text) or fail(ProviderError). */
export async function httpText(ctx: ProviderContext, providerId: string, url: string, opts: HttpOptions = {}): Promise<Result<string>> {
  try {
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? 20_000);
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
    const res = await ctx.fetch(url, { method: opts.method, headers: opts.headers, body: opts.body, signal });
    const body = await res.text();
    if (!res.ok) return fail(statusToError(res.status, providerId, res.headers.get("retry-after"), body));
    // Some services (GDELT) answer HTTP 200/429 with a plain-text "slow down" message.
    if (/please limit requests/i.test(body.slice(0, 200))) return fail(new ProviderError("RATE_LIMITED", providerId, "asked us to slow down", 6000));
    return ok(body);
  } catch (e) {
    const name = (e as Error).name;
    if (name === "TimeoutError" || name === "AbortError") return fail(new ProviderError("TIMEOUT", providerId, "no answer in time"));
    return fail(new ProviderError("UNAVAILABLE", providerId, `network error: ${(e as Error).message}`));
  }
}

/** GET a URL and parse JSON. Bad JSON counts as SCHEMA_DRIFT (the service changed what it sends). */
export async function httpJson<T = unknown>(ctx: ProviderContext, providerId: string, url: string, opts: HttpOptions = {}): Promise<Result<T>> {
  const r = await httpText(ctx, providerId, url, opts);
  if (!r.ok) return r;
  try {
    return ok(JSON.parse(r.value) as T);
  } catch {
    return fail(new ProviderError("SCHEMA_DRIFT", providerId, `response was not valid JSON: ${r.value.slice(0, 60)}`));
  }
}

export const schemaDrift = (providerId: string, what: string) => fail(new ProviderError("SCHEMA_DRIFT", providerId, what));
