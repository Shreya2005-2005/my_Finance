/**
 * Tests for the official-filing sources (BSE), full-article reading (Firecrawl), PDF/HTML text readers
 * and the safe-URL rules. Uses saved real BSE responses, so no internet is needed.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { htmlToText, markdownToText } from "../convex/engine/lib/html.ts";
import { extractPdfText } from "../convex/engine/lib/pdf.ts";
import { checkFetchUrl } from "../convex/engine/lib/safeUrl.ts";
import {
  BSE_ATTACH_HIS,
  BSE_ATTACH_LIVE,
  getAnnouncements,
  getAnnualReports,
  parseAnnouncements,
  parseAnnualReports,
  parseBseDate,
  parseCompanySearch,
  searchCompany,
} from "../convex/engine/providers/bse.ts";
import { readArticle, readFilingPdf } from "../convex/engine/providers/documents.ts";
import { firecrawlScrape, parseScrape } from "../convex/engine/providers/firecrawl.ts";
import type { ProviderContext } from "../convex/engine/providers/types.ts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const respond = (body: BodyInit, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers });
const ctxWith = (fn: (url: string, init?: RequestInit) => Response | Promise<Response>, env: Record<string, string> = {}): ProviderContext => ({
  fetch: (async (url: any, init: any) => fn(String(url), init)) as typeof fetch,
  now: () => Date.UTC(2026, 9, 14),
  env,
});

/** A tiny but valid one-page PDF that says "Revenue was Rs 1,20,000 crore". */
function tinyPdf(text: string): Uint8Array {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${`BT /F1 14 Tf 50 700 Td (${text}) Tj ET`.length} >>\nstream\nBT /F1 14 Tf 50 700 Td (${text}) Tj ET\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

describe("BSE: company search", () => {
  const html =
    "<li class='quotemenu quotemenuselect'><a id='/x' href='/stock-share-price/tata-motors-passenger-vehicles-ltd/tmpv/500570/'><strong>TATA MOTORS</strong> PASSENGER VEHICLES LTD<br /><span>TMPV&nbsp;&nbsp;&nbsp;INE155A01022&nbsp;&nbsp;&nbsp;500570</span> <span class='offleft'>x</span></a></li>" +
    "<li><a href='/y'><strong>TATA</strong> CONSUMER PRODUCTS LTD<br /><span>TATACONSUM&nbsp;&nbsp;&nbsp;INE192A01025&nbsp;&nbsp;&nbsp;500800</span></a></li>";

  it("reads company name, symbol, ISIN and scrip code", () => {
    const r = parseCompanySearch(html);
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ scripCode: "500570", name: "TATA MOTORS PASSENGER VEHICLES LTD", symbol: "TMPV", isin: "INE155A01022" });
    expect(r[1]!.scripCode).toBe("500800");
  });
  it("junk or empty HTML gives an empty list, not a crash", () => {
    expect(parseCompanySearch("")).toEqual([]);
    expect(parseCompanySearch("<li>no code here</li>")).toEqual([]);
  });
  it("searchCompany calls the BSE search address", async () => {
    let seen = "";
    const r = await searchCompany("tata motors", ctxWith((u) => ((seen = u), respond(html))));
    expect(seen).toContain("getQouteSearch.aspx");
    expect(seen).toContain("tata%20motors");
    expect(r.ok && r.value[0]!.scripCode).toBe("500570");
  });
});

