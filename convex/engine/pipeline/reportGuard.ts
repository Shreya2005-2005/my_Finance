/**
 * REPORT GUARD: the last safety net before a report is shown.
 *
 * The AI writes the report from verified claims only, and tags every sentence with the claim IDs
 * it used. This code then removes anything that breaks the rules:
 *   1. A sentence with no claim IDs is dropped (nothing proves it).
 *   2. A sentence citing an unknown or unverified claim is dropped.
 *   3. A number in the sentence that the cited claims do not contain is dropped (AI invented or mangled it).
 */
import type { FinalVerdict } from "../enums.ts";
import { checkNumbers } from "../lib/numbers.ts";

export interface DraftSentence {
  text: string;
  claimIds: string[];
}

export interface KnownClaim {
  id: string;
  text: string;
  quote: string;
  verdict: FinalVerdict;
}

export interface GuardResult {
  kept: DraftSentence[];
  dropped: Array<{ sentence: DraftSentence; reason: string }>;
}

export function guardSentences(sentences: DraftSentence[], claims: KnownClaim[]): GuardResult {
  const byId = new Map(claims.map((c) => [c.id, c]));
  const kept: DraftSentence[] = [];
  const dropped: GuardResult["dropped"] = [];

  for (const s of sentences) {
    if (s.claimIds.length === 0) {
      dropped.push({ sentence: s, reason: "No claim cited." });
      continue;
    }
    const cited = s.claimIds.map((id) => byId.get(id));
    if (cited.some((c) => c === undefined)) {
      dropped.push({ sentence: s, reason: "Cites a claim that does not exist." });
      continue;
    }
    const real = cited as KnownClaim[];
    const badClaim = real.find((c) => c.verdict !== "verified" && c.verdict !== "partially_verified");
    if (badClaim) {
      dropped.push({ sentence: s, reason: `Cites an ${badClaim.verdict} claim.` });
      continue;
    }
    // Every number in the sentence must appear in the evidence of the claims it cites.
    const evidence = real.map((c) => `${c.text} ${c.quote}`).join(" ");
    const nums = checkNumbers(s.text, evidence);
    if (!nums.allMatch) {
      dropped.push({ sentence: s, reason: `Number(s) not supported by the cited claims: ${nums.missing.map((m) => m.raw).join(", ")}.` });
      continue;
    }
    kept.push(s);
  }
  return { kept, dropped };
}
