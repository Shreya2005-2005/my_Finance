/**
 * The list of all data sources the engine can use. The engine asks THIS file "who can give me news?"
 * and never imports a specific provider, so adding or removing a source is a one-line change here.
 */
import { finnhub } from "./finnhub.ts";
import { gdelt } from "./gdelt.ts";
import { googleNews } from "./googleNews.ts";
import { mfapi } from "./mfapi.ts";
import type { NewsProvider, Provider } from "./types.ts";

export const ALL_PROVIDERS: Provider[] = [googleNews, gdelt, finnhub, mfapi];

/** Order matters: the first is tried first. Google News is the most reliable keyless source we found. */
export const NEWS_PROVIDERS: NewsProvider[] = [googleNews, finnhub, gdelt];

export function configuredProviders(env: Record<string, string | undefined>): Provider[] {
  return ALL_PROVIDERS.filter((p) => p.isConfigured(env));
}
