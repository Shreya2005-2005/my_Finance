/**
 * CHAOS TESTS: what happens when outside services misbehave?
 * A fake network function replaces the real internet, so failures can be produced on demand.
 */
import { describe, expect, it } from "vitest";
import { callGemini } from "../convex/engine/llm/gemini.ts";
import { finnhub } from "../convex/engine/providers/finnhub.ts";
import { gdelt } from "../convex/engine/providers/gdelt.ts";
import { googleNews } from "../convex/engine/providers/googleNews.ts";
import { getFundDetail, searchSchemes } from "../convex/engine/providers/mfapi.ts";
import { configuredProviders } from "../convex/engine/providers/registry.ts";
import type { ProviderContext } from "../convex/engine/providers/types.ts";
import { withRetry } from "../convex/engine/lib/resilience.ts";

const respond = (body: string, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers });
const ctxWith = (fn: (url: string, init?: RequestInit) => Response | Promise<Response>, env: Record<string, string> = {}): ProviderContext => ({
  fetch: (async (url: any, init: any) => fn(String(url), init)) as typeof fetch,
  now: () => Date.UTC(2026, 9, 14),
  env,
});

const RSS = `<rss><channel><item><title>A - Reuters</title><link>https://x.com/a</link><source>Reuters</source></item></channel></rss>`;

describe("every kind of failure maps to the right error", () => {
  const cases: Array<[string, Response, string]> = [
    ["rate limited", respond("", 429, { "retry-after": "7" }), "RATE_LIMITED"],
    ["wrong key", respond("", 403), "AUTH"],
    ["not found", respond("", 404), "NOT_FOUND"],
    ["server down", respond("", 503), "UNAVAILABLE"],
    ["weird status", respond("teapot", 418), "SCHEMA_DRIFT"],
  ];
  for (const [name, res, kind] of cases) {
    it(name, async () => {
      const r = await googleNews.searchNews({ text: "x" }, ctxWith(() => res.clone()));
      expect(!r.ok && r.error.kind).toBe(kind);
    });
  }
  it("Retry-After header is respected", async () => {
    const r = await googleNews.searchNews({ text: "x" }, ctxWith(() => respond("", 429, { "retry-after": "7" })));
    expect(!r.ok && r.error.retryAfterMs).toBe(7000);
  });
  it("network failure is UNAVAILABLE, not a crash", async () => {
    const r = await googleNews.searchNews({ text: "x" }, ctxWith(() => { throw new Error("ECONNRESET"); }));
    expect(!r.ok && r.error.kind).toBe("UNAVAILABLE");
  });
  it("a hung request is TIMEOUT", async () => {
    const r = await googleNews.searchNews({ text: "x" }, ctxWith(() => { const e = new Error("t"); e.name = "TimeoutError"; throw e; }));
    expect(!r.ok && r.error.kind).toBe("TIMEOUT");
  });
});

describe("schema drift: the service changed its format", () => {
  it("Google News returns a web page instead of a feed", async () => {
    const r = await googleNews.searchNews({ text: "x" }, ctxWith(() => respond("<html>Are you a robot?</html>")));
    expect(!r.ok && r.error.kind).toBe("SCHEMA_DRIFT");
  });
  it("MFapi returns JSON of the wrong shape", async () => {
    const r = await getFundDetail("1", ctxWith(() => respond(JSON.stringify({ hello: "world" }))));
    expect(!r.ok && r.error.kind).toBe("SCHEMA_DRIFT");
    const s = await searchSchemes("x", ctxWith(() => respond(JSON.stringify({ not: "a list" }))));
    expect(!s.ok && s.error.kind).toBe("SCHEMA_DRIFT");
  });
  it("MFapi returns broken JSON", async () => {
    const r = await getFundDetail("1", ctxWith(() => respond("{oops")));
    expect(!r.ok && r.error.kind).toBe("SCHEMA_DRIFT");
  });
  it("GDELT 'please limit requests' text is treated as RATE_LIMITED", async () => {
    const r = await gdelt.searchNews({ text: "x" }, ctxWith(() => respond("Please limit requests to one every 5 seconds")));
    expect(!r.ok && r.error.kind).toBe("RATE_LIMITED");
  });
});

