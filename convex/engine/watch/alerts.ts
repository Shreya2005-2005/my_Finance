/**
 * WATCH ALERTS: which stories deserve a user's attention?
 *
 * Plain rules, no AI:
 *   - At most MAX_ALERTS (5) per company, never more. Too many alerts and people stop reading them.
 *   - Only stories from recognised sources (never social posts, forums or unknown publishers).
 *   - Most important first. Ties go to the story covered by more trusted outlets, then to the newer one.
 */
import type { AuthorityTier } from "../enums.ts";
import { keywords, type Story, type StoryItem } from "./stories.ts";

export const MAX_ALERTS = 5;

export type AlertLevel = "important" | "worth" | "fyi";

/** Importance (0 to 100) in words a person understands. */
export function alertLevel(importance: number): AlertLevel {
  if (importance >= 55) return "important";
  if (importance >= 30) return "worth";
  return "fyi";
}

/** Longer words that appear in many unrelated headlines, so sharing one does not mean "same event". */
const EVERYDAY = new Set(["vehicle", "company", "industry", "business", "technology", "development", "investment", "quarter", "product", "results", "revenue", "shares", "market", "growth", "launch", "report", "analyst", "expect", "passenger", "global", "annual", "festive", "september", "october", "november"]);

const TIER_RANK: Record<AuthorityTier, number> = { primary: 3, wire: 2, trade: 1, unknown: 0 };

/** Outlet names of a story, most trusted first, one entry per outlet. */
export function outletNames(story: Story<StoryItem>): Array<{ name: string; tier: AuthorityTier }> {
  const seen = new Map<string, { name: string; tier: AuthorityTier }>();
  for (const i of story.items) {
    if (i.weak) continue;
    const name = i.publisher ?? "Unknown";
    const k = name.toLowerCase();
    const cur = seen.get(k);
    if (!cur || TIER_RANK[i.tier] > TIER_RANK[cur.tier]) seen.set(k, { name, tier: i.tier });
  }
  return [...seen.values()].sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier]);
}

/** One plain sentence on why a story is an alert, for example "Reported by 14 outlets, including Reuters and Mint." */
export function whyText(story: Story<StoryItem>): string {
  const outlets = outletNames(story);
  const majors = outlets.filter((o) => o.tier === "primary" || o.tier === "wire").map((o) => o.name);
  const count = outlets.length;
  const who = majors.length ? `, including ${majors.slice(0, 2).join(" and ")}` : "";
  if (count <= 1) return majors.length ? `Reported by ${majors[0]}.` : "Reported by one outlet so far.";
  return `Reported by ${count} outlets${who}.`;
}

/**
 * The alerts to show for a company: recognised sources only, ranked, never more than the limit.
 * Two alerts about the same event would waste a slot, so a candidate that shares 2 or more meaningful words
 * with an alert already chosen (for example both name "Stellantis") is skipped.
 */
export function pickTopAlerts<T extends Story<StoryItem>>(stories: T[], max = MAX_ALERTS, companyWords: string[] = []): T[] {
  const limit = Math.max(0, Math.min(max, MAX_ALERTS)); // the cap cannot be raised by a caller
  const ranked = stories
    .filter((s) => s.trust !== "weak_only")
    .sort((a, b) => b.importance - a.importance || b.trustedOutlets - a.trustedOutlets || (b.lastSeen ?? 0) - (a.lastSeen ?? 0));

  // Words that say nothing about WHICH event: the company's own name, and any word in most headlines.
  const ignore = new Set(companyWords.flatMap((w) => [...keywords(w, new Set())]));
  const counts = new Map<string, number>();
  for (const s of ranked) for (const w of keywords(s.head.title, ignore)) counts.set(w, (counts.get(w) ?? 0) + 1);
  // Safety net if the company name was not given: a word in nearly every headline is the company, not an event.
  // (80%, not lower: a big event can legitimately appear in over half the headlines.)
  if (ranked.length >= 6) for (const [w, c] of counts) if (c / ranked.length >= 0.8) ignore.add(w);

  const chosen: T[] = [];
  const skipped: T[] = [];
  const picked: Array<Set<string>> = [];
  for (const s of ranked) {
    if (chosen.length >= limit) break;
    const words = keywords(s.head.title, ignore);
    // Same event if they share 2 meaningful words, or one distinctive name (such as "Stellantis" or "Iveco").
    const distinctive = (w: string) => w.length >= 7 && !EVERYDAY.has(w) && (counts.get(w) ?? 0) / ranked.length <= 0.6;
    const repeats = picked.some((p) => {
      const shared = [...words].filter((w) => p.has(w));
      return shared.length >= 2 || shared.some(distinctive);
    });
    if (repeats) skipped.push(s);
    else (chosen.push(s), picked.push(words));
  }
  // Only if there are fewer than `limit` distinct events, top up with the best of the repeats, so the user still gets a full list.
  for (const s of skipped) {
    if (chosen.length >= limit) break;
    chosen.push(s);
  }
  return chosen;
}
