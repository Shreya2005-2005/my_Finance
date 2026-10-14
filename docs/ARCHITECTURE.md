# Verifin: Architecture & Backend Design

Status: **DRAFT for approval** (nothing is implemented yet)
Stack: SvelteKit (frontend) · Convex (backend, DB, scheduler) · Gemini (LLM) · TypeScript engine · Python evaluation harness

---

## 0. What we are building

Verifin is a financial research platform with **one shared engine** and **three features** on top of it.

| Feature | One-line purpose | Origin |
|---|---|---|
| **Research** | Verified company report, with conflicts flagged and confidence scores | Required by OJT brief |
| **Watch** | Monitor companies, detect important events, send alerts | Extension |
| **Invest Discovery** | Rank stocks and mutual funds by transparent rules, with sources and risks | Extension |

### OJT brief coverage (must-have + stretch)

| Brief item | Where it lives |
|---|---|
| Multi-source retrieval | Engine §4.2 |
| Basic report generation | Engine §4.9 |
| Automated citation verification | Engine §4.5 |
| Conflicting-source flagging | Engine §4.6 |
| Structured fact/number tables | Engine §4.4 + Research UI |
| Confidence score per claim | Engine §4.7 |
| Auto follow-up research | Engine §4.8 |
| Multi-company comparison | Engine §4.10 (reused by Invest) |
| Benchmarking, chaos/adversarial testing | §13 |
| Observability, packaging, docs, demo | §12, §14, §15 |

### Non-goals
- No buy/sell/hold advice, no return predictions, no trade execution.
- No real-time tick data or charting terminal.
- No user portfolio or broker integration.

### Success targets (defined precisely)
- **Citation coverage = 100%**: every factual claim in a report has a verification record. (Not "every claim passes". Failures are shown as *Unverified*.)
- **Conflict recall ≥ 90%** on a test set of deliberately seeded disagreements. Target precision ≥ 80%.
- **Faithfulness = 100%**: every factual sentence in a report maps to ≥1 claim ID. Anything uncited is dropped before display.
- **Determinism**: same inputs produce identical Invest rankings.

---

## 1. Design principles

1. **AI reads and explains. Code decides.** Gemini plans, extracts and phrases. Code does math, comparisons, scoring, ranking, dedupe, alert rules and final verdicts.
2. **Evidence first.** No claim exists without a stored source snapshot (URL, text, hash, retrieved-at, published-at).
3. **Unknown means Unverified.** Missing or unmatched evidence is never silently accepted.
4. **Never trust fetched text.** Web content is data, never instructions.
5. **Every step is resumable and idempotent.** A crash, retry or duplicate trigger must not corrupt or duplicate results.
6. **Fail visibly.** Partial results are labelled, never passed off as complete. Stale data shows its date.
7. **Everything is traceable.** Each output can be walked back to the claim, the passage and the provider call that produced it.
8. **Config over constants.** Weights, thresholds and tolerances live in versioned config, so we can tune and audit them.

---

## 2. System context

```
                         ┌─────────────────────────────┐
   User (browser) ─────► │ SvelteKit app (Vercel)      │
                         │ Research | Watch | Invest   │
                         │ Ops dashboard | Methodology │
                         └──────────────┬──────────────┘
                                        │ Convex client (reactive queries, auth token)
                         ┌──────────────▼──────────────┐
                         │ CONVEX BACKEND              │
                         │  queries / mutations (DB)   │
                         │  actions (external calls)   │
                         │  workflows (durable runs)   │
                         │  crons / scheduler          │
                         │  file storage (snapshots)   │
                         └───┬───────────┬─────────┬───┘
                             │           │         │
        ┌────────────────────▼─┐   ┌─────▼─────┐  ┌▼────────────┐
        │ Data providers       │   │ Gemini    │  │ Resend      │
        │ GDELT, Finnhub, FMP, │   │ (LLM)     │  │ (email)     │
        │ MFapi, AMFI, NSE/BSE │   └───────────┘  └─────────────┘
        │ filings, Firecrawl   │
        └──────────────────────┘
        Sentry (errors)          Python eval harness (offline, CI)
```

