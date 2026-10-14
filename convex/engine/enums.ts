/**
 * Shared vocabulary of the whole backend.
 *
 * Every "status", "verdict" or "type" the system can use is listed here ONCE.
 * The database schema and the engine both read from this file, so a typo
 * (for example "verifed") is caught by TypeScript instead of becoming bad data.
 */

/** Steps a research run moves through (see ARCHITECTURE.md section 4.1). */
export const RUN_STATUSES = [
  "queued",
  "resolving_entity",
  "needs_input", // paused: user must pick which company they meant
  "planning",
  "retrieving",
  "extracting",
  "verifying",
  "analyzing", // conflict detection + confidence scoring
  "following_up", // extra research because sources were not enough
  "writing",
  "completed",
  "completed_partial", // finished, but some sources failed or budget ran out
  "failed",
  "cancelled",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const STEP_STATUSES = ["pending", "running", "done", "failed", "skipped"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const RUN_MODES = ["single", "compare"] as const;
export type RunMode = (typeof RUN_MODES)[number];

/**
 * How much we trust WHO published a source.
 *   primary   = company filings, exchange announcements, regulators
 *   wire      = major news agencies and large financial newspapers
 *   trade     = trade press, analyst sites
 *   unknown   = blogs, forums, unknown sites
 */
export const AUTHORITY_TIERS = ["primary", "wire", "trade", "unknown"] as const;
export type AuthorityTier = (typeof AUTHORITY_TIERS)[number];

export const CLAIM_TYPES = [
  "financial_figure", // revenue, profit, margin ...
  "event", // acquisition, resignation, results announced ...
  "guidance", // forward-looking statement
  "risk",
  "general",
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const ACCOUNTING_BASES = ["consolidated", "standalone", "unspecified"] as const;
export type AccountingBasis = (typeof ACCOUNTING_BASES)[number];

/** What the Gemini "judge" says about a claim and its quoted passage. */
export const JUDGE_VERDICTS = ["supported", "partially_supported", "contradicted", "not_found"] as const;
export type JudgeVerdict = (typeof JUDGE_VERDICTS)[number];

/** The FINAL verdict a user sees. Decided by code from the two checks. */
export const FINAL_VERDICTS = ["verified", "partially_verified", "unverified", "contradicted"] as const;
export type FinalVerdict = (typeof FINAL_VERDICTS)[number];

export const CONFLICT_KINDS = ["numeric", "date", "qualitative"] as const;
export type ConflictKind = (typeof CONFLICT_KINDS)[number];

/** minor = probably rounding; conflict = real disagreement; possible = AI-suggested, lower certainty */
export const CONFLICT_SEVERITIES = ["minor", "conflict", "possible"] as const;
export type ConflictSeverity = (typeof CONFLICT_SEVERITIES)[number];

export const CONFIDENCE_BANDS = ["high", "medium", "low"] as const;
export type ConfidenceBand = (typeof CONFIDENCE_BANDS)[number];

// ---- Watch ---------------------------------------------------------------

export const EVENT_TYPES = [
  "results",
  "board_meeting",
  "dividend_corporate_action",
  "merger_acquisition",
  "regulatory_legal",
  "rating_change",
  "management_change",
  "guidance",
  "large_price_move",
  "other",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const ALERT_CHANNELS = ["in_app", "email_immediate", "email_digest"] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

export const ALERT_STATUSES = ["pending", "sent", "failed", "suppressed", "read"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const SUPPRESSION_REASONS = ["bounce", "complaint", "unsubscribe"] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

// ---- Invest --------------------------------------------------------------

export const INSTRUMENT_KINDS = ["stock", "fund"] as const;
export type InstrumentKind = (typeof INSTRUMENT_KINDS)[number];

export const FUND_PLANS = ["direct", "regular"] as const;
export type FundPlan = (typeof FUND_PLANS)[number];

export const FUND_OPTIONS = ["growth", "idcw"] as const;
export type FundOption = (typeof FUND_OPTIONS)[number];

export const RANKING_PROFILES = ["balanced", "growth", "value", "quality"] as const;
export type RankingProfile = (typeof RANKING_PROFILES)[number];

export const RANKING_SCOPES = ["sector", "category"] as const;
export type RankingScope = (typeof RANKING_SCOPES)[number];

export const SERIES_KINDS = ["price", "nav"] as const;
export type SeriesKind = (typeof SERIES_KINDS)[number];

// ---- Ops -----------------------------------------------------------------

export const USER_ROLES = ["user", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const TRACE_KINDS = ["llm", "provider", "compute"] as const;
export type TraceKind = (typeof TRACE_KINDS)[number];

export const BREAKER_STATES = ["closed", "open", "half_open"] as const;
export type BreakerState = (typeof BREAKER_STATES)[number];

/** Why an outside service call failed. Decides whether we retry. */
export const PROVIDER_ERROR_KINDS = [
  "RATE_LIMITED",
  "TIMEOUT",
  "NOT_FOUND",
  "AUTH",
  "SCHEMA_DRIFT",
  "UNAVAILABLE",
] as const;
export type ProviderErrorKind = (typeof PROVIDER_ERROR_KINDS)[number];
