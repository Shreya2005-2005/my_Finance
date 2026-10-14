import { CACHE_TTL_MS, FUND_FILTERS, FUND_METRIC_DIRECTION, FUND_PROFILE_WEIGHTS } from "$config/engine.ts";
import { computeFundMetrics, historyYears, sipOutcome } from "$engine/invest/metrics.ts";
import { fundRiskFlags, rankInstruments } from "$engine/invest/ranking.ts";
import { withRetry } from "$engine/lib/resilience.ts";
import { getFundDetail, isDirectGrowth, listAllSchemes, type FundDetail } from "$engine/providers/mfapi.ts";
import { typeById } from "$lib/fund-types";
import type { FundsResponse } from "$lib/types";
import { cached, providerContext } from "./context";

export const PROFILES = ["balanced", "growth", "value", "quality"] as const;
export type Profile = (typeof PROFILES)[number];

const MAX_CANDIDATES = 60;
const MAX_SHOWN = 10;
const MAX_NAV_AGE_DAYS = 10; // a price older than this usually means the fund was closed or merged
const DAY = 86_400_000;

async function loadFund(code: string): Promise<FundDetail | undefined> {
  return cached(`fund:${code}`, CACHE_TTL_MS.nav, async () => {
    const r = await withRetry(() => getFundDetail(code, providerContext()));
    return r.ok ? r.value : undefined;
  });
}

/** "HDFC Flexi Cap Fund - Direct Plan - Growth Option" becomes "HDFC Flexi Cap Fund". */
const shortName = (n: string) =>
  n
    .replace(/\s*[-–]?\s*\(?direct\s*(plan)?\)?\s*[-–]?\s*(growth( option| plan)?)?\s*$/i, "")
    .replace(/\s*[-–]\s*growth( option| plan)?\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

/**
 * Ranks EVERY fund of one kind (found by name in the full list of Indian schemes) and returns the top few.
 * A fund is ranked only if its price is recent and it has at least 3 years of history.
 */
export async function rankFundType(typeId: string, profile: Profile, count: number, sip?: { monthly: number; years: number }): Promise<FundsResponse> {
  const empty = { typeId, profile, funds: [], considered: 0, ranked: 0 };
  const type = typeById(typeId);
  if (!type) return { ...empty, error: "We do not know that kind of fund." };

  const all = await cached("mf:all", CACHE_TTL_MS.scheme_list, () => withRetry(() => listAllSchemes(providerContext())));
  if (!all.ok) return { ...empty, error: "The fund list could not be loaded right now. Please try again in a minute." };

  // Every Direct-Growth fund whose name matches this kind, one per distinct name.
  const seen = new Set<string>();
  const candidates = all.value
    .filter((s) => isDirectGrowth(s.schemeName) && type.pattern.test(s.schemeName) && !(type.exclude?.test(s.schemeName) ?? false))
    .filter((s) => {
      const k = s.schemeName.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, MAX_CANDIDATES);
  if (candidates.length === 0) return { ...empty, error: `No ${type.label} funds were found.` };

  const details: FundDetail[] = [];
  for (let i = 0; i < candidates.length; i += 8) {
    const batch = await Promise.all(candidates.slice(i, i + 8).map((c) => loadFund(c.schemeCode)));
    for (const d of batch) if (d) details.push(d);
  }

  const now = Date.now();
  const eligible = details.filter((d) => {
    const last = d.history.dates.at(-1) ?? 0;
    return now - last <= MAX_NAV_AGE_DAYS * DAY && historyYears(d.history) >= FUND_FILTERS.minHistoryYears;
  });

  const byCode = new Map(eligible.map((d) => [d.schemeCode, d]));
  const inputs = eligible.map((d) => ({ id: d.schemeCode, symbol: d.schemeName, metrics: computeFundMetrics(d.history) as Record<string, number | undefined> }));
  const result = rankInstruments(inputs, { weights: FUND_PROFILE_WEIGHTS[profile], directions: FUND_METRIC_DIRECTION, minCompleteness: 0.6 });
  const metricsByCode = new Map(inputs.map((i) => [i.id, i.metrics]));

  const shown = Math.max(1, Math.min(count, MAX_SHOWN));
  const funds = result.ranked.slice(0, shown).map((it) => {
    const d = byCode.get(it.id)!;
    const m = metricsByCode.get(it.id)!;
    const outcome = sip ? sipOutcome(d.history, sip.years, sip.monthly) : undefined;
    return {
      rank: it.rank,
      code: d.schemeCode,
      name: shortName(d.schemeName),
      category: d.category,
      fundHouse: d.fundHouse,
      score: it.score,
      completeness: it.completeness,
      metrics: m,
      contributions: it.contributions,
      flags: fundRiskFlags(m, d.category),
      missing: it.missingMetrics,
      historyYears: Number(historyYears(d.history).toFixed(1)),
      sip: outcome && { monthly: outcome.monthly, years: outcome.years, invested: outcome.invested, value: outcome.value, gain: outcome.gain, xirr: outcome.xirr },
    };
  });

  const navAsOf = eligible.map((d) => d.history.dates.at(-1) ?? 0).sort((a, b) => b - a)[0];
  return { typeId, profile, navAsOf, funds, considered: candidates.length, ranked: result.ranked.length, sip };
}
