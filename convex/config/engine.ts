/**
 * SETTINGS for the whole backend, in one readable place.
 *
 * Nothing here is "logic". These are the numbers and rules that logic reads.
 * When we tune scoring or thresholds, we change this file (and bump
 * CONFIG_VERSION) so old results can always be explained with the settings
 * that produced them.
 */
import type { AuthorityTier, ClaimType, EventType, RankingProfile } from "../engine/enums.ts";

export const CONFIG_VERSION = "2026.10-v1";

// ---------------------------------------------------------------------------
// RESEARCH RUN LIMITS: stop one run from using unlimited time or money.
// ---------------------------------------------------------------------------
export const RUN_BUDGET = {
  maxSources: 40,
  maxTokens: 400_000,
  maxWallMs: 10 * 60 * 1000, // 10 minutes
  maxFollowUpRounds: 2,
} as const;

export const USER_LIMITS = {
  maxActiveRuns: 2,
  maxRunsPerDay: 20,
} as const;

// ---------------------------------------------------------------------------
// SOURCE TRUST: how much we trust each kind of publisher (0 to 1).
// ---------------------------------------------------------------------------
export const AUTHORITY_SCORE: Record<AuthorityTier, number> = {
  primary: 1.0, // filings, exchange announcements, regulators
  wire: 0.8, // major agencies and big financial papers
  trade: 0.6, // trade press, analyst sites
  unknown: 0.3, // blogs, forums, unknown sites
};

// ---------------------------------------------------------------------------
// CONFIDENCE SCORE (per claim):
//   score = 100 * ( wAuthority*A + wCorroboration*C + wRecency*R + wVerification*V - conflictPenalty*X )
// The four positive weights add up to 1.0 (checked by a test).
// ---------------------------------------------------------------------------
export const CONFIDENCE = {
  weights: {
    authority: 0.3,
    corroboration: 0.25,
    recency: 0.15,
    verification: 0.3,
  },
  maxConflictPenalty: 0.3,
  /** Score at or above this is "high"; at or above `medium` is "medium"; below is "low". */
  bands: { high: 75, medium: 50 },
  /** How much a fully "verified" vs "partially verified" claim contributes (0 to 1). */
  verificationValue: { verified: 1.0, partially_verified: 0.5 },
  /**
   * Recency: a source loses trust as it gets older. Half-life = days after which
   * the recency value drops to 50%. Fast-changing facts age faster.
   */
  recencyHalfLifeDays: {
    financial_figure: 365,
    event: 30,
    guidance: 120,
    risk: 180,
    general: 90,
  } satisfies Record<ClaimType, number>,
} as const;

// ---------------------------------------------------------------------------
// CONFLICT DETECTION: when do two numbers "disagree"?
// ---------------------------------------------------------------------------
export const CONFLICT = {
  /** Difference up to this share is treated as rounding => the sources AGREE. */
  agreeTolerance: 0.005, // 0.5%
  /** Between agreeTolerance and this => "minor difference". Above => real "conflict". */
  conflictThreshold: 0.02, // 2%
  /** Per-metric overrides, e.g. a metric reported with heavy rounding. */
  perMetric: {} as Record<string, { agreeTolerance?: number; conflictThreshold?: number }>,
} as const;

// ---------------------------------------------------------------------------
// FOLLOW-UP RESEARCH: when is "not enough evidence" true?
// ---------------------------------------------------------------------------
export const FOLLOW_UP = {
  /** A key metric backed by fewer independent sources than this triggers follow-up. */
  minIndependentSourcesForKeyMetric: 2,
  /** Share of claims that must be verified; below this triggers follow-up. */
  minVerifiedShare: 0.7,
} as const;

