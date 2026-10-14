import { describe, expect, it } from "vitest";
import { assignPhotos, firstQueries } from "../convex/engine/news/photos.ts";
import { topicFor } from "../convex/engine/news/topic.ts";
import { parseCommonsPhotos, queryWords, searchPhotos, type Photo } from "../convex/engine/providers/commons.ts";
import type { ProviderContext } from "../convex/engine/providers/types.ts";

const page = (index: number, title: string, over: Record<string, unknown> = {}) => ({
  index,
  title: `File:${title}.jpg`,
  imageinfo: [
    {
      thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${encodeURIComponent(title)}.jpg/900px-x.jpg`,
      descriptionurl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(title)}.jpg`,
      width: 4000,
      height: 3000,
      mime: "image/jpeg",
      extmetadata: { Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Jane">Jane Doe</a> &amp; friends' }, LicenseShortName: { value: "CC BY-SA 4.0" } },
      ...over,
    },
  ],
});
const answer = (...pages: ReturnType<typeof page>[]) => ({ query: { pages: Object.fromEntries(pages.map((p, i) => [String(i), p])) } });

describe("which topic a headline has", () => {
  const id = (h: string) => topicFor(h).id;
  it("named organisations come first", () => {
    expect(id("Gulf markets mixed; Saudi stocks hardest hit on Aramco attack")).toBe("aramco");
    expect(id("IMF's Georgieva optimistic on Senegal debt treatment")).toBe("imf");
    expect(id("Meta shares rise for a second straight day as new AI model family impresses")).toBe("meta");
    expect(id("Bank of America fined $1.2 billion by US government")).toBe("bofa");
    expect(id("Fed holds interest rates steady")).toBe("fed");
    expect(id("RBI keeps repo rate unchanged")).toBe("rbi");
  });
  it("broad subjects", () => {
    expect(id("US consumer prices accelerate in September on costlier gasoline; core CPI firmer")).toBe("inflation"); // not "oil"
    expect(id("Oil prices steady after gains on Iran's new tactics to target tankers")).toBe("oil");
    expect(id("Iran's central bank governor dismisses claims of economic collapse")).toBe("central-bank");
    expect(id("Abu Dhabi's IRH seeks more mining assets in Zambia")).toBe("mining");
    expect(id("Gold hits record high as investors seek safety")).toBe("gold");
    expect(id("Dollar slips against yen")).toBe("currency");
    expect(id("Jim Cramer's top 10 things to watch in the stock market Wednesday")).toBe("stocks");
  });
  it("falls back to the financial district", () => {
    expect(topicFor("Something with no clue in it at all").id).toBe("finance");
  });
  it("every topic has at least two searches, so two stories can differ", () => {
    for (const h of ["Aramco", "IMF", "Fed", "oil", "gold", "inflation", "stocks", "nothing"]) expect(topicFor(h).queries.length).toBeGreaterThanOrEqual(2);
  });
});

describe("reading Commons results", () => {
  it("keeps a sharp photo and strips the credit to plain text", () => {
    const r = parseCommonsPhotos(answer(page(1, "New York Stock Exchange building")), "New York Stock Exchange");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ credit: "Jane Doe & friends", license: "CC BY-SA 4.0" });
    expect(r[0]!.url).toMatch(/^https:\/\/upload\.wikimedia\.org\//);
    expect(r[0]!.pageUrl).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
  });
  it("drops logos, maps, portraits and stamps", () => {
    const r = parseCommonsPhotos(answer(page(1, "Reserve Bank of India logo"), page(2, "Reserve Bank of India 2010 stamp"), page(3, "Reserve Bank of India map"), page(4, "Reserve Bank of India, Delhi")), "Reserve Bank of India");
    expect(r.map((p) => p.title)).toEqual(["Reserve Bank of India, Delhi"]);
  });
  it("drops photos that are too small or the wrong shape", () => {
    const r = parseCommonsPhotos(answer(page(1, "Oil refinery small", { width: 500, height: 400 }), page(2, "Oil refinery panorama", { width: 11000, height: 3000 }), page(3, "Oil refinery good", { width: 2500, height: 1800 })), "oil refinery");
    expect(r.map((p) => p.title)).toEqual(["Oil refinery good"]);
  });
  it("drops photos whose title has nothing to do with the topic", () => {
    const r = parseCommonsPhotos(answer(page(1, "Meta Platforms Headquarters Menlo Park"), page(2, "Anti-narcotics operations from Defence Imagery 11")), "Meta Platforms Headquarters Menlo Park");
    expect(r.map((p) => p.title)).toEqual(["Meta Platforms Headquarters Menlo Park"]);
  });
  it("only accepts pictures hosted by Wikimedia, and only real image types", () => {
    const r = parseCommonsPhotos(answer(page(1, "Oil refinery one", { thumburl: "https://evil.example/x.jpg" }), page(2, "Oil refinery two", { mime: "image/svg+xml" }), page(3, "Oil refinery three")), "oil refinery");
    expect(r.map((p) => p.title)).toEqual(["Oil refinery three"]);
  });
  it("accepts Wikimedia's resized-picture host as well as its upload host", () => {
    const r = parseCommonsPhotos(answer(page(1, "Oil refinery resized", { thumburl: "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/51/x.JPG/900px-x.JPG" })), "oil refinery");
    expect(r).toHaveLength(1);
  });
  it("an odd answer gives an empty list, not a crash", () => {
    expect(parseCommonsPhotos({}, "x")).toEqual([]);
    expect(parseCommonsPhotos(null, "x")).toEqual([]);
    expect(parseCommonsPhotos({ query: { pages: "nope" } }, "x")).toEqual([]);
  });
  it("search words ignore short and filler words", () => {
    expect(queryWords("Bank of America Tower")).toEqual(["bank", "america", "tower"]);
  });
  it("reports a rate limit instead of waiting", async () => {
    const ctx: ProviderContext = {
      fetch: (async () => new Response("slow down", { status: 429, headers: { "retry-after": "44" } })) as typeof fetch,
      now: () => 0,
      env: {},
    };
    const r = await searchPhotos("oil refinery", ctx);
    expect(!r.ok && r.error.kind).toBe("RATE_LIMITED");
    expect(!r.ok && r.error.retryAfterMs).toBe(44_000);
  });
});

