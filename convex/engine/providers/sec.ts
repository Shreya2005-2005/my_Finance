/**
 * SEC EDGAR: official yearly figures for US-listed companies (free, no key).
 *
 *   company_tickers.json              every US-listed company: name, ticker, CIK (the SEC's id number)
 *   api/xbrl/companyfacts/CIK<n>.json every number the company has filed, with the period it covers
 *
 * We keep only numbers from the annual report (Form 10-K) that cover a full year. Companies sometimes change
 * the accounting label they use for the same number (for example for revenue), so several labels are tried
 * in order and merged year by year.
 *
 * Limits: companies that file the foreign-company form (20-F, 40-F) use another accounting vocabulary and are
 * reported as "no annual figures" here. Indian companies are not in SEC records at all.
 *
 * The SEC asks every program to identify itself. Set SEC_USER_AGENT to "Your Name your@email" in .env.local.
 */
import { CLAIM_CHECK } from "../../config/engine.ts";
import { httpJson, schemaDrift } from "./http.ts";
import { ok, type ProviderContext, type Result } from "./types.ts";

const ID = "sec";
export const DEFAULT_USER_AGENT = "Verifin student research project (set SEC_USER_AGENT to your name and email)";

export const FLOW_METRICS = ["revenue", "net_income", "operating_income", "gross_profit", "eps", "operating_cash_flow"] as const;
export type FlowMetric = (typeof FLOW_METRICS)[number];

/** Plain-English names, used on the page. */
export const METRIC_NAMES: Record<FlowMetric, string> = {
  revenue: "revenue (total sales)",
  net_income: "net income (profit after all costs and tax)",
  operating_income: "operating income (profit from running the business)",
  gross_profit: "gross profit (sales minus the direct cost of goods)",
  eps: "earnings per share (diluted)",
  operating_cash_flow: "cash from operations",
};

/** The accounting labels each number can be filed under, best first. */
const TAGS: Record<FlowMetric, string[]> = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"],
  net_income: ["NetIncomeLoss", "ProfitLoss"],
  operating_income: ["OperatingIncomeLoss"],
  gross_profit: ["GrossProfit"],
  eps: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"],
  operating_cash_flow: ["NetCashProvidedByUsedInOperatingActivities"],
};

export interface SecCompany {
  cik: number;
  ticker: string;
  title: string;
}

/** One number for one full financial year. */
export interface FlowFigure {
  metric: FlowMetric;
  /** First and last day of the year, as YYYY-MM-DD. */
  start: string;
  end: string;
  value: number;
  /** "USD" for amounts, "USD/shares" for earnings per share. */
  unit: string;
  /** The day the annual report was filed with the SEC. */
  filed: string;
  /** Link to the filing's folder on sec.gov. */
  url: string;
}

export interface CompanyFinancials {
  cik: number;
  name: string;
  ticker?: string;
  /** Link to the company's annual-report list on sec.gov. */
  filingsUrl: string;
  /** Oldest first. */
  figures: Record<FlowMetric, FlowFigure[]>;
}

// ---------------------------------------------------------------------------
// Finding the company
// ---------------------------------------------------------------------------

const SUFFIX = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|holdings|group|the|llc|lp|nv|sa|ag|de)\b/g;
export const normalizeName = (s: string) =>
  s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(SUFFIX, " ").replace(/\s+/g, " ").trim();

export interface CompanyMatch {
  company: SecCompany;
  /** exact = the name is the same; ticker = the typed text is its stock symbol; close = the name starts the same way. */
  how: "exact" | "ticker" | "close";
  /** Other companies the name could also mean (only for "close"). */
  alternatives: SecCompany[];
}

/** Finds a company in the SEC list by name or ticker. Never guesses beyond a clear start-of-name match. */
export function matchCompany(list: SecCompany[], typed: string): CompanyMatch | undefined {
  const q = normalizeName(typed);
  if (!q) return undefined;
  const qWords = q.split(" ");
  // Several tickers can share one CIK (for example preferred shares): keep the main listing.
  const main = list.filter((c) => !c.ticker.includes("-"));

  const exact = main.filter((c) => normalizeName(c.title) === q);
  if (exact.length) return { company: exact[0]!, how: "exact", alternatives: [] };

  if (/^[A-Za-z.]{1,5}$/.test(typed.trim())) {
    const t = main.find((c) => c.ticker.toLowerCase() === typed.trim().toLowerCase());
    if (t) return { company: t, how: "ticker", alternatives: [] };
  }

  const close = main
    .filter((c) => {
      const w = normalizeName(c.title).split(" ");
      return w.length - qWords.length <= 2 && qWords.every((word, i) => w[i] === word);
    })
    .sort((a, b) => a.title.length - b.title.length);
  if (close.length) return { company: close[0]!, how: "close", alternatives: close.slice(1, 4) };
  return undefined;
}