describe("BSE: announcements (real saved response)", () => {
  const docs = parseAnnouncements(fixture("bse-announcements.json"), 1)!;
  it("each filing is an OFFICIAL source with a dated PDF link", () => {
    expect(docs.length).toBeGreaterThan(0);
    for (const d of docs) {
      expect(d.authorityTier).toBe("primary");
      expect(d.kind).toBe("announcement");
      expect(d.publishedAt).toBeGreaterThan(Date.UTC(2020, 0, 1));
    }
    expect(docs[0]!.attachmentUrl).toMatch(/^https:\/\/www\.bseindia\.com\/xml-data\/corpfiling\/AttachLive\/.+\.pdf$/);
  });
  it("titles are readable (the boilerplate prefix is removed)", () => {
    expect(docs[0]!.title).toContain("Press Release");
    expect(docs[0]!.title).not.toMatch(/^Announcement under Regulation/i);
  });
  it("BSE times are read as Indian time", () => {
    expect(parseBseDate("2026-10-12T15:59:44.603")).toBe(Date.UTC(2026, 9, 12, 10, 29, 44));
    expect(parseBseDate(null)).toBeUndefined();
  });
  it("a response of the wrong shape is detected as schema drift", async () => {
    expect(parseAnnouncements({} as any, 1)).toBeUndefined();
    const r = await getAnnouncements("500570", { since: 0 }, ctxWith(() => respond(JSON.stringify({ hello: 1 }))));
    expect(!r.ok && r.error.kind).toBe("SCHEMA_DRIFT");
  });
  it("refuses a malformed scrip code before making any request", async () => {
    let called = false;
    const r = await getAnnouncements("5005; DROP", { since: 0 }, ctxWith(() => ((called = true), respond("{}"))));
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });
  it("sends the date range and scrip code", async () => {
    let seen = "";
    await getAnnouncements("500570", { since: Date.UTC(2026, 8, 1), until: Date.UTC(2026, 9, 14) }, ctxWith((u) => ((seen = u), respond(JSON.stringify(fixture("bse-announcements.json"))))));
    expect(seen).toContain("strScrip=500570");
    expect(seen).toContain("strPrevDate=20260901");
    expect(seen).toContain("strToDate=20261014");
  });
});

describe("BSE: annual reports (real saved response)", () => {
  it("lists the reports newest first, each with a PDF link", () => {
    const docs = parseAnnualReports(fixture("bse-annual-reports.json"), 1)!;
    expect(docs[0]!.kind).toBe("annual_report");
    const years = docs.map((d) => Number(d.title!.slice(-4)));
    expect([...years].sort((a, b) => b - a)).toEqual(years);
    expect(docs[0]!.attachmentUrl).toMatch(/\.pdf$/);
    expect(docs[0]!.authorityTier).toBe("primary");
  });
  it("service down is reported, not thrown", async () => {
    const r = await getAnnualReports("500570", ctxWith(() => respond("", 503)));
    expect(!r.ok && r.error.kind).toBe("UNAVAILABLE");
  });
});

describe("PDF and HTML text readers", () => {
  it("reads text out of a PDF", async () => {
    const r = await extractPdfText(tinyPdf("Revenue was Rs 1,20,000 crore in FY2025"));
    expect(r.totalPages).toBe(1);
    expect(r.text).toContain("Revenue was Rs 1,20,000 crore");
    expect(r.truncated).toBe(false);
  });
  it("reader mode keeps the article and drops menus and scripts", () => {
    const html = `<html><head><title>T</title><script>evil()</script></head><body><nav>Home | About</nav>
      <article><h1>Tata Motors profit rises</h1><p>Net profit stood at Rs 17,500 crore.</p><p>Second paragraph.</p></article>
      <footer>Copyright</footer></body></html>`;
    const t = htmlToText(html);
    expect(t).toContain("Net profit stood at Rs 17,500 crore.");
    expect(t).not.toContain("evil");
    expect(t).not.toContain("Home | About");
    expect(t).not.toContain("Copyright");
    expect(t.split("\n").length).toBeGreaterThanOrEqual(2);
  });
});

