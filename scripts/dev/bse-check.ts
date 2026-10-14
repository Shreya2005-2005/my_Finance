/**
 * Quick manual check of the BSE adapter against the real service.  Run: node scripts/dev/bse-check.ts "tata motors"
 */
import { getAnnouncements, getAnnualReports, searchCompany } from "../../convex/engine/providers/bse.ts";

const ctx = { fetch, now: () => Date.now(), env: process.env as Record<string, string | undefined> };
const name = process.argv[2] ?? "tata motors";

const s = await searchCompany(name, ctx);
console.log("search:", s.ok ? s.value.slice(0, 3) : `${s.error.kind} ${s.error.message}`);
if (s.ok && s.value[0]) {
  const code = s.value[0].scripCode;
  const a = await getAnnouncements(code, { since: Date.now() - 90 * 864e5 }, ctx);
  console.log("announcements:", a.ok ? `${a.value.length} (first: ${a.value[0]?.title?.slice(0, 80)})` : `${a.error.kind} ${a.error.message}`);
  const r = await getAnnualReports(code, ctx);
  console.log("annual reports:", r.ok ? `${r.value.length} (newest: ${r.value[0]?.title})` : `${r.error.kind} ${r.error.message}`);
}
