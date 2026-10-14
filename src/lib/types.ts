/**
 * Shapes of the data the backend sends to the pages.
 * Kept in one place so the server code and the pages always agree.
 */

export type Tier = "primary" | "wire" | "trade" | "unknown";
export type FinalVerdict = "verified" | "partially_verified" | "unverified" | "contradicted";

// ---------- claim check ----------
export interface CheckLine {
  id: "quote" | "numbers" | "years" | "company";
  label: string;
  passed: boolean;
  detail: string;
}
export interface VerifyResponse {
  passed: boolean;
  checks: CheckLine[];
  /** The source text around the quote, so the page can highlight it. */
  context?: { before: string; match: string; after: string };
}

// ---------- watch ----------
/** One alert: a real-world story worth the user's attention. At most 5 per company. */
export interface WatchAlert {
  key: string;
  type: string;
  title: string;
  url: string;
  /** Importance in words: important / worth a look / for your information. */
  level: "important" | "worth" | "fyi";
  outlets: number;
  /** One plain sentence on why this is an alert. */
  why: string;
  publishedAt?: number;
}
export interface WatchAlertsResponse {
  company: string;
  alerts: WatchAlert[];
  /** How many recognised stories there were before picking the top 5. */
  totalStories: number;
  fetchedAt: number;
  error?: string;
}
// ---------- invest ----------
export interface Contribution {
  metric: string;
  value: number;
  percentile: number;
  weight: number;
  contribution: number;
}
export interface SipView {
  monthly: number;
  years: number;
  invested: number;
  value: number;
  /** Fraction gained (0.34 = +34%). Can be negative. */
  gain: number;
  xirr?: number;
}
export interface FundRow {
  /** What an SIP of the chosen size would have become (past prices, not a forecast). */
  sip?: SipView;
  rank: number;
  code: string;
  name: string;
  category?: string;
  fundHouse?: string;
  score: number;
  completeness: number;
  metrics: Record<string, number | undefined>;
  contributions: Contribution[];
  flags: string[];
  missing: string[];
  historyYears: number;
}
export interface FundsResponse {
  typeId: string;
  profile: string;
  navAsOf?: number;
  /** The top funds, best first (never more than 10). */
  funds: FundRow[];
  /** How many funds of this kind we found by name. */
  considered: number;
  /** How many of those had enough history and a fresh price to be ranked. */
  ranked: number;
  /** The SIP size used for the what-if box, if any. */
  sip?: { monthly: number; years: number };
  error?: string;
}

// ---------- research ----------
export type SourceKind = "news" | "announcement" | "annual_report";
export interface EvidenceSource {
  kind: SourceKind;
  /** A short passage copied from the source (a summary or description), used for quotes. */
  text?: string;
  /** Social posts, video and forums: they are shown only when "trusted sources only" is switched off. */
  weak: boolean;
  category?: string;
  /** For filings: PDF whose text can be read on demand. */
  attachmentUrl?: string;
  title: string;
  publisher?: string;
  tier: Tier;
  publishedAt?: number;
  url: string;
  fingerprint: string;
  /** Stories that are copies of one another share one origin. */
  origin: number;
}
/** One place we looked for sources, and what happened. Shown so the user can see exactly where data came from. */
export interface Channel {
  id: string;
  name: string;
  status: "ok" | "empty" | "error" | "needs_key" | "skipped";
  count: number;
  note: string;
}
export interface CompanyMatch {
  scripCode: string;
  name: string;
  symbol: string;
  isin?: string;
}
export interface DocumentText {
  text: string;
  pages?: number;
  totalPages?: number;
  truncated: boolean;
  chars: number;
  via?: string;
  error?: string;
}
/** One real-world event, reported by one or many outlets. Built by plain code from the sources. */
export type StoryView = import("../../convex/engine/watch/stories.ts").Story<EvidenceSource>;

export interface Coverage {
  items: number;
  stories: number;
  publishers: number;
  newest?: number;
  oldest?: number;
  /** Sources with no usable publication date. */
  undated: number;
}

export interface EvidenceResponse {
  company: string;
  /** Time window used, in days. */
  days: number;
  coverage: Coverage;
  stories: StoryView[];
  /** The listed company we matched on the exchange, if any. */
  match?: CompanyMatch;
  /** Other companies the name could mean ("which Tata?"). */
  candidates: CompanyMatch[];
  /** False when the exchange refused or could not be reached (different from "no such company"). */
  exchangeReachable: boolean;
  channels: Channel[];
  /** True when a Firecrawl key exists, so full news articles can be read. */
  canReadArticles: boolean;
  fetchedAt: number;
  sources: EvidenceSource[];
  independentOrigins: number;
  tierCounts: Record<Tier, number>;
  error?: string;
}

export interface SampleClaim {
  id: string;
  text: string;
  quote: string;
  source: string;
  tier: Tier;
  checks: Array<{ label: string; passed: boolean }>;
  problems: string[];
  judge: { verdict: string; reason: string };
  verdict: FinalVerdict;
  confidence?: { score: number; band: "high" | "medium" | "low"; components: Record<string, number> };
}
export interface SampleFactRow {
  metric: string;
  period: string;
  values: Array<{ source: string; tier: Tier; display: string }>;
  status: "agree" | "minor" | "conflict";
  diffPct: number;
  lean?: string;
  reason?: string;
}
export interface SampleReport {
  company: string;
  claims: SampleClaim[];
  facts: SampleFactRow[];
  sections: Array<{ title: string; sentences: Array<{ text: string; claimIds: string[] }> }>;
  removed: Array<{ text: string; reason: string }>;
  gaps: string[];
  verifiedShare: number;
}


// ---------- ask: a name, a question or a claim in one box ----------
/** The official answer built from SEC yearly figures. */
export type Answer = import("../../convex/engine/claims/evaluate.ts").Answer;

export interface AskResponse {
  query: string;
  kind: "company" | "question" | "claim";
  /** The company to show the news briefing for. */
  company: string;
  /** Who read the sentence: plain rules (a name), the AI helper, or the fallback when the AI was unavailable. */
  understoodBy: "rules" | "ai" | "fallback";
  /** A plain-words message, for example when the AI helper was busy. */
  note?: string;
  /** The company found in SEC records. */
  record?: { name: string; ticker?: string; how: "exact" | "ticker" | "close"; filingsUrl: string; alternatives: string[] };
  answer?: Answer;
  /** Figures found in the sentence, used to mark news that mentions them. */
  claimNumbers?: Array<{ raw: string; value: number; isPercent: boolean }>;
  /** What the news search should look for, so only stories about the question are shown. */
  search?: { terms: string[]; keywords: string[]; year?: number; focus: string };
  /** Why no official answer could be given. `title` and `label` replace the default wording. */
  unavailable?: { reason: string; title?: string; label?: string };
  error?: string;
}

// ---------- daily news ----------
export interface DailyNewsResponse {
  items: Array<{ headline: string; source: string; url: string; publishedAt: number; summary?: string; image?: string; photo?: { url: string; credit: string; license: string; pageUrl: string; title: string }; alsoBy: string[] }>;
  /** How far back the list had to look to find at least 5 stories (24, 48 or 72 hours). */
  windowHours: number;
  fetchedAt: number;
  error?: string;
}