describe("retry + flaky provider, end to end", () => {
  it("recovers after two failures", async () => {
    let n = 0;
    const ctx = ctxWith(() => (++n < 3 ? respond("", 503) : respond(RSS)));
    const r = await withRetry(() => googleNews.searchNews({ text: "x" }, ctx), { sleep: async () => {}, random: () => 0 });
    expect(r.ok && r.value).toHaveLength(1);
    expect(n).toBe(3);
  });
  it("does not hammer a provider with a wrong key", async () => {
    let n = 0;
    const ctx = ctxWith(() => (n++, respond("", 403)), { FINNHUB_API_KEY: "bad" });
    const r = await withRetry(() => finnhub.searchNews({ text: "AAPL" }, ctx), { sleep: async () => {} });
    expect(r.ok).toBe(false);
    expect(n).toBe(1);
  });
});

describe("keys and configuration", () => {
  it("providers that need a key refuse politely without one", async () => {
    const r = await finnhub.searchNews({ text: "AAPL" }, ctxWith(() => respond("[]")));
    expect(!r.ok && r.error.kind).toBe("AUTH");
    const g = await callGemini({ system: "", user: "", schema: {} }, ctxWith(() => respond("{}")));
    expect(!g.ok && g.error.kind).toBe("AUTH");
  });
  it("registry only lists providers that are usable", () => {
    const ids = configuredProviders({}).map((p) => p.id);
    expect(ids).toContain("googlenews");
    expect(ids).not.toContain("finnhub");
    expect(configuredProviders({ FINNHUB_API_KEY: "k" }).map((p) => p.id)).toContain("finnhub");
  });
  it("the API key is sent in a header, never in the URL", async () => {
    let seenUrl = "";
    let seenHeaders: any;
    await finnhub.searchNews({ text: "AAPL" }, ctxWith((u, init) => ((seenUrl = u), (seenHeaders = init?.headers), respond("[]")), { FINNHUB_API_KEY: "SECRET123" }));
    expect(seenUrl).not.toContain("SECRET123");
    expect(JSON.stringify(seenHeaders)).toContain("SECRET123");
  });
});

describe("Finnhub symbol search (free plan covers US stocks only)", () => {
  const body = JSON.stringify({
    result: [
      { symbol: "AAPL", description: "APPLE INC", type: "Common Stock" },
      { symbol: "AAPL.SW", description: "APPLE INC", type: "Common Stock" },
      { symbol: "APLE", description: "APPLE HOSPITALITY REIT", type: "REIT" },
    ],
  });
  it("keeps only US-style stock symbols, in Finnhub's order", async () => {
    const { searchSymbol } = await import("../convex/engine/providers/finnhub.ts");
    const r = await searchSymbol("apple", ctxWith(() => respond(body), { FINNHUB_API_KEY: "k" }));
    expect(r.ok && r.value.map((x) => x.symbol)).toEqual(["AAPL"]);
  });
  it("needs a key, and detects a changed format", async () => {
    const { searchSymbol } = await import("../convex/engine/providers/finnhub.ts");
    expect((await searchSymbol("apple", ctxWith(() => respond(body))) as any).error.kind).toBe("AUTH");
    expect((await searchSymbol("apple", ctxWith(() => respond("{}"), { FINNHUB_API_KEY: "k" })) as any).error.kind).toBe("SCHEMA_DRIFT");
  });
});

describe("Gemini client", () => {
  const okBody = JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ verdict: "supported", reason: "r" }) }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } });
  it("returns parsed JSON and token counts", async () => {
    const r = await callGemini<{ verdict: string }>({ system: "s", user: "u", schema: {} }, ctxWith(() => respond(okBody), { GEMINI_API_KEY: "k" }));
    expect(r.ok && r.value.value.verdict).toBe("supported");
    expect(r.ok && r.value.tokensIn).toBe(10);
  });
  it("quota exhausted is RATE_LIMITED", async () => {
    const r = await callGemini({ system: "s", user: "u", schema: {} }, ctxWith(() => respond("", 429), { GEMINI_API_KEY: "k" }));
    expect(!r.ok && r.error.kind).toBe("RATE_LIMITED");
  });
  it("a blocked or empty answer is SCHEMA_DRIFT", async () => {
    const r = await callGemini({ system: "s", user: "u", schema: {} }, ctxWith(() => respond(JSON.stringify({ candidates: [] })), { GEMINI_API_KEY: "k" }));
    expect(!r.ok && r.error.kind).toBe("SCHEMA_DRIFT");
  });
  it("an answer that is not valid JSON is SCHEMA_DRIFT", async () => {
    const bad = JSON.stringify({ candidates: [{ content: { parts: [{ text: "Sure! Here is..." }] } }] });
    const r = await callGemini({ system: "s", user: "u", schema: {} }, ctxWith(() => respond(bad), { GEMINI_API_KEY: "k" }));
    expect(!r.ok && r.error.kind).toBe("SCHEMA_DRIFT");
  });
});
