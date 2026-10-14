/**
 * THE HONEST LIST: what is built, what is waiting on you, and what is not started.
 * Shown on the "Implementation status" page. Keep this file true: update it whenever something changes.
 */
export type State = "done" | "waiting" | "todo";

export interface Item {
  name: string;
  state: State;
  plain: string;
  /** What is needed from the user, if anything. */
  needs?: string;
}

export interface Area {
  title: string;
  items: Item[];
}

export const AREAS: Area[] = [
  {
    title: "Research: checking claims",
    items: [
      { name: "Citation check (Check 1, plain code)", state: "done", plain: "Confirms the quote really exists in the source, and that numbers, units (crore vs million), years and the company name match. Tested against 10 planted false claims: none accepted." },
      { name: "Final verdict rule", state: "done", plain: "Verified only if the code check passes AND the AI judge agrees. The AI can never rescue a claim that failed the code check." },
      { name: "Conflict flagging", state: "done", plain: "Compares the same number across independent sources, ignores rounding, never counts copies of one story twice, and always shows both sides." },
      { name: "Confidence score", state: "done", plain: "A formula (source trust, number of independent sources, freshness, verification, conflict penalty). Unverified claims get no score." },
      { name: "Report guard", state: "done", plain: "Removes any report sentence that cites nothing, cites an unverified claim, or contains a number the evidence does not have." },
      { name: "Follow-up research decision", state: "done", plain: "Finds gaps (no evidence, one source, unresolved conflict) and decides whether to search again, with a hard limit of 2 rounds." },
      { name: "One box: company name, question or claim", state: "done", plain: "Type a name for the news briefing, a question like \"Oracle last year profit\", or a claim like \"Oracle had a profit of 50%\". Gemini only labels the sentence (company, measure, year). The numbers in a claim are read by plain code, and the AI never sees the official figures. Tested live with the real key." },
      { name: "Official yearly figures (US companies, SEC)", state: "done", plain: "Revenue, net income, operating income, gross profit, earnings per share and cash from operations, straight from the company's annual report (Form 10-K), with the exact period and a link to the filing. Checked against Oracle, Apple and Tesla. A percentage with no clear meaning is compared with both growth and margin, and we show which one matched." },
      { name: "Only the news that relates to what you typed", state: "done", plain: "For a question or claim, the news search looks for the company AND the topic (for example \"Oracle operating profit 2026\"), looks back 30 days, and shows only stories that mention your figure or topic. A sentence about an event, with no exact number (for example \"Tata Motors raises offer price per share\"), is searched by its own key words, and plural or past forms count as the same word. Everything else about the company is one click away (\"Show all news about Oracle\"). Plain scoring rules, no AI." },
      { name: "Claim verdicts: correct, close, partly, not correct, can't confirm", state: "done", plain: "Plain code compares the claim with the official number, using the rounding the user wrote. Rupee amounts are never converted, because that would mean guessing an exchange rate." },
      { name: "AI steps: extract claims from articles, judge, write report", state: "todo", plain: "The Gemini key works and the prompts are written and tested with fake answers, but they are not yet used on real news articles. Next step: read the stories into checked claims and write the report." },
      { name: "Reading full articles (Firecrawl)", state: "done", plain: "Key works: read a real web page (about 100,000 characters). Safety checks run on every address. Read a full Apple article from a Finnhub link (about 10,000 characters). Limit found by testing: Firecrawl refuses Google News links, so Google-found news stays headline-only until we can get the publisher's own link." },
      { name: "Research briefing: stories, trust labels, exact quotes", state: "done", plain: "Gathers news from Google News, a trusted-outlet web search (Firecrawl) and Finnhub (US), groups differently worded headlines into real stories (tested on 200 real headlines), labels each as Well reported / Major outlet / Single outlet / Source not recognised by plain rules, and shows quotes copied word for word. Hides social posts and forums by default." },
      { name: "Returning-visitor features", state: "done", plain: "Follow companies, see recent searches, and get a \"new since your last visit\" count with New badges. Remembered in this browser only; real accounts need login." },
      { name: "Reading filing PDFs", state: "done", plain: "Extracts the text of PDFs (3-page filing: about 7,000 characters, tested). Limits on size and page count keep it safe. Scanned image PDFs have no text and are reported as unreadable." },
      { name: "Company name resolution (\"which Tata?\")", state: "todo", plain: "Not built for the news briefing. For official figures, a name is matched to the SEC list and the match is shown so you can spot a wrong one." },
      { name: "Claims about Indian companies", state: "waiting", plain: "Cannot be checked against official filings, because BSE blocks automated access. We say so, show the news, and mark stories that repeat the figure.", needs: "A decision on BSE access (same as the filings item in Watch)." },
      { name: "Multi-company comparison table", state: "todo", plain: "The comparison logic for one metric exists, but the 2 to 5 company comparison view and run are not built." },
    ],
  },
  {
    title: "Watch: monitoring",
    items: [
      { name: "Event type, importance, duplicate merge", state: "done", plain: "Rules label each story (results, deal, regulatory ...), score its importance, and merge repeats at 2 levels. Tested on live headlines." },
      { name: "Email alert rules", state: "done", plain: "Decides in-app vs immediate email vs daily digest from the user's threshold, event types and an hourly email cap. Built and tested, but not shown on the Watch page because emails are not sent yet." },
      { name: "Top-5 alerts per company", state: "done", plain: "The Watch page opens on the company you searched last and shows its 5 most important recent stories, never more. Only recognised sources are used, two alerts never repeat the same event, and each has a plain label (Important / Worth a look / For your information) and a one-line reason. Unread alerts are marked New. Your list is kept in this browser only." },
      { name: "Scheduler (checks every 15 minutes)", state: "waiting", plain: "Designed. Needs the Convex backend to run jobs on a timer.", needs: "Sign in to Convex once: run npx convex dev and log in." },
      { name: "Email alerts and daily digest", state: "waiting", plain: "Designed. Not built.", needs: "A Resend API key and a sending domain." },
      { name: "Official filings and annual reports (BSE)", state: "waiting", plain: "The reader is built and tested on saved real BSE responses, including PDF text reading. But BSE returns HTTP 403 to programs that identify themselves honestly, and we will not disguise ours as a browser. Its terms of use are also not reviewed.", needs: "A decision on BSE access: ask BSE for permission or a data agreement, or use companies' own investor-relations pages instead." },
      { name: "NSE announcements", state: "todo", plain: "Not used. NSE has no public feed and restricts automated access." },
      { name: "Saved watchlists per user", state: "todo", plain: "The Watch page keeps your list in this browser only. Real accounts need login." },
    ],
  },
  {
    title: "Invest Discovery",
    items: [
      { name: "Mutual fund ranking", state: "done", plain: "Real NAV history from MFapi. Returns, SIP return, volatility, worst fall; ranked against peers with published weights and a reason for every rank." },
      { name: "Invest page: Mutual funds", state: "done", plain: "Pick what to invest in (Mutual funds or Stocks), then one of 13 fund types (flexi cap, large cap, index, tax saving, liquid, gold and others) and a ranking style. Shows the top 5 (or top 10) funds with the reasons and risks, and a click-to-expand breakdown of every score. Tested live on Flexi cap and Index funds; the other types are not yet checked one by one." },
      { name: "Invest page: Stocks section", state: "waiting", plain: "The section is on the page and says plainly that stock ranking is not available yet, with a preview of the five stock types it will show. No stock numbers are shown.", needs: "A decision on a stock-data source (see Indian stock data below)." },
      { name: "Risk flags", state: "done", plain: "Plain rules, for example 'fell more than 35%' or 'lost money over some 3-year periods'." },
      { name: "Stock ranking maths", state: "done", plain: "The ranking engine and weights exist and are tested, but there is no stock data feeding them yet." },
      { name: "Finnhub (US stocks)", state: "done", plain: "Key works. Tested: US stocks return quotes, company info, news and fundamentals. Research uses it automatically for US companies." },
      { name: "Indian stock data", state: "todo", plain: "Tested with real keys on 5 big Indian stocks. Finnhub: every one blocked. Financial Modeling Prep: every one refused as paid (HTTP 402). Twelve Data: its free plan includes only 1 NSE stock (Infosys) out of 3,814, and 2 of 5,239 on BSE. So no free source ranks Indian stocks yet. Alpha Vantage is untested (needs a key).", needs: "A decision on an Indian stock-data source: Alpha Vantage test, a broker API, or a paid plan." },
      { name: "Fund expense ratio and AUM", state: "todo", plain: "Not provided by MFapi. Needs AMFI files or another source. Shown as 'not available', never guessed." },
      { name: "Legal sign-off", state: "waiting", plain: "Your original scope excluded investment advice. Ranking needs your partner's and mentor's written OK.", needs: "Your mentor and partner." },
    ],
  },
  {
    title: "Platform",
    items: [
      { name: "Data-source adapters", state: "done", plain: "Google News and MFapi tested live; GDELT (weak) and Finnhub coded. All handle rate limits, timeouts and format changes, and retry only when it makes sense." },
      { name: "Retry, circuit breaker, rate limiter", state: "done", plain: "Keep the system working when an outside service misbehaves. Tested with simulated failures." },
      { name: "Database design (27 tables)", state: "waiting", plain: "Fully designed in code, but not created anywhere yet.", needs: "Sign in to Convex once: run npx convex dev and log in." },
      { name: "Login (Google)", state: "waiting", plain: "Not built.", needs: "Convex first, then Google sign-in keys." },
      { name: "Durable run workflow and evidence storage", state: "todo", plain: "The step runner that saves every stage so a crashed run can resume, and the storage of source snapshots. Needs Convex." },
      { name: "Automated tests", state: "done", plain: "336 tests, including planted false citations, seeded conflicts, unit traps, prompt-injection text and simulated provider failures." },
      { name: "Python evaluation harness and load tests", state: "todo", plain: "Not started. The brief asks for performance benchmarking and load testing." },
      { name: "Operations dashboard and error tracking", state: "todo", plain: "The table design exists. No dashboard yet." },
      { name: "Deployment, documentation, demo video", state: "todo", plain: "Architecture doc is written. Deployment, the runbook and the video are not done." },
      { name: "Frontend", state: "done", plain: "This website: Home, Research, Watch, Invest, Methodology, Status. It reads live data through the same engine code." },
    ],
  },
];

