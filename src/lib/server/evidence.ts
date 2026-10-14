/**
 * RESEARCH, STAGES 1 AND 2: gather sources from every place we can, group them into stories, and say
 * exactly where each came from.
 *
 *   Google News         news headlines from many publishers   (no key)
 *   Trusted-outlet web search (Firecrawl)
 *                       the publisher's own links, with a description copied from the page   (key)
 *   Finnhub             stock news, US companies only on the free plan                       (key)
 *   BSE                 official filings and annual reports (built, but BSE blocks automated access)
 *
 * Each place is reported in `channels`, so the page can say plainly what worked and what did not.
 */
import { CACHE_TTL_MS } from "$config/engine.ts";
import { classifyPublisher, isWeakSource, TRUSTED_OUTLET_SITES } from "$engine/lib/authority.ts";
import { withRetry } from "$engine/lib/resilience.ts";
import { sha256Hex } from "$engine/lib/text.ts";
import { getAnnouncements, getAnnualReports, searchCompany } from "$engine/providers/bse.ts";
import { readArticle, readFilingPdf } from "$engine/providers/documents.ts";
import { finnhub, searchSymbol as searchFinnhubSymbol, type FinnhubSymbol } from "$engine/providers/finnhub.ts";
import { firecrawl, firecrawlSearch } from "$engine/providers/firecrawl.ts";
import { googleNews } from "$engine/providers/googleNews.ts";
import { ok, type Result, type SourceDoc } from "$engine/providers/types.ts";
import { buildStories } from "$engine/watch/stories.ts";
import type { Channel, CompanyMatch, Coverage, DocumentText, EvidenceResponse, EvidenceSource } from "$lib/types";
import { cached, forget, providerContext } from "./context";

const DAY = 86_400_000;
const FILING_DAYS = 90;
const MAX_ANNUAL_REPORTS = 3;

export const ALLOWED_DAYS = [1, 7, 30] as const;

/** Turns a provider result into a channel line plus its documents. Failures become a visible note, never a crash. */
function summarize(id: string, name: string, r: Result<SourceDoc[]>, emptyNote: string, okNote: string): { channel: Channel; docs: SourceDoc[] } {
  if (!r.ok) {
    const kind = r.error.kind;
    const note =
      kind === "RATE_LIMITED" ? "The service asked us to slow down. Try again in a minute." :
      kind === "AUTH" && id.startsWith("bse")
        ? "BSE refused our request (HTTP 403). It blocks automated programs that identify themselves honestly, so official filings are unavailable until BSE gives permission or a data agreement is in place."
        : kind === "AUTH" ? "The service refused the key. Check it in .env.local." :
      kind === "SCHEMA_DRIFT" ? "The service changed its format, so its data could not be read." :
      kind === "TIMEOUT" ? "The service did not answer in time." :
      `The service is not reachable right now (${r.error.message}).`;
    return { channel: { id, name, status: "error", count: 0, note }, docs: [] };
  }
  const docs = r.value;
  return { channel: { id, name, status: docs.length ? "ok" : "empty", count: docs.length, note: docs.length ? okNote : emptyNote }, docs };
}

/**
 * `focus` narrows the search to what the user asked about (for example "operating profit 2026"). The searches then look
 * for the company AND that topic, so stories about it are found even if they are not among the company's newest news.
 */
export async function liveEvidence(company: string, scripCode?: string, days = 7, focus = ""): Promise<EvidenceResponse> {
  const d = (ALLOWED_DAYS as readonly number[]).includes(days) ? days : 7;
  const key = `evidence7:${company.toLowerCase()}:${scripCode ?? ""}:${d}:${focus.toLowerCase()}`;
  const result = await cached(key, CACHE_TTL_MS.news * 3, () => gather(company, scripCode, d, focus));
  // A search where a news source failed (for example it was rate-limited) must not be remembered: the next try starts fresh.
  if (result.channels.some((c) => c.status === "error" && (c.id === "news" || c.id.startsWith("web-")))) forget(key);
  return result;
}

