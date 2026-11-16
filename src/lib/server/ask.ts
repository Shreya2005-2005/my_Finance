/**
 * ASK: one box for a company name, a question ("Oracle last year profit") or a claim ("Oracle had a profit of 50%").
 *
 *   1. Work out which of the three it is (plain rules for a name; Gemini only labels a sentence).
 *   2. For US-listed companies, find the company in SEC records and read its yearly figures.
 *   3. Plain code compares and decides. The answer shows the official number, the period and a link to the filing.
 *
 * Indian companies (NSE/BSE) are checked against yearly results from Yahoo Finance, in rupees. These are NOT read from the
 * filing itself (BSE blocks automated access), and the answer says so.
 */
import { CACHE_TTL_MS } from "$config/engine.ts";
import { claimNumbers, evaluateAnswer } from "$engine/claims/evaluate.ts";
import { keywordsOf, TOPIC_WORDS } from "$engine/claims/related.ts";
import { understandQuery } from "$engine/claims/understand.ts";
import { loadCompanyList, loadFinancials, matchCompany, normalizeName, type CompanyFinancials, type SecCompany } from "$engine/providers/sec.ts";
import type { ParsedQuery } from "$engine/claims/understand.ts";
import type { ProviderError, Result } from "$engine/providers/types.ts";
import { withRetry } from "$engine/lib/resilience.ts";
import { loadIndianFinancials, searchIndianCompany, type IndianListing } from "$engine/providers/yahoo.ts";
import type { AskResponse } from "$lib/types";
import { cached, forget, providerContext } from "./context";

/** Keeps a good answer for a while; a failure is forgotten at once so the next try starts fresh. */
async function cachedOk<T>(key: string, ttl: number, make: () => Promise<Result<T>>): Promise<Result<T>> {
  const r = await cached(key, ttl, make);
  if (!r.ok) forget(key);
  return r;
}

const why = (e: ProviderError) =>
  e.kind === "RATE_LIMITED" ? "The SEC asked us to slow down. Try again in a minute." :
  e.kind === "TIMEOUT" ? "The SEC did not answer in time. Try again." :
  e.kind === "AUTH" ? "The SEC refused the request. Set SEC_USER_AGENT in .env.local to your name and email." :
  e.kind === "SCHEMA_DRIFT" ? "The SEC changed its data format, so it could not be read." :
  `The SEC is not reachable right now (${e.message}).`;

/**
 * Looks the company up among NSE/BSE listings and reads its yearly rupee figures.
 * Returns the finished answer, or the plain-words reason it could not be done.
 */
async function indianAnswer(base: AskResponse, parsed: ParsedQuery, query: string): Promise<{ response: AskResponse } | { reason: string }> {
  const ctx = providerContext();
  const found = await cachedOk<IndianListing[]>(`yahoo:search:${normalizeName(parsed.company)}`, CACHE_TTL_MS.statements, () => withRetry(() => searchIndianCompany(parsed.company, ctx)));
  if (!found.ok) return { reason: "The Indian company data source is not reachable right now. Try again in a minute." };
  const listing = found.value[0];
  if (!listing) return { reason: `We could not find "${parsed.company}" among companies listed on the NSE or BSE.` };
  const fin = await cachedOk<CompanyFinancials>(`yahoo:facts:${listing.symbol}`, CACHE_TTL_MS.statements, () => withRetry(() => loadIndianFinancials(listing, ctx)));
  if (!fin.ok) return { reason: `We found ${listing.name} (${listing.symbol}) but could not read its yearly figures from the free data source.` };
  return {
    response: {
      ...base,
      record: {
        name: fin.value.name,
        ticker: listing.symbol,
        how: normalizeName(listing.name) === normalizeName(parsed.company) ? "exact" : "close",
        filingsUrl: fin.value.filingsUrl,
        alternatives: found.value.slice(1, 4).map((l) => l.name),
        source: "yahoo",
      },
      answer: evaluateAnswer(parsed, query, fin.value),
    },
  };
}

