/**
 * STORIES: turn dozens of differently worded headlines into a few real-world events.
 *
 * Why this matters to a user: one deal was reported in ~30 headlines ("expand partnership", "ink pact",
 * "join hands" ...). Showing 30 rows hides the fact that it is ONE event. Grouping them lets us say
 * "reported by 14 outlets", which is the strongest trust signal available without official filings.
 *
 * All plain code, no AI. The method (documented so it can be challenged):
 *   1. Reduce each headline to its meaningful words (drop filler, the company's own name, news-speak).
 *   2. Words that are rare across the batch count more (a name like "Stellantis" matters more than "global").
 *   3. Two headlines are the same story if they share enough weighted words, within a time window.
 *   4. Small groups that mention a big group's signature word are attached to it.
 */
import type { AuthorityTier, EventType } from "../enums.ts";
import { fastHash, normalizeText, similarity } from "../lib/text.ts";
import { classifyEvent, importanceScore } from "./events.ts";

const DAY = 86_400_000;

export interface StoryItem {
  title: string;
  /** Text from the source, if any: a summary or description. Used for quotes. */
  text?: string;
  publisher?: string;
  tier: AuthorityTier;
  /** Social posts, video and forums. */
  weak: boolean;
  publishedAt?: number;
  url: string;
}

export type TrustLabel = "well_reported" | "major_outlet" | "single_outlet" | "weak_only";

export interface Quote {
  text: string;
  publisher?: string;
  tier: AuthorityTier;
  publishedAt?: number;
  url: string;
}

