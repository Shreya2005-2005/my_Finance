import { json } from "@sveltejs/kit";
import { clean } from "$lib/server/context";
import { liveEvidence } from "$lib/server/evidence";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url }) => {
  const company = clean(url.searchParams.get("company"));
  if (!company) return json({ error: "Please enter a company name." }, { status: 400 });
  const scrip = clean(url.searchParams.get("scrip"), 8);
  const days = Number(url.searchParams.get("days")) || 7;
  const focus = clean(url.searchParams.get("focus"), 120);
  return json(await liveEvidence(company, /^\d{5,6}$/.test(scrip) ? scrip : undefined, days, focus));
};
