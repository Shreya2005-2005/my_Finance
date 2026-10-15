/**
 * A SMALL, TOLERANT RSS / ATOM READER.
 *
 * Indian outlets publish free public feeds. They all differ a little: titles wrapped in CDATA, photos in different tags
 * (media:content, media:thumbnail, enclosure, or an <img> inside the description), odd date formats ("14 Oct, 2026 +0530").
 * This reads all of them into one plain shape. No dependency: a feed is just text, and anything unexpected is skipped
 * instead of crashing the page.
 *
 * Only headline, a short summary, the photo link, the time and the link to the outlet's own article are kept.
 */
import { httpText } from "./http.ts";
import { fail, ok, ProviderError, type ProviderContext, type Result } from "./types.ts";

export interface FeedItem {
  title: string;
  /** The outlet's own article address. */
  link: string;
  /** A short plain-text summary, if the feed has one (HTML removed). */
  summary?: string;
  /** ms since epoch */
  publishedAt?: number;
  /** A photo address (https only). */
  image?: string;
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…" };

/** Turns &amp; &#8377; &#x20B9; into characters. Unknown names are left as written. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1]!.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const CDATA = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/;

/** The text inside the first <tag>...</tag>, without the CDATA wrapper, still holding any HTML. */
function rawTag(block: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  if (!m) return undefined;
  const inner = m[1]!;
  const c = CDATA.exec(inner);
  return c ? c[1]! : decodeEntities(inner);
}

/** Plain text: tags removed, entities decoded, spaces collapsed. */
export function plainText(html: string | undefined): string {
  if (!html) return "";
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** Reads the date formats feeds use. Returns undefined when it cannot, never a wrong guess. */
export function parseFeedDate(text: string | undefined): number | undefined {
  const s = plainText(text);
  if (!s) return undefined;
  const direct = Date.parse(s);
  if (Number.isFinite(direct)) return direct;
  // "14 Oct, 2026 +0530" (SEBI): day, month name, year, optional zone
  const m = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*,?\s+(\d{4})(?:\s+(\d{2}):(\d{2}))?(?:\s*([+-])(\d{2})(\d{2}))?/.exec(s);
  if (m && MONTHS[m[2]!.toLowerCase()] !== undefined) {
    const utc = Date.UTC(Number(m[3]), MONTHS[m[2]!.toLowerCase()]!, Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0));
    const zone = m[6] ? (m[6] === "+" ? 1 : -1) * (Number(m[7]) * 60 + Number(m[8])) * 60_000 : 0;
    return utc - zone;
  }
  return undefined;
}

const IMAGE_EXT = /\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i;

/** The first usable photo address in an item. Only https, and never a tiny icon or an outlet logo. */
export function feedImage(block: string): string | undefined {
  const candidates: string[] = [];
  for (const m of block.matchAll(/<media:(?:content|thumbnail)\b[^>]*>/gi)) {
    const tag = m[0];
    const url = /\burl="([^"]+)"/i.exec(tag)?.[1];
    const medium = /\bmedium="([^"]+)"/i.exec(tag)?.[1];
    const type = /\btype="([^"]+)"/i.exec(tag)?.[1];
    if (url && (!medium || medium === "image") && (!type || type.startsWith("image/"))) candidates.push(url);
  }
  for (const m of block.matchAll(/<enclosure\b[^>]*>/gi)) {
    const url = /\burl="([^"]+)"/i.exec(m[0])?.[1];
    const type = /\btype="([^"]+)"/i.exec(m[0])?.[1];
    if (url && (type?.startsWith("image/") || (!type && IMAGE_EXT.test(url)))) candidates.push(url);
  }
  const desc = rawTag(block, "description") ?? rawTag(block, "content:encoded") ?? rawTag(block, "content") ?? "";
  const img = /<img\b[^>]*\bsrc=["']([^"']+)["']/i.exec(decodeEntities(desc))?.[1];
  if (img) candidates.push(img);
  for (const raw of candidates) {
    const url = decodeEntities(raw).trim();
    if (url.length > 600 || !/^https:\/\//i.test(url)) continue;
    if (/\/(?:logo|icons?|sprite|placeholder|default)[^/]*\.(?:png|svg|gif)/i.test(url)) continue;
    return url;
  }
  return undefined;
}

/** Reads every story in an RSS (<item>) or Atom (<entry>) feed. Items with no title or no web link are skipped. */
export function parseFeed(xml: string): FeedItem[] {
  const blocks = [...xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  const out: FeedItem[] = [];
  for (const block of blocks) {
    const title = plainText(rawTag(block, "title"));
    let link = plainText(rawTag(block, "link"));
    if (!link) link = /<link\b[^>]*\bhref="([^"]+)"/i.exec(block)?.[1] ?? "";
    link = decodeEntities(link).trim();
    if (!title || !/^https?:\/\//i.test(link)) continue;
    const description = rawTag(block, "description") ?? rawTag(block, "summary");
    const summary = plainText(description);
    out.push({
      title,
      link,
      summary: summary && summary.length >= 20 ? summary.slice(0, 400) : undefined,
      publishedAt: parseFeedDate(rawTag(block, "pubDate") ?? rawTag(block, "published") ?? rawTag(block, "updated") ?? rawTag(block, "dc:date")),
      image: feedImage(block),
    });
  }
  return out;
}

/** Downloads one feed and reads it. A feed that is not a feed (a web page, an error) is reported, not guessed at. */
export async function fetchFeed(providerId: string, url: string, ctx: ProviderContext, userAgent: string): Promise<Result<FeedItem[]>> {
  const r = await httpText(ctx, providerId, url, { headers: { "user-agent": userAgent, accept: "application/rss+xml, application/xml, text/xml, */*" }, timeoutMs: 20_000 });
  if (!r.ok) return r;
  const items = parseFeed(r.value);
  if (!items.length && !/<(?:rss|feed|rdf:RDF)\b/i.test(r.value.slice(0, 2000))) {
    return fail(new ProviderError("SCHEMA_DRIFT", providerId, "the address did not return a news feed"));
  }
  return ok(items);
}