export async function loadCompanyList(ctx: ProviderContext): Promise<Result<SecCompany[]>> {
  const r = await httpJson<Record<string, { cik_str: number; ticker: string; title: string }>>(ctx, ID, "https://www.sec.gov/files/company_tickers.json", {
    headers: { "user-agent": ctx.env.SEC_USER_AGENT || DEFAULT_USER_AGENT },
    timeoutMs: 30_000,
  });
  if (!r.ok) return r;
  const rows = Object.values(r.value ?? {});
  if (!rows.length || typeof rows[0]?.cik_str !== "number") return schemaDrift(ID, "company list had an unexpected shape");
  return ok(rows.map((x) => ({ cik: x.cik_str, ticker: String(x.ticker), title: String(x.title) })));
}

// ---------------------------------------------------------------------------
// Reading the yearly figures
// ---------------------------------------------------------------------------

interface RawFact {
  start?: string;
  end: string;
  val: number;
  accn: string;
  form: string;
  filed: string;
}

const DAY = 86_400_000;

/** Turns the SEC's "company facts" file into one number per metric per full year. Pure: no network. */
export function parseCompanyFacts(json: unknown, cik: number, ticker?: string): Result<CompanyFinancials> {
  const j = json as { entityName?: unknown; facts?: Record<string, Record<string, { units?: Record<string, RawFact[]> }>> };
  if (!j || typeof j !== "object" || !j.facts || typeof j.entityName !== "string") return schemaDrift(ID, "company facts had an unexpected shape");
  const gaap = j.facts["us-gaap"] ?? {};
  const figures = Object.fromEntries(FLOW_METRICS.map((m) => [m, [] as FlowFigure[]])) as Record<FlowMetric, FlowFigure[]>;

  for (const metric of FLOW_METRICS) {
    const byEnd = new Map<string, FlowFigure>();
    for (const tag of TAGS[metric]) {
      const units = gaap[tag]?.units;
      if (!units) continue;
      const unit = metric === "eps" ? Object.keys(units).find((u) => /shares/i.test(u)) : "USD";
      const raw = unit ? units[unit] : undefined;
      if (!Array.isArray(raw)) continue;
      // Within one label, a later filing replaces an earlier one (a restated number).
      const latest = new Map<string, RawFact>();
      for (const f of raw) {
        if (!f?.start || !f.end || typeof f.val !== "number" || !/^10-K/.test(f.form ?? "")) continue;
        const days = (Date.parse(f.end) - Date.parse(f.start)) / DAY;
        if (!(days >= CLAIM_CHECK.annualDays.min && days <= CLAIM_CHECK.annualDays.max)) continue;
        const have = latest.get(f.end);
        if (!have || f.filed > have.filed) latest.set(f.end, f);
      }
      for (const [end, f] of latest) {
        if (byEnd.has(end)) continue; // an earlier (preferred) label already gave this year
        byEnd.set(end, {
          metric,
          start: f.start!,
          end,
          value: f.val,
          unit: unit!,
          filed: f.filed,
          url: `https://www.sec.gov/Archives/edgar/data/${cik}/${f.accn.replace(/-/g, "")}/`,
        });
      }
    }
    figures[metric] = [...byEnd.values()].sort((a, b) => a.end.localeCompare(b.end));
  }

  return ok({
    cik,
    name: j.entityName,
    ticker,
    filingsUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-K&dateb=&owner=include&count=40`,
    figures,
  });
}

export async function loadFinancials(company: SecCompany, ctx: ProviderContext): Promise<Result<CompanyFinancials>> {
  const r = await httpJson<unknown>(ctx, ID, `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(company.cik).padStart(10, "0")}.json`, {
    headers: { "user-agent": ctx.env.SEC_USER_AGENT || DEFAULT_USER_AGENT },
    timeoutMs: 45_000,
  });
  if (!r.ok) return r;
  return parseCompanyFacts(r.value, company.cik, company.ticker);
}
