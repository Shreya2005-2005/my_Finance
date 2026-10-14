import { describe, expect, it } from "vitest";
import { STOCK_METRIC_DIRECTION, STOCK_PROFILE_WEIGHTS } from "../convex/config/engine.ts";
import {
  annualizedVolatility,
  cagr,
  computeFundMetrics,
  dailyReturns,
  findGaps,
  historyYears,
  maxDrawdown,
  rollingReturns,
  sipOutcome,
  sipXirr,
  xirr,
  type Series,
} from "../convex/engine/invest/metrics.ts";
import { fundRiskFlags, percentileOf, rankInstruments, stockRiskFlags, winsorize } from "../convex/engine/invest/ranking.ts";
import { alertKey, classifyEvent, dedupe, importanceScore, planAlert, shouldRealert, titleHashOf } from "../convex/engine/watch/events.ts";
import { parseGoogleNewsRss } from "../convex/engine/providers/googleNews.ts";
import { parseFundDetail, parseIndianDate, planAndOption } from "../convex/engine/providers/mfapi.ts";
import { parseGdeltDate } from "../convex/engine/providers/gdelt.ts";

const DAY = 86_400_000;
/** A series growing at exactly `annual` per year, daily points, for `years` years. */
function steadySeries(years: number, annual: number, start = Date.UTC(2020, 0, 1)): Series {
  const n = Math.round(years * 365);
  const dates: number[] = [];
  const values: number[] = [];
  for (let i = 0; i <= n; i++) {
    dates.push(start + i * DAY);
    values.push(100 * (1 + annual) ** (i / 365.25));
  }
  return { dates, values };
}

describe("fund maths (checked against hand-computable cases)", () => {
  const s = steadySeries(6, 0.12);
  it("CAGR of steady 12% growth is 12%", () => {
    expect(cagr(s, 3)!).toBeCloseTo(0.12, 3);
    expect(cagr(s, 5)!).toBeCloseTo(0.12, 3);
  });
  it("CAGR is undefined when history is too short", () => {
    expect(cagr(steadySeries(2, 0.1), 5)).toBeUndefined();
  });
  it("steady growth has no drawdown and near-zero volatility", () => {
    expect(maxDrawdown(s.values)).toBe(0);
    expect(annualizedVolatility(dailyReturns(s.values))!).toBeLessThan(0.001);
  });
  it("max drawdown: 100 -> 50 -> 80 is a 50% fall", () => {
    expect(maxDrawdown([100, 80, 50, 80, 90])).toBeCloseTo(0.5, 10);
  });
  it("rolling returns of steady growth are all 12%", () => {
    const r = rollingReturns(s, 3);
    expect(r.length).toBeGreaterThan(20);
    for (const x of r) expect(x).toBeCloseTo(0.12, 2);
  });
  it("XIRR: invest 100, get 110 after exactly one year = 10%", () => {
    const t0 = Date.UTC(2024, 0, 1);
    const r = xirr([{ t: t0, amount: -100 }, { t: t0 + 365.25 * DAY, amount: 110 }]);
    expect(r!).toBeCloseTo(0.1, 4);
  });
  it("XIRR returns undefined when it cannot be solved", () => {
    expect(xirr([{ t: 0, amount: -100 }])).toBeUndefined();
    expect(xirr([{ t: 0, amount: -100 }, { t: DAY, amount: -50 }])).toBeUndefined();
  });
  it("SIP return on steady 12% growth is a bit above 12% (money added later grows for less time)... and close to it", () => {
    const r = sipXirr(s, 3)!;
    expect(r).toBeGreaterThan(0.1);
    expect(r).toBeLessThan(0.14);
  });
  it("SIP what-if: instalments, total invested and final value are consistent", () => {
    const o = sipOutcome(s, 3, 5000)!;
    expect(o.invested).toBe(36 * 5000);
    expect(o.value).toBeGreaterThan(o.invested);
    expect(o.gain).toBeCloseTo((o.value - o.invested) / o.invested, 10);
    expect(o.xirr!).toBeGreaterThan(0.1);
    expect(o.xirr!).toBeLessThan(0.14);
  });
  it("SIP what-if on a falling fund shows a loss, honestly", () => {
    const down = steadySeries(4, -0.1);
    const o = sipOutcome(down, 3, 1000)!;
    expect(o.value).toBeLessThan(o.invested);
    expect(o.gain).toBeLessThan(0);
  });
  it("SIP what-if needs enough history, and a sensible amount", () => {
    expect(sipOutcome(steadySeries(2, 0.1), 3, 5000)).toBeUndefined();
    expect(sipOutcome(s, 3, 0)).toBeUndefined();
    expect(sipOutcome(s, 0, 1000)).toBeUndefined();
  });
  it("SIP what-if scales with the amount", () => {
    const a = sipOutcome(s, 3, 1000)!;
    const b = sipOutcome(s, 3, 4000)!;
    expect(b.value).toBeCloseTo(a.value * 4, 6);
    expect(b.gain).toBeCloseTo(a.gain, 10);
  });
  it("computeFundMetrics leaves out what it cannot compute honestly", () => {
    const m = computeFundMetrics(steadySeries(2, 0.1));
    expect(m.cagr_5y).toBeUndefined();
    expect(m.sip_xirr_5y).toBeUndefined();
    expect(m.cagr_1y).toBeCloseTo(0.1, 2);
  });
  it("history length and gap detection", () => {
    expect(historyYears(s)).toBeCloseTo(6, 1);
    const gappy: Series = { dates: [0, DAY, 40 * DAY], values: [1, 1, 1] };
    expect(findGaps(gappy)).toHaveLength(1);
  });
});

