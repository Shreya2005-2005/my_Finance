/**
 * Indian market news: free public RSS feeds from Indian business outlets and the RBI and SEBI, picked by the same plain
 * code as the world news (see convex/engine/news/daily.ts and india.ts). No key and no AI.
 *
 * The feeds are read together (they are different websites), kept for 10 minutes, and a feed that cannot be read is
 * reported in `notes` instead of failing the page. Each story keeps the outlet's own photo; a story without one gets a
 * Wikimedia photo of its subject (Indian-aware: a market story gets the Bombay Stock Exchange).
 */
import { CACHE_TTL_MS } from "$config/engine.ts";
import { withRetry } from "$engine/lib/resilience.ts";
import { pickDailyNews, type NewsInput } from "$engine/news/daily.ts";
import { INDIA_FEEDS, toNewsInput } from "$engine/news/india.ts";
import { assignPhotos, firstQueries } from "$engine/news/photos.ts";
import { fetchFeed } from "$engine/providers/rss.ts";
import type { DailyNewsResponse } from "$lib/types";
import { cached, contactAgent, forget, providerContext } from "./context";
import { PHOTO_BUDGET_MS, photosFor } from "./photos";

const KEY = "indianews4";

export async function indianNews(): Promise<DailyNewsResponse> {
  const ctx = providerContext();
  const res = await cached(KEY, CACHE_TTL_MS.news, async (): Promise<DailyNewsResponse> => {
    const agent = contactAgent();
    const results = await Promise.all(INDIA_FEEDS.map((f) => withRetry(() => fetchFeed(`feed-${f.id}`, f.url, ctx, agent))));

    const inputs: NewsInput[] = [];
    const notes: string[] = [];
    results.forEach((r, i) => {
      const feed = INDIA_FEEDS[i]!;
      if (!r.ok) {
        notes.push(`${feed.name} (${feed.id}) could not be read just now, so its stories are missing.`);
        return;
      }
      for (const item of r.value) {
        const n = toNewsInput(feed, item, inputs.length);
        if (n) inputs.push(n);
      }
    });
    if (!inputs.length) {
      return { items: [], windowHours: 24, fetchedAt: ctx.now(), notes, error: "The Indian news feeds are not reachable right now. Try again in a few minutes." };
    }

    // At most 3 stories from any one outlet, so the list is a mix and not one site's front page.
    const picked = pickDailyNews(inputs, ctx.now(), { maxPerSource: 3 });
    const indian = picked.items.map((i) => ({ ...i, region: "india" as const }));
    // Only stories without their own photo need a stock photo: that keeps the first load fast.
    const needPhoto = indian.filter((i) => !i.image);
    const deadline = Date.now() + PHOTO_BUDGET_MS;
    for (const q of firstQueries(needPhoto)) await photosFor(q, deadline);
    const withPhotos = await assignPhotos(needPhoto, (q) => photosFor(q, deadline));
    const photoOf = new Map(withPhotos.map((i) => [i.url, i.photo]));
    const items = indian.map((i) => (i.image ? i : { ...i, photo: photoOf.get(i.url) }));
    return { ...picked, items, fetchedAt: ctx.now(), notes };
  });
  // An answer that failed, or whose stock photos are still missing (Wikimedia was busy), is not kept: the next visit finishes it.
  if (res.error || res.items.some((i) => !i.image && !i.photo)) forget(KEY);
  return res;
}
