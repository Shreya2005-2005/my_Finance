/**
 * BSE INDIA: official company announcements and annual reports. No API key needed.
 *
 * This uses the same public data feed that BSE's own website shows. It is NOT a documented, supported
 * API, so: (1) it can change without notice (we detect that as SCHEMA_DRIFT), (2) we call it gently and
 * cache results, and (3) BSE's terms of use must still be reviewed before any commercial use.
 *
 * Everything from here is an OFFICIAL source (authority tier "primary").
 */
import { canonicalizeUrl, stripHtml } from "../lib/text.ts";
import { httpJson, httpText, schemaDrift } from "./http.ts";
import { ok, type Provider, type ProviderContext, type Result, type SourceDoc } from "./types.ts";

const ID = "bse";
const API = "https://api.bseindia.com/BseIndiaAPI/api";
export const BSE_ATTACH_LIVE = "https://www.bseindia.com/xml-data/corpfiling/AttachLive/";
export const BSE_ATTACH_HIS = "https://www.bseindia.com/xml-data/corpfiling/AttachHis/";

const HEADERS = {
  "user-agent": "Mozilla/5.0 (compatible; VerifinResearchBot/0.1; educational project)",
  referer: "https://www.bseindia.com/",
  origin: "https://www.bseindia.com",
  accept: "application/json, text/html",
};

export interface BseCompany {
  scripCode: string;
  name: string;
  symbol: string;
  isin?: string;
}

/** BSE times have no timezone and are Indian Standard Time (UTC+5:30). */
export function parseBseDate(s: string | null | undefined): number | undefined {
  if (!s) return undefined;
  const t = Date.parse(`${s.replace(/\.\d+$/, "")}+05:30`);
  return Number.isFinite(t) ? t : undefined;
}

