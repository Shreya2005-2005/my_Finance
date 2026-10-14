/**
 * GOOGLE NEWS (RSS): keyless news discovery. Our main news source for Indian companies.
 *
 * Gives headline, link, publisher and date for ~100 recent stories per search.
 * It does NOT give the full article. The link is a Google redirect, so the full text is fetched in a later step.
 * Duplicate stories are common here (same story from many sites), which is exactly what dedupe is for.
 */
import { classifyPublisher } from "../lib/authority.ts";
import { canonicalizeUrl, stripHtml } from "../lib/text.ts";
import { httpText, schemaDrift } from "./http.ts";
import { ok, type NewsProvider, type SourceDoc } from "./types.ts";

const ID = "googlenews";

const tag = (block: string, name: string): string | undefined => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  if (!m) return undefined;
  return m[1]!.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
};

export function parseGoogleNewsRss(xml: string, retrievedAt: number): SourceDoc[] | undefined {
  if (!/<rss[\s>]/i.test(xml) && !/<channel[\s>]/i.test(xml)) return undefined; // not a feed at all
  const docs: SourceDoc[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const block = m[1]!;
    const rawTitle = tag(block, "title");
    const link = tag(block, "link");
    if (!rawTitle || !link) continue;
    const publisher = tag(block, "source");
    // Google appends " - Publisher" to titles; keep the clean headline.
    const title = stripHtml(publisher && rawTitle.endsWith(` - ${publisher}`) ? rawTitle.slice(0, -(publisher.length + 3)) : rawTitle);
    const pub = tag(block, "pubDate");
    const publishedAt = pub ? Date.parse(pub) : NaN;
    const description = tag(block, "description");
    docs.push({
      url: link,
      canonicalUrl: canonicalizeUrl(link),
      title,
      publisher,
      providerId: ID,
      authorityTier: classifyPublisher(publisher),
      publishedAt: Number.isFinite(publishedAt) ? publishedAt : undefined,
      retrievedAt,
      text: description ? stripHtml(description) : undefined,
      language: "en",
    });
  }
  return docs;
}

export const googleNews: NewsProvider = {
  id: ID,
  capabilities: { news: true, fundamentals: false, priceHistory: false, filings: false, fundData: false },
  isConfigured: () => true, // no key needed

  async searchNews(query, ctx) {
    const days = query.since ? Math.max(1, Math.ceil((ctx.now() - query.since) / 86_400_000)) : 7;
    const q = `${query.text} when:${days}d`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;
    const r = await httpText(ctx, ID, url, { headers: { "user-agent": "Mozilla/5.0 (compatible; VerifinBot/0.1)" } });
    if (!r.ok) return r;
    const docs = parseGoogleNewsRss(r.value, ctx.now());
    if (!docs) return schemaDrift(ID, "response is not an RSS feed");
    return ok(docs.slice(0, query.maxRecords ?? 50));
  },
};
