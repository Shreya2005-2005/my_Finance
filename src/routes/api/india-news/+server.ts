import { json } from "@sveltejs/kit";
import { indianNews } from "$lib/server/indianews";
import type { RequestHandler } from "./$types";

/** Today's Indian market news (5 to 10 stories) from free public feeds. */
export const GET: RequestHandler = async () => json(await indianNews());
