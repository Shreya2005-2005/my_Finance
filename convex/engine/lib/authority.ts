/**
 * Decides how much to trust a publisher (see AUTHORITY_SCORE in config/engine.ts).
 * A simple, readable list. Extend it as we meet new publishers.
 *
 * Two separate questions are answered here:
 *   classifyPublisher  how authoritative is the publisher?   (primary / wire / trade / unknown)
 *   isWeakSource       is it the kind of place that is NOT news at all (social posts, forums, video)?
 */
import type { AuthorityTier } from "../enums.ts";

const PRIMARY = /\b(bse|nse|sebi|rbi|sec\.gov|edgar|ministry|government|press information bureau|pib|company filing|annual report|investor relations)\b/i;
const WIRE =
  /\b(reuters|bloomberg|associated press|\bap\b|pti|press trust|ians|business standard|economic times|et markets|et now|et auto|mint|livemint|the hindu|businessline|financial express|cnbc|cnbc-?tv18|moneycontrol|ndtv|ndtv profit|the times of india|times of india|hindustan times|ht auto|india today|firstpost|fortune india|forbes india|the new indian express|deccan herald|the print|financial times|wall street journal|wsj|forbes|barron'?s|the economist|business today|scroll\.in)\b/i;
const TRADE =
  /\b(trendlyne|screener|tickertape|groww|zerodha|angel one|motilal|icici securities|kotak securities|outlook business|inc42|yourstory|autocar|zigwheels|rushlane|siasat|benzinga|investing\.com|seeking alpha|marketwatch|yahoo finance|the motley fool|bw auto world|bw businessworld|storyboard18|manufacturing today|kalkine|goodreturns|simply wall st)\b/i;

/** Social posts, video, forums and blogs: not news reporting, however busy they are. */
const WEAK =
  /\b(instagram|facebook|youtube|tiktok|x\.com|twitter|reddit|quora|pinterest|linkedin|telegram|whatsapp|team-bhp|forum|blogspot|wordpress|medium\.com|substack|stocktwits)\b/i;

export function classifyPublisher(publisher?: string, host?: string): AuthorityTier {
  const text = `${publisher ?? ""} ${host ?? ""}`;
  if (PRIMARY.test(text)) return "primary";
  if (WIRE.test(text)) return "wire";
  if (TRADE.test(text)) return "trade";
  return "unknown";
}

export function isWeakSource(publisher?: string, host?: string): boolean {
  return WEAK.test(`${publisher ?? ""} ${host ?? ""}`);
}

/** Friendly names for the websites a search may return, so users see "Reuters" and not "www.reuters.com". */
const HOST_NAMES: Array<[RegExp, string]> = [
  [/reuters\.com$/, "Reuters"],
  [/bloomberg\.com$/, "Bloomberg"],
  [/auto\.economictimes\.indiatimes\.com$/, "ET Auto"],
  [/economictimes\.indiatimes\.com$/, "The Economic Times"],
  [/livemint\.com$/, "Mint"],
  [/business-standard\.com$/, "Business Standard"],
  [/moneycontrol\.com$/, "Moneycontrol"],
  [/thehindu\.com$/, "The Hindu"],
  [/thehindubusinessline\.com$/, "BusinessLine"],
  [/financialexpress\.com$/, "Financial Express"],
  [/ndtv\.com$/, "NDTV"],
  [/ndtvprofit\.com$/, "NDTV Profit"],
  [/cnbctv18\.com$/, "CNBC-TV18"],
  [/timesofindia\.indiatimes\.com$/, "The Times of India"],
  [/hindustantimes\.com$/, "Hindustan Times"],
  [/indiatoday\.in$/, "India Today"],
  [/firstpost\.com$/, "Firstpost"],
  [/forbesindia\.com$/, "Forbes India"],
  [/businesstoday\.in$/, "Business Today"],
  [/instagram\.com$/, "Instagram"],
  [/facebook\.com$/, "Facebook"],
  [/youtube\.com$/, "YouTube"],
  [/team-bhp\.com$/, "Team-BHP"],
  [/reddit\.com$/, "Reddit"],
];

export function publisherFromHost(host: string): string {
  const h = host.replace(/^www\./, "").toLowerCase();
  for (const [re, name] of HOST_NAMES) if (re.test(h)) return name;
  return h;
}

/** The outlets we ask the web search to prefer. Order is not important. */
export const TRUSTED_OUTLET_SITES = [
  "reuters.com",
  "economictimes.indiatimes.com",
  "livemint.com",
  "business-standard.com",
  "moneycontrol.com",
  "thehindu.com",
  "thehindubusinessline.com",
  "financialexpress.com",
  "cnbctv18.com",
  "ndtvprofit.com",
];
