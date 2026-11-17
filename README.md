# Verifin

**Every claim, checked against its source.**

Verifin is a financial research website for India (and the US). Ask about a company and it shows
what it found, where each fact came from, and what it could not confirm. It would rather say
"can't confirm" than guess.

**Live site:** https://my-finance-peach-six.vercel.app

## What you can do

| Page | What it does |
|---|---|
| **Daily news** | Today's top world and Indian market stories, gathered from many outlets. |
| **Research** | Type a company, a question ("Reliance profit 2025") or a claim ("TCS revenue was 2.5 lakh crore"). Verifin finds the official figure, compares it, and says **Correct**, **Close**, **Not correct** or **Can't confirm**, with a link to the source. |
| **Watch** | Follow companies and see the important news and announcements, with duplicate stories merged. |
| **Invest** | Top Indian stocks (Nifty 50 gainers, losers, most traded, with news per company) and mutual funds ranked by published rules, with the risks shown next to each one. |

## The one rule

> **AI reads and explains. Plain code does the maths, the checking and the ranking.**

The AI never sees the official numbers and never decides a verdict. Every number on the page comes
from a data source, and the page names that source.

## Where the data comes from (all free)

| Data | Source |
|---|---|
| US company figures | SEC EDGAR |
| Indian company figures and stock prices | Yahoo Finance public feed |
| News | Google News, Indian business RSS feeds, GDELT |
| Mutual fund prices | MFapi.in |
| Question understanding | Google Gemini |

Prices can be delayed. Indian figures come from a data service, not the company's own filing, and
the page says so.

## Run it on your computer

```bash
npm install
npm run dev
```

Open http://localhost:5173.

Copy the names from `.env.example` into a file called `.env.local` and add your own keys
(Gemini, Firecrawl, Finnhub). Never commit real keys.

## Useful commands

```bash
npm test             # run the automated tests
npm run typecheck    # catch mistakes in the code
npm run build        # make the production version
```

## How it is built

- **SvelteKit** for the pages and the server routes (no separate backend to run)
- **TypeScript** everywhere
- **Vitest** for tests
- **Vercel** for hosting

```
src/routes/        pages and API routes
src/lib/server/    the logic behind each page
convex/engine/     the shared engine: data providers, claim checking, ranking
tests/             automated tests
docs/              the full design (ARCHITECTURE.md)
```

## Not investment advice

Verifin shows information from public data using published rules. Past returns do not guarantee
future returns, and markets can fall.

## Author

Built by **Shreya** ([@Shreya2005-2005](https://github.com/Shreya2005-2005)).
