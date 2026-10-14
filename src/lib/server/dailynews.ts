/**
 * Daily news: Finnhub's general market headlines, picked and tidied by plain code (see convex/engine/news/daily.ts).
 * Kept for 10 minutes so many visitors do not use up Finnhub's free allowance; a failure is never kept.
 */
import { CACHE_TTL_MS } from "$config/engine.ts";
import { pickDailyNews } from "$engine/news/daily.ts";
import { withRetry } from "$engine/lib/resilience.ts";
import { assignPhotos, firstQueries } from "$engine/news/photos.ts";
import { searchPhotos, type Photo } from "$engine/providers/commons.ts";
import { marketNews } from "$engine/providers/finnhub.ts";
import type { DailyNewsResponse } from "$lib/types";
import { cached, forget, providerContext } from "./context";

const KEY = "dailynews5";
const DAY = 24 * 60 * 60 * 1000;

/**
 * Wikimedia asks programs to make ONE request at a time and to back off when told "too many requests". So: no parallel
 * searches, no waiting out a "slow down" (a visitor never waits for it), and every answer is remembered for a day.
 */
let blockedUntil = 0;
let nextSlot = 0;
const SPACING_MS = 1_500; // about one search a second
const PHOTO_BUDGET_MS = 22_000; // the photo step never holds the page longer than this

/** Photos for one search, remembered for a day. Nothing is remembered when the search failed or found nothing. */
async function photosFor(query: string, deadline: number): Promise<Photo[]> {
  const ctx = providerContext();
  const key = `commons1:${query.toLowerCase()}`;
  const found = await cached<Photo[] | null>(key, DAY, async () => {
    if (Date.now() < blockedUntil || Date.now() > deadline) return null;
    // Space the requests out: Wikimedia's limit is on how fast they arrive, not only on how many.
    const wait = nextSlot - Date.now();
    nextSlot = Math.max(nextSlot, Date.now()) + SPACING_MS;
    if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    if (Date.now() > deadline) return null;
    let r = await searchPhotos(query, ctx);
    // A short "slow down" (a few seconds) is waited out once, inside the time budget, so this story still gets its photo.
    if (!r.ok && r.error.kind === "RATE_LIMITED" && (r.error.retryAfterMs ?? Infinity) <= 8_000 && Date.now() + (r.error.retryAfterMs ?? 0) < deadline) {
      await new Promise((res) => setTimeout(res, (r.ok ? 0 : (r.error.retryAfterMs ?? 0)) + 300));
      nextSlot = Date.now() + SPACING_MS;
      r = await searchPhotos(query, ctx);
    }
    if (!r.ok) {
      if (r.error.kind === "RATE_LIMITED") blockedUntil = Date.now() + Math.min(r.error.retryAfterMs ?? 60_000, 5 * 60_000);
      return null;
    }
    return r.value;
  });
  if (!found?.length) forget(key);
  return found ?? [];
}

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