**Trust boundaries:** browser (untrusted) → Convex functions (validate + authorize everything) → external providers (untrusted data). Secrets exist only in Convex environment variables.

---

## 3. Repository structure

```
verifin/
├─ apps/web/                     SvelteKit frontend
│  └─ src/routes/
│     ├─ research/               new run, list, [runId] report view
│     ├─ compare/                multi-company comparison
│     ├─ watch/                  watchlist, events feed, alert settings
│     ├─ invest/                 sector explorer, stock lists, fund (SIP) lists
│     ├─ methodology/            public explanation of scoring and ranking
│     ├─ settings/               profile, email prefs, timezone
│     └─ admin/ops/              ops dashboard (admin only)
├─ convex/
│  ├─ schema.ts                  all tables + indexes
│  ├─ auth.ts, http.ts           auth config, webhooks (Resend)
│  ├─ crons.ts                   scheduled jobs
│  ├─ research/                  public API for Research feature
│  ├─ watch/                     public API + jobs for Watch
│  ├─ invest/                    public API + jobs for Invest
│  ├─ engine/                    SHARED ENGINE (see §4)
│  │  ├─ pipeline/               planner, retrieve, extract, verify, conflicts,
│  │  │                          score, followup, write, compare
│  │  ├─ providers/              one adapter per external API (§9)
│  │  ├─ llm/                    Gemini client, prompts, JSON schemas, guards
│  │  ├─ evidence/               snapshot store, chunking, dedupe
│  │  └─ lib/                    normalize units, dates, numbers, hashing
│  ├─ ops/                       traces, provider health, rate limits, admin
│  └─ config/                    scoring weights, tolerances, ranking profiles
├─ eval/                         Python evaluation harness (§13)
│  ├─ datasets/                  golden sets, seeded conflicts, adversarial cases
│  └─ runners/                   metrics, benchmarks, load tests
├─ docs/                         architecture, design decisions, runbook, demo script
└─ .github/workflows/            CI/CD
```

Rule: **features never call providers directly.** They call the engine, and the engine calls provider adapters.

---

## 4. The shared engine

### 4.1 Run lifecycle

A "run" is one execution of the pipeline (a research request, a Watch check or an Invest refresh uses parts of it).

```
queued → resolving_entity → planning → retrieving → extracting → verifying
       → analyzing (conflicts + scoring) → [following_up, max 2 rounds] → writing
       → completed | completed_partial | failed | cancelled
```

- Implemented as a **durable workflow** (Convex workflow component). Each stage is a step recorded in `runSteps` (status, attempts, input hash, output reference).
- Steps are **idempotent**: keyed by `(runId, stepName, inputHash)`. A retry returns the saved result.
- **Fan-out** stages (extract/verify per snapshot or claim) run through a **work pool** with limited concurrency, so Gemini quotas aren't blown.
- **Run budgets** (config): max sources, max Gemini tokens, max wall time, max follow-up rounds. When a budget is hit, the run finishes as `completed_partial` and says why.
- The frontend subscribes to the run via a reactive query, so progress is live with no polling code.

### 4.2 Stage 0: Entity resolution

User text ("Tata Motors", "TTM", "RELIANCE") → canonical **entity** (name, ISIN, exchange tickers, sector, country).
- Match against the `entities` table first, then provider symbol search.
- If ambiguous (several close matches), the run pauses in `needs_input` and the UI asks the user to pick. We never guess.
- Every later stage uses the entity ID. This prevents mixing up similarly named companies.

### 4.3 Stage 1: Planner (Gemini, structured output)

Input: entity + question type. Output (validated JSON schema): list of research questions (financials, recent news, risks, outlook, filings), which providers to query for each, and what counts as "enough evidence" per question.
Code validates the plan and caps it to the run budget. The plan is stored for the trace.

### 4.4 Stage 2: Retrieval (multi-source)