async function gather(company: string, scripCode: string | undefined, days: number, focus: string): Promise<EvidenceResponse> {
  const ctx = providerContext();
  const channels: Channel[] = [];
  const all: SourceDoc[] = [];
  const since = ctx.now() - days * DAY;

  // Who is the company on the exchange list? (Used for filings when BSE access is available.)
  const found = await withRetry(() => searchCompany(company, ctx));
  const candidates: CompanyMatch[] = found.ok ? found.value.slice(0, 6) : [];
  const match = scripCode ? candidates.find((c) => c.scripCode === scripCode) : candidates[0];

  const finnhubReady = finnhub.isConfigured(ctx.env);
  const firecrawlReady = firecrawl.isConfigured(ctx.env);

  /** Finnhub (free plan) covers US stocks only: look up a US symbol by name, then fetch its news. */
  const finnhubNews = async (): Promise<{ result: Result<SourceDoc[]>; symbol?: FinnhubSymbol } | undefined> => {
    if (!finnhubReady) return undefined;
    const s = await withRetry(() => searchFinnhubSymbol(company, ctx));
    if (!s.ok) return { result: s };
    const symbol = s.value[0];
    if (!symbol) return { result: ok([]) };
    return { result: await withRetry(() => finnhub.searchNews({ text: symbol.symbol, since, maxRecords: 30 }, ctx)), symbol };
  };

  // A focus can hold up to two wordings separated by "|". Search engines choose the snippet they show by the wording, and one
  // wording may bring back the snippet that holds the numbers while another does not, so both are searched and merged.
  const [firstFocus = "", ...otherFocus] = focus.split("|").map((f) => f.trim()).filter(Boolean).slice(0, 2);
  const searchText = firstFocus ? `${company} ${firstFocus}` : company;
  const sites = TRUSTED_OUTLET_SITES.map((s) => `site:${s}`).join(" OR ");
  const extras = firecrawlReady
    ? await Promise.all(
        otherFocus.flatMap((f) => [
          withRetry(() => firecrawlSearch(`${company} ${f} (${sites})`, { days, limit: 10 }, ctx)),
          withRetry(() => firecrawlSearch(`${company} ${f}`, { days, limit: 8 }, ctx)),
        ]),
      )
    : [];
  const extraTrusted = extras.filter((_, i) => i % 2 === 0);
  const extraGeneral = extras.filter((_, i) => i % 2 === 1);
  const merge = (first: Result<SourceDoc[]> | undefined, more: Array<Result<SourceDoc[]>>): Result<SourceDoc[]> | undefined =>
    first && first.ok ? ok([...first.value, ...more.flatMap((m) => (m.ok ? m.value : []))]) : first;
  const [news, trusted0, general0, filings, annual, fh] = await Promise.all([
    withRetry(() => googleNews.searchNews({ text: searchText, since, maxRecords: 80 }, ctx)),
    firecrawlReady ? withRetry(() => firecrawlSearch(`${searchText} (${sites})`, { days, limit: 10 }, ctx)) : Promise.resolve(undefined),
    firecrawlReady ? withRetry(() => firecrawlSearch(firstFocus ? searchText : `${company} news`, { days, limit: 8 }, ctx)) : Promise.resolve(undefined),
    match ? withRetry(() => getAnnouncements(match.scripCode, { since: ctx.now() - FILING_DAYS * DAY }, ctx)) : Promise.resolve(undefined),
    match ? withRetry(() => getAnnualReports(match.scripCode, ctx)) : Promise.resolve(undefined),
    finnhubNews(),
  ]);

  const trusted = merge(trusted0, extraTrusted);
  const general = merge(general0, extraGeneral);

  // Official filings (when the exchange allows access)
  if (match) {
    const a = summarize("bse-ann", "BSE company announcements", filings!, `No announcements in the last ${FILING_DAYS} days.`, `Official filings from the last ${FILING_DAYS} days, straight from the exchange.`);
    channels.push(a.channel);
    all.push(...a.docs.slice(0, 30));
    const r = summarize("bse-ar", "BSE annual reports", annual!, "No annual reports are listed.", `Latest ${MAX_ANNUAL_REPORTS} of the company's own annual reports (PDF).`);
    channels.push(r.channel);
    all.push(...r.docs.slice(0, MAX_ANNUAL_REPORTS));
  } else if (!found.ok) {
    channels.push(summarize("bse-ann", "BSE company announcements", found, "", "").channel);
  }

  // News
  const n = summarize("news", "Google News", news, "No recent news found.", "Headlines and summaries from many publishers.");
  channels.push(n.channel);
  all.push(...n.docs.map((d) => ({ ...d, kind: "news" as const })));

  if (firecrawlReady) {
    const t = summarize("web-trusted", "Web search, trusted outlets (Firecrawl)", trusted!, "No articles from the trusted outlets in this period.", "Articles from Reuters, Economic Times, Mint, Business Standard, Moneycontrol and similar, with the publisher's own link.");
    channels.push(t.channel);
    all.push(...t.docs);
    const g = summarize("web-general", "Web search, general (Firecrawl)", general!, "Nothing extra found.", "Other web results. Social posts and forums are kept but hidden unless you ask for them.");
    channels.push(g.channel);
    all.push(...g.docs);
  } else {
    channels.push({ id: "firecrawl", name: "Web search and full article reading (Firecrawl)", status: "needs_key", count: 0, note: "Not used yet. Add FIRECRAWL_API_KEY to .env.local." });
  }

  if (!finnhubReady) {
    channels.push({ id: "finnhub", name: "Finnhub stock news", status: "needs_key", count: 0, note: "Not used yet. Add FINNHUB_API_KEY to .env.local (a free key from finnhub.io)." });
  } else {
    const sym = fh!.symbol;
    const f = summarize(
      "finnhub",
      "Finnhub stock news (US stocks)",
      fh!.result,
      sym ? `Matched ${sym.symbol} (${sym.description}) but there was no news in this period.` : "No US-listed company matched. Finnhub's free plan covers US stocks only (every Indian symbol is blocked, which we tested).",
      sym ? `Matched ${sym.symbol} (${sym.description}). Stock news from Finnhub.` : "Stock news from Finnhub.",
    );
    channels.push(f.channel);
    all.push(...f.docs.map((d) => ({ ...d, kind: "news" as const })));
  }

  // Attach a fingerprint to every saved text, drop exact duplicate links, and mark weak sources.
  // When the same link arrives twice, keep the copy with the longer text: it is the one that holds more of the page's own words.
  const best = new Map<string, SourceDoc>();
  for (const d of all) {
    const have = best.get(d.canonicalUrl);
    if (!have || (d.text?.length ?? 0) > (have.text?.length ?? 0)) best.set(d.canonicalUrl, have ? { ...d, publishedAt: have.publishedAt ?? d.publishedAt } : d);
  }
  const sources: EvidenceSource[] = [];
  for (const d of best.values()) {
    let host = "";
    try {
      host = new URL(d.url).hostname;
    } catch {
      /* keep empty */
    }
    sources.push({
      kind: d.kind ?? "news",
      text: d.text ? d.text.slice(0, 600) : undefined,
      weak: isWeakSource(d.publisher, host),
      category: d.category,
      attachmentUrl: d.attachmentUrl,
      title: d.title ?? "",
      publisher: d.publisher,
      tier: d.authorityTier === "unknown" ? classifyPublisher(d.publisher, host) : d.authorityTier,
      publishedAt: d.publishedAt,
      url: d.url,
      fingerprint: (await sha256Hex(`${d.title}\n${d.text ?? ""}\n${d.publisher ?? ""}`)).slice(0, 12),
      origin: 0,
    });
  }

  // Group into real-world stories (plain code, no AI).
  const stories = buildStories(sources, { companyWords: company.split(/\s+/), now: ctx.now() });
  stories.forEach((s, i) => s.items.forEach((it) => (it.origin = i + 1)));

  const dates = sources.map((s) => s.publishedAt).filter((x): x is number => x !== undefined);
  const coverage: Coverage = {
    items: sources.length,
    stories: stories.length,
    publishers: new Set(sources.map((s) => (s.publisher ?? "?").toLowerCase())).size,
    newest: dates.length ? Math.max(...dates) : undefined,
    oldest: dates.length ? Math.min(...dates) : undefined,
    undated: sources.filter((s) => s.publishedAt === undefined).length,
  };

  const tierCounts = { primary: 0, wire: 0, trade: 0, unknown: 0 };
  for (const s of sources) tierCounts[s.tier]++;

  return {
    company,
    days,
    coverage,
    stories,
    match,
    candidates,
    exchangeReachable: found.ok,
    channels,
    canReadArticles: firecrawlReady,
    fetchedAt: ctx.now(),
    sources,
    independentOrigins: stories.length,
    tierCounts,
  };
}

/** Reads the full text of one filing PDF or news article, when asked. */
export async function readDocument(url: string, kind: "filing" | "article"): Promise<DocumentText> {
  return cached(`doc2:${kind}:${url}`, 60 * 60 * 1000, async () => {
    const ctx = providerContext();
    const LIMIT = 9000; // enough to read; the page notes when more exists
    if (kind === "filing") {
      const r = await readFilingPdf(url, ctx, { maxPages: 12 });
      if (!r.ok) return { text: "", truncated: false, chars: 0, error: r.error.message };
      return { text: r.value.text.slice(0, LIMIT), pages: r.value.pages, totalPages: r.value.totalPages, truncated: r.value.truncated || r.value.text.length > LIMIT, chars: r.value.text.length, via: "BSE PDF" };
    }
    const r = await readArticle(url, ctx);
    if (!r.ok) return { text: "", truncated: false, chars: 0, error: r.error.message };
    return { text: r.value.text.slice(0, LIMIT), truncated: r.value.text.length > LIMIT, chars: r.value.text.length, via: r.value.via === "firecrawl" ? "Firecrawl" : "direct download" };
  });
}