describe("ranking", () => {
  const w = STOCK_PROFILE_WEIGHTS.balanced;
  const mk = (id: string, roe: number, pe: number, rest = 0.5): any => ({
    id,
    symbol: id,
    marketCap: 1e11,
    metrics: Object.fromEntries(Object.keys(w).map((k) => [k, rest])) && { ...Object.fromEntries(Object.keys(w).map((k) => [k, rest])), roe, pe },
  });
  const opts = { weights: w, directions: STOCK_METRIC_DIRECTION, minCompleteness: 0.7 };

  it("higher ROE and lower P/E rank better", () => {
    const { ranked } = rankInstruments([mk("good", 30, 10), mk("mid", 15, 25), mk("bad", 5, 60)], opts);
    expect(ranked.map((r) => r.id)).toEqual(["good", "mid", "bad"]);
    expect(ranked[0]!.rank).toBe(1);
  });
  it("is deterministic: same input twice gives identical output", () => {
    const items = [mk("a", 20, 20), mk("b", 20, 20), mk("c", 10, 40)];
    expect(rankInstruments(items, opts)).toEqual(rankInstruments([...items].reverse(), opts));
  });
  it("excludes items with too little data and says why", () => {
    const sparse = { id: "sparse", symbol: "sparse", metrics: { roe: 20 } as Record<string, number | undefined> };
    const r = rankInstruments([mk("a", 20, 20), mk("b", 10, 30), sparse], opts);
    expect(r.excluded.map((e) => e.id)).toEqual(["sparse"]);
    expect(r.ranked).toHaveLength(2);
  });
  it("every position is explained: contributions add up to the score (before the missing-data penalty)", () => {
    const { ranked } = rankInstruments([mk("a", 20, 20), mk("b", 10, 30), mk("c", 5, 50)], opts);
    for (const item of ranked) {
      const sum = item.contributions.reduce((a, c) => a + c.contribution, 0);
      expect(sum).toBeCloseTo(item.score, 0);
      const weights = item.contributions.reduce((a, c) => a + c.weight, 0);
      expect(weights).toBeCloseTo(1, 2);
    }
  });
  it("missing metrics cost points but do not exclude", () => {
    const full = mk("full", 20, 20);
    const partial = { ...mk("partial", 20, 20) };
    delete partial.metrics.return_1y;
    delete partial.metrics.volatility;
    const r = rankInstruments([full, partial, mk("other", 10, 40)], opts);
    const f = r.ranked.find((x) => x.id === "full")!;
    const p = r.ranked.find((x) => x.id === "partial")!;
    expect(p.completeness).toBeLessThan(f.completeness);
    expect(p.missingMetrics).toContain("volatility");
  });
  it("winsorize tames an extreme outlier; percentile ties are equal", () => {
    const w2 = winsorize([1, 2, 3, 4, 5, 6, 7, 8, 9, 1000]);
    expect(Math.max(...w2)).toBeLessThan(1000);
    expect(percentileOf([1, 2, 2, 3], 2)).toBeCloseTo(0.5, 5);
  });
  it("risk flags are plain rules", () => {
    expect(stockRiskFlags({ debt_to_equity: 3, pe: -5 })).toEqual(expect.arrayContaining([expect.stringMatching(/debt/i), expect.stringMatching(/loss/i)]));
    expect(stockRiskFlags({ debt_to_equity: 0.3, pe: 20 })).toEqual([]);
    expect(fundRiskFlags({ max_drawdown: 0.4 }, "Equity Scheme - Small Cap Fund").length).toBe(2);
  });
});

