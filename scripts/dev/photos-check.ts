/**
 * LIVE CHECK: do the photo searches for today's stories return usable photos?
 *
 *   node scripts/dev/photos-check.ts "oil refinery" "Saudi Aramco" "supermarket shelves"
 *
 * Searches run one at a time, about a second apart (Wikimedia's rule), and print what came back.
 */
import { searchPhotos } from "../../convex/engine/providers/commons.ts";

const ctx = { fetch, now: () => Date.now(), env: { CONTACT_USER_AGENT: process.env.CONTACT_USER_AGENT ?? "" } };
for (const q of process.argv.slice(2)) {
  const t = Date.now();
  const r = await searchPhotos(q, ctx);
  if (!r.ok) console.log(`FAIL  ${q} | ${r.error.kind} ${r.error.message} (retry after ${r.error.retryAfterMs ?? "-"} ms) | ${Date.now() - t} ms`);
  else console.log(`${r.value.length ? "OK  " : "EMPTY"} ${q} | ${r.value.length} photos${r.value[0] ? ` | first: ${r.value[0].title.slice(0, 50)}` : ""} | ${Date.now() - t} ms`);
  await new Promise((res) => setTimeout(res, 1500));
}
