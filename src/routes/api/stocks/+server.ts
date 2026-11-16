import { json } from "@sveltejs/kit";
import { clean } from "$lib/server/context";
import { stockNews, topStocks } from "$lib/server/stocks";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url }) => {
  const news = clean(url.searchParams.get("news"), 20).toUpperCase();
  return json(news ? await stockNews(news) : await topStocks());
};