describe("watch: event type and importance", () => {
  it("classifies by rule", () => {
    expect(classifyEvent("Tata Motors Q2 results: net profit jumps 20%").type).toBe("results");
    expect(classifyEvent("Reliance to acquire stake in startup").type).toBe("merger_acquisition");
    expect(classifyEvent("SEBI issues show-cause notice to firm").type).toBe("regulatory_legal");
    expect(classifyEvent("Board declares dividend of Rs 5").type).toBe("dividend_corporate_action");
    // found by the live demo on real headlines
    expect(classifyEvent("Tata Motors sweetens Iveco offer as key investors hold out").type).toBe("merger_acquisition");
    expect(classifyEvent("Tata, Stellantis formalise pact for Sierra-based Jeep SUV").type).toBe("merger_acquisition");
    expect(classifyEvent("Tata Motors Unit Raises Voluntary Tender Offer For Iveco Group").type).toBe("merger_acquisition");
  });
  it("unknown news is 'other' and marked ambiguous (so the AI may pick from the fixed list)", () => {
    const c = classifyEvent("Company opens new cafeteria");
    expect(c.type).toBe("other");
    expect(c.basis).toBe("ambiguous");
  });
  const now = Date.UTC(2026, 9, 14);
  it("results from an official source outrank an old blog rumour", () => {
    const a = importanceScore({ type: "results", authorityTier: "primary", publishedAt: now - 3_600_000, now, isNewStory: true });
    const b = importanceScore({ type: "results", authorityTier: "unknown", publishedAt: now - 5 * DAY, now, isNewStory: true });
    expect(a).toBeGreaterThan(b);
    expect(a).toBeLessThanOrEqual(100);
  });
  it("a repeat of a known story is less important", () => {
    const novel = importanceScore({ type: "results", authorityTier: "wire", publishedAt: now, now, isNewStory: true });
    const repeat = importanceScore({ type: "results", authorityTier: "wire", publishedAt: now, now, isNewStory: false });
    expect(repeat).toBeLessThan(novel);
  });
});

describe("watch: duplicate detection (no repeated alerts)", () => {
  const now = Date.UTC(2026, 9, 14);
  const first = { clusterKey: "tata:1", entityId: "tata", title: "Tata Motors Q2 profit rises 20% - Reuters", titleHash: titleHashOf("Tata Motors Q2 profit rises 20% - Reuters"), firstSeenAt: now };
  it("a new story starts a new cluster", () => {
    expect(dedupe({ entityId: "tata", title: "Tata Motors recalls 5,000 cars", publishedAt: now }, [first]).action).toBe("new");
  });
  it("the same headline from another site merges (level 2)", () => {
    const d = dedupe({ entityId: "tata", title: "Tata Motors Q2 profit rises 20% - Mint", publishedAt: now + 3_600_000 }, [first]);
    expect(d).toMatchObject({ action: "merge", clusterKey: "tata:1", level: "title" });
  });
  it("lightly reworded headline merges (level 3)", () => {
    const d = dedupe({ entityId: "tata", title: "Tata Motors Q2 profit rises by 20%", publishedAt: now + 3_600_000 }, [first]);
    expect(d.action).toBe("merge");
  });
  it("the same headline about a DIFFERENT company is not a duplicate", () => {
    expect(dedupe({ entityId: "other", title: first.title, publishedAt: now }, [first]).action).toBe("new");
  });
  it("the same headline weeks later is a new event", () => {
    expect(dedupe({ entityId: "tata", title: first.title, publishedAt: now + 10 * DAY }, [first]).action).toBe("new");
  });
});

