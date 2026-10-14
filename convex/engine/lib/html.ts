/**
 * Turns a web page's HTML into readable text (a simple "reader mode").
 * Good enough for ordinary news pages. Pages that need JavaScript to show their text will come out empty,
 * and callers must treat a very short result as "could not read".
 */
import { stripHtml } from "./text.ts";

/** Parts of a page that are never the article. */
const NOISE = ["script", "style", "noscript", "svg", "nav", "header", "footer", "aside", "form", "iframe", "figure"];

export function htmlToText(html: string): string {
  let h = html.replace(/<!--[\s\S]*?-->/g, " ");
  for (const tag of NOISE) h = h.replace(new RegExp(`<${tag}[\\s\\S]*?</${tag}>`, "gi", ), " ");

  // Prefer the article body when the page marks one.
  const body = h.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? h.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? h;

  // Keep paragraph breaks so sentences do not run together.
  const withBreaks = body.replace(/<\/(p|div|h[1-6]|li|br|tr)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n");
  const lines = stripHtmlKeepLines(withBreaks)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);
  return lines.join("\n");
}

function stripHtmlKeepLines(s: string): string {
  return s
    .split("\n")
    .map((line) => stripHtml(line))
    .join("\n");
}

/**
 * Turns scraped page markdown into readable paragraphs: drops images, link addresses, tables, menus and
 * other page furniture, and keeps only lines that read like sentences. No words are changed.
 */
export function markdownToText(md: string): string {
  const cleaned = md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links: keep the text
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp;)?nbsp;/gi, " ")
    .replace(/[​-‏⁠﻿]/g, "")
    .replace(/\\{2,}/g, " ");
  const keep: string[] = [];
  for (const raw of cleaned.split("\n")) {
    if (/^\s*\|/.test(raw) || /^\s*[-*_]{3,}\s*$/.test(raw)) continue; // table rows, rules
    const line = raw
      .replace(/^\s{0,3}#{1,6}\s*/, "")
      .replace(/^\s*[-*+]\s+/, "")
      .replace(/[*_`]+/g, "")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const words = line.split(" ").filter(Boolean).length;
    // A real paragraph line is long and ends like a sentence (or at least has many words).
    if (line.length >= 60 && words >= 9 && /[a-z]/.test(line)) keep.push(line);
  }
  return keep.join("\n\n");
}

/** The page <title>, if any. */
export function htmlTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripHtml(m[1]!) : undefined;
}
