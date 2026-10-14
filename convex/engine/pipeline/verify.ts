/**
 * CITATION VERIFICATION: the heart of Verifin.
 *
 * A claim is only "Verified" if TWO independent checks both pass:
 *   Check 1 (this file, plain code): is the quote really in the source, do the
 *            numbers and dates match, is the right company mentioned?
 *   Check 2 (Gemini judge, elsewhere): does the quoted passage actually support the claim?
 *
 * Plain code decides the final verdict, never the AI alone.
 */
import type { FinalVerdict, JudgeVerdict } from "../enums.ts";
import { checkNumbers, extractYears } from "../lib/numbers.ts";
import { normalizeText } from "../lib/text.ts";

export interface Layer1Input {
  claimText: string;
  quote: string;
  /** Full text of the saved source (the snapshot). */
  sourceText: string;
  /** Names the company goes by: official name, short name, ticker words. */
  entityNames: string[];
}

export interface Layer1Result {
  quoteFound: boolean;
  numbersMatch: boolean;
  datesMatch: boolean;
  entityMatch: boolean;
  passed: boolean;
  /** Where the quote sits in the source (character positions), so the UI can highlight it. */
  location?: { start: number; end: number };
  /** Human-readable reasons for anything that failed. */
  problems: string[];
}

/** Finds the quote inside the source. Exact match first, then a forgiving match that ignores punctuation/spacing. */
export function locateQuote(sourceText: string, quote: string): { start: number; end: number } | undefined {
  const q = quote.trim();
  if (q.length === 0) return undefined;
  const exact = sourceText.indexOf(q);
  if (exact >= 0) return { start: exact, end: exact + q.length };

  // Forgiving match: collapse whitespace and ignore case, but keep real characters.
  // We build a map from positions in the squashed text back to the original.
  const squash = (s: string) => {
    let out = "";
    const map: number[] = [];
    let prevSpace = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]!;
      const isSpace = /\s/.test(ch);
      if (isSpace) {
        if (prevSpace) continue;
        out += " ";
        map.push(i);
        prevSpace = true;
      } else {
        out += ch.toLowerCase();
        map.push(i);
        prevSpace = false;
      }
    }
    return { out, map };
  };
  const src = squash(sourceText);
  const qs = squash(q).out.trim();
  const at = src.out.indexOf(qs);
  if (at < 0) return undefined;
  const start = src.map[at]!;
  const end = src.map[at + qs.length - 1]! + 1;
  return { start, end };
}

/** Check 1: everything plain code can verify. */
export function verifyLayer1(input: Layer1Input): Layer1Result {
  const problems: string[] = [];
  const location = locateQuote(input.sourceText, input.quote);
  const quoteFound = location !== undefined;
  if (!quoteFound) problems.push("The quoted text does not appear in the saved source.");

  // Numbers: must match the QUOTE (the cited passage).
  const nums = checkNumbers(input.claimText, input.quote);
  const numbersMatch = nums.allMatch;
  if (!numbersMatch) {
    problems.push(`Number(s) in the claim not found in the quote: ${nums.missing.map((m) => m.raw).join(", ")}.`);
  }

  // Context window around the quote (dates and company names are often in the sentence before).
  const windowStart = Math.max(0, (location?.start ?? 0) - 300);
  const windowEnd = Math.min(input.sourceText.length, (location?.end ?? input.quote.length) + 300);
  const context = quoteFound ? input.sourceText.slice(windowStart, windowEnd) : input.quote;

  // Dates: every year in the claim must show up near the quote.
  const claimYears = extractYears(input.claimText);
  const contextYears = new Set(extractYears(context));
  const missingYears = claimYears.filter((y) => !contextYears.has(y));
  const datesMatch = missingYears.length === 0;
  if (!datesMatch) problems.push(`Year(s) in the claim not found near the quote: ${missingYears.join(", ")}.`);

  // Company: at least one of its names appears in the quote or around it.
  const ctxNorm = normalizeText(context);
  const entityMatch =
    input.entityNames.length === 0 ||
    input.entityNames.some((n) => {
      const nn = normalizeText(n);
      return nn.length > 0 && ctxNorm.includes(nn);
    });
  if (!entityMatch) problems.push("The company is not mentioned near the quote.");

  return {
    quoteFound,
    numbersMatch,
    datesMatch,
    entityMatch,
    passed: quoteFound && numbersMatch && datesMatch && entityMatch,
    location,
    problems,
  };
}

/**
 * Final verdict, decided by code from both checks (table in ARCHITECTURE.md 4.6):
 *   Check 1 failed                       -> unverified (the evidence itself is wrong or missing)
 *   Judge says "contradicted"            -> contradicted
 *   Judge says "not_found"               -> unverified
 *   Check 1 passed + "supported"         -> verified
 *   Check 1 passed + "partially"         -> partially_verified
 */
export function finalVerdict(l1Passed: boolean, l2: JudgeVerdict): FinalVerdict {
  if (!l1Passed) return l2 === "contradicted" ? "contradicted" : "unverified";
  switch (l2) {
    case "supported":
      return "verified";
    case "partially_supported":
      return "partially_verified";
    case "contradicted":
      return "contradicted";
    case "not_found":
      return "unverified";
  }
}

/** Share of claims whose verdict is verified or partially verified. */
export function verifiedShare(verdicts: FinalVerdict[]): number {
  if (verdicts.length === 0) return 0;
  return verdicts.filter((v) => v === "verified" || v === "partially_verified").length / verdicts.length;
}
