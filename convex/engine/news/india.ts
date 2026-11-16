/**
 * INDIAN MARKET NEWS: which public feeds we read, and which of their items are worth a place on the page.
 *
 * All of these are free public RSS feeds that the outlets publish for anyone to read. No key is needed. They were tested
 * live on 2026-10-15 with our honest identity (no pretending to be a browser). A feed can change or disappear: the page
 * then shows the others and says one source could not be read.
 *
 * Only a headline, a short summary, the photo link, the time and the link to the outlet's own article are used.
 */
import type { FeedItem } from "../providers/rss.ts";
import type { NewsInput } from "./daily.ts";

export interface IndiaFeed {
  id: string;
  name: string;
  url: string;
  /** A regulator's own notices (RBI, SEBI). Only the important ones are kept. */
  official?: boolean;
}

export const INDIA_FEEDS: IndiaFeed[] = [
  { id: "et", name: "The Economic Times", url: "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms" },
  { id: "mint-markets", name: "Mint", url: "https://www.livemint.com/rss/markets" },
  { id: "mint-companies", name: "Mint", url: "https://www.livemint.com/rss/companies" },
  { id: "bs", name: "Business Standard", url: "https://www.business-standard.com/rss/markets-106.rss" },
  { id: "bl-markets", name: "The Hindu BusinessLine", url: "https://www.thehindubusinessline.com/markets/feeder/default.rss" },
  { id: "bl-economy", name: "The Hindu BusinessLine", url: "https://www.thehindubusinessline.com/economy/feeder/default.rss" },
  { id: "rbi", name: "RBI", url: "https://www.rbi.org.in/pressreleases_rss.xml", official: true },
  { id: "sebi", name: "SEBI", url: "https://www.sebi.gov.in/sebirss.xml", official: true },
];

// Most RBI and SEBI notices are routine paperwork (bond auctions, money-market figures, recovery proceedings against
// individuals). Only notices a reader would care about are kept: policy, rules, penalties on banks, mutual funds, IPOs.
const RBI_ROUTINE = /auction|treasury bills?|underwriting|money market operations|ways and means|state government securities|sovereign gold|weekly statistical|cut-off|issuance calendar|indicative calendar|re-?issue|ombudsman|results of/i;
const RBI_WORTH = /monetary policy|policy rate|repo|\bMPC\b|inflation|liquidity|penalt|licen[cs]e|cancel|forex|reserves|lending|credit|digital rupee|\bUPI\b|payments?|regulat|framework|master direction|directions|draft|circular|governor|\bbanks?\b/i;
const SEBI_WORTH = /board meeting|consultation paper|master circular|circular|framework|regulations?|mutual funds?|\bipo\b|f&o|derivatives|investor|reforms|\bbans?\b/i;
const SEBI_ROUTINE = /recovery|attachment|release of|settlement|adjudication|show cause|demand notice|auction of/i;

/** Is this regulator notice something a reader of market news would want? */
export function officialWorthShowing(feedId: string, title: string): boolean {
  if (feedId === "rbi") return !RBI_ROUTINE.test(title) && RBI_WORTH.test(title);
  if (feedId === "sebi") return !SEBI_ROUTINE.test(title) && SEBI_WORTH.test(title);
  return true;
}

/** One feed item in the shape the news picker takes. Items with no readable time are left out: they cannot be placed in the day. */
export function toNewsInput(feed: IndiaFeed, item: FeedItem, id: number): NewsInput | undefined {
  if (item.publishedAt === undefined) return undefined;
  if (feed.official && !officialWorthShowing(feed.id, item.title)) return undefined;
  return {
    id,
    headline: item.title,
    source: feed.name,
    url: item.link,
    publishedAt: item.publishedAt,
    // A regulator's notice is a long table, not a summary.
    summary: feed.official ? undefined : item.summary,
    image: item.image,
    official: feed.official || undefined,
  };
}
