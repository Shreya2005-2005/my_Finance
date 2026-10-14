/**
 * SAMPLE RESEARCH REPORT
 *
 * Shows the finished shape of a Verifin report using a FICTIONAL company ("Northwind Motors"),
 * so no real company is ever given made-up numbers.
 *
 * What is real here: the code checks, conflict detection, confidence scores and the report guard
 * all run the real engine. What is recorded: the "AI" steps (claim extraction, the judge's opinion
 * and the draft report text), because those need a Gemini key. The page says so.
 */
import { buildFactKey, detectNumericConflicts, type FactInput } from "$engine/pipeline/conflicts.ts";
import { scoreClaim } from "$engine/pipeline/confidence.ts";
import { guardSentences, type KnownClaim } from "$engine/pipeline/reportGuard.ts";
import { finalVerdict, verifiedShare, verifyLayer1 } from "$engine/pipeline/verify.ts";
import type { AuthorityTier, JudgeVerdict } from "$engine/enums.ts";
import type { SampleClaim, SampleFactRow, SampleReport } from "$lib/types";

const COMPANY = "Northwind Motors";
const DAY = 86_400_000;
const NOW = Date.now();

interface Src {
  name: string;
  tier: AuthorityTier;
  ageDays: number;
  text: string;
}
const SOURCES: Record<string, Src> = {
  A: {
    name: "Northwind Motors Annual Report FY2025",
    tier: "primary",
    ageDays: 120,
    text: "Northwind Motors Ltd reported consolidated revenue of Rs 1,20,000 crore for FY2025, up 12.5% from FY2024. Net profit stood at Rs 17,500 crore. The company plans to open two new plants by 2027.",
  },
  B: {
    name: "Business Standard",
    tier: "wire",
    ageDays: 90,
    text: "Northwind Motors posted FY2025 consolidated revenue of Rs 1,19,800 crore, according to filings. Net profit was Rs 17,450 crore. Analysts expect margins to stay under pressure.",
  },
  C: {
    name: "AutoBlog Daily",
    tier: "unknown",
    ageDays: 30,
    text: "Northwind Motors made a net profit of Rs 14,900 crore in FY2025 and sold 9.2 lakh vehicles during the year.",
  },
};

interface RecordedClaim {
  id: string;
  text: string;
  quote: string;
  src: keyof typeof SOURCES;
  /** What the AI judge said (recorded sample answer). */
  judge: { verdict: JudgeVerdict; reason: string };
  fact?: { metric: string; value: number; period: string };
}

const CLAIMS: RecordedClaim[] = [
  { id: "c1", text: "Northwind Motors reported consolidated revenue of Rs 1,20,000 crore for FY2025", quote: "reported consolidated revenue of Rs 1,20,000 crore for FY2025", src: "A", judge: { verdict: "supported", reason: "The passage states the same revenue for the same year." }, fact: { metric: "revenue", value: 120_000e7, period: "FY2025" } },
  { id: "c2", text: "Northwind Motors revenue grew 12.5% in FY2025", quote: "up 12.5% from FY2024", src: "A", judge: { verdict: "supported", reason: "The passage gives the same growth rate." } },
  { id: "c3", text: "Northwind Motors net profit stood at Rs 17,500 crore in FY2025", quote: "Net profit stood at Rs 17,500 crore", src: "A", judge: { verdict: "supported", reason: "The passage states this profit figure." }, fact: { metric: "net_profit", value: 17_500e7, period: "FY2025" } },
  { id: "c4", text: "Northwind Motors revenue was Rs 1,19,800 crore in FY2025", quote: "FY2025 consolidated revenue of Rs 1,19,800 crore", src: "B", judge: { verdict: "supported", reason: "Matches the passage." }, fact: { metric: "revenue", value: 119_800e7, period: "FY2025" } },
  { id: "c5", text: "Northwind Motors net profit was Rs 17,450 crore in FY2025", quote: "Net profit was Rs 17,450 crore", src: "B", judge: { verdict: "supported", reason: "Matches the passage." }, fact: { metric: "net_profit", value: 17_450e7, period: "FY2025" } },
  { id: "c6", text: "Northwind Motors made a net profit of Rs 14,900 crore in FY2025", quote: "made a net profit of Rs 14,900 crore in FY2025", src: "C", judge: { verdict: "supported", reason: "The passage says this, although it disagrees with the other sources." }, fact: { metric: "net_profit", value: 14_900e7, period: "FY2025" } },
  { id: "c7", text: "Northwind Motors sold 9.2 lakh vehicles in FY2025", quote: "sold 9.2 lakh vehicles during the year", src: "C", judge: { verdict: "partially_supported", reason: "The passage gives the number but not the exact period." } },
  { id: "c8", text: "Northwind Motors plans to open two new plants by 2030", quote: "plans to open two new plants by 2027", src: "A", judge: { verdict: "supported", reason: "(A careless AI judge may miss the year change. The code check does not.)" } },
  { id: "c9", text: "Northwind Motors will pay a dividend of Rs 12 per share", quote: "The board recommended a dividend of Rs 12 per share", src: "A", judge: { verdict: "supported", reason: "(Recorded as a hallucinated quote the AI invented.)" } },
];

