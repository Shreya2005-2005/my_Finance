import type { Tier } from "./types";

export const tierLabel: Record<Tier, string> = {
  primary: "Official source",
  wire: "Major outlet",
  trade: "Trade press",
  unknown: "Unknown source",
};

export const tierTone: Record<Tier, string> = { primary: "good", wire: "info", trade: "", unknown: "warn" };

export const verdictLabel: Record<string, string> = {
  verified: "Verified",
  partially_verified: "Partly verified",
  unverified: "Unverified",
  contradicted: "Contradicted",
};
export const verdictTone: Record<string, string> = { verified: "good", partially_verified: "info", unverified: "warn", contradicted: "bad" };
export const bandTone: Record<string, string> = { high: "good", medium: "info", low: "warn" };

export const eventLabel: Record<string, string> = {
  results: "Results",
  board_meeting: "Board meeting",
  dividend_corporate_action: "Dividend / corporate action",
  merger_acquisition: "Deal / acquisition",
  regulatory_legal: "Regulatory / legal",
  rating_change: "Rating change",
  management_change: "Management change",
  guidance: "Guidance",
  large_price_move: "Big price move",
  other: "Other",
};

export const metricLabel: Record<string, string> = {
  cagr_1y: "1-year return",
  cagr_3y: "3-year return (per year)",
  cagr_5y: "5-year return (per year)",
  rolling_3y_median: "Typical 3-year return",
  rolling_3y_worst: "Worst 3-year return",
  volatility: "Ups and downs (volatility)",
  max_drawdown: "Worst fall from a peak",
  downside_deviation: "Downside swings",
  sharpe: "Return for risk taken (Sharpe)",
  sortino: "Return vs. downside risk (Sortino)",
  consistency: "Consistency",
  sip_xirr_3y: "3-year SIP return (per year)",
  sip_xirr_5y: "5-year SIP return (per year)",
};

/** Metrics shown as percentages (the rest are plain ratios). */
const PERCENT = new Set(["cagr_1y", "cagr_3y", "cagr_5y", "rolling_3y_median", "rolling_3y_worst", "volatility", "max_drawdown", "downside_deviation", "consistency", "sip_xirr_3y", "sip_xirr_5y"]);

export function metricValue(metric: string, v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "not available";
  return PERCENT.has(metric) ? `${(v * 100).toFixed(1)}%` : v.toFixed(2);
}

export function formatDate(ms?: number): string {
  if (!ms) return "date unknown";
  return new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function timeAgo(ms?: number): string {
  if (!ms) return "date unknown";
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} days ago`;
}
