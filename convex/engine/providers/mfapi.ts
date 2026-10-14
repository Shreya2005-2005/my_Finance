/**
 * MFAPI.IN: Indian mutual-fund schemes and their daily NAV history. No key needed.
 * Gives NAV, scheme category, fund house and ISIN. Does NOT give expense ratio or AUM.
 */
import { httpJson, schemaDrift } from "./http.ts";
import { ok, type PriceHistory, type PriceHistoryProvider, type ProviderContext, type Result } from "./types.ts";

const ID = "mfapi";
const BASE = "https://api.mfapi.in/mf";

export interface FundScheme {
  schemeCode: string;
  schemeName: string;
}

export interface FundDetail {
  schemeCode: string;
  schemeName: string;
  fundHouse?: string;
  category?: string;
  schemeType?: string;
  isinGrowth?: string;
  plan: "direct" | "regular" | "unknown";
  option: "growth" | "idcw" | "unknown";
  history: PriceHistory;
}

/** "13-10-2026" to milliseconds (UTC). */
export function parseIndianDate(s: string): number | undefined {
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return undefined;
  const t = Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Number.isFinite(t) ? t : undefined;
}

/** Works out Direct/Regular and Growth/IDCW from the scheme's name. */
export function planAndOption(name: string): { plan: FundDetail["plan"]; option: FundDetail["option"] } {
  const plan = /\bdirect\b/i.test(name) ? "direct" : /\bregular\b/i.test(name) ? "regular" : "unknown";
  const option = /\b(idcw|dividend|payout|reinvest)/i.test(name) ? "idcw" : /\bgrowth\b/i.test(name) ? "growth" : "unknown";
  return { plan, option };
}

interface RawDetail {
  meta?: Record<string, unknown>;
  data?: Array<{ date: string; nav: string }>;
}

export function parseFundDetail(raw: RawDetail, retrievedAt: number): FundDetail | undefined {
  if (!raw.meta || !Array.isArray(raw.data)) return undefined;
  const dates: number[] = [];
  const values: number[] = [];
  // The API lists newest first; we store oldest first.
  for (let i = raw.data.length - 1; i >= 0; i--) {
    const p = raw.data[i]!;
    const t = parseIndianDate(p.date);
    const nav = Number(p.nav);
    if (t === undefined || !Number.isFinite(nav) || nav <= 0) continue; // skip bad rows rather than guess
    dates.push(t);
    values.push(nav);
  }
  const name = String(raw.meta.scheme_name ?? "");
  const code = String(raw.meta.scheme_code ?? "");
  if (!name || !code) return undefined;
  return {
    schemeCode: code,
    schemeName: name,
    fundHouse: raw.meta.fund_house ? String(raw.meta.fund_house) : undefined,
    category: raw.meta.scheme_category ? String(raw.meta.scheme_category) : undefined,
    schemeType: raw.meta.scheme_type ? String(raw.meta.scheme_type) : undefined,
    isinGrowth: raw.meta.isin_growth ? String(raw.meta.isin_growth) : undefined,
    ...planAndOption(name),
    history: { providerId: ID, instrumentRef: code, kind: "nav", dates, values, retrievedAt },
  };
}

export async function searchSchemes(q: string, ctx: ProviderContext): Promise<Result<FundScheme[]>> {
  const r = await httpJson<Array<{ schemeCode: number; schemeName: string }>>(ctx, ID, `${BASE}/search?q=${encodeURIComponent(q)}`);
  if (!r.ok) return r;
  if (!Array.isArray(r.value)) return schemaDrift(ID, "search did not return a list");
  return ok(r.value.map((s) => ({ schemeCode: String(s.schemeCode), schemeName: s.schemeName })));
}

/** Every mutual fund scheme in India (about 38,000), names and codes only. About 6 MB, so callers should cache it. */
export async function listAllSchemes(ctx: ProviderContext): Promise<Result<FundScheme[]>> {
  const r = await httpJson<Array<{ schemeCode: number | string; schemeName: string }>>(ctx, ID, BASE, { timeoutMs: 60_000 });
  if (!r.ok) return r;
  if (!Array.isArray(r.value)) return schemaDrift(ID, "scheme list is not a list");
  return ok(r.value.filter((s) => s && s.schemeName).map((s) => ({ schemeCode: String(s.schemeCode), schemeName: s.schemeName })));
}

/** Direct plan, Growth option, and not a payout, regular-plan, institutional or fixed-term variant. */
export function isDirectGrowth(name: string): boolean {
  return (
    /direct/i.test(name) &&
    /growth/i.test(name) &&
    !/idcw|dividend|bonus|payout|segregated|regular|institutional|unclaimed|\bfmp\b|series|fixed term|interval|capital protection|reinvest/i.test(name)
  );
}

export async function getFundDetail(schemeCode: string, ctx: ProviderContext): Promise<Result<FundDetail>> {
  const r = await httpJson<RawDetail>(ctx, ID, `${BASE}/${encodeURIComponent(schemeCode)}`);
  if (!r.ok) return r;
  const d = parseFundDetail(r.value, ctx.now());
  return d ? ok(d) : schemaDrift(ID, "scheme response is missing meta or data");
}

export const mfapi: PriceHistoryProvider = {
  id: ID,
  capabilities: { news: false, fundamentals: false, priceHistory: true, filings: false, fundData: true },
  isConfigured: () => true,
  async getHistory(query, ctx) {
    const d = await getFundDetail(query.instrumentRef, ctx);
    return d.ok ? ok(d.value.history) : d;
  },
};