export interface Story<T extends StoryItem = StoryItem> {
  /** Stable across refreshes: based on the earliest headline. */
  key: string;
  type: EventType;
  basis: "rule" | "ambiguous";
  head: T;
  items: T[];
  outlets: number;
  /** Outlets that are not social or forum posts. */
  trustedOutlets: number;
  trust: TrustLabel;
  firstSeen?: number;
  lastSeen?: number;
  importance: number;
  quote?: Quote;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const STOP = new Set(
  ("a an the and or of to in on for with at by from as is are was were be been it its this that these those into over after before about " +
    "says said say will would may can could has have had not no new more most amid per via up down out off than then also but if how why what who when " +
    "live today latest news update updates report reports reported share shares stock stocks price prices market markets watch check here key top " +
    "company limited ltd inc corp plc group india indian").split(" "),
);

/** Words that mean the same thing in headlines. Mapping them lets "ink pact" match "expand partnership". */
const SYNONYMS: Record<string, string> = {
  pact: "deal", agreement: "deal", partnership: "deal", tie: "deal", tieup: "deal", collaboration: "deal", alliance: "deal", venture: "deal",
  expand: "expand", expands: "expand", broaden: "expand", broadens: "expand", widen: "expand", widens: "expand", deepen: "expand", deepens: "expand",
  sign: "sign", signs: "sign", signed: "sign", ink: "sign", inks: "sign", formalise: "sign", formalize: "sign",
  join: "deal", joins: "deal", hands: "deal",
  vehicles: "vehicle", cars: "vehicle", car: "vehicle", evs: "ev",
  markets: "market", plants: "plant", factories: "plant", factory: "plant",
  profit: "profit", profits: "profit", earnings: "profit", income: "profit",
  rises: "rise", rise: "rise", jumps: "rise", surges: "rise", gains: "rise", climbs: "rise",
  falls: "fall", fall: "fall", drops: "fall", slips: "fall", declines: "fall", slumps: "fall", tumbles: "fall",
};

/**
 * Words so common in business headlines that sharing them says nothing about being the same story
 * ("expand deal", "sign agreement"). They are used for matching synonyms but never count as evidence.
 */
const GENERIC = new Set(["deal", "expand", "sign", "develop", "launch", "announce", "plan", "target", "focus", "build", "make", "get", "take", "set", "year", "week", "month", "first", "high", "low", "big", "key", "major", "ahead", "buy", "sell", "view", "check", "explain", "explained", "details", "detail", "know", "need", "full"]);

function stem(w: string): string {
  const s = SYNONYMS[w];
  if (s) return s;
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** The meaningful words of a headline, as a set. `ignore` holds the company's own name words. */
export function keywords(title: string, ignore: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const raw of normalizeText(title).split(" ")) {
    const w = raw.replace(/\.$/, "");
    if (w.length < 2 || STOP.has(w) || ignore.has(w)) continue;
    const s = stem(w);
    if (!STOP.has(s) && !GENERIC.has(s) && !ignore.has(s)) out.add(s);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export interface ClusterOptions {
  /** Words of the company's own name (they appear in every headline, so they say nothing). */
  companyWords: string[];
  /** Headlines further apart than this are never the same story. */
  windowMs?: number;
}

/** Splits items into groups, each group one real-world story. Order inside a group is oldest first. */
export function clusterItems<T extends StoryItem>(items: T[], opts: ClusterOptions): T[][] {
  const windowMs = opts.windowMs ?? 3 * DAY;
  const ignore = new Set(opts.companyWords.flatMap((w) => [...keywords(w, new Set())]));
  const n = items.length;
  const sets = items.map((i) => keywords(i.title, ignore));

  // How rare is each word in this batch? Rare words are better evidence of "same story".
  const df = new Map<string, number>();
  for (const s of sets) for (const w of s) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = (w: string) => Math.log(1 + n / (df.get(w) ?? 1));

  const near = (a: StoryItem, b: StoryItem) => a.publishedAt === undefined || b.publishedAt === undefined || Math.abs(a.publishedAt - b.publishedAt) <= windowMs;
  const weightOf = (s: Set<string>) => [...s].reduce((t, w) => t + idf(w), 0);
  const weights = sets.map(weightOf);

  /** How alike two headlines are, 0 to 1. Zero unless they share 2+ words, at least one of them uncommon. */
  const pairSim = (i: number, j: number): number => {
    if (!near(items[i]!, items[j]!)) return 0;
    const A = sets[i]!;
    const B = sets[j]!;
    if (A.size === 0 || B.size === 0) return 0;
    let shared = 0;
    let sharedWeight = 0;
    let hasRare = false;
    for (const w of A) {
      if (!B.has(w)) continue;
      shared++;
      sharedWeight += idf(w);
      if (w.length >= 4 && (df.get(w) ?? 0) / n <= 0.45) hasRare = true;
    }
    if (shared < 2 || !hasRare) return 0;
    return sharedWeight / Math.min(weights[i]!, weights[j]!);
  };

  // Pass 1: build groups one headline at a time, oldest first. A headline joins a group only if it is
  // similar to the group ON AVERAGE (not merely to one member), which stops unrelated stories chaining together.
  const pass1 = (ids: number[]): number[][] => {
    const order = [...ids].sort((a, b) => (items[a]!.publishedAt ?? 0) - (items[b]!.publishedAt ?? 0));
    const groups: number[][] = [];
    for (const i of order) {
      let best = -1;
      let bestAvg = 0.3;
      for (let g = 0; g < groups.length; g++) {
        const avg = groups[g]!.reduce((t, m) => t + pairSim(i, m), 0) / groups[g]!.length;
        const dup = groups[g]!.some((m) => similarity(items[i]!.title, items[m]!.title) >= 0.8);
        if (dup && avg === 0) continue;
        if (avg > bestAvg || (dup && best === -1)) (best = g, (bestAvg = Math.max(avg, bestAvg)));
      }
      if (best >= 0) groups[best]!.push(i);
      else groups.push([i]);
    }
    return groups;
  };

  /** Words found in most headlines of a group: its "signature" (for example a name like "Stellantis"). */
  const signatureOf = (idxs: number[]): Set<string> => {
    const sig = new Set<string>();
    if (idxs.length < 6) return sig;
    const counts = new Map<string, number>();
    for (const m of idxs) for (const w of sets[m]!) counts.set(w, (counts.get(w) ?? 0) + 1);
    // Only distinctive words qualify (names and topics), never everyday words like "vehicle" or "market".
    for (const [w, c] of counts) if (c / idxs.length >= 0.6 && (df.get(w) ?? 0) / n <= 0.3 && w.length >= 5) sig.add(w);
    return sig;
  };

  let groups = pass1(items.map((_, i) => i));

  // Pass 2: groups with the same signature are the same story: merge them.
  for (let changed = true; changed; ) {
    changed = false;
    const sigs = groups.map(signatureOf);
    outer: for (let a = 0; a < groups.length; a++) {
      for (let b = a + 1; b < groups.length; b++) {
        const shared = [...sigs[a]!].filter((w) => sigs[b]!.has(w)).length;
        if (shared >= 1 && shared >= Math.ceil(0.5 * Math.min(sigs[a]!.size, sigs[b]!.size))) {
          groups[a] = [...groups[a]!, ...groups[b]!];
          groups.splice(b, 1);
          changed = true;
          break outer;
        }
      }
    }
  }

  // Pass 3: in a group with a signature, headlines that lack it do not belong. Send them out to be regrouped.
  // Then any headline that DOES contain a signature joins that story, wherever pass 1 put it.
  const sigs = groups.map(signatureOf);
  const leftover: number[] = [];
  groups = groups.map((idxs, g) => {
    if (sigs[g]!.size === 0) {
      // Small groups (1 to 3 headlines) also get a chance to join a bigger story.
      if (idxs.length <= 3) (leftover.push(...idxs), (idxs = []));
      return idxs;
    }
    const keep = idxs.filter((i) => [...sets[i]!].some((w) => sigs[g]!.has(w)));
    leftover.push(...idxs.filter((i) => !keep.includes(i)));
    return keep;
  });
  const pending = new Set(leftover);
  for (const i of [...pending]) {
    let bestGroup = -1;
    let bestWeight = 0;
    sigs.forEach((sig, g) => {
      if (sig.size === 0 || groups[g]!.length === 0) return;
      if (!near(items[i]!, items[groups[g]![0]!]!)) return;
      const hit = [...sets[i]!].filter((w) => sig.has(w)).reduce((t, w) => t + idf(w), 0);
      if (hit > bestWeight) (bestWeight = hit, (bestGroup = g));
    });
    if (bestGroup >= 0) (groups[bestGroup]!.push(i), pending.delete(i));
  }
  // Headlines outside every group get a second, small grouping among themselves.
  groups = [...groups.filter((g) => g.length > 0), ...pass1([...pending])];

  return groups.map((g) => g.map((i) => items[i]!).sort((a, b) => (a.publishedAt ?? 0) - (b.publishedAt ?? 0)));
}

// ---------------------------------------------------------------------------
// Trust and quotes
// ---------------------------------------------------------------------------

const normPublisher = (p?: string) => (p ?? "unknown").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, "");

/** Plain rules, no AI. See the Methodology page for the same wording. */
export function trustLabel(items: StoryItem[]): { label: TrustLabel; outlets: number; trustedOutlets: number } {
  const all = new Set(items.map((i) => normPublisher(i.publisher)));
  const solid = items.filter((i) => !i.weak);
  const trusted = new Set(solid.map((i) => normPublisher(i.publisher)));
  const hasMajor = solid.some((i) => i.tier === "primary" || i.tier === "wire");
  const hasReal = solid.some((i) => i.tier !== "unknown");
  let label: TrustLabel;
  if (trusted.size >= 3 && hasMajor) label = "well_reported";
  else if (hasMajor) label = "major_outlet";
  else if (hasReal && trusted.size >= 1) label = "single_outlet";
  else label = "weak_only";
  // Several trade outlets agreeing is still more than a single outlet.
  return { label: label === "single_outlet" && trusted.size === 1 ? "single_outlet" : label, outlets: all.size, trustedOutlets: trusted.size };
}

/** Sentence spans of a text, as positions in the original (so slices stay exact). */
function sentenceSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (const m of text.matchAll(/[.!?](?=\s|$)/g)) {
    const end = (m.index ?? 0) + 1;
    spans.push({ start, end });
    start = end;
  }
  if (start < text.length) spans.push({ start, end: text.length });
  return spans.map((s) => {
    while (s.start < s.end && /\s/.test(text[s.start]!)) s.start++;
    return s;
  });
}

/** If `text` begins with `title` (ignoring punctuation and case), returns the text after it. */
export function dropTitlePrefix(text: string, title: string): string {
  const t = title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (t.length < 20) return text;
  let ti = 0;
  let i = 0;
  for (; i < text.length && ti < t.length; i++) {
    const ch = text[i]!.toLowerCase();
    if (!/[\p{L}\p{N}]/u.test(ch)) continue;
    if (ch !== t[ti]) return text;
    ti++;
  }
  return ti === t.length ? text.slice(i).replace(/^[\s\-–—:|·;,]+/, "") : text;
}

const words3 = (s: string) => normalizeText(s).split(" ").filter((w) => w.length > 2);

/**
 * Pages often start their text with the headline plus a teaser ("... Infosys may cut guidance; here's what to watch").
 * If the first clause (up to a ; : | or dash) is mostly the same words as a headline, it is dropped.
 */
export function dropEchoedLead(text: string, titles: string[]): string {
  const sets = titles.map((t) => new Set(words3(t)));
  let out = text;
  for (let pass = 0; pass < 2; pass++) {
    let cut = -1;
    for (const m of out.matchAll(/[;:|]| [-–—] /g)) {
      const p = m.index ?? 0;
      if (p > 220) break;
      const lead = words3(out.slice(0, p));
      if (lead.length < 4) continue;
      if (sets.some((ts) => lead.filter((w) => ts.has(w)).length / lead.length >= 0.8)) cut = p + m[0].length;
    }
    if (cut < 0) break;
    out = out.slice(cut).trim();
  }
  // Teaser words left behind by a headline: "here's what to watch", "what to expect".
  return out.replace(/^(?:[Hh]ere['’]?s|[Hh]ere is|[Ww]hat to (?:watch|expect)|[Kk]ey takeaways?|[Dd]etails)\b[^A-Z]{0,35}(?=[A-Z])/, "").trim();
}

/** Text that belongs to the website, not the article. */
const PAGE_FURNITURE = /(about the author|sign up|subscribe|read more|click here|advertisement|follow us|all rights reserved|cookie|newsletter|download the app|share this)/i;

/** Where a page's menu or "related links" block starts inside a description. */
const MENU_START = /\s(?:FROM MARKETS|RELATED LINKS|RELATED ARTICLES|TRENDING NOW|MOST READ|Also Read\b|Read Next\b|Top Stories\b)/;

const FUNCTION_WORDS = new Set("the of to in and a an is was for on with by at that as it from its has have will said are were be been this".split(" "));

/**
 * A list of page tags, not a sentence: no sentence ending and almost none of the small words
 * (the, of, to, in, was ...) that every real sentence contains.
 */
const isTagSoup = (s: string) => {
  const words = s.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length < 6) return false;
  const small = words.filter((w) => FUNCTION_WORDS.has(w)).length;
  return small / words.length < 0.08 && !/[.!?]["”')]?\s*$/.test(s);
};

/**
 * A run of figures with almost no words: a stock-ticker strip ("10635.75 35.85 (0.33%) 2,971 10599.90 ..."), not a sentence.
 * A real quote that holds numbers has plenty of words around them.
 */
export const isNumberSoup = (s: string) => {
  const tokens = s.split(/\s+/).filter(Boolean);
  const numeric = tokens.filter((t) => /\d/.test(t) && !/[A-Za-z]{3,}/.test(t)).length;
  const words = tokens.filter((t) => /^[(\["“'‘]*[A-Za-z]{3,}[.,;:!?)\]"”'’]*$/.test(t)).length;
  return numeric >= 6 && numeric > 1.5 * words;
};

/**
 * A short passage COPIED from the source text. Because it is a slice of the original, it can never say
 * something the source did not say. Skipped: short leading fragments (menu words, "Watch", "Sign up"),
 * the headline when the text starts with it, and lists of page tags.
 * Returns undefined if nothing readable is left.
 */
export function quoteFrom(item: StoryItem, maxChars = 280, otherTitles: string[] = []): string | undefined {
  const original = item.text?.trim();
  if (!original || original.length < 60) return undefined;
  if (similarity(original, item.title) >= 0.6) return undefined;

  // Remove a headline the page repeats at the start of its text (this item's, or any in the story).
  let text: string = original;
  for (const t of [item.title, ...otherTitles].sort((a, b) => b.length - a.length)) text = dropTitlePrefix(text, t);
  text = dropEchoedLead(text.trim(), [item.title, ...otherTitles]);
  // Cut the text where website menu text begins ("FROM MARKETS", "RELATED LINKS" ...); what is before it is still the page's own words.
  const menuAt = text.search(MENU_START);
  if (menuAt >= 0) text = text.slice(0, menuAt).trim();
  if (text.length < 60) return undefined;
  if (otherTitles.some((t) => similarity(text, t) >= 0.6)) return undefined;

  const spans = sentenceSpans(text);
  // Start at the first real sentence: at least 8 words and 50 characters, and not page furniture.
  const first = spans.findIndex((s) => {
    const sentence = text.slice(s.start, s.end);
    return s.end - s.start >= 50 && sentence.split(/\s+/).length >= 8 && !PAGE_FURNITURE.test(sentence);
  });
  if (first < 0) return text.length <= maxChars && !isNumberSoup(text) ? text : undefined;
  const start = spans[first]!.start;

  let end = spans[first]!.end;
  for (let k = first + 1; k < spans.length; k++) {
    if (spans[k]!.end - start > maxChars) break;
    end = spans[k]!.end;
    if (end - start >= 160) break; // two or three sentences is plenty
  }
  // Cut the passage where website menu text begins ("FROM MARKETS", "RELATED LINKS" ...); what is before it is still the page's own words.
  let slice = text.slice(start, end).trim();
  const menu = slice.search(MENU_START);
  if (menu >= 0) slice = slice.slice(0, menu).trim();
  if (slice.length < 40) return undefined;
  if (isTagSoup(slice) || isNumberSoup(slice) || PAGE_FURNITURE.test(slice)) return undefined;
  return slice.length <= maxChars ? slice : `${slice.slice(0, maxChars).trimEnd()}…`;
}

const TIER_RANK: Record<AuthorityTier, number> = { primary: 3, wire: 2, trade: 1, unknown: 0 };

export function buildStories<T extends StoryItem>(items: T[], opts: ClusterOptions & { now: number }): Story<T>[] {
  const stories: Story<T>[] = [];
  for (const group of clusterItems(items, opts)) {
    // The headline shown is from the best source in the group (ties: earliest).
    const head = [...group].sort((a, b) => Number(a.weak) - Number(b.weak) || TIER_RANK[b.tier] - TIER_RANK[a.tier] || (a.publishedAt ?? 0) - (b.publishedAt ?? 0))[0]!;
    const earliest = group[0]!;
    // The topic is a vote among the group's headlines (one odd headline should not decide it).
    const votes = new Map<EventType, number>();
    for (const g of group) {
      const c = classifyEvent(g.title);
      if (c.basis === "rule") votes.set(c.type, (votes.get(c.type) ?? 0) + 1);
    }
    const winner = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    const cls = winner && winner[1] >= Math.max(2, group.length * 0.2) ? { type: winner[0], basis: "rule" as const } : classifyEvent(head.title, head.text ?? "");
    const t = trustLabel(group);
    const times = group.map((g) => g.publishedAt).filter((x): x is number => x !== undefined);
    const lastSeen = times.length ? Math.max(...times) : undefined;

    const titles = group.map((g) => g.title);
    const quoteItem = [...group]
      .filter((g) => !g.weak && quoteFrom(g, 280, titles))
      .sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || (b.text?.length ?? 0) - (a.text?.length ?? 0))[0];
    const bestTier = group.reduce<AuthorityTier>((best, g) => (TIER_RANK[g.tier] > TIER_RANK[best] ? g.tier : best), "unknown");

    stories.push({
      key: fastHash(normalizeText(earliest.title)),
      type: cls.type,
      basis: cls.basis,
      head,
      items: group,
      outlets: t.outlets,
      trustedOutlets: t.trustedOutlets,
      trust: t.label,
      firstSeen: times.length ? Math.min(...times) : undefined,
      lastSeen,
      importance: importanceScore({ type: cls.type, authorityTier: bestTier, publishedAt: lastSeen, now: opts.now, isNewStory: true }),
      quote: quoteItem && { text: quoteFrom(quoteItem, 280, titles)!, publisher: quoteItem.publisher, tier: quoteItem.tier, publishedAt: quoteItem.publishedAt, url: quoteItem.url },
    });
  }
  // Two different stories can start with the same headline (for example a results page that exists for several quarters).
  // Every story needs its own key, because the page uses it to tell stories apart. The first keeps its key, so "new since
  // your last visit" stays stable; later ones get a number added.
  const used = new Map<string, number>();
  for (const s of stories) {
    const n = (used.get(s.key) ?? 0) + 1;
    used.set(s.key, n);
    if (n > 1) s.key = `${s.key}-${n}`;
  }
  // Most important first: topic weight, how widely it was reported, how fresh.
  return stories.sort((a, b) => rank(b) - rank(a));
}

const rank = (s: Story<StoryItem>) => s.importance * (1 + Math.log(1 + s.trustedOutlets)) + (s.trust === "well_reported" ? 20 : 0);
