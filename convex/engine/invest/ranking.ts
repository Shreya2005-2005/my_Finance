/**
 * RANKING: turns many instruments' metrics into one ordered list, with the reason for every position.
 *
 * Steps (same for stocks and funds), all plain code and fully deterministic:
 *   1. Drop instruments with too little data.
 *   2. Winsorize: pull extreme outliers back so one crazy value cannot distort everyone else.
 *   3. Percentile-rank each metric among the peers (direction aware: lower P/E is better).
 *   4. Weighted sum using the chosen profile's weights. Missing metrics are skipped and the
 *      remaining weights are rescaled, then a small penalty applies for missing data.
 *   5. Sort. Ties are broken the same way every time.
 */
import type { MetricDirection } from "../../config/engine.ts";

export interface RankInput {
  id: string;
  symbol: string; // used only for tie-breaks
  marketCap?: number; // used only for tie-breaks
  metrics: Record<string, number | undefined>;
}

export interface Contribution {
  metric: string;
  value: number;
  percentile: number; // 0 to 100, higher = better (already direction adjusted)
  weight: number; // after rescaling
  contribution: number; // points added to the score
}

export interface RankedItem {
  id: string;
  symbol: string;
  rank: number;
  score: number; // 0 to 100
  completeness: number; // 0 to 1, share of (weighted) metrics available
  contributions: Contribution[];
  missingMetrics: string[];
}

export interface RankResult {
  ranked: RankedItem[];
  excluded: Array<{ id: string; symbol: string; reason: string }>;
}

/** Clamps values to the [lo, hi] percentile range of the list. */
export function winsorize(values: number[], lo = 0.05, hi = 0.95): number[] {
  if (values.length < 5) return values;
  const sorted = [...values].sort((a, b) => a - b);
  const last = sorted.length - 1;
  const min = sorted[Math.min(last, Math.ceil(lo * last))]!; // round inwards so the extreme values really are clipped
  const max = sorted[Math.max(0, Math.floor(hi * last))]!;
  return values.map((v) => Math.min(max, Math.max(min, v)));
}

/** Percentile (0 to 1) of v among values. Ties get the middle rank, so equal values score equally. */
export function percentileOf(values: number[], v: number): number {
  if (values.length <= 1) return 0.5;
  let below = 0;
  let equal = 0;
  for (const x of values) {
    if (x < v) below++;
    else if (x === v) equal++;
  }
  return (below + (equal - 1) / 2) / (values.length - 1);
}

export interface RankOptions {
  weights: Record<string, number>;
  directions: Record<string, MetricDirection>;
  minCompleteness: number;
}

export function rankInstruments(items: RankInput[], opts: RankOptions): RankResult {
  const activeMetrics = Object.entries(opts.weights).filter(([, w]) => w > 0).map(([m]) => m);
  const totalWeight = activeMetrics.reduce((a, m) => a + opts.weights[m]!, 0);

  // 1. completeness filter
  const excluded: RankResult["excluded"] = [];
  const eligible: Array<{ item: RankInput; completeness: number }> = [];
  for (const item of items) {
    const have = activeMetrics.filter((m) => Number.isFinite(item.metrics[m]));
    const completeness = totalWeight === 0 ? 0 : have.reduce((a, m) => a + opts.weights[m]!, 0) / totalWeight;
    if (completeness < opts.minCompleteness) {
      excluded.push({ id: item.id, symbol: item.symbol, reason: `Only ${Math.round(completeness * 100)}% of the needed data is available.` });
    } else eligible.push({ item, completeness });
  }

  // 2 and 3. winsorized peer values per metric
  const peerValues = new Map<string, number[]>();
  for (const m of activeMetrics) {
    const raw = eligible.map((e) => e.item.metrics[m]).filter((x): x is number => Number.isFinite(x));
    peerValues.set(m, winsorize(raw));
  }
  const rawPeers = new Map<string, number[]>();
  for (const m of activeMetrics) rawPeers.set(m, eligible.map((e) => e.item.metrics[m]).filter((x): x is number => Number.isFinite(x)));

  const scored = eligible.map(({ item, completeness }) => {
    const have = activeMetrics.filter((m) => Number.isFinite(item.metrics[m]));
    const missingMetrics = activeMetrics.filter((m) => !have.includes(m));
    const haveWeight = have.reduce((a, m) => a + opts.weights[m]!, 0);

    const contributions: Contribution[] = have.map((m) => {
      const peers = peerValues.get(m)!;
      const raw = rawPeers.get(m)!;
      // find this item's winsorized value by its position among the raw peers
      const value = item.metrics[m]!;
      const wins = peers[raw.indexOf(value)] ?? value;
      let p = percentileOf(peers, wins);
      if (opts.directions[m] === "low") p = 1 - p;
      const weight = opts.weights[m]! / haveWeight;
      return { metric: m, value, percentile: round(p * 100, 1), weight: round(weight, 4), contribution: round(p * weight * 100, 2) };
    });

    const base = contributions.reduce((a, c) => a + c.contribution, 0);
    const score = round(base * (0.7 + 0.3 * completeness), 2); // missing data costs up to 30%
    return { item, completeness, contributions, missingMetrics, score };
  });

  // 5. deterministic order
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.completeness - a.completeness ||
      (b.item.marketCap ?? 0) - (a.item.marketCap ?? 0) ||
      a.item.symbol.localeCompare(b.item.symbol),
  );

  const ranked: RankedItem[] = scored.map((s, i) => ({
    id: s.item.id,
    symbol: s.item.symbol,
    rank: i + 1,
    score: s.score,
    completeness: round(s.completeness, 3),
    contributions: s.contributions,
    missingMetrics: s.missingMetrics,
  }));
  return { ranked, excluded };
}

function round(x: number, d: number): number {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

/** Plain-language risk warnings, produced by rules (never by AI). */
export function stockRiskFlags(m: Record<string, number | undefined>): string[] {
  const flags: string[] = [];
  if ((m.debt_to_equity ?? 0) > 2) flags.push("High debt compared with equity");
  if ((m.interest_coverage ?? Infinity) < 2) flags.push("Earnings barely cover interest payments");
  if ((m.volatility ?? 0) > 0.4) flags.push("Price swings are large (high volatility)");
  if ((m.max_drawdown ?? 0) > 0.5) flags.push("Has fallen more than 50% from a peak");
  if ((m.pe ?? 1) < 0) flags.push("Company is currently loss-making");
  if ((m.pe ?? 0) > 80) flags.push("Valuation is very high (P/E above 80)");
  return flags;
}

export function fundRiskFlags(m: Record<string, number | undefined>, category?: string): string[] {
  const flags: string[] = [];
  if ((m.max_drawdown ?? 0) > 0.35) flags.push("Fell more than 35% from a peak in the last 3 years");
  if ((m.volatility ?? 0) > 0.25) flags.push("Value swings a lot (high volatility)");
  if ((m.rolling_3y_worst ?? 0) < 0) flags.push("Lost money over some 3-year periods");
  if (category && /small cap|sectoral|thematic/i.test(category)) flags.push("Category is high-risk by nature");
  return flags;
}
