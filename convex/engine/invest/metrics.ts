/**
 * INVEST MATHS: every number comes from plain formulas on price/NAV history.
 * No AI is involved. Each function says what it returns and when it returns "undefined" (not enough data).
 *
 * A "series" is two parallel lists: dates (ms since 1970, oldest first) and values (NAV or price).
 */
import { RISK_FREE_RATE } from "../../config/engine.ts";

export interface Series {
  dates: number[];
  values: number[];
}

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
const TRADING_DAYS = 252;

/** Index of the last point on or before `t`, or -1 if the series starts later. */
function indexAtOrBefore(s: Series, t: number): number {
  let lo = 0;
  let hi = s.dates.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s.dates[mid]! <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Index of the first point on or after `t`, or -1 if none. */
function indexAtOrAfter(s: Series, t: number): number {
  let lo = 0;
  let hi = s.dates.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s.dates[mid]! >= t) {
      ans = mid;
      hi = mid - 1;
    } else lo = mid + 1;
  }
  return ans;
}

/** Years of history the series covers. */
export function historyYears(s: Series): number {
  if (s.dates.length < 2) return 0;
  return (s.dates[s.dates.length - 1]! - s.dates[0]!) / YEAR_MS;
}

/** Compound annual growth rate over the last `years` years. undefined if the history is too short. */
export function cagr(s: Series, years: number): number | undefined {
  if (s.dates.length < 2) return undefined;
  const endIdx = s.dates.length - 1;
  const startT = s.dates[endIdx]! - years * YEAR_MS;
  const startIdx = indexAtOrBefore(s, startT);
  if (startIdx < 0) return undefined;
  const start = s.values[startIdx]!;
  const end = s.values[endIdx]!;
  if (start <= 0 || end <= 0) return undefined;
  const actualYears = (s.dates[endIdx]! - s.dates[startIdx]!) / YEAR_MS;
  if (actualYears <= 0) return undefined;
  return (end / start) ** (1 / actualYears) - 1;
}

/** Simple day-to-day returns. */
export function dailyReturns(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]!;
    if (prev > 0) out.push(values[i]! / prev - 1);
  }
  return out;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function median(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Yearly volatility: how much the value swings day to day, scaled to one year. Smaller = steadier. */
export function annualizedVolatility(returns: number[]): number | undefined {
  if (returns.length < 20) return undefined;
  const m = mean(returns);
  const variance = returns.reduce((a, r) => a + (r - m) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS);
}

/** Worst peak-to-bottom fall, as a positive share (0.35 = a 35% fall). */
export function maxDrawdown(values: number[]): number | undefined {
  if (values.length < 2) return undefined;
  let peak = values[0]!;
  let worst = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    if (peak > 0) worst = Math.max(worst, (peak - v) / peak);
  }
  return worst;
}

/** Like volatility, but counts only the DOWN days (the ones investors actually dislike). */
export function downsideDeviation(returns: number[], dailyTarget = 0): number | undefined {
  if (returns.length < 20) return undefined;
  const sumSq = returns.reduce((a, r) => a + Math.min(0, r - dailyTarget) ** 2, 0);
  return Math.sqrt(sumSq / returns.length) * Math.sqrt(TRADING_DAYS);
}

/** Sharpe: return above the risk-free rate, per unit of volatility. */
export function sharpe(returns: number[], riskFree = RISK_FREE_RATE.annual): number | undefined {
  const vol = annualizedVolatility(returns);
  if (vol === undefined || vol === 0) return undefined;
  return (mean(returns) * TRADING_DAYS - riskFree) / vol;
}

/** Sortino: like Sharpe, but only penalises the down days. */
export function sortino(returns: number[], riskFree = RISK_FREE_RATE.annual): number | undefined {
  const dd = downsideDeviation(returns);
  if (dd === undefined || dd === 0) return undefined;
  return (mean(returns) * TRADING_DAYS - riskFree) / dd;
}

/**
 * Annualised return of every `windowYears`-long period, stepping forward ~monthly.
 * Shows how the fund did across many different start dates, not just "today minus 3 years".
 */
export function rollingReturns(s: Series, windowYears: number, stepDays = 30): number[] {
  const out: number[] = [];
  if (s.dates.length < 2) return out;
  const lastT = s.dates[s.dates.length - 1]!;
  for (let t = s.dates[0]! + windowYears * YEAR_MS; t <= lastT; t += stepDays * 86400000) {
    const endIdx = indexAtOrBefore(s, t);
    const startIdx = indexAtOrBefore(s, t - windowYears * YEAR_MS);
    if (endIdx < 0 || startIdx < 0) continue;
    const a = s.values[startIdx]!;
    const b = s.values[endIdx]!;
    if (a > 0 && b > 0) out.push((b / a) ** (1 / windowYears) - 1);
  }
  return out;
}

/** Share of periods where `fund` beat `benchmark` (e.g. the category median). Lists must line up by position. */
export function consistency(fund: number[], benchmark: number[]): number | undefined {
  const n = Math.min(fund.length, benchmark.length);
  if (n === 0) return undefined;
  let wins = 0;
  for (let i = 0; i < n; i++) if (fund[i]! > benchmark[i]!) wins++;
  return wins / n;
}

// ---------------------------------------------------------------------------
// XIRR and SIP
// ---------------------------------------------------------------------------

export interface CashFlow {
  t: number; // ms
  amount: number; // negative = money you put in, positive = money you get back
}