/** Reads the HTML snippet BSE returns for a company-name search. */
export function parseCompanySearch(html: string): BseCompany[] {
  const out: BseCompany[] = [];
  for (const m of html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    const block = m[1]!;
    const [namePart] = block.split(/<br\s*\/?>/i);
    const name = stripHtml(namePart ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const span = block.match(/<span[^>]*>([\s\S]*?)<\/span>/i)?.[1];
    if (!name || !span) continue;
    const parts = stripHtml(span).split(/\s+/).filter(Boolean);
    const code = parts.find((p) => /^\d{5,6}$/.test(p));
    if (!code) continue;
    const isin = parts.find((p) => /^IN[A-Z0-9]{10}$/.test(p));
    const symbol = parts.find((p) => p !== code && p !== isin) ?? code;
    out.push({ scripCode: code, name, symbol, isin });
  }
  return out;
}

const SUB_PREFIX = /^announcement under regulation \d+ \(lodr\)\s*-\s*/i;
const shorten = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

interface RawAnnouncement {
  NEWSID?: string;
  NEWSSUB?: string;
  NEWS_DT?: string;
  ATTACHMENTNAME?: string | null;
  MORE?: string | null;
  HEADLINE?: string | null;
  CATEGORYNAME?: string | null;
  SUBCATNAME?: string | null;
  NSURL?: string | null;
  SLONGNAME?: string | null;
}

export function parseAnnouncements(raw: { Table?: RawAnnouncement[] }, retrievedAt: number): SourceDoc[] | undefined {
  if (!raw || !Array.isArray(raw.Table)) return undefined;
  const docs: SourceDoc[] = [];
  for (const r of raw.Table) {
    if (!r.NEWSID) continue;
    const sub = (r.SUBCATNAME ?? r.NEWSSUB ?? "Announcement").replace(SUB_PREFIX, "").trim();
    const detail = stripHtml(r.MORE ?? r.HEADLINE ?? "");
    const attachment = r.ATTACHMENTNAME ? `${BSE_ATTACH_LIVE}${r.ATTACHMENTNAME}` : undefined;
    const url = attachment ?? r.NSURL ?? "https://www.bseindia.com/corporates/ann.html";
    docs.push({
      url,
      canonicalUrl: canonicalizeUrl(url),
      title: detail ? `${sub}: ${shorten(detail, 140)}` : sub,
      publisher: `BSE filing${r.SLONGNAME ? ` · ${r.SLONGNAME}` : ""}`,
      providerId: ID,
      authorityTier: "primary",
      publishedAt: parseBseDate(r.NEWS_DT),
      retrievedAt,
      text: detail || undefined,
      language: "en",
      kind: "announcement",
      attachmentUrl: attachment,
      category: r.CATEGORYNAME ?? undefined,
    });
  }
  return docs;
}

interface RawAnnual {
  Year?: string;
  PDFDownload?: string | null;
  Fld_AuthoriseDate?: string | null;
  scrip_name?: string;
}

export function parseAnnualReports(raw: { Table?: RawAnnual[] }, retrievedAt: number): SourceDoc[] | undefined {
  if (!raw || !Array.isArray(raw.Table)) return undefined;
  const docs: SourceDoc[] = [];
  for (const r of raw.Table) {
    if (!r.Year || !r.PDFDownload) continue;
    docs.push({
      url: r.PDFDownload,
      canonicalUrl: canonicalizeUrl(r.PDFDownload),
      title: `Annual Report ${r.Year}`,
      publisher: `BSE filing${r.scrip_name ? ` · ${r.scrip_name}` : ""}`,
      providerId: ID,
      authorityTier: "primary",
      publishedAt: parseBseDate(r.Fld_AuthoriseDate),
      retrievedAt,
      language: "en",
      kind: "annual_report",
      attachmentUrl: r.PDFDownload,
      category: "Annual Report",
    });
  }
  // newest year first
  return docs.sort((a, b) => Number(b.title?.slice(-4)) - Number(a.title?.slice(-4)));
}

const yyyymmdd = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");

export async function searchCompany(name: string, ctx: ProviderContext): Promise<Result<BseCompany[]>> {
  const r = await httpText(ctx, ID, `${API.replace("/BseIndiaAPI/api", "")}/Msource/1D/getQouteSearch.aspx?Type=EQ&text=${encodeURIComponent(name)}&flag=site`, { headers: HEADERS });
  if (!r.ok) return r;
  return ok(parseCompanySearch(r.value));
}

export async function getAnnouncements(
  scripCode: string,
  range: { since: number; until?: number },
  ctx: ProviderContext,
): Promise<Result<SourceDoc[]>> {
  if (!/^\d{5,6}$/.test(scripCode)) return schemaDrift(ID, "scrip code must be 5 or 6 digits");
  const until = range.until ?? ctx.now();
  const url =
    `${API}/AnnSubCategoryGetData/w?pageno=1&strCat=-1&strPrevDate=${yyyymmdd(range.since)}&strScrip=${scripCode}` +
    `&strSearch=P&strToDate=${yyyymmdd(until)}&strType=C&subcategory=-1`;
  const r = await httpJson<{ Table?: RawAnnouncement[] }>(ctx, ID, url, { headers: HEADERS });
  if (!r.ok) return r;
  const docs = parseAnnouncements(r.value, ctx.now());
  return docs ? ok(docs) : schemaDrift(ID, "announcements response has no 'Table' list");
}

export async function getAnnualReports(scripCode: string, ctx: ProviderContext): Promise<Result<SourceDoc[]>> {
  if (!/^\d{5,6}$/.test(scripCode)) return schemaDrift(ID, "scrip code must be 5 or 6 digits");
  const r = await httpJson<{ Table?: RawAnnual[] }>(ctx, ID, `${API}/AnnualReport_New/w?scripcode=${scripCode}`, { headers: HEADERS });
  if (!r.ok) return r;
  const docs = parseAnnualReports(r.value, ctx.now());
  return docs ? ok(docs) : schemaDrift(ID, "annual report response has no 'Table' list");
}

export const bse: Provider = {
  id: ID,
  capabilities: { news: false, fundamentals: false, priceHistory: false, filings: true, fundData: false },
  isConfigured: () => true, // no key needed
};

/** Hosts we are willing to download filings from. */
export const BSE_HOSTS = ["bseindia.com"];
export const BSE_REQUEST_HEADERS = HEADERS;
