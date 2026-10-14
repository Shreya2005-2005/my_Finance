/** Manual check: which alerts would a user see for the saved real headlines?  Run: node scripts/dev/alerts-check.ts "Tata Motors" */
import { readFileSync } from "node:fs";
import { classifyPublisher, isWeakSource } from "../../convex/engine/lib/authority.ts";
import { pickTopAlerts } from "../../convex/engine/watch/alerts.ts";
import { buildStories, keywords } from "../../convex/engine/watch/stories.ts";

const company = process.argv[2] ?? "Tata Motors";
const raw: Array<{ company: string; title: string; publisher?: string; pubDate?: string }> = JSON.parse(readFileSync(new URL("../../tests/fixtures/headlines.json", import.meta.url), "utf8"));
const stories = buildStories(
  raw.filter((r) => r.company === company).map((r) => ({ title: r.title, publisher: r.publisher, tier: classifyPublisher(r.publisher), weak: isWeakSource(r.publisher), publishedAt: r.pubDate ? Date.parse(r.pubDate) : undefined, url: "https://e.com" })),
  { companyWords: company.split(" "), now: Date.now() },
);
console.log(`${stories.length} stories. Top 8 by rank:`);
for (const s of stories.slice(0, 8)) console.log(` [${s.importance}] ${s.items.length} items | ${s.head.title.slice(0, 80)} | words: ${[...keywords(s.head.title, new Set(["tata", "motor"]))].join(",")}`);
console.log("\nAlerts picked:");
for (const s of pickTopAlerts(stories, 5, company.split(" "))) console.log(` [${s.importance}] ${s.head.title.slice(0, 90)}`);
