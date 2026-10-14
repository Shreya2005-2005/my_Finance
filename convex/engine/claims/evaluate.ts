/**
 * ANSWERING A QUESTION OR CHECKING A CLAIM against the official yearly figures.
 *
 * Everything here is plain code. The AI only labelled the sentence (see understand.ts); it never
 * sees the official numbers and never decides a verdict. Rules:
 *   - A number in the claim is compared with the official number, using the rounding the user wrote
 *     ("$17 billion" means anything that rounds to 17 billion; "$17.1 billion" is stricter).
 *   - A percentage with no clear meaning ("profit of 50%") is compared with BOTH growth and margin,
 *     and we say which one matched, so a lucky coincidence is visible, not hidden.
 *   - Amounts in rupees or other currencies are not converted (we would have to guess an exchange rate).
 *   - Verdicts: correct, close, partly correct, not correct, can't confirm.
 */
import { CLAIM_CHECK } from "../../config/engine.ts";
import { extractNumbers } from "../lib/numbers.ts";
import { FLOW_METRICS, METRIC_NAMES, type CompanyFinancials, type FlowFigure, type FlowMetric } from "../providers/sec.ts";
import type { ParsedQuery } from "./understand.ts";

export type Fit = "match" | "close" | "differs";
export type Verdict = "correct" | "close" | "partly" | "wrong" | "unknown";

export const VERDICT_LABEL: Record<Verdict, string> = {
  correct: "Correct",
  close: "Close, but not exact",
  partly: "Partly correct",
  wrong: "Not correct",
  unknown: "Can't confirm",
};

export interface AnswerCheck {
  /** What was compared, in plain words. */
  label: string;
  /** What the user wrote, if anything. */
  claimed?: string;
  /** What the official records say. */
  official: string;
  fit: Fit | "info";
  note?: string;
}

export interface Answer {
  status: "ok" | "not_covered" | "no_data" | "no_period";
  verdict?: Verdict;
  verdictLabel?: string;
  headline: string;
  /** Short plain sentences under the headline. */
  details: string[];
  checks: AnswerCheck[];
  period?: { label: string; start: string; end: string; filedOn: string; url: string };
  /** Newest year first. */
  table?: { columns: string[]; rows: Array<{ label: string; cells: string[] }> };
  notes: string[];
}

// ---------------------------------------------------------------------------
// Reading the numbers out of the user's sentence
// ---------------------------------------------------------------------------

export interface ClaimNumber {
  raw: string;
  /** Base units: 17 billion => 17000000000. A percentage stays as written (50% => 50). */
  value: number;
  isPercent: boolean;
  currency: "usd" | "inr" | "other" | "none";
  /** The rounding the user wrote: "17 billion" => 1e9, "17.1 billion" => 1e8, "50%" => 1. */
  step: number;
}

const CURRENCIES: Array<[RegExp, ClaimNumber["currency"]]> = [
  [/\$|\busd\b|\bus\s?dollars?\b|\bdollars?\b/i, "usd"],
  [/₹|\brs\b\.?|\binr\b|\brupees?\b|\bcrores?\b|\bcr\b|\blakhs?\b|\blacs?\b/i, "inr"],
  [/€|\beur\b|\beuros?\b|£|\bgbp\b|\bpounds?\b|\byen\b|\byuan\b/i, "other"],
];

function currencyOf(s: string): ClaimNumber["currency"] | undefined {
  for (const [re, c] of CURRENCIES) if (re.test(s)) return c;
  return undefined;
}

