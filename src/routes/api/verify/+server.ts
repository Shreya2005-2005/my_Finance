import { json } from "@sveltejs/kit";
import { clean } from "$lib/server/context";
import { checkClaim } from "$lib/server/verify";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const source = clean(body.source, 20000);
  const claim = clean(body.claim, 600);
  const quote = clean(body.quote, 1200);
  if (!source || !claim || !quote) return json({ error: "Please fill in the source, the claim and the quote." }, { status: 400 });
  return json(checkClaim({ source, claim, quote, company: clean(body.company, 80) }));
};
