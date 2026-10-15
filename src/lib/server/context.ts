/**
 * Shared server helpers: the "outside world" handed to the engine, and a small memory cache.
 * The cache keeps us polite to free APIs (and makes repeat clicks instant).
 */
import { env } from "$env/dynamic/private";
import type { ProviderContext } from "$engine/providers/types.ts";

export function providerContext(): ProviderContext {
  return { fetch, now: () => Date.now(), env: env as Record<string, string | undefined> };
}

const store = new Map<string, { at: number; value: unknown }>();

/** Returns the saved answer if it is younger than ttlMs, otherwise runs `make` and saves the result. */
export async function cached<T>(key: string, ttlMs: number, make: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await make();
  store.set(key, { at: Date.now(), value });
  if (store.size > 200) store.delete(store.keys().next().value!); // never grow without limit
  return value;
}

/**
 * How we introduce ourselves to outside websites (Wikimedia, the news feeds, the SEC). We always say who we are:
 * set CONTACT_USER_AGENT (or SEC_USER_AGENT) in .env.local to your name and email.
 */
export const contactAgent = (): string =>
  env.CONTACT_USER_AGENT || env.SEC_USER_AGENT || "Verifin student research project (set CONTACT_USER_AGENT to your name and email)";

/** Forgets one saved answer (used so a failed call is never kept). */
export const forget = (key: string) => void store.delete(key);

/** Cleans user text from the address bar or a form: trims and limits the length. */
export const clean = (s: string | null | undefined, max = 80) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