- Query providers per the plan, in parallel, via adapters (§9).
- Each adapter returns normalized `SourceDoc` (news/filings/web) or `FinancialDatapoint` (structured numbers).
- **Snapshot store**: raw text is saved immutably with `contentHash`, `retrievedAt`, `publishedAt`, `publisher`, `authorityTier`. Large text goes to file storage, with chunks and metadata in the DB (Convex documents have a size limit).
- **Dedupe**: canonical URL, then title hash, then near-duplicate text similarity. Syndicated copies are grouped under one "origin", so they can't fake corroboration.
- **Staleness tag**: every snapshot carries age; the scorer and UI use it.
- **SSRF protection**: any URL we fetch is checked (https only, no private/internal IP ranges, size and time limits).

### 4.5 Stage 3: Extraction (Gemini, JSON-schema constrained)

From each snapshot's chunks, extract:
- **Claims**: `{text, type, entity, period?, quote}` where `quote` must be an exact span copied from the source.
- **Facts** (structured numbers): `{metric, value, unit, currency, period, basis, quote}`.

Prompts say: extract only what the text states; copy quotes exactly; no inference. The output is rejected and retried if it's invalid JSON or breaks the schema.

### 4.6 Stage 4: Citation verification (the core feature)

Each claim goes through two independent layers. **Both must pass.**

**Layer 1: deterministic (code)**
1. The `quote` exists in the snapshot text (exact match, then whitespace/punctuation-normalized match).
2. Numbers in the claim equal the numbers in the quote after unit normalization (crore/lakh/million/billion, % vs absolute).
3. Dates and periods in the claim match the quote. The entity name or alias appears in the passage.

**Layer 2: entailment judge (Gemini, separate prompt, sees only claim + quoted passage with context)**
Returns one verdict: `supported | partially_supported | contradicted | not_found`, with a short reason.

**Final verdict (code):**

| L1 | L2 | Final |
|---|---|---|
| pass | supported | **Verified** |
| pass | partially_supported | **Partially verified** (shown with caveat) |
| fail | any | **Unverified** (hallucinated or misquoted evidence) |
| any | contradicted / not_found | **Unverified** (or **Contradicted**) |

Every claim gets a `verifications` record, so coverage is 100% by construction. Unverified claims are shown in the report with a clear marker, or hidden by a user toggle, but never presented as fact.

### 4.7 Stage 5: Conflict detection (code first)

- **Fact key** = `(entityId, metric, period, basis, normalizedUnit)`. Basis means consolidated vs standalone, reported vs adjusted.
- Values are normalized to base units. Different currencies are flagged, not silently converted.
- Compare all facts under the same key from **independent origins**:
  - within tolerance (default 0.5%, per-metric config): **agree**
  - 0.5% to 2%: **minor difference** (rounding or restatement likely)
  - above 2%: **conflict**
- **Non-numeric conflicts** (e.g. "CEO resigned" vs "CEO remains"): Gemini proposes candidate pairs of claims on the same topic, a second verification pass confirms, and they're flagged as **possible conflict** (lower certainty label).
- A conflict is never resolved by hiding one side. The UI shows both values with sources, dates and authority. The higher-authority/more recent source is marked "preferred", with the reason.

### 4.8 Stage 6: Confidence scoring (code, config weights)

Per claim, 0-100:

```
score = 100 * clamp(
    wA * Authority      // source tier: filing/exchange 1.0, major wire 0.8, trade press 0.6, blog/unknown 0.3
  + wC * Corroboration  // 1 - 0.5^n, n = independent origins supporting the claim
  + wR * Recency        // exp(-age / halfLife[claimType])
  + wV * Verification   // verified 1.0, partial 0.5
  - wX * ConflictPenalty
)
```

Starting weights: wA 0.30, wC 0.25, wR 0.15, wV 0.30, conflict penalty up to 0.30. These are tuned against the golden set (§13), not guessed forever.
Rules: an **Unverified** claim never gets a confidence badge. Bands: High ≥ 75, Medium 50-74, Low < 50. The UI shows the breakdown on hover.

