/**
 * Tests for grouping headlines into stories, trust labels and verbatim quotes.
 * The grouping tests use 200 REAL headlines saved from Google News (Tata Motors and Reliance Industries),
 * so they check behaviour on real, messy wording, not made-up examples.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyPublisher, isWeakSource, publisherFromHost } from "../convex/engine/lib/authority.ts";
import { cleanPageTitle, firecrawlSearch, looksLikeQuotePage } from "../convex/engine/providers/firecrawl.ts";
import type { ProviderContext } from "../convex/engine/providers/types.ts";
import { buildStories, quoteFrom, trustLabel, type StoryItem } from "../convex/engine/watch/stories.ts";

const raw: Array<{ company: string; title: string; publisher?: string; pubDate?: string }> = JSON.parse(
  readFileSync(new URL("./fixtures/headlines.json", import.meta.url), "utf8"),
);
const itemsFor = (company: string): StoryItem[] =>
  raw
    .filter((r) => r.company === company)
    .map((r) => ({
      title: r.title,
      publisher: r.publisher,
      tier: classifyPublisher(r.publisher),
      weak: isWeakSource(r.publisher),
      publishedAt: r.pubDate ? Date.parse(r.pubDate) : undefined,
      url: "https://example.com/" + encodeURIComponent(r.title),
    }));

const NOW = Date.now();
const has = (story: { items: StoryItem[] }, word: RegExp) => story.items.filter((i) => word.test(i.title)).length;

describe("grouping real Tata Motors headlines into stories", () => {
  const stories = buildStories(itemsFor("Tata Motors"), { companyWords: ["Tata", "Motors"], now: NOW });

  it("100 headlines become far fewer stories", () => {
    expect(stories.length).toBeLessThan(45);
    expect(stories.length).toBeGreaterThan(10);
  });
  it("the Iveco takeover bid is one big story with many outlets", () => {
    const iveco = stories.filter((s) => has(s, /iveco/i) > 0).sort((a, b) => b.items.length - a.items.length)[0]!;
    expect(iveco.outlets).toBeGreaterThanOrEqual(10);
    expect(iveco.type).toBe("merger_acquisition");
  });
  it("the Stellantis partnership is a big, well-reported story", () => {
    const st = [...stories].sort((a, b) => has(b, /stellantis/i) - has(a, /stellantis/i))[0]!;
    expect(has(st, /stellantis/i)).toBeGreaterThanOrEqual(10);
    expect(st.trust).toBe("well_reported");
  });
  it("the Iveco story and the Stellantis story are never mixed", () => {
    for (const s of stories) expect(has(s, /iveco/i) > 0 && has(s, /stellantis/i) > 3).toBe(false);
  });
  it("car-sales rankings are not mixed into the Stellantis story", () => {
    for (const s of stories) {
      if (has(s, /stellantis/i) >= 5) expect(has(s, /best-selling|tops cars sales|no\. ?2 (car|carmaker)/i)).toBe(0);
    }
  });
  it("every headline is placed in exactly one story", () => {
    const total = stories.reduce((t, s) => t + s.items.length, 0);
    expect(total).toBe(100);
  });
  it("stories are ranked: important and widely reported first", () => {
    const top = stories.slice(0, 3);
    expect(top.some((s) => s.type === "merger_acquisition")).toBe(true);
    expect(stories[0]!.trustedOutlets).toBeGreaterThanOrEqual(5);
  });
  it("is deterministic", () => {
    const again = buildStories(itemsFor("Tata Motors"), { companyWords: ["Tata", "Motors"], now: NOW });
    expect(again.map((s) => s.key)).toEqual(stories.map((s) => s.key));
  });
});

describe("grouping real Reliance Industries headlines", () => {
  const stories = buildStories(itemsFor("Reliance Industries"), { companyWords: ["Reliance", "Industries"], now: NOW });
  it("keeps different events apart (Jio IPO, court case, Musk dispute)", () => {
    const jio = stories.find((s) => has(s, /religare/i) >= 3);
    const court = stories.find((s) => has(s, /MMRDA/i) >= 3);
    const musk = stories.find((s) => has(s, /musk/i) >= 3);
    expect(jio && court && musk).toBeTruthy();
    expect(new Set([jio, court, musk]).size).toBe(3);
  });
  it("does not lump unrelated news together", () => {
    for (const s of stories) {
      expect(has(s, /MMRDA/i) > 0 && has(s, /religare/i) > 0).toBe(false);
      expect(has(s, /musk/i) > 0 && has(s, /MMRDA/i) > 0).toBe(false);
    }
  });
});

describe("trust labels (plain rules)", () => {
  const mk = (publisher: string, tier: StoryItem["tier"], weak = false): StoryItem => ({ title: "t", publisher, tier, weak, url: "u" });
  it("3+ outlets including a major one = well reported", () => {
    expect(trustLabel([mk("Reuters", "wire"), mk("Mint", "wire"), mk("Autocar", "trade")]).label).toBe("well_reported");
  });
  it("1 or 2 outlets including a major one = major outlet", () => {
    expect(trustLabel([mk("Reuters", "wire")]).label).toBe("major_outlet");
    expect(trustLabel([mk("Reuters", "wire"), mk("Blog", "unknown")]).label).toBe("major_outlet");
  });
  it("a trade outlet alone = single outlet", () => {
    expect(trustLabel([mk("Autocar", "trade")]).label).toBe("single_outlet");
  });
  it("only unknown or social sources = not recognised", () => {
    expect(trustLabel([mk("RandomBlog", "unknown")]).label).toBe("weak_only");
    expect(trustLabel([mk("Instagram", "unknown", true), mk("Facebook", "unknown", true)]).label).toBe("weak_only");
  });
  it("social posts never count as trusted outlets, even many of them", () => {
    const t = trustLabel([mk("Reuters", "wire"), mk("Instagram", "unknown", true), mk("Facebook", "unknown", true), mk("YouTube", "unknown", true)]);
    expect(t.trustedOutlets).toBe(1);
    expect(t.label).toBe("major_outlet");
  });
  it("the same outlet repeated counts once", () => {
    expect(trustLabel([mk("Reuters", "wire"), mk("Reuters", "wire"), mk("Reuters", "wire")]).outlets).toBe(1);
  });
});

describe("quotes are copied word for word", () => {
  const item = (title: string, text?: string): StoryItem => ({ title, text, publisher: "P", tier: "wire", weak: false, url: "u" });
  const long =
    "Tata Motors raised its offer for Iveco to 14.40 euros per share on Monday. The company said it would not raise the price again. Shareholders have until the end of the month to respond to the revised proposal.";

  it("a quote is always an exact slice of the source text", () => {
    const q = quoteFrom(item("Different headline entirely", long), 120)!;
    expect(q).toBeTruthy();
    expect(long.startsWith(q.replace(/…$/, ""))).toBe(true);
  });
  it("short text is returned whole", () => {
    const t = "Tata Motors raised its offer for Iveco to 14.40 euros per share on Monday, the company said.";
    expect(quoteFrom(item("Another title", t))).toBe(t);
  });
  it("breaks at a sentence end when it must cut", () => {
    const q = quoteFrom(item("x", long), 130)!;
    expect(q.endsWith(".")).toBe(true);
  });
  it("skips short leading fragments such as menu words", () => {
    const messy = "Watch. Sign up here. Tata Motors raised its offer for Iveco to 14.40 euros per share on Monday, the company said in a statement.";
    const q = quoteFrom(item("Other headline", messy))!;
    expect(q.startsWith("Tata Motors raised")).toBe(true);
    expect(messy.includes(q)).toBe(true);
  });
  it("search-result markup is removed without changing any words", async () => {
    const { cleanDescription } = await import("../convex/engine/providers/firecrawl.ts");
    const raw = "# Tata Motors, Stellantis deepen partnership ## Subtitle ![A man walks](https://img.example/a.jpg?auth=abc) Tata Motors will share [vehicle architecture](https://x.com/a) with Stellantis.";
    const c = cleanDescription(raw);
    expect(c).toBe("Tata Motors, Stellantis deepen partnership Subtitle Tata Motors will share vehicle architecture with Stellantis.");
    expect(c).not.toMatch(/https?:|!\[|\]\(/);
  });
  it("a headline repeated at the start of the text is cut off, and the real sentence is quoted", () => {
    const title = "RIL target price ahead of Jio IPO: 47% upside - Why Religare recommends buying Mukesh Ambani stock";
    const text = `${title} Religare Broking recommends buying Reliance Industries, setting a target price of Rs 1,696 against Rs 1,156, implying 46.7% upside.`;
    const q = quoteFrom(item("Something else", text), 280, [title])!;
    expect(q.startsWith("Religare Broking recommends buying")).toBe(true);
    expect(text.includes(q)).toBe(true);
  });
  it("invisible characters and 'N hours ago' prefixes are removed", async () => {
    const { cleanDescription } = await import("../convex/engine/providers/firecrawl.ts");
    expect(cleanDescription("22 hours ago · Infosys CEO sees AI at 50% of work.")).toBe("Infosys CEO sees AI at 50% of work.");
    expect(cleanDescription("said on​ Saturday that it does ‌not expect an impact")).toBe("said on Saturday that it does not expect an impact");
  });
  it("page furniture is never quoted", () => {
    const t = "Sign up for our newsletter to get the latest market news delivered every morning to your inbox. Infosys said on Saturday it does not expect a material impact from the visa rule.";
    const q = quoteFrom(item("Other", t))!;
    expect(q.startsWith("Infosys said on Saturday")).toBe(true);
    expect(quoteFrom(item("Other", "JD Vance accuses Microsoft of H-1B visa abuse and more. About the Author Infosys Wipro ADR Issue is listed here for readers."))).toBeUndefined();
  });
  it("a headline plus teaser at the start is dropped (the case seen on CNBC-TV18)", () => {
    const title = "IT Q2 Earnings Preview: Infosys may cut FY27 guidance";
    const text = "IT Q2 Earnings Preview: Infosys may cut FY27 guidance; here's what to watch Infosys currently guides for constant-currency revenue growth of 1.5%-3.0% for FY27.";
    const q = quoteFrom(item(title, text), 280, [title])!;
    expect(q).toBe("Infosys currently guides for constant-currency revenue growth of 1.5%-3.0% for FY27.");
    expect(text.includes(q)).toBe(true);
  });
  it("does not cut a real sentence just because it has a colon", () => {
    const text = "Infosys said on Saturday: it does not expect a material impact from the new US visa rule on its hiring plans.";
    expect(quoteFrom(item("Different headline about results", text))).toBe(text);
  });
  it("site names are removed from titles however they are spelled", () => {
    expect(cleanPageTitle("IT Q2 Earnings Preview: Infosys may cut FY27 guidance - CNBC TV18", "CNBC-TV18", "www.cnbctv18.com")).toBe("IT Q2 Earnings Preview: Infosys may cut FY27 guidance");
    expect(cleanPageTitle("Markets rally | The Economic Times", "The Economic Times", "economictimes.indiatimes.com")).toBe("Markets rally");
    expect(cleanPageTitle("Tata - Stellantis pact signed", "Mint", "www.livemint.com")).toBe("Tata - Stellantis pact signed");
  });
  it("a list of page tags is not a quote", () => {
    const tags = "Why timing matters Reliance Industries Jio Platforms IPO Reliance share price Mukesh Ambani Religare target price Jio valuation holding company discount";
    expect(quoteFrom(item("A different headline", tags))).toBeUndefined();
  });
  it("text that only repeats the headline is not a quote", () => {
    expect(quoteFrom(item("Tata Motors raises Iveco offer to 14.40 euros per share", "Tata Motors raises Iveco offer to 14.40 euros per share - Reuters"))).toBeUndefined();
  });
  it("no text, or a tiny snippet, gives no quote", () => {
    expect(quoteFrom(item("t"))).toBeUndefined();
    expect(quoteFrom(item("t", "Too short."))).toBeUndefined();
  });
  it("a story's quote comes from a trusted, non-social source and cites it", () => {
    const stories = buildStories(
      [
        { title: "Iveco bid raised", text: long, publisher: "Reuters", tier: "wire", weak: false, publishedAt: NOW, url: "https://r.com/a" },
        { title: "Iveco bid raised by Tata", text: long.replace("Monday", "Tuesday") + " More follows here.", publisher: "Instagram", tier: "unknown", weak: true, publishedAt: NOW, url: "https://i.com/a" },
      ],
      { companyWords: ["Tata"], now: NOW },
    );
    expect(stories[0]!.quote?.publisher).toBe("Reuters");
    expect(stories[0]!.quote?.url).toBe("https://r.com/a");
  });
});

describe("source quality", () => {
  it("social, video and forum sites are weak", () => {
    for (const p of ["Instagram", "Facebook", "YouTube", "Team-BHP", "Reddit"]) expect(isWeakSource(p)).toBe(true);
    expect(isWeakSource("Reuters")).toBe(false);
  });
  it("friendly publisher names from website addresses", () => {
    expect(publisherFromHost("www.reuters.com")).toBe("Reuters");
    expect(publisherFromHost("auto.economictimes.indiatimes.com")).toBe("ET Auto");
    expect(publisherFromHost("unknown-site.example")).toBe("unknown-site.example");
  });
  it("more Indian outlets are recognised as major", () => {
    for (const p of ["Hindustan Times", "India Today", "Firstpost", "Fortune India", "NDTV"]) expect(classifyPublisher(p)).toBe("wire");
  });
});

describe("web search results (Firecrawl)", () => {
  const ctxWith = (body: unknown, status = 200): ProviderContext => ({
    fetch: (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch,
    now: () => 1_000,
    env: { FIRECRAWL_API_KEY: "k" },
  });
  const data = {
    success: true,
    data: [
      { url: "https://www.reuters.com/a", title: "Iveco, Tata Motors raises offer price to €14.40 per share - Reuters", description: "Tata Motors raised its offer for Iveco on Monday." },
      { url: "https://www.moneycontrol.com/quote", title: "Tata Motors Passenger Vehicles Ltd. Share Price Today - Moneycontrol.com", description: "x" },
      { url: "https://www.instagram.com/p/1", title: "A post", description: "caption" },
      { title: "no url" },
    ],
  };
  it("returns publisher's own links, friendly names and trust tiers", async () => {
    const r = await firecrawlSearch("Tata Motors", { days: 7 }, ctxWith(data));
    const docs = r.ok ? r.value : [];
    expect(docs.map((d) => d.publisher)).toEqual(["Reuters", "Instagram"]);
    expect(docs[0]!.authorityTier).toBe("wire");
    expect(docs[0]!.title).toBe("Iveco, Tata Motors raises offer price to €14.40 per share");
    expect(docs[0]!.text).toContain("raised its offer");
  });
  it("live price pages are dropped (they are not reporting)", () => {
    expect(looksLikeQuotePage("Tata Motors Share Price Today")).toBe(true);
    expect(looksLikeQuotePage("Tata Motors raises Iveco offer")).toBe(false);
    expect(looksLikeQuotePage("Tata Motors CV price target - The Economic Times")).toBe(true);
    expect(looksLikeQuotePage("Tata Motors Passenger Vehicles Ltd. - Moneycontrol.com")).toBe(true);
    expect(looksLikeQuotePage("Reliance Industries Limited")).toBe(true);
    expect(looksLikeQuotePage("Tata Motors Ltd shares jump after Iveco offer")).toBe(false);
    expect(looksLikeQuotePage("RIL target price ahead of Jio IPO: 47% upside - Why Religare recommends buying")).toBe(false);
    expect(looksLikeQuotePage("Brokerage raises price target on Infosys after results")).toBe(false);
  });
  it("only cleans a trailing site name, not real parts of the headline", () => {
    expect(cleanPageTitle("Offer raised - Reuters", "Reuters", "www.reuters.com")).toBe("Offer raised");
    expect(cleanPageTitle("Tata - Stellantis pact signed", "Mint", "www.livemint.com")).toBe("Tata - Stellantis pact signed");
  });
  it("sends the time window and keeps the key out of the address", async () => {
    let url = "";
    let body = "";
    const ctx: ProviderContext = { ...ctxWith(data), fetch: (async (u: any, i: any) => ((url = String(u)), (body = String(i.body)), new Response(JSON.stringify(data)))) as unknown as typeof fetch, env: { FIRECRAWL_API_KEY: "SECRET" } };
    await firecrawlSearch("x", { days: 1 }, ctx);
    expect(JSON.parse(body).tbs).toBe("qdr:d");
    expect(url).not.toContain("SECRET");
  });
  it("needs a key, handles quota and format changes", async () => {
    const noKey = await firecrawlSearch("x", { days: 7 }, { ...ctxWith(data), env: {} });
    expect(!noKey.ok && noKey.error.kind).toBe("AUTH");
    const quota = await firecrawlSearch("x", { days: 7 }, ctxWith({}, 429));
    expect(!quota.ok && quota.error.kind).toBe("RATE_LIMITED");
    const drift = await firecrawlSearch("x", { days: 7 }, ctxWith({ success: true }));
    expect(!drift.ok && drift.error.kind).toBe("SCHEMA_DRIFT");
  });
});