/** Draft report the AI "wrote" (recorded). Two sentences are deliberately bad, to show the guard working. */
const DRAFT: Array<{ title: string; sentences: Array<{ text: string; claimIds: string[] }> }> = [
  {
    title: "Financial snapshot",
    sentences: [
      { text: "Northwind Motors reported consolidated revenue of Rs 1,20,000 crore for FY2025.", claimIds: ["c1"] },
      { text: "Revenue grew 12.5% over the previous year.", claimIds: ["c2"] },
      { text: "Net profit was reported at Rs 17,500 crore.", claimIds: ["c3"] },
      { text: "Revenue reached Rs 1,25,000 crore, a record for the sector.", claimIds: ["c1"] },
    ],
  },
  {
    title: "Operations and outlook",
    sentences: [
      { text: "The company sold about 9.2 lakh vehicles during the year.", claimIds: ["c7"] },
      { text: "Northwind is widely seen as the best-run carmaker in the country.", claimIds: [] },
      { text: "It plans to open two new plants by 2030.", claimIds: ["c8"] },
    ],
  },
];

export function sampleReport(): SampleReport {
  // 1. Check every claim. Check 1 is real code. The judge's answer is recorded.
  const base = CLAIMS.map((c) => {
    const s = SOURCES[c.src]!;
    const l1 = verifyLayer1({ claimText: c.text, quote: c.quote, sourceText: s.text, entityNames: [COMPANY] });
    const verdict = finalVerdict(l1.passed, c.judge.verdict);
    return { c, s, l1, verdict };
  });

  // 2. Compare numbers across independent sources.
  const facts: FactInput[] = base
    .filter((b) => b.c.fact && (b.verdict === "verified" || b.verdict === "partially_verified"))
    .map((b) => ({
      id: b.c.id,
      entityId: COMPANY,
      metric: b.c.fact!.metric,
      value: b.c.fact!.value,
      unit: "INR",
      currency: "INR",
      period: b.c.fact!.period,
      basis: "consolidated",
      sourceId: b.s.name,
      originGroupId: b.c.src,
      authorityTier: b.s.tier,
      publishedAt: NOW - b.s.ageDays * DAY,
    }));
  const conflicts = detectNumericConflicts(facts);
  const conflictByKey = new Map(conflicts.map((c) => [c.factKey, c]));

  // 3. Score each verified claim.
  const claims: SampleClaim[] = base.map(({ c, s, l1, verdict }) => {
    let conflictSeverity = 0;
    let support = 1;
    if (c.fact) {
      const f = facts.find((x) => x.id === c.id);
      if (f) {
        const key = buildFactKey(f);
        const peers = facts.filter((x) => buildFactKey(x) === key);
        support = peers.filter((p) => Math.abs(p.value - f.value) / Math.max(p.value, f.value) <= 0.02).length;
        const cf = conflictByKey.get(key);
        if (cf && cf.severity === "conflict") {
          const preferred = cf.items[cf.preferredIndex]!;
          conflictSeverity = Math.abs(preferred.value - f.value) / Math.max(preferred.value, f.value) > 0.02 ? 1 : 0.4;
        }
      }
    }
    const score = scoreClaim({ verdict, authorityTier: s.tier, claimType: c.fact ? "financial_figure" : "general", independentSupport: support, publishedAt: NOW - s.ageDays * DAY, now: NOW, conflictSeverity });
    return {
      id: c.id,
      text: c.text,
      quote: c.quote,
      source: s.name,
      tier: s.tier,
      checks: [
        { label: "Quote is in the source", passed: l1.quoteFound },
        { label: "Numbers match", passed: l1.numbersMatch },
        { label: "Years match", passed: l1.datesMatch },
        { label: "Company named", passed: l1.entityMatch },
      ],
      problems: l1.problems,
      judge: { verdict: c.judge.verdict, reason: c.judge.reason },
      verdict,
      confidence: score ? { score: score.score, band: score.band, components: score.components } : undefined,
    };
  });

  // 4. Build the fact table (agreeing groups too, not only conflicts).
  const groups = new Map<string, FactInput[]>();
  for (const f of facts) groups.set(buildFactKey(f), [...(groups.get(buildFactKey(f)) ?? []), f]);
  const crore = (v: number) => `Rs ${(v / 1e7).toLocaleString("en-IN")} crore`;
  const factRows: SampleFactRow[] = [...groups.entries()].map(([key, list]) => {
    const cf = conflictByKey.get(key);
    const values = list.map((f) => ({ source: f.sourceId, tier: f.authorityTier, display: crore(f.value) }));
    const vals = list.map((f) => f.value);
    const diff = Math.max(...vals) === 0 ? 0 : (Math.max(...vals) - Math.min(...vals)) / Math.max(...vals);
    return {
      metric: list[0]!.metric.replace("_", " "),
      period: list[0]!.period,
      values,
      status: cf ? (cf.severity === "conflict" ? "conflict" : "minor") : "agree",
      diffPct: Number((diff * 100).toFixed(2)),
      lean: cf ? cf.items[cf.preferredIndex]!.sourceId : undefined,
      reason: cf?.reason,
    };
  });

  // 5. Report guard.
  const known: KnownClaim[] = claims.map((c) => ({ id: c.id, text: c.text, quote: c.quote, verdict: c.verdict }));
  const removed: SampleReport["removed"] = [];
  const sections = DRAFT.map((sec) => {
    const g = guardSentences(sec.sentences, known);
    for (const d of g.dropped) removed.push({ text: d.sentence.text, reason: d.reason });
    return { title: sec.title, sentences: g.kept };
  });

  const gaps = ["Margins: no verified source found", "Debt and cash position: not searched in the sample"];
  return { company: COMPANY, claims, facts: factRows, sections, removed, gaps, verifiedShare: verifiedShare(claims.map((c) => c.verdict)) };
}
