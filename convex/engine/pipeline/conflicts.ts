/**
 * CONFLICT DETECTION: do independent sources disagree about the same number?
 *
 * Rules (all plain code, the AI never decides this):
 *   - Facts are only compared if they describe the SAME thing: same company, metric,
 *     period, accounting basis (consolidated vs standalone) and unit.
 *   - Copies of one story do not count as two sources. Only independent origins are compared.
 *   - Small differences are treated as rounding; bigger ones as real conflicts.
 *   - We NEVER hide one side. We mark which side we lean towards, and say why.
 */
import { AUTHORITY_SCORE, CONFLICT } from "../../config/engine.ts";
import type { AccountingBasis, AuthorityTier, ConflictSeverity } from "../enums.ts";
import { relativeDiff } from "../lib/numbers.ts";

export interface FactInput {
  id: string;
  entityId: string;
  metric: string;
  value: number; // base units
  unit: string;
  currency?: string;
  period: string;
  basis: AccountingBasis;
  sourceId: string;
  /** Copies of the same story share an origin. Independent reporting has its own. */
  originGroupId: string;
  authorityTier: AuthorityTier;
  publishedAt?: number;
}

/** Two facts are comparable only if this key is identical. */
export function buildFactKey(f: Pick<FactInput, "entityId" | "metric" | "period" | "basis" | "unit" | "currency">): string {
  return [f.entityId, f.metric.toLowerCase().trim(), f.period.toUpperCase().trim(), f.basis, f.unit.toLowerCase(), (f.currency ?? "").toUpperCase()].join("|");
}

export interface DetectedConflict {
  factKey: string;
  severity: ConflictSeverity;
  /** Largest relative difference found between any two independent values. */
  maxDiff: number;
  items: FactInput[];
  preferredIndex: number;
  reason: string;
}

/** Picks the side to lean towards: most authoritative source; ties go to the more recent. */
export function pickPreferred(items: FactInput[]): { index: number; reason: string } {
  let best = 0;
  for (let i = 1; i < items.length; i++) {
    const a = items[best]!;
    const b = items[i]!;
    const sa = AUTHORITY_SCORE[a.authorityTier];
    const sb = AUTHORITY_SCORE[b.authorityTier];
    if (sb > sa || (sb === sa && (b.publishedAt ?? 0) > (a.publishedAt ?? 0))) best = i;
  }
  const w = items[best]!;
  const others = items.filter((_, i) => i !== best);
  const sameTier = others.every((o) => o.authorityTier === w.authorityTier);
  const reason = sameTier
    ? "Sources have equal authority, so the most recent one is shown first."
    : `Preferred because its source type ("${w.authorityTier}") is more authoritative.`;
  return { index: best, reason };
}

/** Keeps one fact per independent origin (the most authoritative / most recent one of each). */
function onePerOrigin(facts: FactInput[]): FactInput[] {
  const byOrigin = new Map<string, FactInput>();
  for (const f of facts) {
    const cur = byOrigin.get(f.originGroupId);
    if (!cur) byOrigin.set(f.originGroupId, f);
    else {
      const better =
        AUTHORITY_SCORE[f.authorityTier] > AUTHORITY_SCORE[cur.authorityTier] ||
        (AUTHORITY_SCORE[f.authorityTier] === AUTHORITY_SCORE[cur.authorityTier] && (f.publishedAt ?? 0) > (cur.publishedAt ?? 0));
      if (better) byOrigin.set(f.originGroupId, f);
    }
  }
  return [...byOrigin.values()];
}

/**
 * Finds disagreements among a set of facts.
 * Returns only groups that are "minor" or "conflict". Groups that agree are not reported.
 */
export function detectNumericConflicts(facts: FactInput[]): DetectedConflict[] {
  const groups = new Map<string, FactInput[]>();
  for (const f of facts) {
    const key = buildFactKey(f);
    const list = groups.get(key);
    if (list) list.push(f);
    else groups.set(key, [f]);
  }

  const results: DetectedConflict[] = [];
  for (const [factKey, list] of groups) {
    const independent = onePerOrigin(list);
    if (independent.length < 2) continue; // one voice cannot disagree with itself

    let maxDiff = 0;
    for (let i = 0; i < independent.length; i++) {
      for (let j = i + 1; j < independent.length; j++) {
        maxDiff = Math.max(maxDiff, relativeDiff(independent[i]!.value, independent[j]!.value));
      }
    }

    const metricName = independent[0]!.metric.toLowerCase();
    const override = (CONFLICT.perMetric as Record<string, { agreeTolerance?: number; conflictThreshold?: number }>)[metricName];
    const agree = override?.agreeTolerance ?? CONFLICT.agreeTolerance;
    const threshold = override?.conflictThreshold ?? CONFLICT.conflictThreshold;

    if (maxDiff <= agree) continue; // sources agree
    const severity: ConflictSeverity = maxDiff <= threshold ? "minor" : "conflict";
    const pref = pickPreferred(independent);
    results.push({ factKey, severity, maxDiff, items: independent, preferredIndex: pref.index, reason: pref.reason });
  }
  return results.sort((a, b) => b.maxDiff - a.maxDiff);
}

/**
 * Same company/metric/period but reported in DIFFERENT currencies. We never convert silently;
 * we flag it so a human knows the numbers are not directly comparable.
 */
export function findCurrencyMismatches(facts: FactInput[]): Array<{ entityId: string; metric: string; period: string; currencies: string[] }> {
  const groups = new Map<string, FactInput[]>();
  for (const f of facts) {
    const k = [f.entityId, f.metric.toLowerCase(), f.period.toUpperCase(), f.basis].join("|");
    const l = groups.get(k);
    if (l) l.push(f);
    else groups.set(k, [f]);
  }
  const out = [];
  for (const list of groups.values()) {
    const currencies = [...new Set(list.map((f) => (f.currency ?? "").toUpperCase()).filter(Boolean))];
    if (currencies.length > 1) {
      const f = list[0]!;
      out.push({ entityId: f.entityId, metric: f.metric, period: f.period, currencies });
    }
  }
  return out;
}

/** Evaluation helper: of the conflicts we SHOULD find, how many did we find? (target: 90% or more) */
export function conflictRecall(expectedKeys: string[], found: DetectedConflict[]): number {
  if (expectedKeys.length === 0) return 1;
  const foundKeys = new Set(found.map((c) => c.factKey));
  return expectedKeys.filter((k) => foundKeys.has(k)).length / expectedKeys.length;
}
