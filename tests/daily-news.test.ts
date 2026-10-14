import { describe, expect, it } from "vitest";
import { cleanHeadline, pickDailyNews, usefulSummary, DAILY_NEWS } from "../convex/engine/news/daily.ts";
import { isFinancial } from "../convex/engine/news/financial.ts";
import { marketNews, storyImage, type MarketNewsItem } from "../convex/engine/providers/finnhub.ts";
import type { ProviderContext } from "../convex/engine/providers/types.ts";

const NOW = Date.UTC(2026, 9, 14, 14, 0, 0);
const HOUR = 3_600_000;

let id = 0;
const item = (headline: string, hoursAgo: number, source = "Reuters", summary?: string): MarketNewsItem => ({
  id: ++id,
  headline,
  source,
  url: `https://news.example/${id}`,
  publishedAt: NOW - hoursAgo * HOUR,
  summary,
});

// Twelve clearly different financial events, so none of them is grouped with another.
const TOPICS = [
  "Central bank holds interest rates steady citing inflation worries",
  "Oil climbs as pipeline outage tightens supply",
  "Chipmaker shares jump after strong quarterly earnings",
  "Airline stock falls after fuel costs hit profit forecast",
  "Gold hits record high as investors seek safety",
  "Pharmaceutical group agrees takeover of rival drugmaker",
  "Retail sales fall for second month as shoppers cut back",
  "Mining company agrees acquisition of rival copper producer",
  "Housing starts surge to highest level since spring",
  "Electric carmaker shares slide after recall over braking software",
  "Dollar slips against yen as Treasury yields retreat",
  "Bank profits beat estimates as loan demand improves",
];
const many = (n: number, hoursAgo = 2) => TOPICS.slice(0, n).map((t, i) => item(t, hoursAgo + i * 0.3));

describe("tidying a headline", () => {
  it("cuts the outlet name from the end", () => {
    expect(cleanHeadline("Gulf markets mixed - Reuters", "Reuters")).toBe("Gulf markets mixed");
    expect(cleanHeadline("Gulf markets mixed | CNBC", "CNBC")).toBe("Gulf markets mixed");
    expect(cleanHeadline("Stocks rally – Bloomberg.com", "Bloomberg")).toBe("Stocks rally");
  });
  it("leaves a headline alone when the ending is not an outlet", () => {
    expect(cleanHeadline("Oil rises - and so does gas", "Reuters")).toBe("Oil rises - and so does gas");
  });
  it("never returns an empty headline", () => {
    expect(cleanHeadline("- Reuters", "Reuters").length).toBeGreaterThan(0);
  });
  it("drops a summary that only repeats the headline", () => {
    expect(usefulSummary("Gulf markets mixed; Saudi stocks hardest hit on Aramco attack  Reuters", "Gulf markets mixed; Saudi stocks hardest hit on Aramco attack")).toBeUndefined();
    expect(usefulSummary("short", "x")).toBeUndefined();
  });
  it("keeps a summary that adds detail", () => {
    const s = "Delta is replacing its business-class seats on long-haul jets with new suites, adding new menus and tableware and a fleet of Porsche cars for airport transfers.";
    expect(usefulSummary(s, "Delta's business-class revamp: New seats, menus, plates and more Porsches")).toBe(s);
  });
});

