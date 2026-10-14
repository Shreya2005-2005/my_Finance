/**
 * FOLLOW-UP RESEARCH: when is the evidence "not enough"?
 *
 * After the first pass, plain code looks for gaps. Each gap becomes a targeted search in the next
 * round (maximum 2 rounds, see RUN_BUDGET). Gaps that remain are shown in the report as "Not found".
 */
import { FOLLOW_UP, RUN_BUDGET } from "../../config/engine.ts";
import type { FinalVerdict } from "../enums.ts";
import { verifiedShare } from "./verify.ts";

export interface QuestionStatus {
  questionId: string;
  text: string;
  /** Verified claims that answer this question. */
  verifiedClaims: number;
  isKeyMetric: boolean;
  independentSources: number;
}

export interface ConflictStatus {
  factKey: string;
  hasPrimarySource: boolean;
}

export type Gap =
  | { kind: "no_evidence"; questionId: string; text: string }
  | { kind: "single_source"; questionId: string; text: string }
  | { kind: "unresolved_conflict"; factKey: string }
  | { kind: "low_verified_share"; share: number };

export function findGaps(input: {
  questions: QuestionStatus[];
  conflicts: ConflictStatus[];
  verdicts: FinalVerdict[];
}): Gap[] {
  const gaps: Gap[] = [];
  for (const q of input.questions) {
    if (q.verifiedClaims === 0) gaps.push({ kind: "no_evidence", questionId: q.questionId, text: q.text });
    else if (q.isKeyMetric && q.independentSources < FOLLOW_UP.minIndependentSourcesForKeyMetric) {
      gaps.push({ kind: "single_source", questionId: q.questionId, text: q.text });
    }
  }
  for (const c of input.conflicts) if (!c.hasPrimarySource) gaps.push({ kind: "unresolved_conflict", factKey: c.factKey });
  if (input.verdicts.length > 0) {
    const share = verifiedShare(input.verdicts);
    if (share < FOLLOW_UP.minVerifiedShare) gaps.push({ kind: "low_verified_share", share });
  }
  return gaps;
}

/**
 * Should we do another round? Yes only if there are gaps, we have rounds left, and the last round
 * actually made progress (otherwise we would loop forever on something that cannot be found).
 */
export function shouldFollowUp(input: { gaps: Gap[]; round: number; previousGapCount?: number; maxRounds?: number }): {
  go: boolean;
  why: string;
} {
  const max = input.maxRounds ?? RUN_BUDGET.maxFollowUpRounds;
  if (input.gaps.length === 0) return { go: false, why: "No gaps: the evidence is sufficient." };
  if (input.round >= max) return { go: false, why: `Reached the limit of ${max} follow-up rounds.` };
  if (input.previousGapCount !== undefined && input.gaps.length >= input.previousGapCount) {
    return { go: false, why: "The last round did not reduce the gaps, so stopping." };
  }
  return { go: true, why: `${input.gaps.length} gap(s) remain; starting round ${input.round + 1}.` };
}
