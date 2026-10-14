/**
 * FINNHUB: company news and fundamentals. Needs FINNHUB_API_KEY (free plan).
 * Indian (NSE/BSE) coverage on the free plan is UNCONFIRMED. Run `npm run spike:finnhub` once the key is set.
 */
import { classifyPublisher } from "../lib/authority.ts";
import { canonicalizeUrl } from "../lib/text.ts";
import { httpJson, schemaDrift } from "./http.ts";
import {
  fail,
  ok,
  ProviderError,
  type FinancialDatapoint,
  type FundamentalsProvider,
  type NewsProvider,
  type ProviderContext,
  type Result,
  type SourceDoc,
} from "./types.ts";

const ID = "finnhub";
const BASE = "https://finnhub.io/api/v1";

interface FinnhubNews {
  headline: string;
  summary?: string;
  url: string;
  source?: string;
  datetime: number; // seconds
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const missingKey = () => fail(new ProviderError("AUTH", ID, "FINNHUB_API_KEY is not set"));

export interface FinnhubSymbol {
  symbol: string;
  description: string;
  type: string;
}

/**
 * Finds US-listed stocks matching a company name. The free plan covers US stocks only
 * (tested: every NSE/BSE symbol is blocked), so symbols with an exchange suffix are skipped.
 */
export async function searchSymbol(query: string, ctx: ProviderContext): Promise<Result<FinnhubSymbol[]>> {
  const key = ctx.env.FINNHUB_API_KEY;
  if (!key) return missingKey();
  const r = await httpJson<{ result?: Array<{ symbol?: string; description?: string; type?: string }> }>(
    ctx,
    ID,
    `${BASE}/search?q=${encodeURIComponent(query)}`,
    { headers: { "X-Finnhub-Token": key } },
  );
  if (!r.ok) return r;
  if (!Array.isArray(r.value?.result)) return schemaDrift(ID, "search has no 'result' list");
  const us = r.value.result
    .filter((x) => x.symbol && !x.symbol.includes(".") && /common stock|adr|etp/i.test(x.type ?? "common stock"))
    .map((x) => ({ symbol: x.symbol!, description: x.description ?? x.symbol!, type: x.type ?? "" }));
  return ok(us);
}

export const finnhub: NewsProvider & FundamentalsProvider = {
  id: ID,
  capabilities: { news: true, fundamentals: true, priceHistory: false, filings: false, fundData: false },
  isConfigured: (env) => Boolean(env.FINNHUB_API_KEY),

  async searchNews(query, ctx) {
    const key = ctx.env.FINNHUB_API_KEY;
    if (!key) return missingKey();
    const to = ctx.now();
    const from = query.since ?? to - 7 * 86_400_000;
    // For Finnhub, `text` is a ticker symbol such as "AAPL" or "RELIANCE.NS".
    const url = `${BASE}/company-news?symbol=${encodeURIComponent(query.text)}&from=${day(from)}&to=${day(to)}`;
    const r = await httpJson<FinnhubNews[]>(ctx, ID, url, { headers: { "X-Finnhub-Token": key } });
    if (!r.ok) return r;
    if (!Array.isArray(r.value)) return schemaDrift(ID, "company-news did not return a list");
    const docs: SourceDoc[] = r.value.slice(0, query.maxRecords ?? 50).map((n) => ({
      url: n.url,
      canonicalUrl: canonicalizeUrl(n.url),
      title: n.headline,
      publisher: n.source,
      providerId: ID,
      authorityTier: classifyPublisher(n.source),
      publishedAt: n.datetime ? n.datetime * 1000 : undefined,
      retrievedAt: ctx.now(),
      text: n.summary || undefined,
      language: "en",
    }));
    return ok(docs);
  },

  async getFundamentals(query, ctx) {
    const key = ctx.env.FINNHUB_API_KEY;
    if (!key) return missingKey();
    const r = await httpJson<{ metric?: Record<string, number | null> }>(
      ctx,
      ID,
      `${BASE}/stock/metric?symbol=${encodeURIComponent(query.entityRef)}&metric=all`,
      { headers: { "X-Finnhub-Token": key } },
    );
    if (!r.ok) return r;
    const m = r.value?.metric;
    if (!m || typeof m !== "object") return schemaDrift(ID, "stock/metric has no 'metric' object");
    if (Object.keys(m).length === 0) return fail(new ProviderError("NOT_FOUND", ID, `no fundamentals for ${query.entityRef} on this plan`));
    const wanted = query.metrics;
    const now = ctx.now();
    const points: FinancialDatapoint[] = [];
    for (const [metric, value] of Object.entries(m)) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      if (wanted && !wanted.includes(metric)) continue;
      points.push({ providerId: ID, entityRef: query.entityRef, metric, value, unit: "ratio_or_native", period: "TTM", basis: "unspecified", asOf: now, retrievedAt: now });
    }
    return ok(points);
  },
};

// ---------------------------------------------------------------------------
// Market news: the general headlines feed (not tied to one company)
// ---------------------------------------------------------------------------

export interface MarketNewsItem {
  id: number;
  headline: string;
  source: string;
  url: string;
  /** ms since epoch */
  publishedAt: number;
  summary?: string;
  /** A real picture for this story. The outlet's shared logo is not a picture of the story, so it is left out. */
  image?: string;
}

/** Only a normal https picture, and never an outlet logo (Finnhub sends one logo for every story of some outlets). */
export function storyImage(url: unknown): string | undefined {
  if (typeof url !== "string" || !/^https:\/\//i.test(url) || /\/logo\//i.test(url) || url.length > 600) return undefined;
  return url;
}

/**
 * Finnhub's general market news (the free plan allows it): global and US business headlines from outlets such as
 * Reuters, CNBC and Bloomberg. Items without a headline, a time or a normal web link are dropped.
 */
export async function marketNews(category: "general" | "forex" | "crypto" | "merger", ctx: ProviderContext): Promise<Result<MarketNewsItem[]>> {
  const key = ctx.env.FINNHUB_API_KEY;
  if (!key) return missingKey();
  const r = await httpJson<Array<{ id?: number; headline?: string; source?: string; url?: string; datetime?: number; summary?: string; image?: string }>>(
    ctx,
    ID,
    `${BASE}/news?category=${category}`,
    { headers: { "X-Finnhub-Token": key } },
  );
  if (!r.ok) return r;
  if (!Array.isArray(r.value)) return schemaDrift(ID, "news did not return a list");
  const items: MarketNewsItem[] = [];
  for (const n of r.value) {
    if (typeof n?.headline !== "string" || !n.headline.trim() || typeof n.datetime !== "number" || n.datetime <= 0) continue;
    if (typeof n.url !== "string" || !/^https?:\/\//i.test(n.url)) continue;
    items.push({
      id: typeof n.id === "number" ? n.id : items.length,
      headline: n.headline.trim(),
      source: (n.source ?? "").trim() || "Unknown",
      url: n.url,
      publishedAt: n.datetime * 1000,
      summary: n.summary?.trim() || undefined,
      image: storyImage(n.image),
    });
  }
  return ok(items);
}
