/**
 * WHICH PHOTO FITS THIS STORY?
 *
 * News feeds for Reuters and Bloomberg come without a photo of the event, so each story gets an ILLUSTRATIVE photo that
 * matches its subject: a stock exchange for a market story, a refinery for an oil story, a central bank building for a
 * rates story. Plain word rules, checked in order: the first rule that matches decides. Specific names (a company, a
 * central bank) come before broad subjects (oil, inflation), and "stock market" is the last resort.
 *
 * Each rule lists a few searches. The first gives the best match; the next ones give other photos of the same subject,
 * so two oil stories on one page do not get the same picture.
 */

export interface Topic {
  id: string;
  /** Photo searches, best first. */
  queries: string[];
}

interface Rule extends Topic {
  test: RegExp;
}

const RULES: Rule[] = [
  // ---- named organisations ----
  { id: "aramco", test: /aramco|saudi/i, queries: ["Saudi Aramco", "Ras Tanura refinery", "Riyadh skyline"] },
  { id: "imf", test: /\bimf\b|international monetary fund|world bank/i, queries: ["International Monetary Fund headquarters", "World Bank headquarters Washington"] },
  { id: "opec", test: /\bopec\b/i, queries: ["OPEC headquarters Vienna", "oil refinery"] },
  { id: "fed", test: /\bfed\b|federal reserve|powell/i, queries: ["Eccles Federal Reserve Building", "Federal Reserve Bank building"] },
  { id: "ecb", test: /\becb\b|european central bank|lagarde/i, queries: ["European Central Bank Frankfurt", "Frankfurt skyline"] },
  { id: "boj", test: /\bboj\b|bank of japan/i, queries: ["Bank of Japan headquarters", "Tokyo skyline"] },
  { id: "boe", test: /\bboe\b|bank of england/i, queries: ["Bank of England building", "City of London skyline"] },
  { id: "rbi", test: /\brbi\b|reserve bank of india/i, queries: ["Reserve Bank of India", "Mumbai skyline"] },
  { id: "bofa", test: /bank of america/i, queries: ["Bank of America Tower", "Bank of America branch"] },
  { id: "jpm", test: /jpmorgan|jp morgan/i, queries: ["JPMorgan Chase headquarters", "383 Madison Avenue"] },
  { id: "goldman", test: /goldman sachs/i, queries: ["Goldman Sachs headquarters", "200 West Street"] },
  { id: "meta", test: /\bmeta\b|facebook|instagram/i, queries: ["Meta Platforms Headquarters Menlo Park", "Facebook campus Menlo Park"] },
  { id: "apple", test: /\bapple\b|iphone/i, queries: ["Apple Park Cupertino", "Apple Store"] },
  { id: "microsoft", test: /microsoft/i, queries: ["Microsoft headquarters Redmond", "Microsoft campus"] },
  { id: "google", test: /google|alphabet/i, queries: ["Googleplex Mountain View", "Google campus"] },
  { id: "amazon", test: /\bamazon\b/i, queries: ["Amazon headquarters Seattle", "Amazon fulfillment center"] },
  { id: "nvidia", test: /nvidia/i, queries: ["Nvidia headquarters Santa Clara", "graphics card"] },
  { id: "tesla", test: /tesla/i, queries: ["Tesla Gigafactory", "Tesla Model 3"] },
  { id: "tata", test: /\btata\b/i, queries: ["Tata Motors", "Tata Motors factory"] },
  { id: "reliance", test: /reliance/i, queries: ["Reliance Industries", "Jamnagar refinery"] },
  { id: "infosys", test: /infosys/i, queries: ["Infosys campus", "Infosys Bangalore"] },
  { id: "sbi", test: /\bsbi\b|state bank of india/i, queries: ["State Bank of India headquarters Mumbai", "State Bank of India branch"] },
  { id: "hdfc", test: /hdfc/i, queries: ["HDFC Bank branch", "HDFC Bank"] },
  { id: "icici", test: /icici/i, queries: ["ICICI Bank branch", "ICICI Bank"] },
  { id: "adani", test: /adani/i, queries: ["Adani Group", "Mundra port"] },
  { id: "lic", test: /\blic\b|life insurance corporation/i, queries: ["Life Insurance Corporation of India", "LIC building Mumbai"] },
  { id: "sebi", test: /\bsebi\b|securities and exchange board of india/i, queries: ["Securities and Exchange Board of India", "SEBI Bhavan Mumbai"] },

  // ---- broad subjects ----
  { id: "india-market", test: /nifty|sensex|\bbse\b|\bnse\b|dalal street/i, queries: ["Bombay Stock Exchange building", "Dalal Street Mumbai"] },
  { id: "japan-market", test: /nikkei|tokyo stock/i, queries: ["Tokyo Stock Exchange", "Tokyo skyline"] },
  { id: "uk-market", test: /\bftse\b|london stock/i, queries: ["London Stock Exchange", "City of London skyline"] },
  { id: "central-bank", test: /central bank|interest rate|rate (?:cut|hike|decision)|monetary policy/i, queries: ["central bank building", "Federal Reserve Bank building", "bank building"] },
  { id: "inflation", test: /inflation|consumer prices|producer prices|\bcpi\b|\bppi\b|cost of living/i, queries: ["supermarket shelves", "grocery store aisle", "gas station prices"] },
  { id: "oil", test: /\boil\b|crude|brent|gasoline|petrol|natural gas|tanker|refiner/i, queries: ["oil refinery", "oil tanker ship", "oil pumpjack"] },
  { id: "gold", test: /\bgold\b|silver|bullion/i, queries: ["gold bars", "gold bullion", "silver bars"] },
  { id: "mining", test: /mining|\bmines?\b|copper|lithium|iron ore|miner\b/i, queries: ["open-pit mine", "copper mine", "mining truck"] },
  { id: "currency", test: /\bdollar\b|\beuro\b|\byen\b|rupee|yuan|sterling|currenc|forex/i, queries: ["banknotes", "currency exchange", "coins and banknotes"] },
  { id: "debt", test: /\bdebt\b|bond|yields?\b|treasur|deficit|budget|sovereign/i, queries: ["United States Department of the Treasury building", "Treasury building Washington"] },
  { id: "bank", test: /\bbanks?\b|lender|loan|mortgage|fined|fine\b|bailout/i, queries: ["bank building", "bank branch", "bank headquarters"] },
  { id: "housing", test: /housing|home sales|real estate|property market|mortgage/i, queries: ["suburban houses", "apartment buildings", "housing construction"] },
  { id: "trade", test: /tariff|trade (?:war|deal|talks)|shipping|\bport\b|exports?|imports?|container/i, queries: ["container terminal", "port cranes containers", "cargo ship"] },
  { id: "tech", test: /\bai\b|artificial intelligence|chip|semiconductor|software|cloud|data cent/i, queries: ["data center servers", "semiconductor wafer", "server room"] },
  { id: "airline", test: /airline|airways|aircraft|boeing|airbus|aviation/i, queries: ["airliner airport", "Boeing 737", "Airbus A320"] },
  { id: "auto", test: /carmaker|automaker|\bev\b|electric vehicle|car sales|vehicles?\b/i, queries: ["car factory assembly line", "electric car charging", "car dealership"] },
  { id: "pharma", test: /pharma|drugmaker|\bdrugs?\b|vaccine|biotech/i, queries: ["pharmaceutical laboratory", "pharmaceutical factory", "pills"] },
  { id: "retail", test: /retail|retailer|shoppers|consumer spending|consumer confidence/i, queries: ["shopping mall", "department store", "shopping street"] },
  { id: "jobs", test: /\bjobs?\b|payrolls|unemployment|layoffs?|hiring|workers/i, queries: ["office workers", "factory workers", "job fair"] },
  { id: "deal", test: /merger|acqui|takeover|buyout|\bipo\b|offer price|\bbid\b|deal\b/i, queries: ["business district skyline", "skyscrapers", "corporate headquarters building"] },
  { id: "stocks", test: /stocks?|shares?|equit|wall street|earnings|\bmarkets?\b|s&p|nasdaq|\bdow\b|rall(?:y|ies)|selloff/i, queries: ["New York Stock Exchange", "Wall Street", "stock exchange trading floor"] },
];

const FALLBACK: Topic = { id: "finance", queries: ["financial district skyline", "business district skyline", "skyscrapers"] };

const INDIA_MARKET = RULES.find((r) => r.id === "india-market")!;

/**
 * `region` says where the story is from. For an Indian story, a plain "stock market" or unknown subject gets an Indian
 * market photo (the Bombay Stock Exchange), not the New York Stock Exchange.
 */
export function topicFor(headline: string, region?: "india"): Topic {
  for (const r of RULES) {
    if (!r.test.test(headline)) continue;
    if (region === "india" && r.id === "stocks") return { id: INDIA_MARKET.id, queries: INDIA_MARKET.queries };
    return { id: r.id, queries: r.queries };
  }
  return region === "india" ? { id: INDIA_MARKET.id, queries: INDIA_MARKET.queries } : FALLBACK;
}