/** Annualised return of irregular cash flows (what an SIP really earns). undefined if it cannot be solved. */
export function xirr(flows: CashFlow[]): number | undefined {
  if (flows.length < 2) return undefined;
  if (!flows.some((f) => f.amount < 0) || !flows.some((f) => f.amount > 0)) return undefined;
  const t0 = flows[0]!.t;
  const npv = (rate: number) => flows.reduce((a, f) => a + f.amount / (1 + rate) ** ((f.t - t0) / YEAR_MS), 0);

  // Bisection is slower than Newton but cannot fail to converge.
  let lo = -0.99;
  let hi = 10;
  let fLo = npv(lo);
  const fHi = npv(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return undefined;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-9 || hi - lo < 1e-10) return mid;
    if (fLo * fMid < 0) hi = mid;
    else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

/**
 * Simulates investing a fixed amount every month for `years` years, ending on the last date.
 * Returns the annualised return (XIRR) of that SIP. This is the number that matters most to an SIP investor.
 */
export function sipXirr(s: Series, years: number, monthly = 1000): number | undefined {
  if (s.dates.length < 2) return undefined;
  const endT = s.dates[s.dates.length - 1]!;
  const months = Math.round(years * 12);
  const firstWanted = endT - years * YEAR_MS;
  if (indexAtOrBefore(s, firstWanted) < 0) return undefined; // history too short

  const flows: CashFlow[] = [];
  let units = 0;
  for (let m = 0; m < months; m++) {
    const d = new Date(firstWanted);
    d.setUTCMonth(d.getUTCMonth() + m);
    const idx = indexAtOrAfter(s, d.getTime());
    if (idx < 0) continue;
    const nav = s.values[idx]!;
    if (nav <= 0) continue;
    units += monthly / nav;
    flows.push({ t: s.dates[idx]!, amount: -monthly });
  }
  if (flows.length < 2) return undefined;
  flows.push({ t: endT, amount: units * s.values[s.values.length - 1]! });
  return xirr(flows);
}

export interface SipOutcome {
  monthly: number;
  years: number;
  /** Total money put in. */
  invested: number;
  /** What those instalments would be worth at the end, at the fund's real past prices. */
  value: number;
  /** (value - invested) / invested */
  gain: number;
  /** Annualised return of the SIP. */
  xirr?: number;
  /** First and last instalment dates (ms). */
  from: number;
  to: number;
}

/**
 * "If I had put `monthly` rupees in every month for `years` years": what would it have become?
 * Uses the fund's actual past prices. This is history, not a forecast. undefined if the history is too short.
 */
export function sipOutcome(s: Series, years: number, monthly: number): SipOutcome | undefined {
  if (s.dates.length < 2 || monthly <= 0 || years <= 0) return undefined;
  const endT = s.dates[s.dates.length - 1]!;
  const months = Math.round(years * 12);
  const firstWanted = endT - years * YEAR_MS;
  if (indexAtOrBefore(s, firstWanted) < 0) return undefined; // history too short

  let units = 0;
  let count = 0;
  let from = 0;
  const flows: CashFlow[] = [];
  for (let m = 0; m < months; m++) {
    const d = new Date(firstWanted);
    d.setUTCMonth(d.getUTCMonth() + m);
    const idx = indexAtOrAfter(s, d.getTime());
    if (idx < 0) continue;
    const nav = s.values[idx]!;
    if (nav <= 0) continue;
    units += monthly / nav;
    count++;
    if (count === 1) from = s.dates[idx]!;
    flows.push({ t: s.dates[idx]!, amount: -monthly });
  }
  if (count < 2) return undefined;
  const invested = count * monthly;
  const value = units * s.values[s.values.length - 1]!;
  flows.push({ t: endT, amount: value });
  return { monthly, years, invested, value, gain: (value - invested) / invested, xirr: xirr(flows), from, to: endT };
}

/** Detects missing stretches in a series (gaps longer than `maxGapDays`). Gaps make metrics unreliable. */
export function findGaps(s: Series, maxGapDays = 10): Array<{ from: number; to: number; days: number }> {
  const out = [];
  for (let i = 1; i < s.dates.length; i++) {
    const days = (s.dates[i]! - s.dates[i - 1]!) / 86400000;
    if (days > maxGapDays) out.push({ from: s.dates[i - 1]!, to: s.dates[i]!, days: Math.round(days) });
  }
  return out;
}

export interface FundMetrics {
  cagr_1y?: number;
  cagr_3y?: number;
  cagr_5y?: number;
  rolling_3y_median?: number;
  rolling_3y_worst?: number;
  volatility?: number;
  max_drawdown?: number;
  downside_deviation?: number;
  sharpe?: number;
  sortino?: number;
  sip_xirr_3y?: number;
  sip_xirr_5y?: number;
}

/** All fund metrics from one NAV history. Anything we cannot compute honestly is left out (undefined). */
export function computeFundMetrics(s: Series): FundMetrics {
  // Use the last 3 years for risk numbers so old market regimes don't dominate.
  const endT = s.dates[s.dates.length - 1] ?? 0;
  const startIdx = Math.max(0, indexAtOrBefore(s, endT - 3 * YEAR_MS));
  const recent = s.values.slice(startIdx);
  const returns = dailyReturns(recent);
  const rolling = rollingReturns(s, 3);
  return {
    cagr_1y: cagr(s, 1),
    cagr_3y: cagr(s, 3),
    cagr_5y: cagr(s, 5),
    rolling_3y_median: median(rolling),
    rolling_3y_worst: rolling.length ? Math.min(...rolling) : undefined,
    volatility: annualizedVolatility(returns),
    max_drawdown: maxDrawdown(recent),
    downside_deviation: downsideDeviation(returns),
    sharpe: sharpe(returns),
    sortino: sortino(returns),
    sip_xirr_3y: sipXirr(s, 3),
    sip_xirr_5y: sipXirr(s, 5),
  };
}
