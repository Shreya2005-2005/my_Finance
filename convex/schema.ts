/**
 * DATABASE DESIGN for Verifin.
 *
 * Read this file top to bottom: tables are grouped by purpose, in the same
 * order as docs/ARCHITECTURE.md section 8.
 *
 *   1. People & companies     users, entities, instruments
 *   2. Research runs          researchRuns, runSteps, plans
 *   3. Evidence (the proof)   sources, snapshots, chunks
 *   4. Claims & checking      claims, facts, verifications, conflicts, confidences, reports
 *   5. Watch                  watchTargets, watchSubs, events, alerts, emailSuppressions
 *   6. Invest Discovery       metrics, rankings, priceSeries
 *   7. Operations             runTraces, providerHealth, usage, providerCache
 *
 * Convex adds `_id` and `_creationTime` to every row automatically.
 * An "index" is a pre-sorted lookup so queries stay fast as data grows.
 */
import { defineSchema, defineTable } from "convex/server";
import { v, type Validator } from "convex/values";
import * as E from "./engine/enums.ts";

/** Turns a list like ["a","b"] into a validator that accepts only "a" or "b". */
function oneOf<T extends string>(values: readonly T[]): Validator<T, "required", never> {
  return v.union(...(values.map((x) => v.literal(x)) as [never, never, ...never[]])) as unknown as Validator<
    T,
    "required",
    never
  >;
}