describe("picking the day's stories", () => {
  it("returns at most 10, newest first", () => {
    const r = pickDailyNews(many(12), NOW);
    expect(r.items).toHaveLength(DAILY_NEWS.max);
    const times = r.items.map((i) => i.publishedAt);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(r.windowHours).toBe(24);
  });
  it("shows fewer when there are fewer, as long as there are at least 5", () => {
    expect(pickDailyNews(many(6), NOW).items).toHaveLength(6);
  });
  it("ignores anything older than 24 hours while there are enough recent stories", () => {
    const r = pickDailyNews([...many(6), item("An old story about interest rates long ago", 30)], NOW);
    expect(r.items).toHaveLength(6);
    expect(r.items.some((i) => /old story/.test(i.headline))).toBe(false);
  });
  it("looks further back when the last 24 hours have fewer than 5 stories", () => {
    const r = pickDailyNews([...many(3, 2), ...TOPICS.slice(3, 8).map((t) => item(t, 30))], NOW);
    expect(r.windowHours).toBe(48);
    expect(r.items.length).toBeGreaterThanOrEqual(5);
  });
  it("tells the truth when even 72 hours holds fewer than 5", () => {
    const r = pickDailyNews(many(2), NOW);
    expect(r.items).toHaveLength(2);
    expect(r.windowHours).toBe(72);
  });
  it("one event is one line, and the other outlets are listed under it", () => {
    const a = item("Saudi Aramco shares fall after attack damages headquarters, sources say - Reuters", 3, "Reuters");
    const b = item("Saudi Aramco shares fall after attack damages headquarters, sources say - Bloomberg", 2, "Bloomberg");
    const r = pickDailyNews([a, b, ...many(6)], NOW);
    const aramco = r.items.filter((i) => /Aramco shares/.test(i.headline));
    expect(aramco).toHaveLength(1);
    expect(aramco[0]!.alsoBy).toHaveLength(1);
  });
  it("ignores items dated in the future", () => {
    const r = pickDailyNews([...many(6), item("A story from tomorrow about interest rates", -5)], NOW);
    expect(r.items.some((i) => /tomorrow/.test(i.headline))).toBe(false);
  });
  it("an empty feed gives an empty list", () => {
    expect(pickDailyNews([], NOW)).toEqual({ items: [], windowHours: 72 });
  });
});

