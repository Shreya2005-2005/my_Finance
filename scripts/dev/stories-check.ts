/**
 * Manual check: group real saved headlines into stories and print them, so the grouping can be judged by eye.
 * Run: node scripts/dev/stories-check.ts "Tata Motors"
 */
import { readFileSync } from "node:fs";
import { classifyPublisher, isWeakSource } from "../../convex/engine/lib/authority.ts";
import { buildStories, type StoryItem } from "../../convex/engine/watch/stories.ts";

const company = process.argv[2] ?? "Tata Motors";
const raw: Array<{ company: string; title: string; publisher?: string; pubDate?: string }> = JSON.parse(readFileSync(new URL("../../tests/fixtures/headlines.json", import.meta.url), "utf8"));
const items: StoryItem[] = raw
  .filter((r) => r.company === company)
  .map((r) => ({ title: r.title, publisher: r.publisher, tier: classifyPublisher(r.publisher), weak: isWeakSource(r.publisher), publishedAt: r.pubDate ? Date.parse(r.pubDate) : undefined, url: "https://example.com" }));

const stories = buildStories(items, { companyWords: company.split(" "), now: Date.now() });
console.log(`${items.length} headlines -> ${stories.length} stories\n`);
for (const s of stories.slice(0, 8)) {
  console.log(`[${s.trust}] ${s.outlets} outlets (${s.trustedOutlets} trusted) · ${s.type} · importance ${s.importance}\n   HEAD: ${s.head.title.slice(0, 110)}`);
  if (s.items.length > 2) for (const i of s.items.slice(0, 7)) console.log(`      - ${i.publisher?.slice(0, 14).padEnd(14)} | ${i.title.slice(0, 95)}`);
}
console.log("\nSingletons:", stories.filter((s) => s.items.length === 1).length);