### 4.9 Stage 7: Follow-up research (agent loop)

After analysis, code checks **sufficiency** against the plan:
- a planned question has no verified claims,
- a key metric has only one source,
- a conflict has no authoritative source,
- a verified-claim share below threshold.

For each gap, the planner generates **targeted follow-up queries**. Retrieval → extraction → verification runs again for those only. **Max 2 rounds**, and it stops early when no progress is made. Remaining gaps are listed in the report as "Not found".

### 4.10 Stage 8: Report writer (Gemini, constrained)

- Input is **only** verified and partially verified claims, facts and conflicts, referenced by ID.
- Output is structured sections where each sentence lists its `claimIds`.
- **Post-check (code):** sentences without claim IDs are removed; numbers in the prose must equal the numbers in the cited facts; otherwise the sentence is dropped or regenerated.
- Standard sections: Overview, Financial snapshot (table), Recent developments, Risks, Conflicts & disagreements, Unverified/not found, Sources (with dates).

### 4.11 Comparison mode

For 2-5 entities: run the pipeline per entity (in parallel), then build a **comparison table** keyed by metric and period, with per-cell confidence and conflict markers. Differences in period/basis between companies are flagged (e.g. different fiscal year-ends). Invest Discovery reuses this for stock comparison.

---

## 5. Feature 1: Verifin Research

**User flow**
1. Enter company (or 2-5 for comparison) and optional focus (e.g. "risks", "last year financials").
2. Entity resolution (ask the user if ambiguous).
3. Live progress page (stage by stage).
4. Report page: report text with **claim chips** (verdict + confidence), click to see the exact source passage highlighted, **conflicts panel**, **fact table**, source list with dates, "Unverified / not found" section, export (Markdown/PDF).

**Backend API (Convex, authenticated, owner-scoped)**
- `research.start({query, entityIds?, mode})` → creates `researchRuns` row, starts workflow
- `research.get(runId)`, `research.listMine()`, `research.cancel(runId)`
- `research.claimEvidence(claimId)` → passage + snapshot metadata
- `research.chooseEntity(runId, entityId)`

**Rules:** per-user concurrency limit (e.g. 2 active runs), per-user daily run quota, results are owner-only unless explicitly shared.

---

## 6. Feature 2: Verifin Watch

### 6.1 Core idea: poll per company, not per user
Many users may watch the same company. We check each company **once per interval** and fan the result out to all watchers. This saves API quota and gives consistent results.

### 6.2 Pipeline

```
cron tick (every ~15 min) → pick companies due (nextCheckAt) → per-company check action
  → fetch from providers (official announcements first, then news)
  → normalize → dedupe → classify → score importance → cluster into events
  → fan-out: match watchers' rules → create alerts → email (immediate or digest)
```

- **Due-scheduling:** `watchTargets` holds `nextCheckAt`, `lastCursor` (per provider, e.g. last seen ID/time). Adaptive interval: more often for companies with recent activity or during market hours. A tick only enqueues work; the work runs through the work pool with provider rate limits.
- **Official sources first:** exchange announcements are higher authority and often arrive before news.