export default defineSchema({
  // =========================================================================
  // 1. PEOPLE & COMPANIES
  // =========================================================================

  /** One row per person who logs in. (Auth library columns are added when login is built.) */
  users: defineTable({
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    image: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    role: v.optional(oneOf(E.USER_ROLES)),
    timezone: v.optional(v.string()), // e.g. "Asia/Kolkata", used for the daily digest time
  }).index("by_email", ["email"]),

  /** One row per real company, so "Tata Motors" and "TTM" are never confused. */
  entities: defineTable({
    name: v.string(),
    aliases: v.array(v.string()),
    isin: v.optional(v.string()),
    tickers: v.array(v.object({ exchange: v.string(), symbol: v.string() })),
    sector: v.optional(v.string()),
    country: v.optional(v.string()),
  })
    .index("by_isin", ["isin"])
    .searchIndex("search_name", { searchField: "name" }),

  /** Things Invest Discovery can rank: a stock or a mutual-fund scheme. */
  instruments: defineTable({
    kind: oneOf(E.INSTRUMENT_KINDS),
    name: v.string(),
    entityId: v.optional(v.id("entities")),
    exchange: v.optional(v.string()),
    symbol: v.optional(v.string()),
    schemeCode: v.optional(v.string()), // mutual funds
    category: v.optional(v.string()), // SEBI fund category
    plan: v.optional(oneOf(E.FUND_PLANS)),
    option: v.optional(oneOf(E.FUND_OPTIONS)),
    sector: v.optional(v.string()),
    marketCap: v.optional(v.number()),
    active: v.boolean(),
  })
    .index("by_kind_sector", ["kind", "sector"])
    .index("by_kind_category", ["kind", "category"])
    .index("by_scheme", ["schemeCode"])
    .index("by_symbol", ["exchange", "symbol"]),

  // =========================================================================
  // 2. RESEARCH RUNS  (one run = one execution of the pipeline)
  // =========================================================================

  researchRuns: defineTable({
    userId: v.id("users"),
    query: v.string(),
    focus: v.optional(v.string()),
    entityIds: v.array(v.id("entities")),
    mode: oneOf(E.RUN_MODES),
    status: oneOf(E.RUN_STATUSES),
    budget: v.object({
      maxSources: v.number(),
      maxTokens: v.number(),
      maxWallMs: v.number(),
      maxFollowUpRounds: v.number(),
    }),
    followUpRound: v.number(),
    partialReason: v.optional(v.string()), // why a run ended as "completed_partial"
    error: v.optional(v.string()),
    configVersion: v.string(), // which scoring settings were used
    completedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_status", ["status"]),

  /** Every stage of a run is saved, so a crashed run can resume where it stopped. */
  runSteps: defineTable({
    runId: v.id("researchRuns"),
    stepName: v.string(),
    status: oneOf(E.STEP_STATUSES),
    attempts: v.number(),
    inputHash: v.string(), // same input => same step => safe to reuse the saved result
    outputRef: v.optional(v.string()),
    error: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
  })
    .index("by_run", ["runId"])
    .index("by_run_step", ["runId", "stepName", "inputHash"]),

  /** The research plan Gemini proposed (and code validated). */
  plans: defineTable({
    runId: v.id("researchRuns"),
    round: v.number(), // 0 = first plan, 1+ = follow-up rounds
    questions: v.array(
      v.object({
        id: v.string(),
        text: v.string(),
        kind: v.string(),
        providers: v.array(v.string()),
        sufficiency: v.string(), // what counts as "enough evidence" for this question
      }),
    ),
  }).index("by_run", ["runId"]),

  // =========================================================================
  // 3. EVIDENCE  (the saved proof every claim points back to)
  // =========================================================================

  /** A place information came from: one article, filing or page. */
  sources: defineTable({
    url: v.string(),
    canonicalUrl: v.string(), // cleaned URL, used to spot duplicates
    title: v.optional(v.string()),
    publisher: v.optional(v.string()),
    providerId: v.string(), // which API found it, e.g. "gdelt"
    authorityTier: oneOf(E.AUTHORITY_TIERS),
    originGroupId: v.optional(v.string()), // copies of the same story share one id
    publishedAt: v.optional(v.number()),
  })
    .index("by_canonical", ["canonicalUrl"])
    .index("by_origin", ["originGroupId"]),

  /** A frozen copy of a source's text at a moment in time. Never edited. */
  snapshots: defineTable({
    sourceId: v.id("sources"),
    contentHash: v.string(),
    storageId: v.optional(v.id("_storage")), // full text lives in file storage
    charCount: v.number(),
    retrievedAt: v.number(),
    publishedAt: v.optional(v.number()),
  })
    .index("by_source", ["sourceId"])
    .index("by_hash", ["contentHash"]),

  /** A snapshot cut into pieces, so quotes can be found and searched quickly. */
  chunks: defineTable({
    snapshotId: v.id("snapshots"),
    idx: v.number(),
    text: v.string(),
    startChar: v.number(),
    endChar: v.number(),
  })
    .index("by_snapshot", ["snapshotId", "idx"])
    .searchIndex("search_text", { searchField: "text", filterFields: ["snapshotId"] }),

  // =========================================================================
  // 4. CLAIMS & CHECKING
  // =========================================================================

  /** One statement of fact pulled from a source, with the exact quote that backs it. */
  claims: defineTable({
    runId: v.id("researchRuns"),
    entityId: v.id("entities"),
    text: v.string(),
    claimType: oneOf(E.CLAIM_TYPES),
    snapshotId: v.id("snapshots"),
    chunkId: v.optional(v.id("chunks")),
    quote: v.string(), // must be copied word-for-word from the source
    period: v.optional(v.string()), // e.g. "FY2025", "Q2 FY26"
  })
    .index("by_run", ["runId"])
    .index("by_snapshot", ["snapshotId"]),

  /** A number pulled from a source (revenue, profit ...). Feeds the fact tables. */
  facts: defineTable({
    runId: v.id("researchRuns"),
    entityId: v.id("entities"),
    metric: v.string(),
    value: v.number(),
    unit: v.string(), // normalized, e.g. "INR", "percent"
    currency: v.optional(v.string()),
    period: v.string(),
    basis: oneOf(E.ACCOUNTING_BASES),
    factKey: v.string(), // entity|metric|period|basis|unit, facts with equal keys are compared
    snapshotId: v.id("snapshots"),
    quote: v.string(),
  })
    .index("by_run", ["runId"])
    .index("by_run_key", ["runId", "factKey"]),

  /** The result of checking one claim against its source. One row per claim. */
  verifications: defineTable({
    runId: v.id("researchRuns"),
    claimId: v.id("claims"),
    // Check 1, done by plain code:
    l1: v.object({
      quoteFound: v.boolean(),
      numbersMatch: v.boolean(),
      datesMatch: v.boolean(),
      entityMatch: v.boolean(),
      passed: v.boolean(),
    }),
    // Check 2, done by the Gemini judge:
    l2Verdict: oneOf(E.JUDGE_VERDICTS),
    l2Reason: v.optional(v.string()),
    // What the user sees, decided by code from both checks:
    finalVerdict: oneOf(E.FINAL_VERDICTS),
    modelVersion: v.optional(v.string()),
    configVersion: v.string(),
  })
    .index("by_claim", ["claimId"])
    .index("by_run", ["runId"]),

  /** Two or more sources that disagree. Both sides are always kept and shown. */
  conflicts: defineTable({
    runId: v.id("researchRuns"),
    factKey: v.string(),
    kind: oneOf(E.CONFLICT_KINDS),
    severity: oneOf(E.CONFLICT_SEVERITIES),
    items: v.array(
      v.object({
        factId: v.optional(v.id("facts")),
        claimId: v.optional(v.id("claims")),
        value: v.optional(v.number()),
        text: v.optional(v.string()),
        sourceId: v.id("sources"),
        authorityTier: oneOf(E.AUTHORITY_TIERS),
        publishedAt: v.optional(v.number()),
      }),
    ),
    preferredIndex: v.optional(v.number()), // which item we lean towards (never hides the others)
    reason: v.optional(v.string()),
  }).index("by_run", ["runId"]),

  /** Trust score for each claim, with the pieces that made it up. */
  confidences: defineTable({
    runId: v.id("researchRuns"),
    claimId: v.id("claims"),
    score: v.number(), // 0 to 100
    band: oneOf(E.CONFIDENCE_BANDS),
    components: v.object({
      authority: v.number(),
      corroboration: v.number(),
      recency: v.number(),
      verification: v.number(),
      conflictPenalty: v.number(),
    }),
    configVersion: v.string(),
  })
    .index("by_claim", ["claimId"])
    .index("by_run", ["runId"]),

  /** The finished report. Every section lists the claims that back its text. */
  reports: defineTable({
    runId: v.id("researchRuns"),
    version: v.number(),
    sections: v.array(
      v.object({
        title: v.string(),
        text: v.string(),
        claimIds: v.array(v.id("claims")),
      }),
    ),
    gaps: v.array(v.string()), // things we looked for and could not verify
    configVersion: v.string(),
  }).index("by_run", ["runId"]),

  // =========================================================================
  // 5. WATCH
  // =========================================================================

  /** One row per company being watched by ANYONE. We check it once and tell all watchers. */
  watchTargets: defineTable({
    entityId: v.id("entities"),
    nextCheckAt: v.number(),
    intervalMs: v.number(),
    cursors: v.array(v.object({ providerId: v.string(), cursor: v.string() })), // "where we stopped reading"
    lastCheckedAt: v.optional(v.number()),
    subscriberCount: v.number(),
  })
    .index("by_due", ["nextCheckAt"])
    .index("by_entity", ["entityId"]),

  /** One user's wish to watch one company, with their own alert rules. */
  watchSubs: defineTable({
    userId: v.id("users"),
    entityId: v.id("entities"),
    minImportance: v.number(),
    eventTypes: v.array(oneOf(E.EVENT_TYPES)),
    emailImmediate: v.boolean(),
    emailDigest: v.boolean(),
  })
    .index("by_user", ["userId"])
    .index("by_entity", ["entityId"])
    .index("by_user_entity", ["userId", "entityId"]),

  /** Something important that happened. Duplicate news about it is merged into one event. */
  events: defineTable({
    entityId: v.id("entities"),
    clusterKey: v.string(), // same story => same key
    titleHash: v.string(),
    eventType: oneOf(E.EVENT_TYPES),
    importance: v.number(), // 0 to 100
    summary: v.string(),
    sourceIds: v.array(v.id("sources")),
    firstSeenAt: v.number(),
    lastUpdatedAt: v.number(),
  })
    .index("by_entity_time", ["entityId", "firstSeenAt"])
    .index("by_cluster", ["clusterKey"])
    .index("by_title_hash", ["entityId", "titleHash"]),

  /** One message to one user about one event. The unique lookup stops double-sending. */
  alerts: defineTable({
    userId: v.id("users"),
    eventId: v.id("events"),
    channel: oneOf(E.ALERT_CHANNELS),
    status: oneOf(E.ALERT_STATUSES),
    idempotencyKey: v.string(), // sent to the email service so retries never send twice
    sentAt: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_user_event_channel", ["userId", "eventId", "channel"])
    .index("by_status", ["status"]),

  /** Emails we must never send to again (bounced, complained, unsubscribed). */
  emailSuppressions: defineTable({
    email: v.string(),
    reason: oneOf(E.SUPPRESSION_REASONS),
    at: v.number(),
  }).index("by_email", ["email"]),

  // =========================================================================
  // 6. INVEST DISCOVERY
  // =========================================================================

  /** One computed number about a stock or fund. Raw inputs are kept so it can be re-checked. */
  metrics: defineTable({
    instrumentId: v.id("instruments"),
    name: v.string(), // e.g. "roe", "cagr_3y", "max_drawdown"
    value: v.number(),
    asOf: v.number(),
    formulaVersion: v.string(),
    inputs: v.optional(v.string()), // JSON of the numbers used, for audit
  }).index("by_instrument_name", ["instrumentId", "name"]),

  /** A saved ranking: which instruments, in what order, and exactly why. */
  rankings: defineTable({
    scopeKind: oneOf(E.RANKING_SCOPES),
    scope: v.string(), // the sector or fund category
    profile: oneOf(E.RANKING_PROFILES),
    configVersion: v.string(),
    asOf: v.number(),
    items: v.array(
      v.object({
        instrumentId: v.id("instruments"),
        rank: v.number(),
        score: v.number(),
        completeness: v.number(), // share of metrics we actually had (0 to 1)
        contributions: v.array(
          v.object({
            metric: v.string(),
            percentile: v.number(),
            weight: v.number(),
            contribution: v.number(),
          }),
        ),
        riskFlags: v.array(v.string()),
      }),
    ),
  }).index("by_scope_profile", ["scopeKind", "scope", "profile"]),

  /** Price or NAV history, stored in yearly pieces. Two parallel lists keep it compact. */
  priceSeries: defineTable({
    instrumentId: v.id("instruments"),
    kind: oneOf(E.SERIES_KINDS),
    year: v.number(),
    dates: v.array(v.number()), // days since 1970-01-01
    values: v.array(v.number()),
  }).index("by_instrument_year", ["instrumentId", "year"]),

  // =========================================================================
  // 7. OPERATIONS  (monitoring, safety, cost control)
  // =========================================================================

  /** One row per step or outside call: who, how long, how many tokens, did it work. */
  runTraces: defineTable({
    runId: v.optional(v.id("researchRuns")),
    userId: v.optional(v.id("users")),
    stage: v.string(),
    kind: oneOf(E.TRACE_KINDS),
    target: v.string(), // provider or model name
    status: v.union(v.literal("ok"), v.literal("error")),
    errorKind: v.optional(v.string()),
    latencyMs: v.number(),
    tokensIn: v.optional(v.number()),
    tokensOut: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    startedAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_target_time", ["target", "startedAt"]),

  /** Circuit breaker: if a provider keeps failing we stop calling it for a while. */
  providerHealth: defineTable({
    provider: v.string(),
    state: oneOf(E.BREAKER_STATES),
    consecutiveFailures: v.number(),
    openedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_provider", ["provider"]),

  /** Per-user daily usage, for fair limits and cost control. */
  usage: defineTable({
    userId: v.id("users"),
    day: v.string(), // "2026-10-14"
    runs: v.number(),
    tokens: v.number(),
  }).index("by_user_day", ["userId", "day"]),

  /** Short-lived saved answers from outside APIs, so we don't burn free-tier quota. */
  providerCache: defineTable({
    key: v.string(),
    providerId: v.string(),
    payload: v.string(), // JSON text
    fetchedAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_expiry", ["expiresAt"]),
});
