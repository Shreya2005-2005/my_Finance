import { json } from "@sveltejs/kit";
import { readDocument } from "$lib/server/evidence";
import type { RequestHandler } from "./$types";

/** Reads the text of one filing (BSE PDFs only) or one news article. Address safety is checked inside the engine. */
export const GET: RequestHandler = async ({ url }) => {
  const target = (url.searchParams.get("url") ?? "").slice(0, 600);
  const kind = url.searchParams.get("kind") === "article" ? "article" : "filing";
  if (!target) return json({ error: "No address given." }, { status: 400 });
  return json(await readDocument(target, kind));
};
