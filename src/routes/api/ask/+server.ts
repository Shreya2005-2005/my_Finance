import { json } from "@sveltejs/kit";
import { ask } from "$lib/server/ask";
import { clean } from "$lib/server/context";
import type { RequestHandler } from "./$types";

/** One box for a company name, a question or a claim. Returns what it understood and, when possible, the official answer. */
export const GET: RequestHandler = async ({ url }) => {
  const q = clean(url.searchParams.get("q"), 300);
  if (!q) return json({ error: "Please type a company name, a question or a claim." }, { status: 400 });
  return json(await ask(q));
};