describe("article text from scraped markdown", () => {
  const md = [
    "| | | --- | | | 15 [![Instant Cash](https://images.example.com/a.png)](https://x.com/cash)",
    "# Tata Motors, Stellantis deepen partnership",
    "[Home](https://x.com) | [Markets](https://x.com/m)",
    "---",
    "Tata Motors Passenger Vehicles said on Monday it will share its vehicle architecture and advanced technology with Stellantis.",
    "Share this",
    "The two companies target exports to more than 50 markets, according to a statement from the company on Monday.",
    "![A car](https://img.example.com/car.jpg)",
  ].join("\n");
  it("keeps real paragraphs and drops tables, menus, images and addresses", () => {
    const t = markdownToText(md);
    expect(t).toContain("said on Monday it will share its vehicle architecture");
    expect(t).toContain("target exports to more than 50 markets");
    expect(t).not.toMatch(/https?:|\]\(|\|/);
    expect(t).not.toContain("Share this");
    expect(t.split("\n\n")).toHaveLength(2);
  });
  it("a page that is all furniture reads as empty, and the reader says so", async () => {
    expect(markdownToText("| a | b |\n| - | - |\n[Home](https://x.com)")).toBe("");
    const body = JSON.stringify({ success: true, data: { markdown: "| a | b |\n".repeat(60), metadata: {} } });
    const r = await readArticle("https://pub.com/a", ctxWith(() => respond(body), { FIRECRAWL_API_KEY: "k" }));
    expect(!r.ok && r.error.message).toMatch(/no readable article text/);
  });
});

describe("safe URLs (nothing internal can be reached)", () => {
  const bad = [
    "http://www.bseindia.com/a.pdf",
    "https://localhost/a",
    "https://127.0.0.1/a",
    "https://10.0.0.5/a",
    "https://192.168.1.1/a",
    "https://169.254.169.254/latest/meta-data",
    "https://8.8.8.8/a",
    "https://[::1]/a",
    "https://user:pass@www.bseindia.com/a",
    "https://www.bseindia.com:8443/a",
    "https://intranet/a",
    "https://db.internal/a",
    "file:///etc/passwd",
    "not a url",
  ];
  for (const u of bad) it(`blocks ${u}`, () => expect(checkFetchUrl(u).ok).toBe(false));

  it("allows an ordinary https page", () => expect(checkFetchUrl("https://www.reuters.com/x").ok).toBe(true));
  it("allowlist: only the named site and its subdomains", () => {
    expect(checkFetchUrl("https://www.bseindia.com/a.pdf", ["bseindia.com"]).ok).toBe(true);
    expect(checkFetchUrl("https://api.bseindia.com/a", ["bseindia.com"]).ok).toBe(true);
    expect(checkFetchUrl("https://evilbseindia.com/a", ["bseindia.com"]).ok).toBe(false);
    expect(checkFetchUrl("https://bseindia.com.evil.io/a", ["bseindia.com"]).ok).toBe(false);
  });
});

describe("reading a filing PDF", () => {
  const url = `${BSE_ATTACH_LIVE}abc.pdf`;
  it("downloads and reads it", async () => {
    const pdf = tinyPdf("Net profit stood at Rs 17,500 crore");
    const r = await readFilingPdf(url, ctxWith(() => respond(pdf as unknown as BodyInit, 200, { "content-type": "application/pdf" })));
    expect(r.ok && r.value.text).toContain("Net profit stood at Rs 17,500 crore");
  });
  it("falls back to the history folder for older filings", async () => {
    const seen: string[] = [];
    const pdf = tinyPdf("Old filing text that is long enough");
    const r = await readFilingPdf(url, ctxWith((u) => (seen.push(u), u.startsWith(BSE_ATTACH_LIVE) ? respond("", 404) : respond(pdf as unknown as BodyInit))));
    expect(r.ok).toBe(true);
    expect(seen).toEqual([url, `${BSE_ATTACH_HIS}abc.pdf`]);
  });
  it("refuses any site other than BSE (cannot be used to fetch arbitrary URLs)", async () => {
    let called = false;
    const r = await readFilingPdf("https://evil.example.com/a.pdf", ctxWith(() => ((called = true), respond("x"))));
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });
  it("rejects a file that is not a PDF", async () => {
    const r = await readFilingPdf(url, ctxWith(() => respond("<html>Access denied</html>")));
    expect(!r.ok && r.error.kind).toBe("SCHEMA_DRIFT");
  });
  it("rejects a huge file by its declared size", async () => {
    const r = await readFilingPdf(url, ctxWith(() => respond("x", 200, { "content-length": String(50 * 1024 * 1024) })));
    expect(r.ok).toBe(false);
  });
});

