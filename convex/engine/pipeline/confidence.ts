/**
 * CONFIDENCE SCORE for one claim (0 to 100), calculated by a formula, never by AI.
 *
 *   score = 100 * ( wA*Authority + wC*Corroboration + wR*Recency + wV*Verification - penalty*Conflict )
 *
 * All weights live in convex/config/engine.ts so they can be tuned and audited.
 * An UNVERIFIED claim gets no score at all: we never show a trust badge on something we could not prove.
 */
import { AUTHORITY_SCORE, CONFIDENCE } from "../../config/engine.ts";
import type { AuthorityTier, ClaimType, ConfidenceBand, FinalVerdict } from "../enums.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ConfidenceInput {
  verdict: FinalVerdict;
  authorityTier: AuthorityTier;
  claimType: ClaimType;
  /** How many INDEPENDENT origins support this claim (copies of one story count once). */
  independentSupport: number;
  publishedAt?: number;
  now: number;
  /** 0 = no conflict, 1 = a major unresolved conflict touches this claim. */
  conflictSeverity: number;
}

export interface ConfidenceResult {
  score: number;
  band: ConfidenceBand;
  components: {
    authority: number;
    corroboration: number;
    recency: number;
    verification: number;
    conflictPenalty: number;
  };
}

/** 1 source = 0.5, 2 = 0.75, 3 = 0.875 ... approaches 1 but never reaches it. */
export function corroborationValue(independentSupport: number): number {
  return 1 - 0.5 ** Math.max(0, independentSupport);
}

/** 1.0 when brand new; 0.5 after one half-life; keeps falling. Unknown date = neutral 0.5. */
export function recencyValue(publishedAt: number | undefined, claimType: ClaimType, now: number): number {
  if (publishedAt === undefined) return 0.5;
  const ageDays = Math.max(0, (now - publishedAt) / DAY_MS);
  return 0.5 ** (ageDays / CONFIDENCE.recencyHalfLifeDays[claimType]);
}

export function bandFor(score: number): ConfidenceBand {
  if (score >= CONFIDENCE.bands.high) return "high";
  if (score >= CONFIDENCE.bands.medium) return "medium";
  return "low";
}

/** Returns undefined for claims that are not verified: they get NO score on purpose. */
export function scoreClaim(i: ConfidenceInput): ConfidenceResult | undefined {
  if (i.verdict !== "verified" && i.verdict !== "partially_verified") return undefined;

  const w = CONFIDENCE.weights;
  const authority = AUTHORITY_SCORE[i.authorityTier];
  const corroboration = corroborationValue(i.independentSupport);
  const recency = recencyValue(i.publishedAt, i.claimType, i.now);
  const verification = CONFIDENCE.verificationValue[i.verdict];
  const conflictPenalty = Math.min(1, Math.max(0, i.conflictSeverity)) * CONFIDENCE.maxConflictPenalty;

  const raw = w.authority * authority + w.corroboration * corroboration + w.recency * recency + w.verification * verification - conflictPenalty;
  const score = Math.round(Math.min(1, Math.max(0, raw)) * 100);
  return { score, band: bandFor(score), components: { authority, corroboration, recency, verification, conflictPenalty } };
}
