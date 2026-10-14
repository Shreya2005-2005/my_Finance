/**
 * WHICH STORIES RELATE TO WHAT THE USER TYPED?
 *
 * A search for "Oracle had an operating profit of ₹803.80 Cr in 2026" should show the stories about THAT,
 * not everything written about Oracle this week. Each story is scored by plain rules:
 *
 *   +4  it contains an amount from the sentence (same value, same kind: an amount is not a percentage)
 *   +2  it contains a percentage from the sentence (common numbers can match by luck, so it counts less)
 *   +2  it talks about the same topic (profit, revenue, results ...). When the sentence is about an event rather than
 *       a yearly figure ("Tata Motors raises offer price per share"), the user's own key words are the topic:
 *       a story must contain enough of them (all of 1-2 words, 2 of 3-4, 3 of 5 or more).
 *   +1  extra, when a sentence of 3 or more key words has every one of them in the story
 *   +1  it names the year
 *   +1  it names the company in its headline
 *
 * A story is shown when its score reaches the threshold. A figure alone is enough, or topic plus company.
 */
import { approxEqual, extractNumbers } from "../lib/numbers.ts";
import type { FlowMetric } from "../providers/sec.ts";
import { quoteFrom, type Quote, type StoryItem } from "../watch/stories.ts";

export const RELATED_THRESHOLD = 3;

/** Words that mean the same topic, per measure. The first one is also used to focus the news search. */
export const TOPIC_WORDS: Record<FlowMetric, string[]> = {
  revenue: ["revenue", "sales", "turnover", "total income"],
  net_income: ["profit", "net income", "earnings", "results", "PAT"],
  operating_income: ["operating profit", "operating income", "EBIT", "EBITDA"],
  gross_profit: ["gross profit", "gross margin"],
  eps: ["EPS", "earnings per share"],
  operating_cash_flow: ["cash flow", "cash from operations"],
};

export interface RelatedInput {
  company: string;
  /** Topic words to look for. Empty means "no topic known". */
  terms: string[];
  year?: number;
  numbers: Array<{ value: number; isPercent: boolean }>;
  /** The user's own key words, used as the topic when no measure (profit, revenue ...) was named. */
  keywords?: string[];
}

const STOP = new Set(
  ("the and for with from that this these those have has had was were are been will would could should about into onto over under per not but its " +
    "his her their our your you they them than then also very just more most some any all out off new says said say claim claims claimed news").split(" "),
);

/** The meaningful words of a sentence: no company words, numbers, currencies or filler words. At most 6. */
export function keywordsOf(query: string, company: string): string[] {
  const skip = new Set(company.toLowerCase().split(/\s+/));
  const out: string[] = [];
  for (const w of query.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 3 || /\d/.test(w) || STOP.has(w) || skip.has(w) || out.includes(w)) continue;
    out.push(w);
  }
  return out.slice(0, 6);
}

/** "raises" must also find "raised" and "raising": compare on the beginning of the word. */
const stem = (w: string) => (w.length > 5 ? w.slice(0, -2) : w.length > 4 ? w.slice(0, -1) : w);
const needed = (n: number) => (n <= 2 ? n : n <= 4 ? 2 : 3);

export type Reason = "figure" | "topic" | "year" | "company";

export interface Relevance {
  score: number;
  reasons: Reason[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Scores one text against the user's sentence. The company only counts when it is named in the HEADLINE (default: the
 * text itself), so a story that mentions the company in passing is not taken for a story about it.
 */
export function relevance(text: string, input: RelatedInput, headline = text): Relevance {
  const reasons: Reason[] = [];
  let score = 0;

  const found = extractNumbers(text);
  const amount = input.numbers.some((n) => !n.isPercent && found.some((f) => !f.isPercent && approxEqual(f.value, n.value)));
  const percent = input.numbers.some((n) => n.isPercent && found.some((f) => f.isPercent && approxEqual(f.value, n.value)));
  if (amount) score += 4;
  else if (percent) score += 2;
  if (amount || percent) reasons.push("figure");

  let topic = input.terms.some((t) => new RegExp(`(?<![A-Za-z])${escapeRe(t)}(?![A-Za-z])`, "i").test(text));
  let everyKeyword = false;
  if (!input.terms.length && input.keywords?.length) {
    const hits = input.keywords.filter((k) => new RegExp(`(?<![A-Za-z])${escapeRe(stem(k))}`, "i").test(text)).length;
    topic = hits >= needed(input.keywords.length);
    if (topic) score += 0.1 * hits; // a story that uses more of the user's words ranks higher
    everyKeyword = input.keywords.length >= 3 && hits === input.keywords.length;
  }
  if (topic) {
    score += 2;
    reasons.push("topic");
    if (everyKeyword) score += 1;
  }
  if (input.year && new RegExp(`(?<!\\d)${input.year}(?!\\d)`).test(text)) {
    score += 1;
    reasons.push("year");
  }
  const first = input.company.trim().split(/\s+/)[0];
  if (first && new RegExp(`(?<![A-Za-z])${escapeRe(first)}`, "i").test(headline)) {
    score += 1;
    reasons.push("company");
  }
  return { score, reasons };
}

/** The part of a story we score: its headline, its quote and every outlet's headline. */
interface StoryLike {
  head: { title: string };
  quote?: { text: string };
  items: Array<{ title?: string; text?: string }>;
}

export function storyText(s: StoryLike): string {
  return [s.head.title, s.quote?.text ?? "", ...s.items.map((i) => `${i.title ?? ""} ${i.text ?? ""}`)].join(" \n ");
}

/** Stories related to the sentence, best first. Never more than `max`. */
export function relatedStories<T extends StoryLike>(stories: T[], input: RelatedInput, max = 6): T[] {
  return stories
    .map((story, index) => ({ story, index, ...relevance(storyText(story), input, story.head.title) }))
    // Topic and year alone are not enough: the story must also carry the user's figure or name the company in its headline.
    .filter((x) => x.score >= RELATED_THRESHOLD && (x.reasons.includes("figure") || x.reasons.includes("company")))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, max)
    .map((x) => x.story);
}

// ---------------------------------------------------------------------------
// Which outlet's words to show
// ---------------------------------------------------------------------------

const TIER_RANK: Record<string, number> = { primary: 3, wire: 2, trade: 1, unknown: 0 };

/**
 * A story is often covered by several outlets, each with its own summary. For a focused search, show the outlet text that fits
 * the search best (for example the one that holds the user's figure) instead of simply the first one.
 * Every candidate is a slice copied from that outlet's own text (see quoteFrom), so nothing is reworded.
 * Returns undefined when no outlet fits better than the quote the story already has.
 */
export function bestQuoteFor<I extends StoryItem>(story: { head: { title: string }; quote?: Quote; items: I[] }, input: RelatedInput): Quote | undefined {
  const titles = story.items.map((i) => i.title);
  const scored = story.items
    .filter((i) => !i.weak)
    .flatMap((i) => {
      const text = quoteFrom(i, 280, titles);
      if (!text) return [];
      const quote: Quote = { text, publisher: i.publisher, tier: i.tier, publishedAt: i.publishedAt, url: i.url };
      return [{ quote, score: relevance(`${i.title} ${text}`, input, i.title).score, tier: TIER_RANK[i.tier] ?? 0 }];
    })
    .sort((a, b) => b.score - a.score || b.tier - a.tier);
  const best = scored[0];
  if (!best) return undefined;
  const current = story.quote ? relevance(`${story.head.title} ${story.quote.text}`, input, story.head.title).score : -1;
  return best.score > current ? best.quote : undefined;
}
