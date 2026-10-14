/**
 * COVERAGE TEST: MFapi.in (Indian mutual-fund NAV history, no API key needed).
 *
 * Questions it answers:
 *   1. Can we find funds by name?
 *   2. How many years of daily NAV does a fund have?
 *   3. What extra info comes with it (category, ISIN)? Is expense ratio / AUM there?
 *
 * Run:  npm run spike:mfapi
 */
export {};
const SEARCHES = ["HDFC Flexi Cap Direct Growth", "Parag Parikh Flexi Cap Direct Growth", "SBI Small Cap Direct Growth", "Nippon India Large Cap Direct Growth"];

interface Scheme {
  schemeCode: number;
  schemeName: string;
}
interface NavPoint {
  date: string; // dd-mm-yyyy
  nav: string;
}
interface SchemeDetail {
  meta: Record<string, unknown>;
  data: NavPoint[];
  status?: string;
}

const parseDate = (s: string) => {
  const [d, m, y] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
};
const get = async <T>(url: string): Promise<T> => {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
};

console.log("MFapi.in coverage test\n");
const rows: Array<Record<string, string | number>> = [];
let sampleMeta: Record<string, unknown> | undefined;

for (const q of SEARCHES) {
  try {
    const found = await get<Scheme[]>(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(q)}`);
    const best = found[0];
    if (!best) {
      rows.push({ search: q, result: "no match" });
      continue;
    }
    const detail = await get<SchemeDetail>(`https://api.mfapi.in/mf/${best.schemeCode}`);
    const points = detail.data;
    const newest = points[0];
    const oldest = points[points.length - 1];
    const years = newest && oldest ? (parseDate(newest.date).getTime() - parseDate(oldest.date).getTime()) / (365.25 * 864e5) : 0;
    sampleMeta ??= detail.meta;
    rows.push({
      search: q,
      matches: found.length,
      matched: best.schemeName.slice(0, 48),
      navPoints: points.length,
      latestNavDate: newest?.date ?? "-",
      historyYears: Number(years.toFixed(1)),
    });
  } catch (e) {
    rows.push({ search: q, result: `error: ${(e as Error).message}` });
  }
}

console.table(rows);
console.log("\nFields MFapi returns about a fund (meta):");
console.log(sampleMeta ?? "(none)");
console.log(
  "\nHow to read this: 'historyYears' must be 3 or more for a fund to be ranked.\n" +
    "Look at the meta fields above: if there is no expense ratio or AUM, we must get those elsewhere (AMFI) or rank without them.",
);
