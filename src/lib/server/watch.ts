import { alertLevel, MAX_ALERTS, pickTopAlerts, whyText } from "$engine/watch/alerts.ts";
import type { WatchAlertsResponse } from "$lib/types";
import { liveEvidence } from "./evidence";

/**
 * The top alerts for one company (never more than 5).
 * Uses the same gathered stories as the Research page, so the two always agree, and a company
 * you just researched needs no new lookup.
 */
export async function watchAlerts(company: string): Promise<WatchAlertsResponse> {
  const ev = await liveEvidence(company);
  const recognised = ev.stories.filter((s) => s.trust !== "weak_only");
  const alerts = pickTopAlerts(recognised, MAX_ALERTS, company.split(/\s+/)).map((s) => ({
    key: s.key,
    type: s.type,
    title: s.head.title,
    url: s.head.url,
    level: alertLevel(s.importance),
    outlets: s.outlets,
    why: whyText(s),
    publishedAt: s.lastSeen,
  }));

  const news = ev.channels.find((c) => c.id === "news");
  const error = ev.stories.length === 0 && news?.status === "error" ? news.note : undefined;
  return { company: ev.company, alerts, totalStories: recognised.length, fetchedAt: ev.fetchedAt, error };
}