### 6.3 Event classification (rules first, AI second)
- Event types: results, board meeting, dividend/corporate action, M&A, regulatory/legal, rating change, management change, guidance, large price move, other.
- Step 1: **rule-based** using announcement category codes and keyword patterns.
- Step 2: only for ambiguous items, Gemini classifies into the **fixed enum** (it can't invent types).
- **Importance (code):** `typeWeight × authority × recency × novelty`, plus the user's thresholds. Gemini writes only the short summary; code decides whether an alert exists.

### 6.4 Three-level dedupe
1. **Exact:** canonical URL / provider ID.
2. **Title:** normalized-title hash within the same entity.
3. **Near-duplicate:** text similarity ≥ threshold, same entity, 48-hour window → merged into one **event cluster**, which accumulates its sources.

An alert is created once per `(userId, clusterId, channel)` (unique key). A new source joining an old cluster **does not re-alert** unless importance rises across a level (e.g. rumor → official confirmation).

### 6.5 Alerts and email (Resend)
- **Immediate** email only for high-importance events; everything else goes to the **daily digest** at the user's local time.
- Throttle: max N immediate emails/hour/user.
- Each send uses an **idempotency key**. Bounces and complaints come in via a webhook into a **suppression list**. Every email has a signed one-click **unsubscribe** link.
- In-app alert feed shows the same events, with source links and dates.
- Failed sends retry with backoff, then are marked `failed` (visible in ops).

### 6.6 Backend API
`watch.addTarget / removeTarget / listTargets`, `watch.setRules`, `watch.listEvents`, `watch.markRead`, `watch.setEmailPrefs`. Jobs (internal): `watch.tick`, `watch.checkCompany`, `watch.fanOut`, `watch.sendDigest`, `watch.sendImmediate`.

---

## 7. Feature 3: Verifin Invest Discovery

### 7.1 Principle
All numbers and ranks are computed by **code** from stored raw inputs. Gemini may only write a plain-language summary **from the computed table**, and a code check confirms every number in the summary matches the table.

### 7.2 Stocks: sector explorer and comparison

**Universe:** `instruments` table (symbol, exchange, ISIN, sector, market cap, liquidity). Sector lists are built from provider data and stored.

**Metrics (computed in code, formula version stored):**
- Valuation: P/E, P/B, EV/EBITDA
- Growth: revenue CAGR (3y), profit CAGR (3y)
- Profitability: ROE, ROCE, operating margin
- Leverage/safety: debt/equity, interest coverage
- Market: 1y return, annualized volatility, max drawdown (from prices)

**Ranking algorithm (deterministic):**
1. **Hard filters:** minimum data completeness (e.g. ≥70% of metrics), minimum market cap/liquidity, not flagged as stale.
2. **Winsorize** outliers per metric within the sector.
3. **Percentile rank** within the sector for each metric (direction-aware: lower P/E is better, higher ROE is better).
4. **Weighted sum** by **profile** (Balanced, Growth, Value, Quality). Weights are published on the Methodology page.
5. **Missing metrics:** excluded and weights renormalized, with a visible "data gaps" label and a completeness penalty.
6. **Tie-break:** fixed rule (completeness, then market cap, then symbol).

**Output per stock:** rank, score, **per-metric contribution** (why it ranked here), code-generated **risk flags** (high debt, high volatility, negative earnings, low liquidity, stale data), sources and "as of" dates.
**Comparison:** uses the shared comparison mode (§4.11).

### 7.3 Mutual funds for SIP

**Universe:** scheme list (MFapi) joined with category info (AMFI). Defaults: **Direct plans, Growth option**, so IDCW payouts don't distort NAV returns. Funds are ranked only **within their SEBI category**.

**Metrics from NAV history (code):**
- CAGR 1/3/5 years
- Rolling 3-year return (median, worst)
- Annualized volatility, max drawdown, downside deviation
- Sharpe/Sortino using a **configurable, dated** risk-free rate
- Consistency: % of rolling periods beating the category median
- **SIP simulation:** XIRR of a monthly SIP over 3 and 5 years (the metric most relevant to SIP investors)
- Optional (if obtainable and licensed): expense ratio, AUM. If missing, the UI says "not available" and doesn't guess.

**Guards:** minimum 3 years of history to be ranked, NAV gap detection, merged/renamed scheme handling, NAV-staleness check.

**Ranking:** same engine as stocks (filters → percentile within category → profile weights → explanations).
**Required disclaimers** on every Invest page: market-risk warning, "past performance doesn't guarantee future returns", "not investment advice", data "as of" date.

### 7.4 Backend API and jobs
`invest.sectors`, `invest.rankStocks(sector, profile)`, `invest.compare(entityIds)`, `invest.rankFunds(category, profile)`, `invest.explain(rankId)`.
Jobs: nightly refresh of prices/NAV and metrics, with per-instrument retry and a stale-data flag.

---

## 8. Data model (Convex tables)

Every user-owned table has `userId` and an index on it. Server functions always check ownership.

| Domain | Table | Key fields | Notes |
|---|---|---|---|
| Identity | `users` | email, name, role (`user`/`admin`), timezone | from auth |
| | `entities` | name, aliases[], isin, tickers[], exchange, sector, country | canonical company |
| | `instruments` | entityId?, type (stock/fund), symbol, schemeCode, category, plan | Invest universe |
| Runs | `researchRuns` | userId, entityIds[], mode, status, budget, partialReason | status machine in §4.1 |
| | `runSteps` | runId, stepName, status, attempts, inputHash, outputRef, error | idempotency + resume |
| | `plans` | runId, questions[], providerMap | planner output |
| Evidence | `sources` | url, canonicalUrl, publisher, providerId, authorityTier, originGroupId | |
| | `snapshots` | sourceId, contentHash, storageId, retrievedAt, publishedAt, charCount | immutable |
| | `chunks` | snapshotId, idx, text, span | for search and quote lookup |
| Claims | `claims` | runId, entityId, text, type, snapshotId, quote, period | |
| | `facts` | runId, entityId, metric, value, unit, currency, period, basis, snapshotId, quote | structured numbers |
| | `verifications` | claimId, l1Result, l2Verdict, l2Reason, finalVerdict, modelVersion | one per claim |
| | `conflicts` | runId, factKey, kind, items[], severity, preferredItem, reason | |
| | `confidence` | claimId, score, band, components{A,C,R,V,X}, configVersion | |
| Output | `reports` | runId, sections[{text, claimIds[]}], tableRefs, gaps[], version | |
| Watch | `watchTargets` | entityId, nextCheckAt, cursors{}, interval | global per company |
| | `watchSubs` | userId, entityId, rules{}, thresholds | per user |
| | `events` | entityId, clusterKey, type, importance, summary, sourceIds[], firstSeenAt | |
| | `alerts` | userId, eventId, channel, status, sentAt, unique(userId,eventId,channel) | |
| | `emailSuppressions` | email, reason, at | bounce/complaint/unsub |
| Invest | `metrics` | instrumentId, name, value, asOf, formulaVersion, inputsRef | raw inputs retained |
| | `rankings` | scope (sector/category), profile, configVersion, asOf, items[] | |
| | `navSeries` / price store | instrumentId, date, value | chunked per instrument |
| Ops | `runTraces` | runId, step, provider/model, latencyMs, tokensIn/Out, cost, status | feeds dashboard |
| | `providerHealth` | provider, state (closed/open/half-open), failures, openedAt | circuit breaker |
| | `usage` | userId, day, runs, tokens | quotas |

**Schema evolution:** add fields as optional first, backfill with a migration job, then tighten. Config (weights/tolerances) is versioned (`configVersion`), and stored with each output so old results stay explainable.

---

## 9. Provider adapters

All providers sit behind one interface:

```
Provider.fetch(query, ctx) → Result<NormalizedItems, ProviderError>
ProviderError = RATE_LIMITED | TIMEOUT | NOT_FOUND | AUTH | SCHEMA_DRIFT | UNAVAILABLE
```

| Provider | Used for | Notes / risk |
|---|---|---|
| **Gemini** | plan, extract, judge, summarize | configurable model per step (cheaper for bulk extract, stronger for judge/write); structured output only |
| **GDELT** | news discovery + metadata | article text not guaranteed, so fetch body via Firecrawl or direct |
| **Finnhub** | company news, quotes, some fundamentals | **Indian coverage on free plan must be tested in W1** |
| **FMP** (optional) | statements and ratios | check free-plan coverage and limits |
| **MFapi.in** | scheme list + NAV history | NAV only: no expense ratio/AUM |
| **AMFI** | categories, NAV files, industry data | some are file downloads; parse and cache |
| **NSE/BSE/filings** | official announcements | **check terms and access method before relying on it**; prefer official feeds over scraping |
| **SEC EDGAR** (proposed) | US company filings | free, official, no key; optional scope |
| **Firecrawl** (optional) | clean page text | quota-aware; direct fetch as fallback |
| **Resend** | emails | webhooks for bounce/complaint |

**Per-adapter requirements:** timeout, retry with exponential backoff + jitter (only for retryable errors), response schema validation (detects API changes → `SCHEMA_DRIFT`), caching with TTL (news minutes, statements days, NAV daily), source authority tier assignment, recorded fixtures for tests.
**Rate limiting:** token bucket per provider (global) and per user, using the rate-limiter component.
**Circuit breaker:** after repeated failures a provider is marked open in `providerHealth`; runs skip it, continue with other sources, and mark the gap. It's retried after a cool-down.

---

## 10. Security

- **Auth:** Convex Auth with Google (and email as a fallback). All functions check identity; **row-level ownership** checks in every query/mutation. Roles: `user`, `admin`.
- **Secrets:** only in Convex environment variables; never in frontend code or git. `.env.example` has names only. Rotate keys if ever exposed.
- **Input validation:** every public function validates arguments with Convex validators plus length limits.
- **Prompt injection:** fetched text is placed in clearly delimited data blocks; the system prompt states it is untrusted; **LLM output can only create data (claims/classifications), never trigger actions**; only validated JSON schemas are accepted; the verifier's L1 stage catches fabricated quotes.
- **SSRF / unsafe fetch:** see §4.4.
- **Abuse and cost control:** per-user quotas, concurrency limits, global daily Gemini budget with an automatic "degraded mode" (cached results only) when exceeded.
- **Privacy:** minimal personal data (email, name, watchlist); no sensitive data in URLs or logs; account deletion removes user rows.
- **Email:** SPF/DKIM/DMARC on the sending domain, suppression list, unsubscribe.
- **Dependency hygiene:** lockfile, automated dependency audit in CI.

---

## 11. Reliability

- Timeouts on every external call; retries only for retryable errors; **idempotency keys** on writes and emails.
- Long work is split into resumable steps so no single action approaches platform time limits.
- **Partial results policy:** a run with some failed providers still completes as `completed_partial`, with the failed sources and gaps listed.
- **Failure states are first-class:** `failed` runs keep their step history for debugging and offer "retry from last good step".
- **Stale data:** every datum shows "as of"; data past its TTL is flagged and excluded from Invest ranking if beyond the staleness limit.
- **Kill switches (config):** disable a provider, disable Watch sending, force degraded mode.

---

## 12. Observability

- **`runTraces`** record every step: provider/model, latency, tokens, cost, outcome.
- **Ops dashboard** (admin): runs per day, success/partial/fail rate, p50/p95 latency per stage, tokens and cost per run, provider error and breaker states, quota usage, Watch metrics (checks, events, alerts sent, duplicate-suppressed count, email bounces), verification stats (verified %, unverified %, conflict count).
- **Error tracking:** Sentry for the frontend and backend exceptions (DSN optional, per your env list).
- **Structured logs** with `runId` correlation. **Alerts to the team** on: provider outage, failure-rate spike, budget at 80%.

---

## 13. Testing and evaluation

| Layer | What | How |
|---|---|---|
| Unit | unit/number normalization, quote matching, conflict tolerance, scoring, dedupe, ranking math, SIP XIRR | deterministic tests with known answers (hand-checked spreadsheet values for metrics) |
| Integration | each adapter against **recorded fixtures**; full pipeline with a fake Gemini | fixtures keep tests fast and free |
| Golden set | ~30 company-question sets with human-labelled correct claims | measures extraction and verification quality |
| **Verification eval** | labelled (claim, source) pairs, including **planted false citations** | metrics: coverage, false-accept rate, false-reject rate |
| **Conflict eval** | seeded disagreements (unit differences, restated numbers, wrong values) | recall ≥ 90%, precision ≥ 80% |
| Confidence calibration | high-band claims should be correct more often than low-band | tune weights |
| Watch replay | replay recorded feeds with known events and duplicates | duplicate-alert rate, missed-important-event rate, latency |
| Invest | rank determinism, metric accuracy, missing-data handling | same input = same output |
| **Chaos** | provider 429/500/timeouts, malformed JSON, schema drift, Gemini outage mid-run, partial failures | the run must resume or degrade, never corrupt |
| **Adversarial** | prompt-injection pages, fake single-source claims, syndicated duplicates inflating corroboration, crore-vs-million traps, stale articles presented as new, ambiguous company names, paywalled or huge pages, non-English text | each case has an expected safe outcome |
| Load | N concurrent runs, Watch tick with many targets | p95 latency, error rate, quota behaviour; results go in the final report |

The Python harness in `eval/` runs these and outputs a metrics report. **CI blocks merges** if key metrics regress beyond thresholds.

---

## 14. Frontend notes

- Reactive queries drive live run progress, alerts feed and ranking pages.
- Trust UI: verdict badges, confidence bands with breakdown, source passage highlight, "as of" dates everywhere, conflict side-by-side view, visible gaps.
- Accessibility: keyboard navigation, colour not used as the only signal (icons + text on verdicts), responsive layout.
- Methodology page publishes the scoring formulas, ranking weights and limitations (transparency builds trust and helps the demo).

---

## 15. Environments, CI/CD and deployment

- **Environments:** local (dev Convex deployment), staging, production, each with its own Convex deployment and separate keys.
- **CI (GitHub Actions):** lint, typecheck, unit + integration tests, eval smoke test, dependency audit → on main: deploy Convex, deploy web to Vercel.
- **Env vars** (Convex dashboard): `GEMINI_API_KEY`, `FINNHUB_API_KEY`, `FMP_API_KEY`(opt), `RESEND_API_KEY`, `FIRECRAWL_API_KEY`(opt), `GOOGLE_CLIENT_ID/SECRET`(opt), `SENTRY_DSN`(opt), auth signing keys, `SITE_URL`, `ADMIN_EMAILS`. Frontend only gets `PUBLIC_CONVEX_URL`.
- **Runbook** in `docs/`: how to rotate keys, disable a provider, replay a failed run, handle quota exhaustion.

---

## 16. Compliance and legal notes (to confirm with mentor/partner)

- Original scope excluded investment advice. **Invest Discovery needs written sign-off** and clear informational framing.
- In India, publishing ranked or recommended securities may attract SEBI research-analyst regulations. Confirm before any public launch.
- Check each provider's terms for commercial use, caching and redistribution (free plans often restrict this).
- Show attribution and source links wherever required.

---

## 17. Risks and open items

| Risk | Mitigation |
|---|---|
| Indian stock coverage on free APIs may be poor | W1 coverage spike on ~10 tickers; choose providers from evidence |
| NSE/BSE access/terms | official feeds only; fallback to news-based detection, labelled lower authority |
| MF expense ratio/AUM unavailable | rank without them, label as "not available" |
| Gemini free-tier quotas | caching, per-step model choice, work-pool concurrency limits, degraded mode |
| LLM errors/hallucination | two-layer verification, schema-constrained outputs, post-checks |
| 8-week scope is large | cut line: MF ranking, then Watch digests; Research core is never cut |

---

## 18. Build order (maps to the 8 weeks)

1. **W1:** coverage spike, scaffold, config, schema, auth, adapter interfaces, this doc finalized.
2. **W2:** entity resolution, retrieval, snapshot store, planner, basic report (Research v0).
3. **W3:** tests, two-layer citation verification.
4. **W4:** conflicts, fact tables, first demo.
5. **W5:** confidence scoring, eval harness, chaos/adversarial pass.
6. **W6:** follow-up loop, comparison mode, Watch (scheduler, rules, dedupe, email).
7. **W7:** Invest Discovery (stocks, then funds), performance tuning, ops dashboard.
8. **W8:** polish, docs, architecture diagram, demo video, production deploy.
