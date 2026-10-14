import { json } from "@sveltejs/kit";
import { clean } from "$lib/server/context";
import { watchAlerts } from "$lib/server/watch";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url }) => {
  const company = clean(url.searchParams.get("company"));
  if (!company) return json({ error: "Please enter a company name." }, { status: 400 });
  return json(await watchAlerts(company));
};
