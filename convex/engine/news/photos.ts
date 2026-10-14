/**
 * GIVING EACH STORY ITS PHOTO.
 *
 * A story that already has a real photo of its own (some CNBC stories) keeps it. Every other story gets an illustrative
 * photo for its topic (see topic.ts). Two stories never get the same photo, even when they share a topic: the next
 * search for that topic, or the next photo in the list, is used.
 */
import type { Photo } from "../providers/commons.ts";
import { topicFor } from "./topic.ts";

export type PhotoLookup = (query: string) => Promise<Photo[]>;

const FALLBACK_QUERIES = ["financial district skyline", "business district skyline"];

/** The first photo for this story's topic that no earlier story is already using. */
async function pickPhoto(headline: string, used: Set<string>, lookup: PhotoLookup): Promise<Photo | undefined> {
  for (const q of [...topicFor(headline).queries, ...FALLBACK_QUERIES]) {
    const found = (await lookup(q).catch(() => [])).find((p) => !used.has(p.url));
    if (found) return found;
  }
  return undefined;
}

export async function assignPhotos<T extends { headline: string; image?: string }>(items: T[], lookup: PhotoLookup): Promise<Array<T & { photo?: Photo }>> {
  const used = new Set<string>();
  const out: Array<T & { photo?: Photo }> = [];
  // In order, so the newest story gets the first choice of photo.
  for (const item of items) {
    const photo = await pickPhoto(item.headline, used, lookup);
    if (photo) used.add(photo.url);
    out.push({ ...item, photo });
  }
  return out;
}

/** The first search of every story's topic: fetched together, ahead of the in-order pass, so the page is not slow. */
export const firstQueries = (items: Array<{ headline: string }>): string[] => [...new Set(items.map((i) => topicFor(i.headline).queries[0]!))];
