import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DAILY_NEWS, limitPerSource, pickDailyNews, type DailyNewsItem, type NewsInput } from "../convex/engine/news/daily.ts";
import { isFinancial } from "../convex/engine/news/financial.ts";
import { INDIA_FEEDS, officialWorthShowing, toNewsInput } from "../convex/engine/news/india.ts";
import { topicFor } from "../convex/engine/news/topic.ts";
import { decodeEntities, feedImage, fetchFeed, parseFeed, parseFeedDate, plainText } from "../convex/engine/providers/rss.ts";
import type { ProviderContext } from "../convex/engine/providers/types.ts";

// Real feed samples saved on 2026-10-15 (three items each), so these tests run without the network.
const sample = (id: string) => readFileSync(new URL(`./fixtures/rss/${id}.xml`, import.meta.url), "utf8");
const NOW = Date.parse("2026-10-15T10:00:00Z");
const HOUR = 3_600_000;

describe("reading real Indian feeds", () => {
  it("reads every sample and finds the stories", () => {
    for (const id of ["et", "mint", "bs", "bl", "rbi", "sebi"]) expect(parseFeed(sample(id)).length, id).toBe(3);
  });
  it("reads titles, links and times (including CDATA)", () => {
    const [first] = parseFeed(sample("mint"));
    expect(first!.title).toContain("Yes Bank share price crash");
    expect(first!.link).toMatch(/^https:\/\/www\.livemint\.com\//);
    expect(first!.publishedAt).toBe(Date.parse("2026-10-15T09:21:42Z"));
  });
  it("finds each outlet's own photo, wherever it keeps it", () => {
    expect(parseFeed(sample("et"))[0]!.image).toMatch(/^https:\/\/img\.etimg\.com\//); // <enclosure>
    expect(parseFeed(sample("mint"))[0]!.image).toMatch(/^https:\/\/www\.livemint\.com\/lm-img\//); // <media:content>
    expect(parseFeed(sample("bs"))[0]!.image).toMatch(/^https:\/\/bsmedia\.business-standard\.com\//);
  });
  it("a story with no photo has none", () => {
    expect(parseFeed(sample("rbi"))[0]!.image).toBeUndefined();
  });
  it("decodes symbols in titles (the rupee sign)", () => {
    expect(parseFeed(sample("rbi"))[0]!.title).toContain("₹34,000 crore");
  });
  it("reads SEBI's unusual date format", () => {
    const dated = parseFeed(sample("sebi")).filter((i) => i.publishedAt !== undefined);
    expect(dated.length).toBe(3);
    expect(new Date(dated[0]!.publishedAt!).getUTCFullYear()).toBe(2026);
  });
  it("strips the HTML out of a summary", () => {
    for (const id of ["et", "mint", "bs", "bl"]) for (const i of parseFeed(sample(id))) expect(i.summary ?? "", id).not.toMatch(/<[a-z]/i);
  });
});

describe("feed building blocks", () => {
  it("decodes entities", () => {
    expect(decodeEntities("A &amp; B &#8377;5 &#x20B9;5 &nbsp;&unknown;")).toBe("A & B ₹5 ₹5  &unknown;");
  });
  it("makes plain text from HTML", () => {
    expect(plainText("<p>Hello <b>world</b></p>  &amp; more")).toBe("Hello world & more");
  });
  it("reads the date formats feeds use, and refuses what it cannot read", () => {
    expect(parseFeedDate("Thu, 15 Oct 2026 14:51:42 +0530")).toBe(Date.parse("2026-10-15T09:21:42Z"));
    expect(parseFeedDate("14 Oct, 2026 +0530")).toBe(Date.parse("2026-10-13T18:30:00Z"));
    expect(parseFeedDate("2026-10-15T09:00:00Z")).toBe(Date.parse("2026-10-15T09:00:00Z"));
    expect(parseFeedDate("sometime soon")).toBeUndefined();
    expect(parseFeedDate(undefined)).toBeUndefined();
  });
  it("accepts a photo only if it is https and not a logo or icon", () => {
    expect(feedImage('<item><media:content url="https://a.example/p/photo.jpg" medium="image"/></item>')).toBe("https://a.example/p/photo.jpg");
    expect(feedImage('<item><media:content url="http://a.example/photo.jpg" medium="image"/></item>')).toBeUndefined();
    expect(feedImage('<item><media:content url="https://a.example/logo.png" medium="image"/></item>')).toBeUndefined();
    expect(feedImage('<item><media:content url="https://a.example/clip.mp4" medium="video"/></item>')).toBeUndefined();
    expect(feedImage('<item><media:thumbnail url="https://a.example/t.jpg"/></item>')).toBe("https://a.example/t.jpg");
    expect(feedImage('<item><description><![CDATA[<img src="https://a.example/in-text.jpg"> words]]></description></item>')).toBe("https://a.example/in-text.jpg");
  });
  it("skips items with no title or no web link, and reads Atom feeds too", () => {
    const xml = `<rss><channel>
      <item><title>No link here</title></item>
      <item><link>https://a.example/x</link></item>
      <item><title>Bad link</title><link>javascript:alert(1)</link></item>
      <item><title>Good one</title><link>https://a.example/good</link></item>
    </channel></rss>`;
    expect(parseFeed(xml).map((i) => i.title)).toEqual(["Good one"]);
    const atom = `<feed><entry><title>Atom story</title><link href="https://a.example/atom"/><updated>2026-10-15T09:00:00Z</updated></entry></feed>`;
    expect(parseFeed(atom)).toMatchObject([{ title: "Atom story", link: "https://a.example/atom" }]);
  });
  it("drops a summary that is only a few words", () => {
    expect(parseFeed("<rss><item><title>T</title><link>https://a.example/1</link><description>short</description></item></rss>")[0]!.summary).toBeUndefined();
  });
});

describe("downloading a feed", () => {
  const ctx = (body: string, status = 200): ProviderContext => ({ fetch: (async () => new Response(body, { status })) as typeof fetch, now: () => NOW, env: {} });
  it("reads a good feed", async () => {
    const r = await fetchFeed("feed-x", "https://x.example/rss", ctx(sample("bs")), "test agent");
    expect(r.ok && r.value.length).toBe(3);
  });
  it("sends our identity, not a disguise", async () => {
    let agent = "";
    const c: ProviderContext = { fetch: (async (_u: string, init?: RequestInit) => ((agent = String((init?.headers as Record<string, string>)["user-agent"])), new Response(sample("bs")))) as typeof fetch, now: () => NOW, env: {} };
    await fetchFeed("feed-x", "https://x.example/rss", c, "Verifin student research project");
    expect(agent).toBe("Verifin student research project");
  });
  it("a refused request is reported", async () => {
    const r = await fetchFeed("feed-x", "https://x.example/rss", ctx("no", 403), "a");
    expect(!r.ok && r.error.kind).toBe("AUTH");
  });
  it("a web page where a feed should be is reported, not guessed at", async () => {
    const r = await fetchFeed("feed-x", "https://x.example/rss", ctx("<!doctype html><html><body>Not found</body></html>"), "a");
    expect(!r.ok && r.error.kind).toBe("SCHEMA_DRIFT");
  });
  it("an empty but real feed is fine", async () => {
    const r = await fetchFeed("feed-x", "https://x.example/rss", ctx('<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>'), "a");
    expect(r.ok && r.value).toEqual([]);
  });
});

describe("which official notices are worth showing", () => {
  it("drops routine RBI paperwork and keeps policy and rules", () => {
    expect(officialWorthShowing("rbi", "Underwriting Auction for sale of Government Security for ₹34,000 crore")).toBe(false);
    expect(officialWorthShowing("rbi", "Money Market Operations as on October 14, 2026")).toBe(false);
    expect(officialWorthShowing("rbi", "RBI imposes monetary penalty on a cooperative bank")).toBe(true);
    expect(officialWorthShowing("rbi", "Monetary Policy Statement, 2026-27: policy repo rate unchanged")).toBe(true);
  });
  it("drops SEBI's case-by-case enforcement and keeps rules and reforms", () => {
    expect(officialWorthShowing("sebi", "Release of attachment on immovable property under RC No. 3965 of 2021")).toBe(false);
    expect(officialWorthShowing("sebi", "SEBI issues master circular for mutual funds")).toBe(true);
    expect(officialWorthShowing("sebi", "Consultation paper on the framework for IPO pricing")).toBe(true);
  });
  it("other feeds are not filtered by these lists", () => {
    expect(officialWorthShowing("et", "anything")).toBe(true);
  });
});

describe("turning feed items into news", () => {
  const rbi = INDIA_FEEDS.find((f) => f.id === "rbi")!;
  const mint = INDIA_FEEDS.find((f) => f.id === "mint-markets")!;
  it("an item with no readable time is left out", () => {
    expect(toNewsInput(mint, { title: "Sensex jumps", link: "https://a.example/1" }, 1)).toBeUndefined();
  });
  it("a regulator notice keeps the 'official' mark and drops its long table", () => {
    const n = toNewsInput(rbi, { title: "RBI imposes monetary penalty on a bank", link: "https://rbi.example/1", publishedAt: NOW, summary: "a very long table of numbers and words that is not a summary" }, 1);
    expect(n).toMatchObject({ source: "RBI", official: true });
    expect(n!.summary).toBeUndefined();
  });
  it("a routine regulator notice is left out", () => {
    expect(toNewsInput(rbi, { title: "Auction of Treasury Bills", link: "https://rbi.example/2", publishedAt: NOW }, 1)).toBeUndefined();
  });
  it("every feed we use is a public https address", () => {
    for (const f of INDIA_FEEDS) expect(f.url, f.id).toMatch(/^https:\/\//);
    expect(new Set(INDIA_FEEDS.map((f) => f.id)).size).toBe(INDIA_FEEDS.length);
  });
});

describe("the Indian list from the real samples", () => {
  const all = (): NewsInput[] => {
    const out: NewsInput[] = [];
    for (const f of INDIA_FEEDS) {
      const id = f.id.startsWith("mint") ? "mint" : f.id.startsWith("bl") ? "bl" : f.id;
      for (const item of parseFeed(sample(id))) {
        const n = toNewsInput(f, item, out.length);
        if (n) out.push(n);
      }
    }
    return out;
  };
  it("builds a list of financial stories from the outlets", () => {
    const r = pickDailyNews(all(), NOW, { maxPerSource: 3 });
    expect(r.items.length).toBeGreaterThanOrEqual(5);
    expect(r.items.length).toBeLessThanOrEqual(DAILY_NEWS.max);
    expect(r.windowHours).toBe(24);
    expect(r.items.some((i) => /Yes Bank/.test(i.headline))).toBe(true);
  });
  it("is newest first", () => {
    const t = pickDailyNews(all(), NOW).items.map((i) => i.publishedAt);
    expect([...t].sort((a, b) => b - a)).toEqual(t);
  });
  it("leaves out the routine RBI auction", () => {
    expect(pickDailyNews(all(), NOW).items.some((i) => /Underwriting Auction/.test(i.headline))).toBe(false);
  });
  it("Indian money words count as financial", () => {
    for (const h of ["Sensex jumps 1,400 pts, Nifty crosses 25,000", "Q2 Results Today: Wipro, HDFC AMC to announce", "FIIs sell ₹2,300 crore of shares", "Govt eyes GST relief for insurers", "IDBI Bank stake sale to push divestment to 8-year high"]) expect(isFinancial(h), h).toBe(true);
    expect(isFinancial("Bollywood film breaks box office record")).toBe(false);
  });
});

describe("one outlet cannot fill the list", () => {
  const story = (source: string, n: number, mins: number): DailyNewsItem => ({ headline: `${source} story ${n}`, source, url: `https://x.example/${source}/${n}`, publishedAt: NOW - mins * 60_000, alsoBy: [] });
  it("keeps at most the cap from each outlet, newest first", () => {
    const items = [
      ...Array.from({ length: 6 }, (_, i) => story("Mint", i, i)),
      ...Array.from({ length: 5 }, (_, i) => story("Business Standard", i, 10 + i)),
      ...Array.from({ length: 5 }, (_, i) => story("BusinessLine", i, 20 + i)),
      ...Array.from({ length: 3 }, (_, i) => story("The Economic Times", i, 30 + i)),
    ];
    const out = limitPerSource(items, 3);
    expect(out.length).toBeGreaterThanOrEqual(10);
    expect(out.filter((i) => i.source === "The Economic Times").length).toBe(3);
    expect(out.filter((i) => i.source === "Mint").length).toBe(3);
    expect(out.filter((i) => i.source === "Business Standard").length).toBe(3);
    expect(out.filter((i) => i.source === "BusinessLine").length).toBe(3);
  });
  it("brings stories back when there are too few from other outlets", () => {
    const items = Array.from({ length: 8 }, (_, i) => story("Mint", i, i));
    expect(limitPerSource(items, 3)).toHaveLength(8);
  });
  it("without a cap the list is unchanged", () => {
    const feed: NewsInput[] = Array.from({ length: 8 }, (_, i) => ({ id: i, headline: `Stocks rally number ${i} on strong earnings ${"x".repeat(i)}`, source: "Mint", url: `https://x.example/${i}`, publishedAt: NOW - i * 5 * 60_000 }));
    expect(pickDailyNews(feed, NOW).items.length).toBeGreaterThanOrEqual(1);
  });
});

describe("photos fit the country", () => {
  it("an Indian market story gets an Indian market photo, not the New York Stock Exchange", () => {
    expect(topicFor("Stocks rally on strong earnings").id).toBe("stocks");
    expect(topicFor("Stocks rally on strong earnings", "india").id).toBe("india-market");
    expect(topicFor("Some story with no clue in it", "india").id).toBe("india-market");
  });
  it("named Indian organisations get their own photos", () => {
    expect(topicFor("SBI raises lending rates", "india").id).toBe("sbi");
    expect(topicFor("HDFC Bank Q2 profit rises", "india").id).toBe("hdfc");
    expect(topicFor("SEBI tightens IPO rules", "india").id).toBe("sebi");
  });
  it("short names match whole words only", () => {
    expect(topicFor("Public sector banks gain").id).not.toBe("lic");
    expect(topicFor("LIC shares jump").id).toBe("lic");
  });
});
