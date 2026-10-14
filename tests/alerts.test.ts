import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyPublisher, isWeakSource } from "../convex/engine/lib/authority.ts";
import { alertLevel, MAX_ALERTS, outletNames, pickTopAlerts, whyText } from "../convex/engine/watch/alerts.ts";
import { buildStories, type StoryItem } from "../convex/engine/watch/stories.ts";

const raw: Array<{ company: string; title: string; publisher?: string; pubDate?: string }> = JSON.parse(
  readFileSync(new URL("./fixtures/headlines.json", import.meta.url), "utf8"),
);
const storiesFor = (company: string) =>
  buildStories(
    raw
      .filter((r) => r.company === company)
      .map<StoryItem>((r) => ({ title: r.title, publisher: r.publisher, tier: classifyPublisher(r.publisher), weak: isWeakSource(r.publisher), publishedAt: r.pubDate ? Date.parse(r.pubDate) : undefined, url: "https://e.com/" + r.title })),
    { companyWords: company.split(" "), now: Date.now() },
  );

describe("watch alerts: never more than 5, only worth reading", () => {
  const tata = storiesFor("Tata Motors");
  const reliance = storiesFor("Reliance Industries");

  it("the limit is 5", () => expect(MAX_ALERTS).toBe(5));

  it("a company with many stories gets exactly 5 alerts", () => {
    expect(tata.length).toBeGreaterThan(20);
    expect(pickTopAlerts(tata)).toHaveLength(5);
    expect(pickTopAlerts(reliance)).toHaveLength(5);
  });
  it("a caller cannot raise the limit above 5", () => {
    expect(pickTopAlerts(tata, 50)).toHaveLength(5);
    expect(pickTopAlerts(tata, 3)).toHaveLength(3);
    expect(pickTopAlerts(tata, 0)).toHaveLength(0);
  });
  it("with fewer than 5 stories, it shows only what exists", () => {
    expect(pickTopAlerts(tata.slice(0, 2))).toHaveLength(2);
    expect(pickTopAlerts([])).toHaveLength(0);
  });
  it("social posts, forums and unrecognised publishers never become alerts", () => {
    for (const s of [...pickTopAlerts(tata), ...pickTopAlerts(reliance)]) expect(s.trust).not.toBe("weak_only");
  });
  it("alerts are ordered most important first", () => {
    const top = pickTopAlerts(tata);
    for (let i = 1; i < top.length; i++) expect(top[i - 1]!.importance).toBeGreaterThanOrEqual(top[i]!.importance);
  });
  it("two alerts never repeat the same event (found with real Tata Motors headlines)", () => {
    const top = pickTopAlerts(tata, 5, ["Tata", "Motors"]);
    expect(top).toHaveLength(5);
    const stellantis = top.filter((s) => /stellantis/i.test(s.head.title));
    const iveco = top.filter((s) => /iveco/i.test(s.head.title));
    expect(stellantis.length).toBeLessThanOrEqual(1);
    expect(iveco.length).toBeLessThanOrEqual(1);
  });
  it("a huge event that fills most headlines is still one alert, not several (seen live: 9 of 16 stories)", () => {
    const base = storiesFor("Tata Motors");
    const mk = (title: string, importance: number) => ({ ...base[0]!, key: title, head: { ...base[0]!.head, title }, importance, trust: "well_reported" as const });
    const stellantis = ["Stellantis and Tata Motors sign pact", "Tata Motors PV, Stellantis expand tie-up", "Stellantis Tata partnership explained", "Stellantis to use Tata platforms", "Tata Motors Stellantis joint plan"].map((t, i) => mk(t, 90 - i));
    const others = ["Tata Motors Q2 results preview", "Tata Motors recalls cars over airbag fault", "Tata Motors opens new dealership network", "Iveco takeover bid raised by Tata Motors"].map((t, i) => mk(t, 50 - i));
    const top = pickTopAlerts([...stellantis, ...others], 5, ["Tata", "Motors"]);
    expect(top).toHaveLength(5);
    expect(top.filter((s) => /stellantis/i.test(s.head.title))).toHaveLength(1);
  });
  it("works out the company words by itself (no company name needed)", () => {
    const top = pickTopAlerts(tata);
    expect(top).toHaveLength(5);
    expect(top.filter((s) => /stellantis/i.test(s.head.title)).length).toBeLessThanOrEqual(1);
  });
  it("Reliance's top 5 are five different events", () => {
    const top = pickTopAlerts(reliance, 5, ["Reliance", "Industries"]);
    expect(top).toHaveLength(5);
    expect(new Set(top.map((s) => s.key)).size).toBe(5);
  });
  it("still gives a full list when there are not 5 distinct events (tops up from repeats)", () => {
    const mk = (title: string, importance: number): ReturnType<typeof storiesFor>[number] => ({ ...storiesFor("Tata Motors")[0]!, key: title, head: { ...storiesFor("Tata Motors")[0]!.head, title }, importance });
    const same = ["Stellantis Tata deal signed today", "Stellantis Tata deal expands globally", "Stellantis Tata deal vehicles markets"].map((t, i) => mk(t, 80 - i));
    expect(pickTopAlerts(same, 5)).toHaveLength(3);
  });
  it("the same input always gives the same alerts", () => {
    expect(pickTopAlerts(tata).map((s) => s.key)).toEqual(pickTopAlerts([...tata].reverse()).map((s) => s.key));
  });
  it("does not change the list it was given", () => {
    const before = tata.map((s) => s.key);
    pickTopAlerts(tata);
    expect(tata.map((s) => s.key)).toEqual(before);
  });
});

describe("plain-language labels", () => {
  it("importance becomes a word", () => {
    expect(alertLevel(80)).toBe("important");
    expect(alertLevel(55)).toBe("important");
    expect(alertLevel(40)).toBe("worth");
    expect(alertLevel(10)).toBe("fyi");
  });
  it("explains why a story is an alert, naming major outlets", () => {
    const story = pickTopAlerts(storiesFor("Tata Motors"))[0]!;
    const why = whyText(story);
    expect(why).toMatch(/^Reported by \d+ outlets?/);
    expect(outletNames(story).length).toBeGreaterThan(1);
  });
  it("a single-outlet story says so", () => {
    const one = buildStories([{ title: "Infosys opens new office in Pune", publisher: "Reuters", tier: "wire", weak: false, publishedAt: Date.now(), url: "https://r.com/a" }], { companyWords: ["Infosys"], now: Date.now() })[0]!;
    expect(whyText(one)).toBe("Reported by Reuters.");
  });
  it("social outlets are not named as sources", () => {
    const s = buildStories(
      [
        { title: "Infosys wins big contract", publisher: "Reuters", tier: "wire", weak: false, publishedAt: Date.now(), url: "https://r.com/a" },
        { title: "Infosys wins big contract", publisher: "Instagram", tier: "unknown", weak: true, publishedAt: Date.now(), url: "https://i.com/a" },
      ],
      { companyWords: ["Infosys"], now: Date.now() },
    )[0]!;
    expect(outletNames(s).map((o) => o.name)).toEqual(["Reuters"]);
  });
});
