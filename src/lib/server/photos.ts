/**
 * Topic photos from Wikimedia Commons, shared by every news page.
 *
 * Wikimedia asks programs to make ONE request at a time and to back off when told "too many requests". So: no parallel
 * searches, short "slow down" waits are served once inside the time budget, longer ones make us stop asking for a while
 * (a visitor never waits for that), and every answer is remembered for a day.
 */
import { searchPhotos, type Photo } from "$engine/providers/commons.ts";
import { cached, forget, providerContext } from "./context";

const DAY = 24 * 60 * 60 * 1000;
const SPACING_MS = 1_500; // about one search a second
/** The photo step never holds a page longer than this. */
export const PHOTO_BUDGET_MS = 22_000;

let blockedUntil = 0;
let nextSlot = 0;

/** Photos for one search, remembered for a day. Nothing is remembered when the search failed or found nothing. */
export async function photosFor(query: string, deadline: number): Promise<Photo[]> {
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
