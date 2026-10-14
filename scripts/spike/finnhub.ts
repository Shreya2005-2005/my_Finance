/**
 * COVERAGE TEST: Finnhub (financial news + market data). Needs a FREE API key.
 *
 * Question it answers: "On the free plan, which Finnhub endpoints work for
 * Indian (NSE/BSE) stocks, compared with a US stock as a control?"
 *
 * Setup (once):
 *   1. Get a free key at https://finnhub.io/
 *   2. Create a file called .env.local in the project root containing one line:
 *        FINNHUB_API_KEY=your_key_here
 *      (.env.local is git-ignored, so the key is never committed)
 *
 * Run:  npm run spike:finnhub
 */
export {};
const KEY = process.env.FINNHUB_API_KEY;

if (!KEY) {
  console.log(
    "FINNHUB_API_KEY is not set, so this test was skipped.\n\n" +
      "To run it: create .env.local in the project root with the line\n" +
      "  FINNHUB_API_KEY=your_key_here\n" +
      "then run:  npm run spike:finnhub",
  );
  process.exit(0);
}

// AAPL is the control (we expect everything to work). The rest are Indian symbols:
// Finnhub uses a ".NS" suffix for NSE and ".BO" for BSE.
const SYMBOLS = ["AAPL", "RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS", "RELIANCE.BO"];

const day = (offsetDays: number) => new Date(Date.now() - offsetDays * 864e5).toISOString().slice(0, 10);

const ENDPOINTS: Array<{ name: string; path: (s: string) => string; hasData: (j: unknown) => boolean }> = [
  { name: "quote", path: (s) => `quote?symbol=${s}`, hasData: (j) => Number((j as { c?: number }).c) > 0 },
  { name: "profile", path: (s) => `stock/profile2?symbol=${s}`, hasData: (j) => Object.keys(j as object).length > 0 },
  { name: "news", path: (s) => `company-news?symbol=${s}&from=${day(14)}&to=${day(0)}`, hasData: (j) => Array.isArray(j) && j.length > 0 },
  {
    name: "fundamentals",
    path: (s) => `stock/metric?symbol=${s}&metric=all`,
    hasData: (j) => Object.keys((j as { metric?: object }).metric ?? {}).length > 0,
  },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log("Finnhub coverage test\n");
const rows: Array<Record<string, string>> = [];

for (const symbol of SYMBOLS) {
  const row: Record<string, string> = { symbol };
  for (const ep of ENDPOINTS) {
    try {
      const res = await fetch(`https://finnhub.io/api/v1/${ep.path(symbol)}&token=${KEY}`.replace("?&", "?"), {
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 403) row[ep.name] = "BLOCKED (plan)";
      else if (res.status === 429) row[ep.name] = "RATE LIMITED";
      else if (!res.ok) row[ep.name] = `HTTP ${res.status}`;
      else row[ep.name] = ep.hasData(await res.json()) ? "OK" : "empty";
    } catch (e) {
      row[ep.name] = `error`;
    }
    await sleep(1100); // stay well under the free-plan rate limit
  }
  rows.push(row);
}

console.table(rows);
console.log(
  "How to read this:\n" +
    "  OK            = data came back\n" +
    "  empty         = request worked but Finnhub has no data for this symbol\n" +
    "  BLOCKED (plan)= your free plan does not include this for this exchange\n" +
    "If the Indian rows are mostly empty/BLOCKED, Finnhub cannot be our main source for Indian stocks.",
);
