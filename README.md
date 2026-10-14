# Verifin

Agentic financial research where **every claim is checked against its source**.

One shared engine powers three features:

| Feature | What the user gets |
|---|---|
| **Research** | A company report. Each fact is tagged *Verified* or *Unverified*, disagreeing sources are flagged, and each claim has a trust score. |
| **Watch** | A watchlist that checks news and announcements on a schedule and emails only the important, de-duplicated events. |
| **Invest Discovery** | Stocks and mutual funds (for SIP) ranked by clear, published rules, with sources and risks. |

Rule of the project: **AI reads and explains. Normal code does the math, ranking, checking and de-duplication.**

Full design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## What is in each folder

```
src/                     the website (SvelteKit): pages in src/routes, server code in src/lib/server
convex/                  the backend
  schema.ts              the database: every table, explained in plain comments
  config/engine.ts       all tunable numbers (scoring weights, limits, ranking rules)
  engine/enums.ts        every allowed status / verdict / type, listed once
  engine/providers/      the contract every data source (GDELT, Finnhub...) must follow
tests/                   automated tests
scripts/spike/           small scripts that test whether each data source really works
docs/                    architecture and design documents
```

## Commands

```bash
npm install          # install the tools (once)
npm run dev          # start the website at http://localhost:5173
npm run typecheck    # catch mistakes in the code
npm test             # run the automated tests
npm run spike:mfapi  # test the mutual-fund data source
npm run spike:gdelt  # test the news data source
npm run spike:finnhub  # test Finnhub (needs a key in .env.local)
```

## Secrets

Real API keys never go in git. Copy the names from `.env.example` into `.env.local` (for local scripts)
and into the Convex dashboard (for the deployed backend).

## Progress

Built and tested as plain code (works without any login or key):

- [x] **Foundation:** project setup, database design (27 tables), settings file, provider contract
- [x] **Data sources:** Google News, MFapi, GDELT, Finnhub adapters with error handling, retry, circuit breaker and rate limiter
- [x] **Citation verification:** code check (quote, numbers, units, years, company) and the final verdict rule
- [x] **Conflict flagging:** same-metric comparison across independent sources, rounding tolerance, preferred side
- [x] **Confidence score:** formula with authority, corroboration, recency, verification and conflict penalty
- [x] **Follow-up research logic** and **report guard** (drops uncited or mismatched sentences)
- [x] **Gemini client and prompts** (injection-safe wrapping, strict JSON answers)
- [x] **Watch logic:** event type, importance, 3-level duplicate merge, alert planning
- [x] **Invest logic:** returns, risk, SIP return, deterministic ranking with reasons and risk flags
- [x] **Claims and questions:** one search box takes a name, a question ("Oracle last year profit") or a claim ("Oracle had a profit of 50%"); Gemini labels the sentence, plain code compares it with official yearly figures from the SEC (US companies) and gives a verdict
- [x] **Tests:** 310 automated tests including false-citation, seeded-conflict, unit-trap, injection and failure tests
- [x] **Local status page** with live demos

Still to do:

- [ ] **Connect Convex** and login (needs you to sign in once)
- [ ] **Wire the engine into Convex:** durable run workflow, evidence store, saved reports
- [ ] **Run Gemini on news articles** (key works; used today only to read questions and claims) and measure accuracy on a labelled test set
- [ ] **Finnhub / Indian stock coverage** (needs a Finnhub key), stock ranking data
- [ ] **Watch jobs:** scheduler, Resend emails, daily digest
- [ ] **Python evaluation harness** and load tests
- [ ] **Ops dashboard**, docs, demo video, production deploy
- [x] **Research briefing:** stories, trust labels, exact quotes, follow and "new since last visit"
- [x] **Frontend (SvelteKit):** Home, Research, Watch and Invest pages running on live data
