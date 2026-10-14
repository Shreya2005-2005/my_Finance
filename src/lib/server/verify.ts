import { verifyLayer1 } from "$engine/pipeline/verify.ts";
import type { VerifyResponse } from "$lib/types";

/** Runs the code-only citation check (Check 1) and explains every result in plain words. */
export function checkClaim(input: { source: string; claim: string; quote: string; company: string }): VerifyResponse {
  const r = verifyLayer1({
    claimText: input.claim,
    quote: input.quote,
    sourceText: input.source,
    entityNames: input.company ? [input.company] : [],
  });

  const problem = (needle: RegExp) => r.problems.find((p) => needle.test(p));
  const checks: VerifyResponse["checks"] = [
    {
      id: "quote",
      label: "The quote really appears in the source",
      passed: r.quoteFound,
      detail: r.quoteFound ? "Found it word for word." : "This text is not in the source you pasted. A quote that was made up cannot prove anything.",
    },
    {
      id: "numbers",
      label: "Numbers and units match the quote",
      passed: r.numbersMatch,
      detail: r.numbersMatch ? "Every number in the claim is in the quote, with the same unit (crore, million, %)." : (problem(/Number/) ?? "A number differs."),
    },
    {
      id: "years",
      label: "Years and periods match",
      passed: r.datesMatch,
      detail: r.datesMatch ? "No year in the claim contradicts the source." : (problem(/Year/) ?? "A year differs."),
    },
    {
      id: "company",
      label: "The right company is mentioned",
      passed: r.entityMatch,
      detail: r.entityMatch ? (input.company ? `"${input.company}" appears near the quote.` : "No company name was given, so this was skipped.") : (problem(/company/) ?? "The company is not mentioned."),
    },
  ];

  let context: VerifyResponse["context"];
  if (r.location) {
    const { start, end } = r.location;
    context = {
      before: input.source.slice(Math.max(0, start - 140), start),
      match: input.source.slice(start, end),
      after: input.source.slice(end, end + 140),
    };
  }
  return { passed: r.passed, checks, context };
}
