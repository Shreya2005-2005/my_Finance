import { json } from "@sveltejs/kit";
import { dailyNews } from "$lib/server/dailynews";
import type { RequestHandler } from "./$types";

/** The day's top market headlines (5 to 10), from Finnhub. */
export const GET: RequestHandler = async () => json(await dailyNews());
