/**
 * DAILY NEWS: turn Finnhub's raw market-news feed into a short list a person can read in a minute.
 *
 *   - Only recent items: the last 24 hours. If that leaves fewer than 5 different stories, the window widens
 *     to 48 and then 72 hours, and the page says how far back it had to go.
 *   - One event is one line: different outlets writing about the same event are grouped (the same grouping
 *     the company briefing uses), and the other outlets are listed under it.
 *   - Money news only: stories about politics, travel, shipping or sport are left out (see financial.ts).
 *   - Newest first, never more than 10.
 *   - A picture is kept only when it is a photo of that story: a picture shared by several stories is an outlet logo.
 *   - The outlet name is shown on its own, so it is cut from the end of the headline ("... - Reuters").
 *
 * Plain code, no AI. Nothing is rewritten: every headline is the outlet's own words.
 */
import { similarity } from "../lib/text.ts";
import { classifyPublisher } from "../lib/authority.ts";
import type { MarketNewsItem } from "../providers/finnhub.ts";
import { buildStories } from "../watch/stories.ts";
import { isFinancial } from "./financial.ts";

export const DAILY_NEWS = { min: 5, max: 10, windowsHours: [24, 48, 72] } as const;

/**
 * One story coming in, from any source (Finnhub, an Indian outlet's feed ...).
 * `official` marks a regulator's own notice (RBI, SEBI): it was already chosen as worth showing, so it skips the word check.
 */
export type NewsInput = MarketNewsItem & { official?: boolean };

export interface DailyNewsItem {
  headline: string;
  source: string;
  url: string;
  publishedAt: number;
  /** The outlet's own summary, only when it says more than the headline does. */
  summary?: string;
  /** A real picture of the story, when the feed has one. */
  image?: string;
  /** True for a regulator's own notice (RBI, SEBI). */
  official?: boolean;
  /** Where the story is from, so its photo fits (an Indian market story gets an Indian photo). */
  region?: "india";
  /** Other outlets that reported the same event. */
  alsoBy: string[];
}

export interface DailyNews {
  items: DailyNewsItem[];
  /** How far back the list had to look (24, 48 or 72). */
  windowHours: number;
}

const HOUR = 3_600_000;

/** "Gulf markets mixed - Reuters" becomes "Gulf markets mixed". Only cuts the outlet's own name. */
export function cleanHeadline(headline: string, source: string): string {
  let h = headline.replace(/\s+/g, " ").trim();
  const names = [source, "Reuters", "CNBC", "Bloomberg", "Bloomberg.com", "MarketWatch", "Yahoo Finance", "Financial Times"].filter(Boolean);
  for (const n of names) {
    const re = new RegExp(`\\s[-–—|]\\s*${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
    if (re.test(h)) {
      h = h.replace(re, "").trim();
      break;
    }
  }
  return h || headline.trim();
}

/** The summary is shown only when it adds something: many feeds just repeat the headline. */
export function usefulSummary(summary: string | undefined, headline: string): string | undefined {
  const s = summary?.replace(/\s+/g, " ").trim();
  if (!s || s.length < 40) return undefined;
  if (similarity(s, headline) >= 0.45) return undefined;
  if (s.toLowerCase().startsWith(headline.toLowerCase().slice(0, 40))) return undefined;
  return s.length > 280 ? `${s.slice(0, 280).trimEnd()}…` : s;
}

/**
 * Keeps one outlet from filling the whole list: at most `cap` stories from each, newest first. If that leaves too few
 * stories, the ones that were set aside come back, so a quiet day is never padded with nothing.
 */
export function limitPerSource(items: DailyNewsItem[], cap: number): DailyNewsItem[] {
  const count = new Map<string, number>();
  const kept: DailyNewsItem[] = [];
  const aside: DailyNewsItem[] = [];
  for (const it of items) {
    const c = count.get(it.source) ?? 0;
    if (c < cap) {
      kept.push(it);
      count.set(it.source, c + 1);
    } else aside.push(it);
  }
  const out = kept.length >= DAILY_NEWS.max ? kept : [...kept, ...aside.slice(0, DAILY_NEWS.max - kept.length)];
  return out.sort((a, b) => b.publishedAt - a.publishedAt);
}

export function pickDailyNews(raw: NewsInput[], now: number, opts: { maxPerSource?: number } = {}): DailyNews {
  // A picture used by more than one story is an outlet's logo, not a photo of the story, so it is dropped.
  const uses = new Map<string, number>();
  for (const n of raw) if (n.image) uses.set(n.image, (uses.get(n.image) ?? 0) + 1);
  const fresh = raw
    .filter((n) => n.publishedAt <= now + 5 * 60_000) // a clock that runs a little ahead is fine; the future is not
    .filter((n) => n.official || isFinancial(cleanHeadline(n.headline, n.source), n.summary)) // money news only
    .map((n) => (n.image && (uses.get(n.image) ?? 0) > 1 ? { ...n, image: undefined } : n));
  let chosen: DailyNewsItem[] = [];
  let used: number = DAILY_NEWS.windowsHours[0];
  for (const hours of DAILY_NEWS.windowsHours) {
    used = hours;
    const inWindow = fresh.filter((n) => now - n.publishedAt <= hours * HOUR);
    chosen = group(inWindow, now);
    if (chosen.length >= DAILY_NEWS.min) break;
  }
  const items = opts.maxPerSource ? limitPerSource(chosen, opts.maxPerSource) : chosen;
  return { items: items.slice(0, DAILY_NEWS.max), windowHours: used };
}

function group(items: NewsInput[], now: number): DailyNewsItem[] {
  if (!items.length) return [];
  const cleaned = items.map((n) => {
    const title = cleanHeadline(n.headline, n.source);
    return { n, title, summary: usefulSummary(n.summary, title) };
  });
  const stories = buildStories(
    cleaned.map((c) => ({ title: c.title, text: c.summary, publisher: c.n.source, tier: classifyPublisher(c.n.source), weak: false, publishedAt: c.n.publishedAt, url: c.n.url, image: c.n.image, official: c.n.official })),
    { companyWords: [], now },
  );
  const out: DailyNewsItem[] = stories.map((s) => {
    // Show the newest report of the event.
    const latest = [...s.items].sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))[0]!;
    const others = [...new Set(s.items.map((i) => i.publisher ?? "").filter((p) => p && p !== latest.publisher))];
    return {
      headline: latest.title,
      source: latest.publisher ?? "Unknown",
      url: latest.url,
      publishedAt: latest.publishedAt ?? 0,
      summary: latest.text,
      // The newest report's picture, or any other outlet's picture of the same event.
      image: latest.image ?? s.items.find((i) => i.image)?.image,
      official: s.items.some((i) => i.official) || undefined,
      alsoBy: others,
    };
  });
  return out.sort((a, b) => b.publishedAt - a.publishedAt);
}