export const LIMITS: string[] = [
  "A search result shows only what the search engine returned. Search engines pick the snippet by the wording of the search, so a page's numbers (for example a results page) may be missing from the snippet unless the figure is typed. We search two wordings and keep the longer text, and we never read a number out of a page we could not read.",
  "A marked story can be about a different company with a similar name (for example Oracle versus Oracle Financial Services Software). We show the headline and say so, but we cannot yet tell which company each story is about.",
  "Claim checking covers six yearly figures (revenue, net income, operating income, gross profit, earnings per share, cash from operations) and only for US-listed companies. Quarterly figures, debt, assets, share price and other measures are not covered yet.",
  "\"Last year\" means the newest full year in the annual report, and the answer always states the exact period. A company's own year naming can differ (Oracle's year ends in May).",
  "Gemini's reading of a sentence (which company, which measure) has not been measured for accuracy. We always show what it understood, and the SEC match, so a wrong reading is visible.",
  "Companies that file foreign-company forms (20-F, 40-F) are not read yet.",
  "Numbers written as words (for example \"five plants\") are not compared by code. Only the AI judge could catch those.",
  "The 90% conflict-detection target is met only on a synthetic test set of 20 pairs, not yet on real companies.",
  "The AI judge's accuracy has not been measured at all, because it has never been run.",
  "A briefing shows that something was reported, not that its numbers are right. Without official filings or claim checking, figures inside stories are unverified.",
  "\"Well reported\" counts separate outlets, but news sites often repeat one wire report (for example PTI or Reuters), which can make a story look more widely confirmed than it is.",
  "Story grouping sometimes splits one event into two or three groups. We chose that over wrongly mixing different events.",
  "Web search results carry no publication date (about 1 in 7 items), so freshness for those is unknown.",
  "Quotes are only as good as the page descriptions we can read. Some stories have no quote.",
  "Duplicate merging works on headlines. The same story written with very different headlines can still show up as separate events until we compare full article text.",
  "Source trust labels use a simple publisher list, so some real outlets are labelled \"unknown source\" until the list grows.",
  "Fund rankings compare up to 12 funds matched by your search. They are a comparison of that group, not of the whole market.",
  "The example report page uses a fictional company, and its AI answers are recorded examples.",
  "The Research page only collects news sources today. It does not yet read them into checked claims or write a report.",
  "Everything runs on free data sources with no commercial-use review yet.",
];
