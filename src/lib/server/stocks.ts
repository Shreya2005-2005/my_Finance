/**
 * Top Indian stocks: reads the Nifty 50 from the free Yahoo chart feed, then sorts them into plain lists (top gainers,
 * top losers, most traded). No key and no AI. Results are kept for 10 minutes and a stock that cannot be read is
 * reported in `notes` instead of failing the page.
 */
import { CACHE_TTL_MS } from "$config/engine.ts";
import { NIFTY_50 } from "$engine/invest/nifty.ts";
import { withRetry } from "$engine/lib/resilience.ts";
import { googleNews } from "$engine/providers/googleNews.ts";
import { fetchStockQuote } from "$engine/providers/yahoo.ts";
import type { StockNewsResponse, StockRow, StocksResponse } from "$lib/types";
import { cached, forget, providerContext } from "./context";

const KEY = "stocks2";
const NEWS_KEY = "stocknews1";
const TOP = 5;

/** Runs `fn` over `items` with at most `limit` at the same time, so we stay polite to the free feed. */
async function pool<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

export async function topStocks(): Promise<StocksResponse> {
  const ctx = providerContext();
  const res = await cached(KEY, CACHE_TTL_MS.news, async (): Promise<StocksResponse> => {
    const results = await pool(NIFTY_50, 8, (s) => withRetry(() => fetchStockQuote(`${s.symbol}.NS`, ctx)));
    const all: StockRow[] = [];
    const notes: string[] = [];
    let asOf = 0;
    results.forEach((r, i) => {
      const s = NIFTY_50[i]!;
      if (!r.ok) return void notes.push(`${s.name} could not be read just now, so it is missing from the lists.`);
      const q = r.value;
      asOf = Math.max(asOf, q.asOf);
      all.push({
        symbol: s.symbol,
        name: s.name,
        sector: s.sector,
        price: q.price,
        changePct: q.changePct,
        volume: q.volume,
        turnover: q.volume ? q.volume * q.price : undefined,
        high52: q.high52,
        low52: q.low52,
        nearHigh: q.high52 ? (q.price / q.high52) * 100 : undefined,
        return1m: q.return1m,
        return1y: q.return1y,
      });
    });
    if (!all.length) {
      return { gainers: [], losers: [], active: [], all, fetchedAt: ctx.now(), read: 0, total: NIFTY_50.length, notes, error: "The price feed is not reachable right now. Try again in a few minutes." };
    }
    const by = (f: (r: StockRow) => number) => [...all].sort((a, b) => f(b) - f(a));
    return {
      gainers: by((r) => r.changePct).filter((r) => r.changePct > 0).slice(0, TOP),
      losers: by((r) => -r.changePct).filter((r) => r.changePct < 0).slice(0, TOP),
      active: by((r) => r.turnover ?? 0).slice(0, TOP),
      all,
      asOf: asOf || undefined,
      fetchedAt: ctx.now(),
      read: all.length,
      total: NIFTY_50.length,
      notes,
    };
  });
  if (res.error) forget(KEY); // a failed answer is never kept
  return res;
}

/** Latest headlines for one Nifty 50 company, from Google News (keyless). */
export async function stockNews(symbol: string): Promise<StockNewsResponse> {
  const stock = NIFTY_50.find((s) => s.symbol === symbol);
  if (!stock) return { symbol, items: [], error: "Unknown stock." };
  const ctx = providerContext();
  const res = await cached(`${NEWS_KEY}:${symbol}`, CACHE_TTL_MS.news, async (): Promise<StockNewsResponse> => {
    const r = await withRetry(() => googleNews.searchNews({ text: `"${stock.name}" share NSE`, maxRecords: 8 }, ctx));
    if (!r.ok) return { symbol, items: [], error: "News could not be read just now." };
    return { symbol, items: r.value.map((d) => ({ headline: d.title ?? "", source: d.publisher ?? "News", url: d.url, publishedAt: d.publishedAt })).filter((i) => i.headline).slice(0, 6) };
  });
  if (res.error) forget(`${NEWS_KEY}:${symbol}`);
  return res;
}
