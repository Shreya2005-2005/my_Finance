/**
 * THE PROVIDER CONTRACT.
 *
 * Every outside data source (GDELT, Finnhub, MFapi, AMFI, ...) gets one small
 * "adapter" file that follows the rules below. The rest of the engine only ever
 * sees these shapes, never a provider's raw format. That means:
 *   - switching a provider = rewriting ONE adapter file
 *   - a provider changing its format is caught in ONE place (SCHEMA_DRIFT)
 *   - tests can use saved sample responses instead of real network calls
 */
import type { AccountingBasis, AuthorityTier, ProviderErrorKind } from "../enums.ts";
import { PROVIDER_ERROR_KINDS } from "../enums.ts";

// ---------------------------------------------------------------------------
// What an adapter returns
// ---------------------------------------------------------------------------

/** A readable document: a news article, filing or web page. */
export interface SourceDoc {
  url: string;
  canonicalUrl: string; // cleaned URL (no tracking junk), used to detect duplicates
  title?: string;
  publisher?: string;
  providerId: string; // which adapter produced it
  authorityTier: AuthorityTier;
  publishedAt?: number; // ms since epoch
  retrievedAt: number; // ms since epoch
  /** Full text, if the provider gave it. News APIs often give only a headline + link. */
  text?: string;
  language?: string;
  /** What kind of document this is. Filings and annual reports are official; news is not. */
  kind?: "news" | "announcement" | "annual_report";
  /** For filings: a direct link to the PDF, whose text can be read on demand. */
  attachmentUrl?: string;
  /** The provider's own category label, e.g. "Company Update". */
  category?: string;
}

/** One structured number from a financial-data provider. */
export interface FinancialDatapoint {
  providerId: string;
  entityRef: string; // the provider's own id for the company (ticker, ISIN ...)
  metric: string; // e.g. "revenue", "net_income"
  value: number;
  unit: string; // normalized unit, e.g. "INR" or "percent"
  currency?: string;
  period: string; // e.g. "FY2025", "Q2 FY26"
  basis: AccountingBasis;
  asOf: number; // when the provider says this number was true or published
  retrievedAt: number;
}

/** A daily price or NAV history for one instrument. */
export interface PriceHistory {
  providerId: string;
  instrumentRef: string;
  kind: "price" | "nav";
  /** Parallel lists: dates[i] belongs to values[i]. Dates are ms since epoch, oldest first. */
  dates: number[];
  values: number[];
  retrievedAt: number;
}

// ---------------------------------------------------------------------------
// Errors: every failure is one of six kinds, so the engine knows what to do next
// ---------------------------------------------------------------------------

/** Which failures are worth retrying automatically. */
const RETRYABLE: ReadonlySet<ProviderErrorKind> = new Set(["RATE_LIMITED", "TIMEOUT", "UNAVAILABLE"]);

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly providerId: string;
  /** If the provider told us when to retry (seconds from a 429), it goes here. */
  readonly retryAfterMs?: number;

  constructor(kind: ProviderErrorKind, providerId: string, message: string, retryAfterMs?: number) {
    super(`[${providerId}] ${kind}: ${message}`);
    this.name = "ProviderError";
    this.kind = kind;
    this.providerId = providerId;
    this.retryAfterMs = retryAfterMs;
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.kind);
  }
}

export function isProviderErrorKind(x: string): x is ProviderErrorKind {
  return (PROVIDER_ERROR_KINDS as readonly string[]).includes(x);
}

// ---------------------------------------------------------------------------
// Result type: adapters never "throw into the engine"; they return ok or error
// ---------------------------------------------------------------------------

export type Result<T> = { ok: true; value: T } | { ok: false; error: ProviderError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (error: ProviderError): Result<never> => ({ ok: false, error });

// ---------------------------------------------------------------------------
// What every adapter must provide
// ---------------------------------------------------------------------------

/** What an adapter is able to do. The engine uses this to decide which adapters to ask. */
export interface ProviderCapabilities {
  news: boolean;
  fundamentals: boolean;
  priceHistory: boolean;
  filings: boolean;
  fundData: boolean;
}

/** Everything an adapter needs from the outside world, passed in so tests can fake it. */
export interface ProviderContext {
  /** Replaceable network function (tests pass a fake one). Same shape as the built-in fetch. */
  fetch: typeof fetch;
  /** Current time in ms (tests pass a fixed one). */
  now: () => number;
  /** Secret keys read from backend environment variables. */
  env: Record<string, string | undefined>;
  /** Abort signal so a stuck call can be cancelled. */
  signal?: AbortSignal;
}

export interface Provider {
  /** Short stable name, e.g. "gdelt". Stored in the database. */
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  /** True if the environment has the key(s) this provider needs. */
  isConfigured(env: ProviderContext["env"]): boolean;
}

export interface NewsProvider extends Provider {
  searchNews(
    query: { text: string; since?: number; maxRecords?: number },
    ctx: ProviderContext,
  ): Promise<Result<SourceDoc[]>>;
}

export interface FundamentalsProvider extends Provider {
  getFundamentals(
    query: { entityRef: string; metrics?: string[] },
    ctx: ProviderContext,
  ): Promise<Result<FinancialDatapoint[]>>;
}

export interface PriceHistoryProvider extends Provider {
  getHistory(query: { instrumentRef: string }, ctx: ProviderContext): Promise<Result<PriceHistory>>;
}
