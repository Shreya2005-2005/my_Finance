/**
 * Daily news: Finnhub's general market headlines, picked and tidied by plain code (see convex/engine/news/daily.ts).
 * Kept for 10 minutes so many visitors do not use up Finnhub's free allowance; a failure is never kept.
 */
import { CACHE_TTL_MS } from "$config/engine.ts";
import { pickDailyNews } from "$engine/news/daily.ts";
import { withRetry } from "$engine/lib/resilience.ts";
import { assignPhotos, firstQueries } from "$engine/news/photos.ts";
import { marketNews } from "$engine/providers/finnhub.ts";
import type { DailyNewsResponse } from "$lib/types";
import { cached, forget, providerContext } from "./context";
import { PHOTO_BUDGET_MS, photosFor } from "./photos";

const KEY = "dailynews6";

export async function dailyNews(): Promise<DailyNewsResponse> {
  const ctx = providerContext();
  if (!ctx.env.FINNHUB_API_KEY) return { items: [], windowHours: 24, fetchedAt: ctx.now(), error: "Daily news needs a Finnhub key. Add FINNHUB_API_KEY to .env.local." };

  const res = await cached(KEY, CACHE_TTL_MS.news, async (): Promise<DailyNewsResponse> => {
    const r = await withRetry(() => marketNews("general", ctx));
    if (!r.ok) {
      const k = r.error.kind;
      const error =
        k === "RATE_LIMITED" ? "Finnhub asked us to slow down. Try again in a minute." :
        k === "AUTH" ? "Finnhub refused the key. Check FINNHUB_API_KEY in .env.local." :
        k === "TIMEOUT" ? "Finnhub did not answer in time. Try again." :
        k === "SCHEMA_DRIFT" ? "Finnhub changed its data format, so the news could not be read." :
        `Finnhub is not reachable right now (${r.error.message}).`;
      return { items: [], windowHours: 24, fetchedAt: ctx.now(), error };
    }
    const picked = pickDailyNews(r.value, ctx.now());
    // Every story gets a photo of its topic (no two the same). Searches run one after another, within a time budget.
    const deadline = Date.now() + PHOTO_BUDGET_MS;
    for (const q of firstQueries(picked.items)) await photosFor(q, deadline);
    const items = await assignPhotos(picked.items, (q) => photosFor(q, deadline));
    return { ...picked, items, fetchedAt: ctx.now() };
  });
  // A list that is still missing photos (Wikimedia was busy) is not kept, so the next visit finishes the job. The searches
  // that did work are already remembered, so that next try is quick.
  if (res.error || res.items.some((i) => !i.photo)) forget(KEY);
  return res;
}
