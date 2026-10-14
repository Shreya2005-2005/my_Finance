/**
 * NUMBER HELPERS.
 *
 * Financial text writes the same amount many ways: "Rs 1,200 crore", "₹12 billion",
 * "12.5%". To compare a claim with its source we turn every number into a plain
 * value in base units, so "100 crore" (1,000,000,000) is NOT confused with
 * "10 million" (10,000,000). That mix-up is a classic Indian-finance trap.
 */

/** Words that scale a number. Multiplying converts to base units. */
const SCALES: Record<string, number> = {
  thousand: 1e3,
  k: 1e3,
  lakh: 1e5,
  lakhs: 1e5,
  lac: 1e5,
  lacs: 1e5,
  million: 1e6,
  mn: 1e6,
  m: 1e6,
  crore: 1e7,
  crores: 1e7,
  cr: 1e7,
  billion: 1e9,
  bn: 1e9,
  b: 1e9,
  trillion: 1e12,
  tn: 1e12,
  lakh_crore: 1e12,
};

export interface ParsedNumber {
  /** The text as written, e.g. "Rs 1,200 crore". */
  raw: string;
  /** Value in base units (percent stays as the percent number: 12.5% => 12.5). */
  value: number;
  isPercent: boolean;
  /** True when a scale word (crore, million ...) was attached. */
  scaled: boolean;
}

// number, optional scale word or percent sign. Handles Indian grouping (1,23,456.78).
const NUMBER_RE =
  /(?<![\p{L}\d])(?:(?:rs\.?|inr|₹|\$|usd|us\$|eur|€|£)\s*)?(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(lakh\s+crores?|%|per\s?cent|thousand|lakhs?|lacs?|crores?|million|billion|trillion|mn|bn|tn|cr|k|m|b)?(?![\p{L}\d])/giu;

/** Pulls every number out of a text and converts it to base units. */
export function extractNumbers(text: string): ParsedNumber[] {
  const out: ParsedNumber[] = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    const digits = m[1]!;
    let value = Number(digits.replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    const word = m[2]?.toLowerCase().replace(/\s+/g, " ");
    const hasCommas = digits.includes(",");
    const isPercent = word === "%" || word === "per cent" || word === "percent";

    // A bare 4-digit number from 1900 to 2100 is a year, not an amount. Dates are checked elsewhere.
    if (!word && !hasCommas && /^(19|20)\d{2}$/.test(digits)) continue;

    let scaled = false;
    if (word && !isPercent) {
      const key = word === "lakh crore" || word === "lakh crores" ? "lakh_crore" : word;
      const factor = SCALES[key];
      if (factor) {
        value *= factor;
        scaled = true;
      }
    }
    out.push({ raw: m[0].trim(), value, isPercent, scaled });
  }
  return out;
}

/** True if two numbers are equal after allowing a tiny relative error (rounding noise). */
export function approxEqual(a: number, b: number, relTol = 0.0005): boolean {
  if (a === b) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale === 0 ? true : Math.abs(a - b) / scale <= relTol;
}

/**
 * Relative difference between two values: |a-b| / max(|a|,|b|). 0 = identical, 1 = totally different.
 * Used by conflict detection.
 */
export function relativeDiff(a: number, b: number): number {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale === 0 ? 0 : Math.abs(a - b) / scale;
}

export interface NumberCheck {
  /** Every number in the claim was found in the quote (same unit, same size). */
  allMatch: boolean;
  /** Numbers in the claim that the quote does not contain. */
  missing: ParsedNumber[];
  claimNumbers: ParsedNumber[];
}

/**
 * Do the numbers in a claim agree with the quote it cites?
 * A claim number matches if the quote has the same value (in base units) and the same kind (percent vs amount).
 * A claim with NO numbers trivially passes.
 */
export function checkNumbers(claimText: string, quote: string): NumberCheck {
  const claimNumbers = extractNumbers(claimText);
  const quoteNumbers = extractNumbers(quote);
  const missing = claimNumbers.filter(
    (c) => !quoteNumbers.some((q) => q.isPercent === c.isPercent && approxEqual(q.value, c.value)),
  );
  return { allMatch: missing.length === 0, missing, claimNumbers };
}

/** Years (and fiscal-year labels) mentioned in a text, e.g. "FY2025" => 2025, "FY25" => 2025. */
export function extractYears(text: string): number[] {
  const years = new Set<number>();
  for (const m of text.matchAll(/\b(?:fy\s?'?)?((?:19|20)\d{2})\b/gi)) years.add(Number(m[1]));
  for (const m of text.matchAll(/\bfy\s?'?(\d{2})\b/gi)) years.add(2000 + Number(m[1]));
  return [...years];
}
