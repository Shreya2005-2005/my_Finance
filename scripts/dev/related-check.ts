/**
 * LIVE CHECK: for a typed question or claim, which stories does the page show?
 *
 * Needs the website running (npm run dev). Run:
 *   node scripts/dev/related-check.ts "oracle claims Operating profit. ₹803.80 Cr. in 2026 opening" http://localhost:5174
 */
import { bestQuoteFor, relatedStories } from "../../convex/engine/claims/related.ts";

const query = process.argv[2] ?? "Oracle had an operating profit of ₹803.80 Cr in 2026";
const base = process.argv[3] ?? "http://localhost:5173";

const ask = await (await fetch(`${base}/api/ask?q=${encodeURIComponent(query)}`)).json();
console.log("understood:", { kind: ask.kind, company: ask.company, by: ask.understoodBy, search: ask.search });
if (ask.kind === "company") process.exit(0);

const focus: string = ask.search?.focus ?? "";
const ev = await (await fetch(`${base}/api/evidence?company=${encodeURIComponent(ask.company)}&days=30&focus=${encodeURIComponent(focus)}`)).json();
console.log(`searched: ${ev.coverage.items} items, ${ev.stories.length} stories`);
const input = { company: ask.company, terms: ask.search?.terms ?? [], keywords: ask.search?.keywords, year: ask.search?.year, numbers: ask.claimNumbers ?? [] };
const related = relatedStories(ev.stories, input);
console.log(`related: ${related.length}`);
for (const s of related) {
  const q = bestQuoteFor(s as never, input) ?? (s.quote as { publisher?: string; text: string } | undefined);
  console.log(" -", (s.head as { publisher?: string }).publisher, "|", s.head.title);
  if (q) console.log("     quote:", q.publisher, "|", q.text.slice(0, 110));
}