// ---------------------------------------------------------------------------
// WATCH: scheduling, importance, de-duplication and email limits.
// ---------------------------------------------------------------------------
export const WATCH = {
  tickIntervalMinutes: 15,
  defaultCheckIntervalMs: 60 * 60 * 1000, // each company, about hourly
  /** Stories about the same company within this window can be merged as one event. */
  dedupeWindowMs: 48 * 60 * 60 * 1000,
  /** Text similarity (0 to 1) at or above this means "same story". */
  nearDuplicateSimilarity: 0.8,
  /** Alerts at or above this importance may be emailed immediately; the rest go to the digest. */
  immediateEmailMinImportance: 80,
  maxImmediateEmailsPerHour: 5,
  /** How important each kind of event is by default (0 to 100). */
  eventTypeWeight: {
    results: 90,
    merger_acquisition: 90,
    regulatory_legal: 85,
    guidance: 75,
    rating_change: 70,
    management_change: 70,
    dividend_corporate_action: 65,
    board_meeting: 50,
    large_price_move: 60,
    other: 20,
  } satisfies Record<EventType, number>,
} as const;

// ---------------------------------------------------------------------------
// INVEST: ranking rules. Weights per profile add up to 1.0 (checked by a test).
// Direction: "high" = bigger is better, "low" = smaller is better.
// ---------------------------------------------------------------------------
export type MetricDirection = "high" | "low";

export const STOCK_METRIC_DIRECTION: Record<string, MetricDirection> = {
  pe: "low",
  pb: "low",
  ev_ebitda: "low",
  revenue_cagr_3y: "high",
  profit_cagr_3y: "high",
  roe: "high",
  roce: "high",
  operating_margin: "high",
  debt_to_equity: "low",
  interest_coverage: "high",
  return_1y: "high",
  volatility: "low",
  max_drawdown: "low", // stored as a positive size of the fall, so smaller is better
};

export const STOCK_PROFILE_WEIGHTS: Record<RankingProfile, Record<string, number>> = {
  balanced: {
    pe: 0.1, pb: 0.05, ev_ebitda: 0.05,
    revenue_cagr_3y: 0.1, profit_cagr_3y: 0.1,
    roe: 0.1, roce: 0.1, operating_margin: 0.05,
    debt_to_equity: 0.1, interest_coverage: 0.05,
    return_1y: 0.05, volatility: 0.1, max_drawdown: 0.05,
  },
  growth: {
    pe: 0.0, pb: 0.0, ev_ebitda: 0.0,
    revenue_cagr_3y: 0.25, profit_cagr_3y: 0.25,
    roe: 0.1, roce: 0.1, operating_margin: 0.1,
    debt_to_equity: 0.05, interest_coverage: 0.0,
    return_1y: 0.1, volatility: 0.05, max_drawdown: 0.0,
  },
  value: {
    pe: 0.25, pb: 0.15, ev_ebitda: 0.2,
    revenue_cagr_3y: 0.05, profit_cagr_3y: 0.05,
    roe: 0.05, roce: 0.05, operating_margin: 0.0,
    debt_to_equity: 0.1, interest_coverage: 0.05,
    return_1y: 0.0, volatility: 0.05, max_drawdown: 0.0,
  },
  quality: {
    pe: 0.0, pb: 0.0, ev_ebitda: 0.0,
    revenue_cagr_3y: 0.05, profit_cagr_3y: 0.05,
    roe: 0.2, roce: 0.2, operating_margin: 0.15,
    debt_to_equity: 0.15, interest_coverage: 0.1,
    return_1y: 0.0, volatility: 0.05, max_drawdown: 0.05,
  },
};

export const STOCK_FILTERS = {
  minDataCompleteness: 0.7, // must have at least 70% of the metrics
  minMarketCapInr: 5_000_000_000, // 500 crore
  maxDataAgeDays: 120, // older than this = stale, excluded from ranking
} as const;

