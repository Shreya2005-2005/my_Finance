/**
 * YAHOO FINANCE (chart feed): keyless daily prices for Indian stocks (NSE as "RELIANCE.NS").
 *
 * This is the public feed behind Yahoo's own charts. It is NOT a documented, supported API, so it can change without
 * notice (we detect that as SCHEMA_DRIFT), we call it gently and cache results, and Yahoo's terms must be reviewed
 * before any commercial use. Prices are end-of-day or slightly delayed: never present them as live trading prices.
 */
import { httpJson, schemaDrift } from "./http.ts";
import { ok, type ProviderContext, type Result } from "./types.ts";
import { FLOW_METRICS, type CompanyFinancials, type FlowFigure, type FlowMetric } from "./sec.ts";

const ID = "yahoo";
const BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

export interface StockQuote {
  symbol: string;
  price: number;
  previousClose: number;
  /** Change since the previous close, in percent (2.5 means +2.5%). */
  changePct: number;
  volume?: number;
  dayHigh?: number;
  dayLow?: number;
  high52?: number;
  low52?: number;
  /** Returns over about 1 month and 1 year, in percent, when enough history exists. */
  return1m?: number;
  return1y?: number;
  /** When the price was last updated, in ms. */
  asOf: number;
}

interface ChartJson {
  chart?: {
    result?: Array<{
      meta?: Record<string, unknown>;
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }> | null;
  };
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Reads one chart answer. Returns undefined when the shape is not what we expect. */
export function parseChart(symbol: string, j: ChartJson): StockQuote | undefined {
  const r = j.chart?.result?.[0];
  const m = r?.meta;
  if (!r || !m) return undefined;
  const price = num(m.regularMarketPrice);
  const raw = r.indicators?.quote?.[0]?.close ?? [];
  const closes = raw.filter((c): c is number => typeof c === "number");
  // Yesterday's close. While the market is open today's bar has no close yet (null), so yesterday is the last real
  // close; once it has closed, today's bar is the last one and yesterday is the one before. (Yahoo's
  // `chartPreviousClose` is the close before the whole requested range, a year old here, so we do not use it.)
  const todayOpen = raw.length > 0 && raw[raw.length - 1] == null;
  const prev = todayOpen ? closes[closes.length - 1] : closes[closes.length - 2];
  if (price === undefined || prev === undefined || prev <= 0) return undefined;
  const at = (back: number) => (closes.length > back ? closes[closes.length - 1 - back] : undefined);
  const ret = (back: number) => {
    const then = at(back);
    return then && then > 0 ? ((price - then) / then) * 100 : undefined;
  };
  const time = num(m.regularMarketTime);
  return {
    symbol,
    price,
    previousClose: prev,
    changePct: ((price - prev) / prev) * 100,
    volume: num(m.regularMarketVolume),
    dayHigh: num(m.regularMarketDayHigh),
    dayLow: num(m.regularMarketDayLow),
    high52: num(m.fiftyTwoWeekHigh),
    low52: num(m.fiftyTwoWeekLow),
    return1m: ret(21),
    return1y: closes.length > 240 ? ret(closes.length - 1) : undefined,
    asOf: time ? time * 1000 : 0,
  };
}

export async function fetchStockQuote(symbol: string, ctx: ProviderContext): Promise<Result<StockQuote>> {
  const url = `${BASE}/${encodeURIComponent(symbol)}?range=1y&interval=1d`;
  const r = await httpJson<ChartJson>(ctx, ID, url, { headers: { "user-agent": "Mozilla/5.0 (compatible; VerifinBot/0.1)" } });
  if (!r.ok) return r;
  const q = parseChart(symbol, r.value);
  return q ? ok(q) : schemaDrift(ID, `no usable price for ${symbol}`);
}

// ---------------------------------------------------------------------------
// Indian company search and yearly figures (revenue, profit, EPS ...)
// ---------------------------------------------------------------------------

export interface IndianListing {
  /** NSE symbol with ".NS" (or ".BO" when only BSE lists it). */
  symbol: string;
  name: string;
}

interface SearchJson {
  quotes?: Array<{ symbol?: string; quoteType?: string; longname?: string; shortname?: string }>;
}

/** Finds Indian (NSE/BSE) listings for a typed company name. Best match first. */
export async function searchIndianCompany(name: string, ctx: ProviderContext): Promise<Result<IndianListing[]>> {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(name)}&quotesCount=10&newsCount=0`;
  const r = await httpJson<SearchJson>(ctx, ID, url, { headers: { "user-agent": "Mozilla/5.0 (compatible; VerifinBot/0.1)" } });
  if (!r.ok) return r;
  if (!Array.isArray(r.value?.quotes)) return schemaDrift(ID, "search answer had an unexpected shape");
  const seen = new Set<string>();
  const out: IndianListing[] = [];
  // NSE listings first, then BSE-only ones.
  const quotes = r.value.quotes.filter((q) => q.quoteType === "EQUITY" && /\.(NS|BO)$/.test(q.symbol ?? ""));
  quotes.sort((a, b) => Number(b.symbol!.endsWith(".NS")) - Number(a.symbol!.endsWith(".NS")));
  for (const q of quotes) {
    const label = q.longname ?? q.shortname ?? q.symbol!;
    const key = label.toLowerCase();
    if (seen.has(key)) continue; // the same company on both exchanges
    seen.add(key);
    out.push({ symbol: q.symbol!, name: label });
  }
  return ok(out);
}

/** What we read for each yearly measure, using the same names as the US figures. */
const YAHOO_TYPES: Record<FlowMetric, string> = {
  revenue: "annualTotalRevenue",
  net_income: "annualNetIncome",
  operating_income: "annualOperatingIncome",
  gross_profit: "annualGrossProfit",
  eps: "annualDilutedEPS",
  operating_cash_flow: "annualOperatingCashFlow",
};

interface TimeseriesJson {
  timeseries?: { result?: Array<Record<string, unknown> & { meta?: { type?: string[] } }> | null };
}

const isoYearBefore = (end: string): string => {
  const d = new Date(`${end}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Reads one answer of Yahoo's yearly-figures feed. Pure: no network. */
export function parseTimeseries(json: TimeseriesJson, symbol: string, name: string): CompanyFinancials | undefined {
  const results = json.timeseries?.result;
  if (!Array.isArray(results)) return undefined;
  let currency: "INR" | "USD" | undefined;
  const page = `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/financials/`;
  const figures = Object.fromEntries(FLOW_METRICS.map((m) => [m, [] as FlowFigure[]])) as Record<FlowMetric, FlowFigure[]>;
  for (const metric of FLOW_METRICS) {
    const type = YAHOO_TYPES[metric];
    const row = results.find((x) => x.meta?.type?.[0] === type);
    const points = row?.[type];
    if (!Array.isArray(points)) continue;
    for (const p of points as Array<{ asOfDate?: string; periodType?: string; currencyCode?: string; reportedValue?: { raw?: number } } | null>) {
      const raw = p?.reportedValue?.raw;
      if (!p || p.periodType !== "12M" || typeof raw !== "number" || !Number.isFinite(raw) || !p.asOfDate || !/^\d{4}-\d{2}-\d{2}$/.test(p.asOfDate)) continue;
      const code = p.currencyCode ?? "INR";
      if (code !== "INR" && code !== "USD") return undefined; // we only describe rupee and dollar reporters
      if (currency && currency !== code) return undefined; // mixed currencies: never guess
      currency = code;
      figures[metric].push({ metric, start: isoYearBefore(p.asOfDate), end: p.asOfDate, value: raw, unit: metric === "eps" ? `${code}/shares` : code, filed: p.asOfDate, url: page });
    }
    figures[metric].sort((a, b) => a.end.localeCompare(b.end));
  }
  if (!currency || !FLOW_METRICS.some((m) => figures[m].length)) return undefined;
  return { cik: 0, name, ticker: symbol, filingsUrl: page, figures, currency, sourceName: "Yahoo Finance" };
}

export async function loadIndianFinancials(listing: IndianListing, ctx: ProviderContext): Promise<Result<CompanyFinancials>> {
  const types = FLOW_METRICS.map((m) => YAHOO_TYPES[m]).join(",");
  const now = Math.floor(ctx.now() / 1000);
  const url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(listing.symbol)}?type=${types}&merge=false&period1=1262304000&period2=${now}`;
  const r = await httpJson<TimeseriesJson>(ctx, ID, url, { headers: { "user-agent": "Mozilla/5.0 (compatible; VerifinBot/0.1)" } });
  if (!r.ok) return r;
  const fin = parseTimeseries(r.value, listing.symbol, listing.name);
  return fin ? ok(fin) : schemaDrift(ID, `no usable yearly figures for ${listing.symbol}`);
}
