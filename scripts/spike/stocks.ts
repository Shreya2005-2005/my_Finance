/**
 * COVERAGE TEST: can the free stock-data plans give us INDIAN stocks (NSE and BSE)?
 *
 * Tests Twelve Data, Financial Modeling Prep and (if a key exists) Alpha Vantage on five big Indian companies,
 * with Apple as a control (we expect the control to work everywhere).
 *
 * Run:  npm run spike:stocks      (keys come from .env.local)
 */
export {};

const TD = process.env.TWELVEDATA_API_KEY;
const FMP = process.env.FMP_API_KEY;
const AV = process.env.ALPHAVANTAGE_API_KEY;

const INDIAN = [
  { name: "Reliance", nse: "RELIANCE", bse: "500325" },
  { name: "TCS", nse: "TCS", bse: "532540" },
  { name: "Infosys", nse: "INFY", bse: "500209" },
  { name: "HDFC Bank", nse: "HDFCBANK", bse: "500180" },
  { name: "ITC", nse: "ITC", bse: "500875" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Cell = string;
/** Turns an HTTP result into a short, honest label. Never prints the key. */
async function call(url: string, ok: (j: any) => string | undefined): Promise<Cell> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    let j: any;
    try {
      j = JSON.parse(text);
    } catch {
      return `HTTP ${res.status} (not JSON)`;
    }
    if (res.status === 429) return "RATE LIMITED";
    if (res.status === 401 || res.status === 403) return "BLOCKED (plan or key)";
    if (res.status === 402) return "BLOCKED (paid plan)";
    const msg = String(j?.message ?? j?.["Error Message"] ?? j?.Error ?? j?.Note ?? j?.Information ?? "");
    if (/upgrade|premium|plan|subscription|not available|restricted|exclusive|special endpoint/i.test(msg)) return `PAID: ${msg.slice(0, 60)}`;
    if (/invalid api|apikey|api key/i.test(msg)) return `KEY PROBLEM: ${msg.slice(0, 50)}`;
    const good = ok(j);
    if (good) return `OK ${good}`;
    return msg ? `NO DATA: ${msg.slice(0, 60)}` : "empty";
  } catch (e) {
    return `error (${(e as Error).message.slice(0, 30)})`;
  }
}

// ---------------------------------------------------------------------------
async function twelveData() {
  console.log("\n=== Twelve Data (free: 8 calls a minute, so this part is slow on purpose) ===");
  if (!TD) return console.log("TWELVEDATA_API_KEY not set: skipped.");
  const rows: Array<Record<string, string>> = [];
  const items = [{ name: "Apple (control)", q: "symbol=AAPL" }, ...INDIAN.map((c) => ({ name: c.name, q: `symbol=${c.nse}&exchange=NSE` }))];
  for (const it of items) {
    const row: Record<string, string> = { company: it.name };
    row.price = await call(`https://api.twelvedata.com/quote?${it.q}&apikey=${TD}`, (j) => (j.close ? `${j.close} ${j.currency ?? ""}` : undefined));
    await sleep(8000);
    row.history = await call(`https://api.twelvedata.com/time_series?${it.q}&interval=1day&outputsize=30&apikey=${TD}`, (j) => (Array.isArray(j.values) ? `${j.values.length} days` : undefined));
    await sleep(8000);
    row.fundamentals = await call(`https://api.twelvedata.com/statistics?${it.q}&apikey=${TD}`, (j) => (j.statistics ? "ratios" : undefined));
    await sleep(8000);
    rows.push(row);
    console.log(`  done: ${it.name}`);
  }
  console.table(rows);
}

async function fmp() {
  console.log("\n=== Financial Modeling Prep (free: 250 calls a day) ===");
  if (!FMP) return console.log("FMP_API_KEY not set: skipped.");
  const base = "https://financialmodelingprep.com/stable";
  const rows: Array<Record<string, string>> = [];
  const items = [{ name: "Apple (control)", s: "AAPL" }, ...INDIAN.map((c) => ({ name: c.name, s: `${c.nse}.NS` }))];
  for (const it of items) {
    const row: Record<string, string> = { company: it.name };
    row.price = await call(`${base}/quote?symbol=${it.s}&apikey=${FMP}`, (j) => (Array.isArray(j) && j[0]?.price ? `${j[0].price}` : undefined));
    row.history = await call(`${base}/historical-price-eod/light?symbol=${it.s}&apikey=${FMP}`, (j) => (Array.isArray(j) && j.length ? `${j.length} days` : undefined));
    row.ratios = await call(`${base}/ratios-ttm?symbol=${it.s}&apikey=${FMP}`, (j) => (Array.isArray(j) && j[0] ? "ratios" : undefined));
    row.statements = await call(`${base}/income-statement?symbol=${it.s}&limit=1&apikey=${FMP}`, (j) => (Array.isArray(j) && j[0] ? `FY ${j[0].fiscalYear ?? j[0].calendarYear ?? ""}` : undefined));
    rows.push(row);
    console.log(`  done: ${it.name}`);
    await sleep(600);
  }
  console.table(rows);
}

async function alphaVantage() {
  console.log("\n=== Alpha Vantage (free: 25 calls a day) ===");
  if (!AV) return console.log("ALPHAVANTAGE_API_KEY not set: skipped (get a free key at alphavantage.co).");
  const rows: Array<Record<string, string>> = [];
  const items = [{ name: "Apple (control)", s: "AAPL" }, ...INDIAN.slice(0, 3).map((c) => ({ name: c.name, s: `${c.nse}.BSE` }))];
  for (const it of items) {
    const row: Record<string, string> = { company: it.name };
    row.history = await call(`https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${it.s}&apikey=${AV}`, (j) => (j["Time Series (Daily)"] ? `${Object.keys(j["Time Series (Daily)"]).length} days` : undefined));
    await sleep(1500);
    row.overview = await call(`https://www.alphavantage.co/query?function=OVERVIEW&symbol=${it.s}&apikey=${AV}`, (j) => (j.Symbol ? `PE ${j.PERatio ?? "-"}, ROE ${j.ReturnOnEquityTTM ?? "-"}` : undefined));
    await sleep(1500);
    rows.push(row);
    console.log(`  done: ${it.name}`);
  }
  console.table(rows);
}

await fmp();
await alphaVantage();
await twelveData();
console.log(
  "\nHow to read this: OK = data came back. PAID/BLOCKED = the free plan does not include it. 'Apple (control)' should be OK; if the Indian rows are not, that service cannot rank Indian stocks for free.",
);