/** Numbers that can be checked: percentages, and amounts that carry a currency sign or a size word. */
export function claimNumbers(text: string): ClaimNumber[] {
  const wholeCurrency = currencyOf(text) ?? "none";
  const out: ClaimNumber[] = [];
  for (const n of extractNumbers(text)) {
    const own = currencyOf(n.raw);
    if (!n.isPercent && !n.scaled && !own) continue; // a bare number like "2" means nothing on its own
    const digits = /(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)/.exec(n.raw)?.[1] ?? "";
    const digitsValue = Number(digits.replace(/,/g, ""));
    const decimals = digits.split(".")[1]?.length ?? 0;
    const unit = n.isPercent || !(digitsValue > 0) ? 1 : n.value / digitsValue;
    out.push({
      raw: n.raw,
      value: n.value,
      isPercent: n.isPercent,
      currency: n.isPercent ? "none" : (own ?? wholeCurrency),
      step: unit * Math.pow(10, -decimals),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Comparing
// ---------------------------------------------------------------------------

/** Does a claimed amount agree with the official one, allowing for the rounding the user wrote? */
export function compareAmount(claimed: ClaimNumber, official: number): Fit {
  const diff = Math.abs(claimed.value - official);
  if (diff <= (claimed.step / 2) * (1 + 1e-9)) return "match";
  const scale = Math.abs(official);
  if (scale > 0 && diff / scale <= CLAIM_CHECK.closeRelative) return "close";
  return "differs";
}

/** Does a claimed percentage agree with the official one? Both are in percent. `claimedValue` may be signed. */
export function comparePercent(claimed: ClaimNumber, claimedValue: number, official: number): Fit {
  const diff = Math.abs(claimedValue - official);
  if (diff <= (claimed.step / 2) * (1 + 1e-9)) return "match";
  if (diff <= CLAIM_CHECK.closePercentPoints) return "close";
  return "differs";
}

const DAY = 86_400_000;

/** The year the user asked for, or the newest year when none was named. */
export function pickFigure(figs: FlowFigure[], year?: number): FlowFigure | undefined {
  if (!figs.length) return undefined;
  if (!year) return figs[figs.length - 1];
  const named = figs.filter((f) => Number(f.end.slice(0, 4)) === year);
  if (named.length) return named[named.length - 1];
  // A year that ends in January or February is usually named after the year before it.
  return figs.find((f) => Number(f.end.slice(0, 4)) === year + 1 && Number(f.end.slice(5, 7)) <= 2);
}

export function priorFigure(figs: FlowFigure[], f: FlowFigure): FlowFigure | undefined {
  const target = Date.parse(f.end) - 365 * DAY;
  return figs.find((g) => Math.abs(Date.parse(g.end) - target) <= 20 * DAY);
}

/** Growth in percent. Undefined when the earlier year was a loss or zero (growth is not meaningful then). */
export function growthPercent(now: number, before: number): number | undefined {
  if (!(before > 0)) return undefined;
  return ((now - before) / before) * 100;
}

export const marginPercent = (part: number, revenue: number): number | undefined => (revenue > 0 ? (part / revenue) * 100 : undefined);

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function dateLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}
const monthYear = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]!.slice(0, 3)} ${iso.slice(0, 4)}`;

const commas = (n: number, digits = 0) => n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function formatMoney(v: number, perShare = false): string {
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (perShare) return `${sign}$${a.toFixed(2)} per share`;
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)} trillion`;
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)} billion`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)} million`;
  return `${sign}$${commas(a)}`;
}
const pct = (v: number) => `${v.toFixed(1)}%`;
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const isPerShare = (m: FlowMetric) => m === "eps";
const MARGIN_NAME: Partial<Record<FlowMetric, string>> = { net_income: "net profit margin", operating_income: "operating margin", gross_profit: "gross margin" };

const SHORT_NAMES: Record<FlowMetric, string> = {
  revenue: "revenue",
  net_income: "net income",
  operating_income: "operating income",
  gross_profit: "gross profit",
  eps: "earnings per share",
  operating_cash_flow: "cash from operations",
};

const DECLINE = /\b(fell|fall|falls|fallen|drop|dropped|drops|declin\w*|decreas\w*|down|lower|shrank|shrink\w*|slump\w*)\b/i;

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

/** Rows of recent years for the table, newest first. */
function buildTable(fin: CompanyFinancials): Answer["table"] {
  const ends = [...new Set(FLOW_METRICS.flatMap((m) => fin.figures[m].map((f) => f.end)))].sort().slice(-CLAIM_CHECK.yearsShown).reverse();
  if (!ends.length) return undefined;
  const at = (m: FlowMetric, end: string) => fin.figures[m].find((f) => f.end === end);
  const rows: Array<{ label: string; cells: string[] }> = [];
  for (const m of FLOW_METRICS) {
    if (!fin.figures[m].length) continue;
    const cells = ends.map((e) => (at(m, e) ? formatMoney(at(m, e)!.value, isPerShare(m)) : "–"));
    if (cells.every((c) => c === "–")) continue; // nothing filed for these years (for example Oracle has no gross profit line)
    rows.push({ label: SHORT_NAMES[m][0]!.toUpperCase() + SHORT_NAMES[m].slice(1), cells });
  }
  const margin = (m: "net_income" | "operating_income") => ends.map((e) => {
    const a = at(m, e), r = at("revenue", e);
    const v = a && r ? marginPercent(a.value, r.value) : undefined;
    return v === undefined ? "–" : pct(v);
  });
  if (fin.figures.net_income.length && fin.figures.revenue.length) rows.push({ label: "Net profit margin", cells: margin("net_income") });
  if (fin.figures.net_income.length) {
    rows.push({
      label: "Net income growth",
      cells: ends.map((e) => {
        const a = at("net_income", e);
        const p = a ? priorFigure(fin.figures.net_income, a) : undefined;
        const g = a && p ? growthPercent(a.value, p.value) : undefined;
        return g === undefined ? "–" : `${g >= 0 ? "+" : ""}${pct(g)}`;
      }),
    });
  }
  return { columns: ends.map((e) => `Year to ${monthYear(e)}`), rows };
}

