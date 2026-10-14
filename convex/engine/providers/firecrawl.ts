/**
 * FIRECRAWL: turns a web page into clean readable text. Needs FIRECRAWL_API_KEY (free plan exists).
 * UNTESTED against the real service until a key is added; tested here with a simulated one.
 */
import { classifyPublisher, publisherFromHost } from "../lib/authority.ts";
import { canonicalizeUrl, stripHtml } from "../lib/text.ts";
import { fail, ok, ProviderError, type Provider, type ProviderContext, type Result, type SourceDoc } from "./types.ts";
import { httpJson } from "./http.ts";

const ID = "firecrawl";

export interface ScrapedPage {
  text: string;
  title?: string;
  /** The page's final address (useful when the first link was a redirect). */
  finalUrl?: string;
}

export const firecrawl: Provider = {
  id: ID,
  capabilities: { news: false, fundamentals: false, priceHistory: false, filings: false, fundData: false },
  isConfigured: (env) => Boolean(env.FIRECRAWL_API_KEY),
};

interface RawScrape {
  success?: boolean;
  error?: string;
  data?: { markdown?: string; metadata?: { title?: string; sourceURL?: string; url?: string } };
}

export function parseScrape(raw: RawScrape): ScrapedPage | undefined {
  const md = raw?.data?.markdown;
  if (!raw?.success || typeof md !== "string") return undefined;
  const meta = raw.data?.metadata;
  return { text: md.trim(), title: meta?.title, finalUrl: meta?.url ?? meta?.sourceURL };
}

/**
 * Search descriptions come back as raw page text, with markdown images, links and headings.
 * This removes the markup and keeps the words, so the text reads normally. No words are changed.
 */
export function cleanDescription(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links: keep the link text
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp;)?nbsp;/gi, " ")
    .replace(/[​-‏⁠﻿‪-‮]/g, "") // invisible characters
    .replace(/^\s*\d+\s+(minutes?|hours?|days?|weeks?)\s+ago\s*[·\-–—|]?\s*/i, "") // "22 hours ago ·" shown before the text
    .replace(/(^|\s)#{1,6}(?=\s)/g, " ") // heading marks, at the start of a line or after a space
    .replace(/[*_`>|]+/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pages that are a live price or quote board, not reporting. They add nothing to a briefing. */
const QUOTE_PAGE = /(share price|stock price|stock quote|price chart|live (updates|price|today)|today.s (move|price)|stock forecast|price target \d{4}|price target\s*(?:[-|–—].*)?$|\b(?:ltd|limited)\.?\s*(?:[-|–—].*)?$)/i;
export const looksLikeQuotePage = (title: string) => QUOTE_PAGE.test(title);

/** Removes a trailing " - Reuters" / " | The Hindu" style site name from a page title. */
export function cleanPageTitle(title: string, publisher: string, host: string): string {
  const m = title.match(/^(.*\S)\s[-|–—]\s([^-|–—]{2,45})$/);
  if (!m) return title.trim();
  // Compare letters and digits only, so "CNBC TV18", "CNBC-TV18" and "cnbctv18.com" all match.
  const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const suffix = flat(m[2]!);
  const pub = flat(publisher);
  const hostWord = flat(host.replace(/^www\./, "").split(".")[0] ?? "");
  const sameSite =
    suffix.length >= 3 && (pub.includes(suffix) || suffix.includes(pub) || (hostWord.length >= 3 && (suffix.includes(hostWord) || hostWord.includes(suffix))));
  return sameSite || suffix.includes("economictimes") || suffix.includes("indiatimes") ? m[1]!.trim() : title.trim();
}

interface RawSearch {
  success?: boolean;
  error?: string;
  data?: Array<{ url?: string; title?: string; description?: string }>;
}

/**
 * Web search that returns the PUBLISHER'S OWN links (unlike Google News redirects) with a short description
 * copied from the page. Results carry no publication date, so they are treated as "recent" within the window.
 */
export async function firecrawlSearch(query: string, opts: { days: number; limit?: number }, ctx: ProviderContext): Promise<Result<SourceDoc[]>> {
  const key = ctx.env.FIRECRAWL_API_KEY;
  if (!key) return fail(new ProviderError("AUTH", ID, "FIRECRAWL_API_KEY is not set"));
  const tbs = opts.days <= 1 ? "qdr:d" : opts.days <= 7 ? "qdr:w" : "qdr:m";
  const r = await httpJson<RawSearch>(ctx, ID, "https://api.firecrawl.dev/v1/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, limit: opts.limit ?? 8, tbs, country: "in", lang: "en" }),
    timeoutMs: 45_000,
  });
  if (!r.ok) return r;
  if (!r.value?.success || !Array.isArray(r.value.data)) return fail(new ProviderError("SCHEMA_DRIFT", ID, r.value?.error ?? "search returned no result list"));

  const docs: SourceDoc[] = [];
  for (const x of r.value.data) {
    if (!x.url || !x.title) continue;
    let host: string;
    try {
      host = new URL(x.url).hostname;
    } catch {
      continue;
    }
    if (looksLikeQuotePage(x.title)) continue;
    const publisher = publisherFromHost(host);
    docs.push({
      url: x.url,
      canonicalUrl: canonicalizeUrl(x.url),
      title: cleanPageTitle(stripHtml(x.title), publisher, host),
      publisher,
      providerId: ID,
      authorityTier: classifyPublisher(publisher, host),
      retrievedAt: ctx.now(),
      text: x.description ? cleanDescription(stripHtml(x.description)) || undefined : undefined,
      language: "en",
      kind: "news",
    });
  }
  return ok(docs);
}

export async function firecrawlScrape(url: string, ctx: ProviderContext): Promise<Result<ScrapedPage>> {
  const key = ctx.env.FIRECRAWL_API_KEY;
  if (!key) return fail(new ProviderError("AUTH", ID, "FIRECRAWL_API_KEY is not set"));
  const r = await httpJson<RawScrape>(ctx, ID, "https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
    timeoutMs: 60_000,
  });
  if (!r.ok) {
    // Firecrawl answers 403 when IT refuses a site (it blocks some, including Google News). That is not a bad key.
    if (r.error.kind === "AUTH" && /HTTP 403/.test(r.error.message)) {
      return fail(new ProviderError("NOT_FOUND", ID, "Firecrawl does not allow this site (for example Google News links). Try the publisher's own link."));
    }
    return r;
  }
  const page = parseScrape(r.value);
  if (!page) return fail(new ProviderError("SCHEMA_DRIFT", ID, r.value?.error ?? "response has no page text"));
  if (page.text.length < 200) return fail(new ProviderError("NOT_FOUND", ID, "the page had almost no readable text"));
  return ok(page);
}
