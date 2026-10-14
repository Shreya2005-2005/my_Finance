/**
 * GDELT: global news index. Keyless, but very strict rate limit and patchy for Indian companies
 * (see the coverage test). Used as a BACKUP to Google News, never as the only source.
 */
import { classifyPublisher } from "../lib/authority.ts";
import { canonicalizeUrl } from "../lib/text.ts";
import { httpJson, schemaDrift } from "./http.ts";
import { ok, type NewsProvider, type SourceDoc } from "./types.ts";

const ID = "gdelt";

interface GdeltArticle {
  url: string;
  title: string;
  seendate: string; // 20261010T064500Z
  domain: string;
  language?: string;
}

export function parseGdeltDate(s: string): number | undefined {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  return m ? Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!) : undefined;
}

export const gdelt: NewsProvider = {
  id: ID,
  capabilities: { news: true, fundamentals: false, priceHistory: false, filings: false, fundData: false },
  isConfigured: () => true,

  async searchNews(query, ctx) {
    const days = query.since ? Math.max(1, Math.ceil((ctx.now() - query.since) / 86_400_000)) : 7;
    const url =
      "https://api.gdeltproject.org/api/v2/doc/doc?" +
      new URLSearchParams({
        query: `"${query.text}" sourcelang:english`,
        mode: "artlist",
        maxrecords: String(query.maxRecords ?? 25),
        format: "json",
        timespan: `${days}d`,
        sort: "datedesc",
      });
    const r = await httpJson<{ articles?: GdeltArticle[] }>(ctx, ID, url, { timeoutMs: 30_000 });
    if (!r.ok) return r;
    if (r.value && typeof r.value === "object" && r.value.articles === undefined && Object.keys(r.value).length > 0) {
      return schemaDrift(ID, "response has no 'articles' field");
    }
    const docs: SourceDoc[] = (r.value.articles ?? []).map((a) => ({
      url: a.url,
      canonicalUrl: canonicalizeUrl(a.url),
      title: a.title,
      publisher: a.domain,
      providerId: ID,
      authorityTier: classifyPublisher(a.domain, a.domain),
      publishedAt: parseGdeltDate(a.seendate),
      retrievedAt: ctx.now(),
      language: a.language?.toLowerCase().startsWith("eng") ? "en" : a.language,
    }));
    return ok(docs);
  },
};