describe("Firecrawl and article reading", () => {
  const paragraph = "Tata Motors said on Monday that it has raised its offer for Iveco to 14.40 euros per share and will not raise it again. ";
  const goodBody = JSON.stringify({ success: true, data: { markdown: paragraph.repeat(4).replace(/ $/, "").replaceAll(". Tata", ".\nTata"), metadata: { title: "Headline", url: "https://pub.com/a" } } });

  it("needs a key", async () => {
    const r = await firecrawlScrape("https://pub.com/a", ctxWith(() => respond(goodBody)));
    expect(!r.ok && r.error.kind).toBe("AUTH");
  });
  it("sends the key in a header (never in the URL) and returns clean text", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const r = await firecrawlScrape("https://pub.com/a", ctxWith((u, i) => ((seenUrl = u), (seenInit = i), respond(goodBody)), { FIRECRAWL_API_KEY: "SECRET" }));
    expect(r.ok && r.value.title).toBe("Headline");
    expect(seenUrl).not.toContain("SECRET");
    expect(JSON.stringify(seenInit?.headers)).toContain("SECRET");
    expect(seenInit?.method).toBe("POST");
  });
  it("handles quota, failure and an empty page", async () => {
    const env = { FIRECRAWL_API_KEY: "k" };
    expect((await firecrawlScrape("https://p.com/a", ctxWith(() => respond("", 429), env)) as any).error.kind).toBe("RATE_LIMITED");
    expect((await firecrawlScrape("https://p.com/a", ctxWith(() => respond(JSON.stringify({ success: false, error: "blocked" })), env)) as any).error.kind).toBe("SCHEMA_DRIFT");
    expect((await firecrawlScrape("https://p.com/a", ctxWith(() => respond(JSON.stringify({ success: true, data: { markdown: "tiny" } })), env)) as any).error.kind).toBe("NOT_FOUND");
    expect(parseScrape({} as any)).toBeUndefined();
  });
  it("a site Firecrawl refuses (403) is reported as that, not as a bad key", async () => {
    const r = await firecrawlScrape("https://news.google.com/x", ctxWith(() => respond("", 403), { FIRECRAWL_API_KEY: "k" }));
    expect(!r.ok && r.error.kind).toBe("NOT_FOUND");
    expect(!r.ok && r.error.message).toMatch(/does not allow this site/);
    const bad = await firecrawlScrape("https://pub.com/x", ctxWith(() => respond("", 401), { FIRECRAWL_API_KEY: "k" }));
    expect(!bad.ok && bad.error.kind).toBe("AUTH");
  });
  it("without a key, a Google News redirect link is explained, not guessed", async () => {
    const r = await readArticle("https://news.google.com/rss/articles/abc", ctxWith(() => respond("x")));
    expect(!r.ok && r.error.message).toMatch(/Firecrawl/);
  });
  it("without a key, an ordinary article is read directly", async () => {
    const page = `<html><title>Hello</title><body><article>${"<p>Net profit stood at Rs 17,500 crore for the year. </p>".repeat(12)}</article></body></html>`;
    const r = await readArticle("https://pub.com/a", ctxWith(() => respond(page)));
    expect(r.ok && r.value.via).toBe("direct");
    expect(r.ok && r.value.text).toContain("Net profit stood");
  });
  it("a page with no readable text is reported as such", async () => {
    const r = await readArticle("https://pub.com/a", ctxWith(() => respond("<html><body><div id='app'></div><script>load()</script></body></html>")));
    expect(!r.ok && r.error.kind).toBe("NOT_FOUND");
  });
  it("internal addresses are refused", async () => {
    let called = false;
    const r = await readArticle("https://169.254.169.254/latest", ctxWith(() => ((called = true), respond("x"))));
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });
  it("with a key, Firecrawl is used", async () => {
    const r = await readArticle("https://pub.com/a", ctxWith(() => respond(goodBody), { FIRECRAWL_API_KEY: "k" }));
    expect(r.ok && r.value.via).toBe("firecrawl");
  });
});
