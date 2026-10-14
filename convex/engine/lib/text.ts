/**
 * TEXT HELPERS: cleaning, comparing and cutting text.
 * Pure functions (no network, no database), so they are easy to test.
 */

/** Lowercase, remove punctuation and extra spaces. Used to compare text fairly. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^\p{L}\p{N}%.\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|mc_|ref$|ref_|cmpid|ocid|oc$|guccounter|guce_)/i;

/** Cleans a URL so two links to the same page look identical (no tracking junk). */
export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    }
    u.searchParams.sort();
    let path = u.pathname.replace(/\/+$/, "");
    if (path === "") path = "";
    return `${u.protocol}//${u.host}${path}${u.search}`;
  } catch {
    return raw.trim();
  }
}

/** Headline normalized for duplicate detection. News feeds often append " - Publisher". */
export function normalizeTitle(title: string): string {
  return normalizeText(title.replace(/\s[-|–—]\s[^-|–—]{2,40}$/, ""));
}

/** Fast non-cryptographic hash (FNV-1a, 53 bit) as a hex string. For titles and keys, not security. */
export function fastHash(s: string): string {
  let h1 = 0xdeadbeef ^ s.length;
  let h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/** Secure SHA-256 of a text, as hex. Used as the "fingerprint" of a saved source. */
export async function sha256Hex(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Groups of consecutive words. Short headlines compare word by word; long text compares 3-word groups. */
function shingles(s: string): Set<string> {
  const words = normalizeText(s).split(" ").filter(Boolean);
  const size = words.length < 12 ? 1 : 3;
  const out = new Set<string>();
  if (words.length <= size) {
    out.add(words.join(" "));
    return out;
  }
  for (let i = 0; i <= words.length - size; i++) out.add(words.slice(i, i + size).join(" "));
  return out;
}

/** 0 to 1: how much two texts overlap (Jaccard similarity of word groups). 1 = same wording. */
export function similarity(a: string, b: string): number {
  const A = shingles(a);
  const B = shingles(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const x of A) if (B.has(x)) shared++;
  return shared / (A.size + B.size - shared);
}

export interface TextChunk {
  idx: number;
  text: string;
  startChar: number;
  endChar: number;
}

/**
 * Cuts text into overlapping pieces, preferring to break at sentence ends.
 * Overlap makes sure a sentence on a boundary is fully inside at least one chunk.
 */
export function chunkText(text: string, maxChars = 1500, overlap = 200): TextChunk[] {
  if (text.length === 0) return [];
  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const window = text.slice(start + Math.floor(maxChars * 0.6), end);
      const m = [...window.matchAll(/[.!?]\s/g)].pop();
      if (m?.index !== undefined) end = start + Math.floor(maxChars * 0.6) + m.index + 1;
    }
    chunks.push({ idx: chunks.length, text: text.slice(start, end), startChar: start, endChar: end });
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

/** Decodes the few HTML entities that appear in feeds, and removes tags. */
export function stripHtml(s: string): string {
  return s
    .replace(/&lt;/g, "<") // feeds often send HTML escaped, so un-escape the brackets first
    .replace(/&gt;/g, ">")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}