export const FUND_METRIC_DIRECTION: Record<string, MetricDirection> = {
  cagr_1y: "high",
  cagr_3y: "high",
  cagr_5y: "high",
  rolling_3y_median: "high",
  rolling_3y_worst: "high",
  volatility: "low",
  max_drawdown: "low",
  downside_deviation: "low",
  sharpe: "high",
  sortino: "high",
  consistency: "high", // share of rolling periods that beat the category median
  sip_xirr_3y: "high",
  sip_xirr_5y: "high",
};

export const FUND_PROFILE_WEIGHTS: Record<RankingProfile, Record<string, number>> = {
  balanced: {
    cagr_1y: 0.05, cagr_3y: 0.1, cagr_5y: 0.1,
    rolling_3y_median: 0.1, rolling_3y_worst: 0.05,
    volatility: 0.1, max_drawdown: 0.1, downside_deviation: 0.05,
    sharpe: 0.05, sortino: 0.05, consistency: 0.1,
    sip_xirr_3y: 0.075, sip_xirr_5y: 0.075,
  },
  growth: {
    cagr_1y: 0.1, cagr_3y: 0.15, cagr_5y: 0.2,
    rolling_3y_median: 0.1, rolling_3y_worst: 0.0,
    volatility: 0.0, max_drawdown: 0.0, downside_deviation: 0.0,
    sharpe: 0.05, sortino: 0.0, consistency: 0.05,
    sip_xirr_3y: 0.15, sip_xirr_5y: 0.2,
  },
  value: {
    cagr_1y: 0.05, cagr_3y: 0.1, cagr_5y: 0.1,
    rolling_3y_median: 0.15, rolling_3y_worst: 0.1,
    volatility: 0.1, max_drawdown: 0.1, downside_deviation: 0.05,
    sharpe: 0.05, sortino: 0.05, consistency: 0.1,
    sip_xirr_3y: 0.025, sip_xirr_5y: 0.025,
  },
  quality: {
    cagr_1y: 0.0, cagr_3y: 0.05, cagr_5y: 0.1,
    rolling_3y_median: 0.1, rolling_3y_worst: 0.1,
    volatility: 0.15, max_drawdown: 0.15, downside_deviation: 0.1,
    sharpe: 0.05, sortino: 0.05, consistency: 0.15,
    sip_xirr_3y: 0.0, sip_xirr_5y: 0.0,
  },
};

export const FUND_FILTERS = {
  minHistoryYears: 3,
  defaultPlan: "direct",
  defaultOption: "growth",
  maxNavAgeDays: 7, // a NAV older than this means the scheme may be inactive
} as const;

/** Annual risk-free rate used in Sharpe/Sortino. Always show its date next to results. */
export const RISK_FREE_RATE = { annual: 0.065, asOf: "2026-10-01", note: "placeholder; update from RBI T-bill yield" } as const;

// ---------------------------------------------------------------------------
// OUTSIDE APIS: caching and retry behaviour.
// ---------------------------------------------------------------------------
export const CACHE_TTL_MS = {
  news: 10 * 60 * 1000, // 10 minutes
  quotes: 60 * 1000,
  statements: 24 * 60 * 60 * 1000, // 1 day
  nav: 12 * 60 * 60 * 1000, // 12 hours
  scheme_list: 24 * 60 * 60 * 1000,
} as const;

export const RETRY = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
} as const;

export const CIRCUIT_BREAKER = {
  failuresToOpen: 5,
  coolDownMs: 2 * 60 * 1000,
} as const;

// ---------------------------------------------------------------------------
// CLAIM CHECKING: how a typed claim is compared with the official yearly figures.
// ---------------------------------------------------------------------------
export const CLAIM_CHECK = {
  /** An amount within this share of the official figure is "close" (but not a match). */
  closeRelative: 0.05,
  /** A percentage within this many points of the official figure is "close". */
  closePercentPoints: 2,
  /** How many years of official figures are shown in the table. */
  yearsShown: 5,
  /** A yearly figure covers about 365 days; 52/53-week years are included. */
  annualDays: { min: 350, max: 380 },
} as const;
