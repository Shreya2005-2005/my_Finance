/**
 * PDF TEXT READER. Filings and annual reports are PDFs; their text must be read before any claim can be checked.
 * Uses `unpdf` (pure JavaScript, works without any native tools).
 */
import { getDocumentProxy } from "unpdf";

export interface PdfText {
  text: string;
  /** Pages actually read. */
  pages: number;
  totalPages: number;
  /** True if we stopped early because of the page or size limit. Annual reports have hundreds of pages. */
  truncated: boolean;
}

export async function extractPdfText(bytes: Uint8Array, opts: { maxPages?: number; maxChars?: number } = {}): Promise<PdfText> {
  const maxPages = opts.maxPages ?? 30;
  const maxChars = opts.maxChars ?? 400_000;
  const pdf = await getDocumentProxy(bytes);
  const totalPages = pdf.numPages;
  const limit = Math.min(totalPages, maxPages);

  const parts: string[] = [];
  let chars = 0;
  let read = 0;
  for (let i = 1; i <= limit; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((it) => ("str" in it ? it.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    parts.push(text);
    chars += text.length;
    read = i;
    if (chars >= maxChars) break;
  }
  const joined = parts.join("\n\n");
  return { text: joined.length > maxChars ? joined.slice(0, maxChars) : joined, pages: read, totalPages, truncated: read < totalPages };
}