describe("giving every story its own photo", () => {
  const photo = (n: number): Photo => ({ url: `https://upload.wikimedia.org/p${n}.jpg`, credit: "A", license: "CC BY 4.0", pageUrl: `https://commons.wikimedia.org/wiki/File:p${n}`, title: `p${n}` });
  const lookup = (table: Record<string, Photo[]>) => async (q: string) => table[q] ?? [];

  it("two stories on one topic get different photos", async () => {
    const out = await assignPhotos([{ headline: "Oil prices steady" }, { headline: "Oil climbs as pipeline outage tightens supply" }], lookup({ "oil refinery": [photo(1), photo(2)] }));
    expect(out[0]!.photo?.url).not.toBe(out[1]!.photo?.url);
    expect(out.every((o) => o.photo)).toBe(true);
  });
  it("moves to the topic's next search when the first one is used up", async () => {
    const out = await assignPhotos([{ headline: "Oil prices steady" }, { headline: "Oil climbs again" }], lookup({ "oil refinery": [photo(1)], "oil tanker ship": [photo(2)] }));
    expect(out.map((o) => o.photo?.url)).toEqual([photo(1).url, photo(2).url]);
  });
  it("falls back to a generic finance photo when the topic has none", async () => {
    const out = await assignPhotos([{ headline: "Oil prices steady" }], lookup({ "financial district skyline": [photo(9)] }));
    expect(out[0]!.photo?.url).toBe(photo(9).url);
  });
  it("a story with no photo anywhere gets none, and the others are not affected", async () => {
    const out = await assignPhotos([{ headline: "Oil prices steady" }, { headline: "Gold hits record" }], lookup({ "gold bars": [photo(3)] }));
    expect(out[0]!.photo).toBeUndefined();
    expect(out[1]!.photo?.url).toBe(photo(3).url);
  });
  it("a failing lookup does not stop the page", async () => {
    const out = await assignPhotos([{ headline: "Oil prices steady" }], async () => {
      throw new Error("network down");
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.photo).toBeUndefined();
  });
  it("keeps everything else on the story", async () => {
    const out = await assignPhotos([{ headline: "Gold hits record", image: "https://cdn.example/real.jpg" }], lookup({ "gold bars": [photo(3)] }));
    expect(out[0]!.image).toBe("https://cdn.example/real.jpg");
  });
  it("the first searches are listed once each", () => {
    expect(firstQueries([{ headline: "Oil prices steady" }, { headline: "Oil climbs" }, { headline: "Gold hits record" }])).toEqual(["oil refinery", "gold bars"]);
  });
});