export async function ask(query: string): Promise<AskResponse> {
  const ctx = providerContext();
  const understood = await understandQuery(query, ctx);
  if (!understood.ok) return { query, kind: "company", company: query, understoodBy: "fallback", error: understood.error.message };
  const parsed = understood.value;
  // A whole sentence is never "just a company name": if the AI said so, treat it as a question so the news is narrowed.
  if (parsed.kind === "company" && parsed.by === "ai" && normalizeName(parsed.company) !== normalizeName(query)) parsed.kind = "question";
  const note = (understood as { note?: string }).note;
  const base: AskResponse = { query, kind: parsed.kind, company: parsed.company, understoodBy: parsed.by, note };
  if (parsed.kind === "company") return base;

  const numbers = claimNumbers(query);
  base.claimNumbers = numbers.map((n) => ({ raw: n.raw, value: n.value, isPercent: n.isPercent }));

  // What the news search should look for besides the company. If the sentence names one of our yearly measures (profit,
  // revenue ...) that is the topic. Otherwise (an event like "raises offer price") the user's own key words are the topic.
  const measured = parsed.metric !== "none" && parsed.metric !== "other";
  const terms = measured ? TOPIC_WORDS[parsed.metric as keyof typeof TOPIC_WORDS] : [];
  const keywords = measured ? [] : keywordsOf(query, parsed.company);
  const amount = numbers.find((n) => !n.isPercent);
  const primary = [...(measured ? [terms[0]] : keywords.slice(0, 5)), parsed.year, amount?.raw].filter((x) => x !== undefined && x !== "").join(" ");
  // For a money measure a second wording is added ("... results highlights"): results pages show their numbers in the snippet
  // only for that wording (tested live: without it the Oracle Financial Services page came back with no figures).
  const second = measured ? [terms[0], "results highlights", parsed.year].filter((x) => x !== undefined && x !== "").join(" ") : "";
  base.search = { terms, keywords, year: parsed.year, focus: second ? `${primary} | ${second}` : primary };

  // Not about a yearly figure at all (an offer, a deal, a price): there is nothing official to compare, but the news can be searched.
  if (!measured && (parsed.metric === "other" || parsed.kind === "claim" || keywords.length >= 2)) {
    return {
      ...base,
      unavailable: {
        label: "News search",
        title: "This is about a news event, so here are the stories that match it.",
        reason: `Your sentence is not about one of the yearly figures we can check (revenue, profit, earnings per share ...), so there is no official figure to compare it with. We searched the news for the words you typed instead. A story that matches is not proof that your sentence is true: read it and see what it actually says.`,
      },
    };
  }

  // An Indian listing, or a figure written in rupees: read the yearly results of the NSE/BSE company.
  if (parsed.listedIn === "india" || numbers.some((n) => n.currency === "inr")) {
    const r = await indianAnswer(base, parsed, query);
    if ("response" in r) return r.response;
    return {
      ...base,
      unavailable: { reason: `${r.reason} Official Indian filings from BSE block automated access, and we will not get around that. The news below is the best evidence we have, and stories that mention your figure are marked.` },
    };
  }
  if (parsed.listedIn === "other") {
    return {
      ...base,
      unavailable: {
        reason: `${parsed.company} is not listed in the US or India, so we cannot check it against official figures yet. The news below is the best evidence we have, and stories that mention your figure are marked.`,
      },
    };
  }

  const list = await cachedOk<SecCompany[]>("sec:list", CACHE_TTL_MS.scheme_list, () => withRetry(() => loadCompanyList(ctx)));
  if (!list.ok) return { ...base, unavailable: { reason: why(list.error) } };

  const match = matchCompany(list.value, parsed.company);
  if (!match) {
    // Not a US company: it may be an Indian one the AI could not place.
    const r = await indianAnswer(base, parsed, query);
    if ("response" in r) return r.response;
    return {
      ...base,
      unavailable: {
        reason: `We could not find "${parsed.company}" among US-listed companies in SEC records or among companies listed on the NSE or BSE, so there is no official figure to check against. Try its full name. The news below is the best evidence we have.`,
      },
    };
  }

  const fin = await cachedOk<CompanyFinancials>(`sec:facts:${match.company.cik}`, CACHE_TTL_MS.statements, () => withRetry(() => loadFinancials(match.company, ctx)));
  if (!fin.ok) return { ...base, unavailable: { reason: why(fin.error) } };

  return {
    ...base,
    record: {
      name: fin.value.name,
      ticker: fin.value.ticker,
      how: match.how,
      filingsUrl: fin.value.filingsUrl,
      alternatives: match.alternatives.map((a) => a.title),
    },
    answer: evaluateAnswer(parsed, query, fin.value),
  };
}
