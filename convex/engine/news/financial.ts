/**
 * IS THIS HEADLINE FINANCIAL NEWS?
 *
 * The market-news feed also carries general news (politics, travel, shipping, sport). Daily news should be about money:
 * markets, companies' results, prices, rates, currencies, deals, and the economy. A headline counts as financial when it
 * holds at least one term from the list below. Plain rules, no AI, so the same headline always gets the same answer
 * and the list can be read and changed.
 *
 * Known limit: a headline about a market-moving event that uses none of these words (for example a plain "Container ship
 * sinks near Hormuz") is left out. That is the safer mistake for a page that promises financial news.
 */

const TERMS = [
  // markets and shares
  "markets?", "stocks?", "shares?", "equit(?:y|ies)", "wall street", "s&p(?: 500)?", "dow(?: jones)?", "nasdaq", "nikkei", "ftse", "dax", "nifty", "sensex", "hang seng", "bourse",
  "rall(?:y|ies|ied)", "selloff", "sell-off", "bull market", "bear market",
  // Indian markets and money
  "crores?", "lakh crores?", "fii", "fiis", "dii", "diis", "gst", "repo(?: rate)?", "sips?", "demat", "nbfcs?", "npas?", "irdai", "sebi", "market cap", "m-cap", "target price", "block deal", "bulk deal", "stock split", "bonus issue", "disinvestment", "divestment", "q[1-4] results", "q[1-4] fy\\d+", "result today", "results today",
  // companies' results and deals
  "earnings", "profits?", "revenues?", "quarterly results", "guidance", "ipo", "merger", "acqui(?:re|res|red|sition|sitions)", "takeover", "buyout", "private equity", "dividends?", "buybacks?", "bankruptcy",
  "offer price", "share price", "stock price", "price (?:cut|cuts|hike|hikes|war)", "bids?", "takeover bids?", "stakes?", "assets?", "investors?", "investments?", "invests?", "analysts?", "price target", "hedge fund", "mutual fund", "etfs?", "funds?",
  // the economy
  "inflation", "deflation", "cpi", "ppi", "gdp", "consumer prices", "producer prices", "jobs report", "payrolls", "unemployment", "jobless", "economy", "economic", "economists?", "recession",
  "retail sales", "housing (?:starts|market|prices)", "manufacturing (?:activity|index|output)", "pmi", "consumer (?:spending|confidence|sentiment)", "trade (?:war|deal|talks|surplus|deficit)", "tariffs?",
  // money, rates and banks
  "interest rates?", "rate (?:cut|cuts|hike|hikes|decision)", "central bank", "federal reserve", "fed", "ecb", "bank of (?:england|japan|canada|india)", "rbi", "boj", "treasur(?:y|ies)", "bonds?", "yields?",
  "debt", "deficit", "budget", "taxes", "tax", "banks?", "lenders?", "loans?", "mortgages?",
  // currencies and commodities
  "dollar", "euro", "yen", "rupee", "yuan", "sterling", "currenc(?:y|ies)", "forex", "oil", "crude", "brent", "opec", "natural gas", "gold", "silver", "copper", "commodit(?:y|ies)", "bitcoin", "crypto",
];

const FINANCIAL = new RegExp(`(?<![A-Za-z])(?:${TERMS.join("|")})(?![A-Za-z])`, "i");

/** Words that mark entertainment, sport and lifestyle pieces, even when a money word appears ("box office profit"). */
const NOT_FINANCIAL = /\b(?:celebrity|movie|film|album|oscars?|grammys?|nfl|nba|mlb|nhl|soccer|football|tennis|golf|recipe|horoscope|royal family|reality tv)\b/i;

export function isFinancial(headline: string, summary?: string): boolean {
  if (NOT_FINANCIAL.test(headline)) return false;
  return FINANCIAL.test(headline) || FINANCIAL.test(summary ?? "");
}