describe("watch: who gets alerted", () => {
  const rules = { minImportance: 50, eventTypes: [] as any[], emailImmediate: true, emailDigest: true };
  it("below the user's threshold: no alert", () => {
    expect(planAlert({ type: "results", importance: 30 }, rules, 0).send).toBe(false);
  });
  it("respects the chosen event types", () => {
    expect(planAlert({ type: "results", importance: 90 }, { ...rules, eventTypes: ["merger_acquisition"] }, 0).send).toBe(false);
  });
  it("very important: in-app + immediate email", () => {
    expect(planAlert({ type: "results", importance: 90 }, rules, 0)).toEqual({ send: true, channels: ["in_app", "email_immediate"] });
  });
  it("moderately important: digest only", () => {
    expect(planAlert({ type: "board_meeting", importance: 60 }, rules, 0)).toEqual({ send: true, channels: ["in_app", "email_digest"] });
  });
  it("over the hourly email cap: falls back to the digest", () => {
    expect(planAlert({ type: "results", importance: 95 }, rules, 99)).toEqual({ send: true, channels: ["in_app", "email_digest"] });
  });
  it("alert keys are unique per user/event/channel", () => {
    expect(alertKey("u1", "e1", "email_immediate")).not.toBe(alertKey("u1", "e1", "in_app"));
    expect(alertKey("u1", "e1", "in_app")).toBe(alertKey("u1", "e1", "in_app"));
  });
  it("re-alerts only when a story crosses into 'very important'", () => {
    expect(shouldRealert(50, 85)).toBe(true);
    expect(shouldRealert(85, 90)).toBe(false);
    expect(shouldRealert(40, 60)).toBe(false);
  });
});

describe("provider parsing (using saved sample responses, no internet)", () => {
  it("Google News RSS", () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item><title>Reliance hits 18-month low - Business Standard</title><link>https://news.google.com/rss/articles/abc?utm_source=x</link>
      <pubDate>Mon, 13 Oct 2026 08:00:00 GMT</pubDate><description>&lt;a href="x"&gt;Reliance falls&lt;/a&gt;</description><source url="https://bs.com">Business Standard</source></item>
      <item><title>No link here</title></item></channel></rss>`;
    const docs = parseGoogleNewsRss(xml, 1)!;
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ title: "Reliance hits 18-month low", publisher: "Business Standard", authorityTier: "wire", text: "Reliance falls" });
    expect(docs[0]!.publishedAt).toBe(Date.UTC(2026, 9, 13, 8));
  });
  it("Google News: a non-feed (e.g. an error page) is detected as schema drift", () => {
    expect(parseGoogleNewsRss("<html>blocked</html>", 1)).toBeUndefined();
  });
  it("MFapi: dates, order and plan/option", () => {
    expect(parseIndianDate("13-10-2026")).toBe(Date.UTC(2026, 9, 13));
    expect(parseIndianDate("2026-10-13")).toBeUndefined();
    expect(planAndOption("HDFC Flexi Cap Fund - Direct Plan - Growth Option")).toEqual({ plan: "direct", option: "growth" });
    expect(planAndOption("X Fund - Regular Plan - IDCW")).toEqual({ plan: "regular", option: "idcw" });
    const d = parseFundDetail(
      { meta: { scheme_name: "A Fund - Direct - Growth", scheme_code: 1, scheme_category: "Equity Scheme - Flexi Cap Fund" }, data: [{ date: "02-01-2025", nav: "11" }, { date: "01-01-2025", nav: "10" }, { date: "bad", nav: "9" }, { date: "31-12-2024", nav: "0" }] },
      1,
    )!;
    expect(d.history.values).toEqual([10, 11]); // oldest first, bad rows skipped
    expect(d.category).toContain("Flexi Cap");
    expect(parseFundDetail({ data: [] } as any, 1)).toBeUndefined();
  });
  it("GDELT date", () => {
    expect(parseGdeltDate("20261010T064500Z")).toBe(Date.UTC(2026, 9, 10, 6, 45));
  });
});
