/**
 * COVERAGE TEST: GDELT (news discovery, no API key needed).
 *
 * Question it answers: "For Indian (and a few global) companies, does GDELT
 * return recent news articles, and from how many different publishers?"
 *
 * Run:  npm run spike:gdelt
 */
export {};
const COMPANIES = ["Reliance Industries", "Tata Motors", "Infosys", "HDFC Bank", "Zomato", "Apple Inc"];
const PAUSE_MS = 6000; // GDELT asks callers to go slowly, so one request every few seconds

interface GdeltArticle {
  url: string;
  title: string;
  seendate: string;
  domain: string;
  language: string;
  sourcecountry: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function search(company: string) {
  const url =
    "https://api.gdeltproject.org/api/v2/doc/doc?" +
    new URLSearchParams({
      query: `"${company}" sourcelang:english`,
      mode: "artlist",
      maxrecords: "25",
      format: "json",
      timespan: "7d",
      sort: "datedesc",
    });
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    let articles: GdeltArticle[] = [];
    try {
      articles = (JSON.parse(text) as { articles?: GdeltArticle[] }).articles ?? [];
    } catch {
      return { company, status: res.status, ms: Date.now() - started, note: `not JSON: ${text.slice(0, 80)}` };
    }
    const domains = new Set(articles.map((a) => a.domain));
    return {
      company,
      status: res.status,
      ms: Date.now() - started,
      articles: articles.length,
      publishers: domains.size,
      newest: articles[0]?.seendate ?? "-",
      sample: articles[0]?.title?.slice(0, 70) ?? "-",
    };
  } catch (e) {
    return { company, status: 0, ms: Date.now() - started, note: `error: ${(e as Error).message}` };
  }
}

console.log("GDELT coverage test (last 7 days, English)\n");
const rows: Array<Record<string, string | number | undefined>> = [];
for (const [i, c] of COMPANIES.entries()) {
  if (i > 0) await sleep(PAUSE_MS);
  const row = await search(c);
  rows.push(row);
  console.log(`  done: ${c}`);
}
console.log();
console.table(rows);
console.log(
  "How to read this: 'articles' = how many news items came back (max 25), 'publishers' = distinct websites.\n" +
    "GDELT gives headlines + links, NOT full article text, so we fetch the text separately later.",
);