export function evaluateAnswer(parsed: ParsedQuery, text: string, fin: CompanyFinancials): Answer {
  const notes: string[] = ["Figures come from the company's annual report (Form 10-K) filed with the US SEC. No AI wrote or changed any number."];
  const who = parsed.company || titleCase(fin.name);
  const table = buildTable(fin);

  if (parsed.metric === "other") {
    return {
      status: "not_covered",
      headline: "That is not one of the figures we can check yet.",
      details: [`We can check yearly revenue, net income, operating income, gross profit, earnings per share and cash from operations for US-listed companies.`],
      checks: [],
      table,
      notes,
    };
  }

  const metric: FlowMetric = parsed.metric === "none" ? "net_income" : parsed.metric;
  const overviewOnly = parsed.metric === "none";
  const figs = fin.figures[metric];
  if (!figs.length) {
    return {
      status: "no_data",
      headline: `The SEC records for ${titleCase(fin.name)} have no yearly ${SHORT_NAMES[metric]}.`,
      details: ["Companies that file the foreign-company form (20-F or 40-F) are not read yet."],
      checks: [],
      table,
      notes,
    };
  }

  const fig = pickFigure(figs, parsed.year);
  if (!fig) {
    const years = [...new Set(figs.map((f) => f.end.slice(0, 4)))].join(", ");
    return {
      status: "no_period",
      headline: `${titleCase(fin.name)} has no yearly ${SHORT_NAMES[metric]} for ${parsed.year} in its SEC annual reports.`,
      details: [`Years available: ${years}.`],
      checks: [],
      table,
      notes,
    };
  }

  const prior = priorFigure(figs, fig);
  const growth = prior ? growthPercent(fig.value, prior.value) : undefined;
  const revenue = fin.figures.revenue.find((f) => f.end === fig.end);
  const margin = metric !== "revenue" && metric !== "eps" && metric !== "operating_cash_flow" && revenue ? marginPercent(fig.value, revenue.value) : undefined;
  const periodLabel = `the year ended ${dateLabel(fig.end)}`;
  const official = formatMoney(fig.value, isPerShare(metric));

  // The official sentence, built only from the numbers above.
  let sentence = `${who}'s ${SHORT_NAMES[metric]} for ${periodLabel} was ${official}`;
  if (prior && growth !== undefined) sentence += `, ${growth >= 0 ? "up" : "down"} ${pct(Math.abs(growth))} from ${formatMoney(prior.value, isPerShare(metric))} the year before`;
  if (margin !== undefined) sentence += `, and ${pct(margin)} of its revenue`;
  sentence += ".";

  const monthEnd = Number(fig.end.slice(5, 7));
  if (monthEnd !== 12) notes.push(`Its financial year ends in ${MONTHS[monthEnd - 1]}, so one "year" runs ${MONTHS[monthEnd % 12]} to ${MONTHS[monthEnd - 1]}.`);
  if (!parsed.year) notes.push(`"Last year" or "latest" means the newest full year in its annual reports. Ask for a named year (for example "2024") to see another one.`);

  const period = { label: periodLabel, start: fig.start, end: fig.end, filedOn: dateLabel(fig.filed), url: fig.url };
  const base = { status: "ok" as const, period, table, notes };

  // ---- a question (or a claim with nothing to compare) ----
  const nums = parsed.kind === "claim" ? claimNumbers(text) : [];
  if (!nums.length) {
    if (parsed.kind === "claim") notes.push("Your sentence had no figure that can be compared (a percentage, or an amount with a currency), so this shows the official figure instead.");
    const checks: AnswerCheck[] = [{ label: `${SHORT_NAMES[metric][0]!.toUpperCase()}${SHORT_NAMES[metric].slice(1)}, ${periodLabel}`, official, fit: "info" }];
    if (growth !== undefined) checks.push({ label: "Change from the year before", official: `${growth >= 0 ? "+" : ""}${pct(growth)}`, fit: "info" });
    if (margin !== undefined) checks.push({ label: `Share of revenue (${MARGIN_NAME[metric]})`, official: pct(margin), fit: "info" });
    return { ...base, headline: overviewOnly ? `Here are ${who}'s latest yearly figures.` : sentence, details: overviewOnly ? [sentence] : [], checks };
  }

  // ---- a claim: compare every number ----
  const declining = DECLINE.test(text);
  const checks: AnswerCheck[] = [];
  for (const n of nums) {
    if (n.isPercent) {
      const meaning = parsed.percentMeaning === "none" ? "unclear" : parsed.percentMeaning;
      const options: Array<{ name: string; value: number; claimed: number }> = [];
      if ((meaning === "growth" || meaning === "unclear") && growth !== undefined) options.push({ name: `growth in ${SHORT_NAMES[metric]}`, value: growth, claimed: meaning === "growth" && declining ? -n.value : n.value });
      if ((meaning === "margin" || meaning === "unclear") && margin !== undefined) options.push({ name: MARGIN_NAME[metric] ?? "share of revenue", value: margin, claimed: n.value });
      if (!options.length) {
        checks.push({ label: "Percentage", claimed: n.raw, official: "can't be worked out", fit: "info", note: "We have no earlier year or revenue to compute this percentage from." });
        continue;
      }
      const scored = options.map((o) => ({ o, fit: comparePercent(n, o.claimed, o.value) }));
      const rank = { match: 0, close: 1, differs: 2 } as const;
      scored.sort((a, b) => rank[a.fit] - rank[b.fit] || Math.abs(a.o.claimed - a.o.value) - Math.abs(b.o.claimed - b.o.value));
      const best = scored[0]!;
      if (best.fit === "differs" && options.length > 1) {
        checks.push({ label: "Percentage", claimed: n.raw, official: options.map((o) => `${o.name} ${o.value >= 0 && o.name.startsWith("growth") ? "+" : ""}${pct(o.value)}`).join("; "), fit: "differs", note: "Your sentence did not say whether it meant growth or a share of revenue, so both were checked. Neither matches." });
      } else {
        checks.push({
          label: `Percentage (${best.o.name})`,
          claimed: n.raw,
          official: `${best.o.value >= 0 && best.o.name.startsWith("growth") ? "+" : ""}${pct(best.o.value)}`,
          fit: best.fit,
          note: options.length > 1 && best.fit !== "differs" ? "Your sentence did not say whether it meant growth or a share of revenue. This is the one that fits." : undefined,
        });
      }
    } else {
      if (n.currency === "inr" || n.currency === "other") {
        checks.push({ label: "Amount", claimed: n.raw, official, fit: "info", note: "Your figure is not in US dollars and the official figure is. We do not convert, because that would mean guessing an exchange rate." });
        continue;
      }
      checks.push({
        label: `${SHORT_NAMES[metric][0]!.toUpperCase()}${SHORT_NAMES[metric].slice(1)}, ${periodLabel}`,
        claimed: n.raw,
        official,
        fit: compareAmount(n, fig.value),
        note: n.currency === "none" ? "No currency was written, so US dollars were assumed." : undefined,
      });
    }
  }

  const comparable = checks.filter((c) => c.fit !== "info");
  let verdict: Verdict;
  if (!comparable.length) verdict = "unknown";
  else if (comparable.every((c) => c.fit === "match")) verdict = "correct";
  else if (comparable.every((c) => c.fit === "match" || c.fit === "close")) verdict = "close";
  else if (comparable.some((c) => c.fit === "match" || c.fit === "close")) verdict = "partly";
  else verdict = "wrong";

  const lead: Record<Verdict, string> = {
    correct: "Your claim matches the official figures.",
    close: "Your claim is close to the official figures, but not exact.",
    partly: "Part of your claim matches the official figures, and part does not.",
    wrong: "Your claim does not match the official figures.",
    unknown: "Your claim could not be compared with the official figures.",
  };
  return { ...base, verdict, verdictLabel: VERDICT_LABEL[verdict], headline: lead[verdict], details: [sentence], checks };
}
