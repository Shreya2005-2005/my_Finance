export {};
/**
 * LIVE CHECK: which search wording brings back the snippet that holds the numbers?
 *
 *   node scripts/dev/snippet-check.ts http://localhost:5174 Oracle "803\.80" "operating profit 2026" "results highlights operating profit"
 *
 * Prints, for each wording, the first source whose text matches the pattern.
 */
const [base = "http://localhost:5173", company = "Oracle", pattern = "803\\.80", ...focuses] = process.argv.slice(2);
const re = new RegExp(pattern);
for (const focus of focuses) {
  const ev = await (await fetch(`${base}/api/evidence?company=${encodeURIComponent(company)}&days=30&focus=${encodeURIComponent(focus)}`)).json();
  const hit = (ev.sources as Array<{ publisher?: string; title: string; text?: string }>).find((s) => re.test(`${s.title} ${s.text ?? ""}`));
  console.log(`${hit ? "FOUND  " : "missing"} | ${focus} | ${ev.sources.length} sources${hit ? ` | ${hit.publisher}: ${hit.text?.slice(0, 80)}` : ""}`);
}
