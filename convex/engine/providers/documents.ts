/**
 * DOCUMENT READER: gets the full text of a filing PDF or a news article.
 *
 *   readFilingPdf   downloads a PDF from BSE (only bseindia.com is allowed) and extracts its text
 *   readArticle     reads a news page: with Firecrawl if a key exists, otherwise a plain download
 *
 * Every download first passes the safe-URL check, has a size limit and a time limit.
 */
import { htmlTitle, htmlToText, markdownToText } from "../lib/html.ts";
import { extractPdfText, type PdfText } from "../lib/pdf.ts";
import { checkFetchUrl } from "../lib/safeUrl.ts";
import { BSE_ATTACH_HIS, BSE_ATTACH_LIVE, BSE_HOSTS, BSE_REQUEST_HEADERS } from "./bse.ts";
import { firecrawlScrape } from "./firecrawl.ts";
import { httpText } from "./http.ts";
import { fail, ok, ProviderError, type ProviderContext, type Result } from "./types.ts";

const ID = "documents";
const MAX_PDF_BYTES = 30 * 1024 * 1024;

/** Older filings move from the "Live" folder to the "His" (history) folder. Try both. */
function candidateUrls(url: string): string[] {
  if (url.startsWith(BSE_ATTACH_LIVE)) return [url, BSE_ATTACH_HIS + url.slice(BSE_ATTACH_LIVE.length)];
  if (url.startsWith(BSE_ATTACH_HIS)) return [url, BSE_ATTACH_LIVE + url.slice(BSE_ATTACH_HIS.length)];
  return [url];
}

export async function readFilingPdf(url: string, ctx: ProviderContext, opts: { maxPages?: number } = {}): Promise<Result<PdfText>> {
  let last: ProviderError | undefined;
  for (const candidate of candidateUrls(url)) {
    const safe = checkFetchUrl(candidate, BSE_HOSTS);
    if (!safe.ok) return fail(new ProviderError("NOT_FOUND", ID, safe.reason));
    try {
      const res = await ctx.fetch(candidate, { headers: BSE_REQUEST_HEADERS, signal: AbortSignal.timeout(60_000) });
      if (res.status === 404) {
        last = new ProviderError("NOT_FOUND", ID, "that file is not on the server");
        continue;
      }
      if (!res.ok) return fail(new ProviderError(res.status === 429 ? "RATE_LIMITED" : res.status >= 500 ? "UNAVAILABLE" : "SCHEMA_DRIFT", ID, `HTTP ${res.status}`));
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > MAX_PDF_BYTES) return fail(new ProviderError("NOT_FOUND", ID, `file is too large (${Math.round(declared / 1e6)} MB)`));
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > MAX_PDF_BYTES) return fail(new ProviderError("NOT_FOUND", ID, "file is too large"));
      if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") {
        last = new ProviderError("SCHEMA_DRIFT", ID, "the file is not a PDF");
        continue;
      }
      const text = await extractPdfText(bytes, { maxPages: opts.maxPages ?? 30 });
      if (text.text.trim().length < 20) {
        return fail(new ProviderError("NOT_FOUND", ID, "the PDF has no readable text (it may be a scanned image)"));
      }
      return ok(text);
    } catch (e) {
      const name = (e as Error).name;
      last = new ProviderError(name === "TimeoutError" || name === "AbortError" ? "TIMEOUT" : "UNAVAILABLE", ID, (e as Error).message);
    }
  }
  return fail(last ?? new ProviderError("NOT_FOUND", ID, "could not download the file"));
}

export interface Article {
  text: string;
  title?: string;
  via: "firecrawl" | "direct";
}

/** Google News links are redirects that need JavaScript, so a plain download cannot read them. */
const REDIRECT_HOSTS = ["news.google.com"];

export async function readArticle(url: string, ctx: ProviderContext): Promise<Result<Article>> {
  const safe = checkFetchUrl(url);
  if (!safe.ok) return fail(new ProviderError("NOT_FOUND", ID, safe.reason));

  if (ctx.env.FIRECRAWL_API_KEY) {
    const r = await firecrawlScrape(url, ctx);
    if (!r.ok) return r;
    const text = markdownToText(r.value.text);
    if (text.length < 200) return fail(new ProviderError("NOT_FOUND", ID, "the page had no readable article text (it may be a quote page, a video or a paywall)"));
    return ok({ text, title: r.value.title, via: "firecrawl" });
  }
  if (REDIRECT_HOSTS.includes(safe.url.hostname)) {
    return fail(new ProviderError("NOT_FOUND", ID, "this is a Google News redirect link; reading the full article needs a Firecrawl key"));
  }
  const page = await httpText(ctx, ID, url, { headers: { "user-agent": BSE_REQUEST_HEADERS["user-agent"]!, accept: "text/html" }, timeoutMs: 25_000 });
  if (!page.ok) return page;
  const text = htmlToText(page.value);
  if (text.length < 300) return fail(new ProviderError("NOT_FOUND", ID, "no readable text found (the page may need JavaScript, or be behind a paywall)"));
  return ok({ text: text.slice(0, 200_000), title: htmlTitle(page.value), via: "direct" });
}
