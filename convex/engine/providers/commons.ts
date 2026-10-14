/**
 * WIKIMEDIA COMMONS: free, licensed photos (no key needed).
 *
 * Used to put an illustrative photo on each news story (a stock exchange, an oil refinery, a central bank building ...).
 * These are NOT photos of the event itself, and the page says so. Every photo carries its author and licence, which the
 * licences (Creative Commons and similar) require us to show.
 *
 * Wikimedia asks every program to identify itself in the User-Agent. Set SEC_USER_AGENT (or CONTACT_USER_AGENT) to
 * "Your Name your@email" in .env.local.
 */
import { httpJson, schemaDrift } from "./http.ts";
import { ok, type ProviderContext, type Result } from "./types.ts";

const ID = "commons";
export const DEFAULT_USER_AGENT = "Verifin student research project (set CONTACT_USER_AGENT to your name and email)";

export interface Photo {
  /** A ready-sized copy (about 900 px wide) on upload.wikimedia.org. */
  url: string;
  /** The photographer, as plain text. */
  credit: string;
  /** For example "CC BY-SA 4.0" or "Public domain". */
  license: string;
  /** The photo's page on Commons, where the full credit and licence text live. */
  pageUrl: string;
  title: string;
}

/** Titles that are not photographs of a place or thing. */
const NOT_A_PHOTO = /\b(?:logo|map|maps|flag|coat of arms|diagram|chart|graph|icon|screenshot|poster|banner|stamp|coin|portrait|signature|seal|emblem|infographic|cover|album|svg|statue|painting|drawing|illustration|cartoon|meeting|conference|summit|speech)\b/i;

const STOP = new Set(["the", "and", "for", "with", "from", "building", "headquarters", "photo", "view"]);

/** The words of a search that a good result's title should contain at least one of. */
export const queryWords = (query: string): string[] =>
  query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w));

const plain = (html: string | undefined): string =>
  (html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:amp|#38);/g, "&")
    .replace(/&(?:quot|#34);/g, '"')
    .replace(/&(?:#39|apos);/g, "'")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

interface CommonsPage {
  index?: number;
  title?: string;
  imageinfo?: Array<{
    thumburl?: string;
    descriptionurl?: string;
    width?: number;
    height?: number;
    mime?: string;
    extmetadata?: { Artist?: { value?: string }; LicenseShortName?: { value?: string } };
  }>;
}

/** Turns the search answer into a short list of usable photos, best match first. Pure: no network. */
export function parseCommonsPhotos(json: unknown, query: string): Photo[] {
  const pages = (json as { query?: { pages?: Record<string, CommonsPage> } })?.query?.pages;
  if (!pages || typeof pages !== "object") return [];
  const words = queryWords(query);
  const out: Photo[] = [];
  for (const p of Object.values(pages).sort((a, b) => (a.index ?? 0) - (b.index ?? 0))) {
    const ii = p.imageinfo?.[0];
    const title = (p.title ?? "").replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "");
    // Resized copies live on Wikimedia's own picture hosts (upload. for originals, thumb. for resized copies).
    if (!ii?.thumburl || !/^https:\/\/(?:upload|thumb)\.wikimedia\.org\//.test(ii.thumburl) || !ii.descriptionurl) continue;
    if (!/^image\/(?:jpeg|png|webp)$/.test(ii.mime ?? "")) continue;
    const w = ii.width ?? 0;
    const h = ii.height ?? 0;
    if (Math.min(w, h) < 700 || Math.max(w, h) < 1200) continue; // sharp enough for a tall card
    const ratio = w / Math.max(h, 1);
    if (ratio < 0.5 || ratio > 2.2) continue; // no panoramas or thin strips
    if (NOT_A_PHOTO.test(title)) continue;
    if (words.length && !words.some((x) => title.toLowerCase().includes(x))) continue; // the title must be about the topic
    out.push({
      url: ii.thumburl,
      credit: plain(ii.extmetadata?.Artist?.value).slice(0, 70) || "Unknown author",
      license: plain(ii.extmetadata?.LicenseShortName?.value) || "see Commons",
      pageUrl: ii.descriptionurl,
      title,
    });
  }
  return out.slice(0, 8);
}

export async function searchPhotos(query: string, ctx: ProviderContext): Promise<Result<Photo[]>> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `filetype:bitmap ${query}`,
    gsrnamespace: "6",
    gsrlimit: "25",
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: "900",
    iiextmetadatafilter: "Artist|LicenseShortName",
  });
  const r = await httpJson<unknown>(ctx, ID, `https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: { "user-agent": ctx.env.CONTACT_USER_AGENT || ctx.env.SEC_USER_AGENT || DEFAULT_USER_AGENT },
    timeoutMs: 15_000,
  });
  if (!r.ok) return r;
  const j = r.value as { error?: unknown; query?: unknown };
  if (j?.error) return schemaDrift(ID, "Commons returned an error for the search");
  return ok(parseCommonsPhotos(j, query));
}
