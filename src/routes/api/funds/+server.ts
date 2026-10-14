import { json } from "@sveltejs/kit";
import { clean } from "$lib/server/context";
import { PROFILES, rankFundType, type Profile } from "$lib/server/funds";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url }) => {
  const typeId = clean(url.searchParams.get("type"), 20);
  const p = url.searchParams.get("profile") as Profile;
  const count = Math.max(5, Math.min(10, Number(url.searchParams.get("count")) || 5));

  // An SIP amount is optional. Keep it to sensible limits.
  const monthly = Math.round(Number(url.searchParams.get("sip")));
  const years = Number(url.searchParams.get("years"));
  const sip = monthly >= 100 && monthly <= 10_000_000 && (years === 3 || years === 5) ? { monthly, years } : undefined;

  return json(await rankFundType(typeId, PROFILES.includes(p) ? p : "balanced", count, sip));
};