describe("reading the Finnhub feed", () => {
  const ctx = (body: unknown, status = 200, env: Record<string, string> = { FINNHUB_API_KEY: "k" }): ProviderContext => ({
    fetch: (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as typeof fetch,
    now: () => NOW,
    env,
  });
  it("keeps good items and drops broken ones", async () => {
    const r = await marketNews("general", ctx([
      { id: 1, headline: "Good one", source: "Reuters", url: "https://x.example/1", datetime: 1_700_000_000, summary: "s" },
      { id: 2, headline: "", source: "Reuters", url: "https://x.example/2", datetime: 1_700_000_000 },
      { id: 3, headline: "No link", source: "Reuters", url: "javascript:alert(1)", datetime: 1_700_000_000 },
      { id: 4, headline: "No time", source: "Reuters", url: "https://x.example/4" },
    ]));
    expect(r.ok && r.value.map((i) => i.id)).toEqual([1]);
    expect(r.ok && r.value[0]!.publishedAt).toBe(1_700_000_000_000);
  });
  it("needs a key", async () => {
    const r = await marketNews("general", ctx([], 200, {}));
    expect(!r.ok && r.error.kind).toBe("AUTH");
  });
  it("notices a changed format", async () => {
    const r = await marketNews("general", ctx({ not: "a list" }));
    expect(!r.ok && r.error.kind).toBe("SCHEMA_DRIFT");
  });
  it("reports a rate limit", async () => {
    const r = await marketNews("general", ctx("", 429));
    expect(!r.ok && r.error.kind).toBe("RATE_LIMITED");
  });
});

describe("story pictures", () => {
  it("accepts a normal https picture", () => {
    expect(storyImage("https://image.example.com/a/b.jpeg?w=1920")).toBe("https://image.example.com/a/b.jpeg?w=1920");
  });
  it("never treats an outlet logo as a picture of the story", () => {
    expect(storyImage("https://static2.finnhub.io/file/finnhub/logo/reuters_logo.jpeg")).toBeUndefined();
  });
  it("refuses links that are not https, are not text, or are far too long", () => {
    expect(storyImage("http://image.example.com/a.jpg")).toBeUndefined();
    expect(storyImage("javascript:alert(1)")).toBeUndefined();
    expect(storyImage(undefined)).toBeUndefined();
    expect(storyImage(42)).toBeUndefined();
    expect(storyImage(`https://x.example/${"a".repeat(700)}`)).toBeUndefined();
  });
  it("keeps the picture through the picking step", () => {
    const withPic = { ...item("Airline shares jump on record aircraft order", 2, "CNBC"), image: "https://image.example.com/p.jpg" };
    const r = pickDailyNews([withPic, ...many(5, 3).filter((i) => !/Airline/.test(i.headline))], NOW);
    expect(r.items.find((i) => /Airline shares jump/.test(i.headline))?.image).toBe("https://image.example.com/p.jpg");
  });
  it("a story with no picture has none", () => {
    expect(pickDailyNews(many(6), NOW).items.every((i) => i.image === undefined)).toBe(true);
  });
});

describe("financial news only", () => {
  const feed = (headline: string, hoursAgo = 2) => item(headline, hoursAgo);
  it("keeps stories about markets, results, prices, rates, currencies and deals", () => {
    for (const h of [
      "Stocks rally as inflation cools",
      "US consumer prices accelerate in September; core CPI firmer",
      "Oil prices steady after gains",
      "Bank of America fined $1.2 billion over suspicious transactions",
      "Tata Motors raises offer price for Iveco",
      "Rupee falls against the dollar",
      "India's wholesale inflation rises faster than expected",
    ]) expect(isFinancial(h), h).toBe(true);
  });
  it("leaves out politics, travel, shipping and other non-financial stories", () => {
    for (const h of [
      "Netanyahu says he is not seeking to attack Iran again before Israel election",
      "Delta's business-class revamp: New seats, menus, plates and more Porsches",
      "Ohio's working-class voters rethink support for Trump and the Republican Party",
      "Container ship sinks near Hormuz after being hit by projectile, sources say",
    ]) expect(isFinancial(h), h).toBe(false);
  });
  it("a sport or film piece is not financial even with a money word in it", () => {
    expect(isFinancial("Film breaks box office record with record profit")).toBe(false);
  });
  it("matches whole words only", () => {
    expect(isFinancial("The federation of ferries shuffles timetables")).toBe(false); // "fed" inside another word
    expect(isFinancial("Fed holds rates")).toBe(true);
  });
  it("the daily list drops non-financial stories", () => {
    const r = pickDailyNews([feed("Netanyahu says he is not seeking to attack Iran again"), feed("Delta's business-class revamp brings new seats"), ...many(6)], NOW);
    expect(r.items.some((i) => /Netanyahu|Delta/.test(i.headline))).toBe(false);
    expect(r.items).toHaveLength(6);
  });
  it("looks further back when too few stories are financial", () => {
    const r = pickDailyNews([feed("Netanyahu speaks"), feed("Ohio voters rethink"), ...many(2), ...TOPICS.slice(4, 9).map((t) => item(t, 30))], NOW);
    expect(r.windowHours).toBe(48);
  });
});

describe("logos are not photos", () => {
  const withImage = (headline: string, image: string) => ({ ...item(headline, 2), image });
  it("a picture shared by several stories is dropped", () => {
    const shared = "https://cdn.example.com/outlet_logo.png";
    const r = pickDailyNews([withImage(TOPICS[0]!, shared), withImage(TOPICS[1]!, shared), withImage(TOPICS[2]!, shared), ...many(6).slice(3)], NOW);
    expect(r.items.every((i) => i.image === undefined)).toBe(true);
  });
  it("a picture used once is kept", () => {
    const r = pickDailyNews([withImage(TOPICS[0]!, "https://cdn.example.com/a.jpg"), withImage(TOPICS[1]!, "https://cdn.example.com/b.jpg"), ...many(6).slice(2)], NOW);
    expect(r.items.filter((i) => i.image).length).toBe(2);
  });
});
